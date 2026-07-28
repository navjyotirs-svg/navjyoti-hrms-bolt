import { createClient } from "npm:@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, Apikey",
};

const REQUIRED_TOTAL_MINUTES = 540;
const ATTENDANCE_POLICY_VERSION = "POLICY_540_FULL_DAY";
const APPROVED_EVIDENCE_MIMES = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
const MAX_EVIDENCE_BYTES = 10 * 1024 * 1024; // 10MB

interface CheckInRequest {
  action: "check_in";
  photo_base64: string;
  evidence_mime_type: string;
  latitude: number;
  longitude: number;
  location_accuracy?: number;
}

interface CheckOutRequest {
  action: "check_out";
  photo_base64: string;
  evidence_mime_type: string;
  latitude: number;
  longitude: number;
  location_accuracy?: number;
}

type AttendanceRequest = CheckInRequest | CheckOutRequest;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return jsonError(401, "Missing authorization header");

    const callerClient = createClient(supabaseUrl, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: callerData, error: callerError } =
      await callerClient.auth.getUser(authHeader.replace("Bearer ", ""));

    if (callerError || !callerData.user) {
      return jsonError(401, "Invalid session");
    }

    const callerId = callerData.user.id;

    // Fetch caller profile
    const { data: profile, error: profileError } = await admin
      .from("user_profiles")
      .select("id, role, organization_id, status")
      .eq("id", callerId)
      .maybeSingle();

    if (profileError || !profile) {
      return jsonError(403, "Profile not found");
    }

    if (profile.status === "disabled") {
      return jsonError(403, "Account disabled");
    }

    // Fetch employee record for the caller
    const { data: employee, error: empError } = await admin
      .from("employees")
      .select("id, organization_id, branch_id, employment_status, is_active, user_id")
      .eq("user_id", callerId)
      .maybeSingle();

    if (empError || !employee) {
      return jsonError(403, "Employee record not found");
    }

    if (!employee.is_active || !["active", "on_probation", "confirmed", "notice_period"].includes(employee.employment_status)) {
      return jsonError(403, "Employee is not active and cannot record attendance");
    }

    // Read attendance config from vault secrets (stored in database, not Deno.env)
    const config = await loadAttendanceConfig(admin);

    // Check test mode (server environment only)
    // Production is detected via SUPABASE_ENV=production secret.
    // Test mode is rejected when SUPABASE_ENV is "production" regardless of ATTENDANCE_TEST_MODE.
    const testMode = config.testMode && !config.isProduction;
    const totalMinutes = testMode ? config.totalMinutes : REQUIRED_TOTAL_MINUTES;

    const body: AttendanceRequest = await req.json();

    if (body.action === "check_in") {
      return handleCheckIn(admin, supabaseUrl, serviceKey, callerId, employee, totalMinutes, body as CheckInRequest);
    } else if (body.action === "check_out") {
      return handleCheckOut(admin, supabaseUrl, serviceKey, callerId, employee, body as CheckOutRequest);
    } else {
      return jsonError(400, "Invalid action");
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return jsonError(500, message);
  }
});

async function loadAttendanceConfig(admin: ReturnType<typeof createClient>): Promise<{
  testMode: boolean;
  isProduction: boolean;
  totalMinutes: number;
  preAlertMinutes: number;
}> {
  const { data, error } = await admin.rpc("get_attendance_config");
  if (error || !data) {
    return { testMode: false, isProduction: false, totalMinutes: 540, preAlertMinutes: 2 };
  }

  const cfg = data as Record<string, string>;
  const testMode = cfg["ATTENDANCE_TEST_MODE"] === "true";
  const isProduction = cfg["SUPABASE_ENV"] === "production";
  const totalMinutes = parseInt(cfg["ATTENDANCE_TOTAL_MINUTES"] ?? "540", 10);
  const preAlertMinutes = parseInt(cfg["ATTENDANCE_PRE_ALERT_MINUTES"] ?? "2", 10);

  return { testMode, isProduction, totalMinutes, preAlertMinutes };
}

/**
 * Upload a base64-encoded photo to the attendance-evidence storage bucket
 * using the service role key (bypasses RLS). Returns the storage path.
 */
async function uploadEvidencePhoto(
  supabaseUrl: string,
  serviceKey: string,
  callerId: string,
  photoBase64: string,
  mimeType: string
): Promise<string> {
  const ext = mimeType.split("/")[1] ?? "jpg";
  const path = `${callerId}/${crypto.randomUUID()}.${ext}`;

  // Decode base64 to binary
  const binaryString = atob(photoBase64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }

  const uploadUrl = `${supabaseUrl}/storage/v1/object/attendance-evidence/${path}`;

  const resp = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${serviceKey}`,
      "Content-Type": mimeType,
      "x-upsert": "false",
    },
    body: bytes,
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Storage upload failed (${resp.status}): ${text}`);
  }

  return path;
}

/**
 * Validate the photo + location evidence payload.
 * Returns an error string on failure, or null when the payload is valid.
 */
function validateEvidencePayload(
  body: CheckInRequest | CheckOutRequest,
  callerId: string
): string | null {
  if (!body.photo_base64 || typeof body.photo_base64 !== "string") {
    return "Photo evidence is required";
  }

  if (!body.evidence_mime_type) {
    return "Photo MIME type is required";
  }

  if (typeof body.latitude !== "number" || typeof body.longitude !== "number") {
    return "Latitude and longitude are required";
  }

  if (!APPROVED_EVIDENCE_MIMES.includes(body.evidence_mime_type)) {
    return "Invalid image format. Approved formats: JPG, JPEG, PNG, WebP";
  }

  // Estimate base64 size — 4/3 ratio overhead
  const estimatedBytes = Math.ceil(body.photo_base64.length * 3 / 4);
  if (estimatedBytes > MAX_EVIDENCE_BYTES) {
    return "Image size exceeds 10MB limit";
  }

  return null;
}

async function handleCheckIn(
  admin: ReturnType<typeof createClient>,
  supabaseUrl: string,
  serviceKey: string,
  callerId: string,
  employee: Record<string, unknown>,
  totalMinutes: number,
  body: CheckInRequest
): Promise<Response> {
  // Check permission
  const hasPerm = await checkPermission(admin, callerId, "attendance.check_in_self");
  if (!hasPerm) {
    return jsonError(403, "You do not have permission to check in");
  }

  // Validate mandatory photo + location evidence
  const evidenceError = validateEvidencePayload(body, callerId);
  if (evidenceError) {
    return jsonError(400, evidenceError);
  }

  const now = new Date();
  const attendanceDate = now.toISOString().slice(0, 10);
  const requiredCheckoutAt = new Date(now.getTime() + totalMinutes * 60 * 1000);

  // Check for duplicate active record
  const { data: existing } = await admin
    .from("attendance_records")
    .select("id")
    .eq("employee_id", employee.id as string)
    .eq("attendance_date", attendanceDate)
    .eq("final_status", "PENDING_CHECKOUT")
    .maybeSingle();

  if (existing) {
    return jsonError(409, "You have already checked in today. Please check out first.");
  }

  // Upload evidence photo to storage (server-side with service role key)
  let storagePath: string;
  let fileSizeBytes: number;
  try {
    storagePath = await uploadEvidencePhoto(supabaseUrl, serviceKey, callerId, body.photo_base64, body.evidence_mime_type);
    fileSizeBytes = Math.ceil(body.photo_base64.length * 3 / 4);
  } catch (err) {
    return jsonError(500, `Failed to upload evidence photo: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Create attendance record
  const { data: record, error: insertError } = await admin
    .from("attendance_records")
    .insert({
      employee_id: employee.id as string,
      organization_id: employee.organization_id as string,
      branch_id: employee.branch_id as string | null,
      attendance_date: attendanceDate,
      check_in_at: now.toISOString(),
      required_checkout_at: requiredCheckoutAt.toISOString(),
      required_total_minutes: totalMinutes,
      attendance_policy_version: ATTENDANCE_POLICY_VERSION,
      final_status: "PENDING_CHECKOUT",
      check_in_evidence_status: "VERIFIED",
      created_by: callerId,
    })
    .select("id, check_in_at, required_checkout_at, required_total_minutes, final_status")
    .maybeSingle();

  if (insertError || !record) {
    return jsonError(500, `Failed to create attendance record: ${insertError?.message ?? "Unknown"}`);
  }

  // Create check-in evidence record
  const { error: evidenceError } = await admin.from("attendance_evidence").insert({
    attendance_record_id: record.id,
    employee_id: employee.id as string,
    evidence_type: "CHECK_IN_PHOTO",
    storage_path: storagePath,
    mime_type: body.evidence_mime_type,
    file_size_bytes: fileSizeBytes,
    latitude: body.latitude,
    longitude: body.longitude,
    location_accuracy: body.location_accuracy ?? null,
    captured_at: now.toISOString(),
    uploaded_at: now.toISOString(),
    created_by: callerId,
  });

  if (evidenceError) {
    return jsonError(500, `Failed to store check-in evidence: ${evidenceError.message}`);
  }

  // Create history entry
  await admin.from("attendance_history").insert({
    attendance_record_id: record.id,
    employee_id: employee.id as string,
    event_type: "check_in",
    event_data: {
      check_in_at: record.check_in_at,
      required_checkout_at: record.required_checkout_at,
      required_total_minutes: record.required_total_minutes,
      evidence_type: "CHECK_IN_PHOTO",
      storage_path: storagePath,
      latitude: body.latitude,
      longitude: body.longitude,
    },
    performed_by: callerId,
  });

  // Create audit log
  await admin.from("audit_logs").insert({
    actor_id: callerId,
    action: "attendance.check_in",
    entity_type: "attendance_record",
    entity_id: record.id,
    new_values: {
      employee_id: employee.id,
      check_in_at: record.check_in_at,
      required_checkout_at: record.required_checkout_at,
      check_in_evidence_status: "VERIFIED",
      evidence_type: "CHECK_IN_PHOTO",
    },
  });

  // Notify the employee that check-in was recorded
  await admin.from("notifications").insert({
    recipient_id: callerId,
    notification_type: "ATTENDANCE_CHECK_IN_CONFIRMED",
    title: "Check-in Recorded",
    message: "Your check-in has been recorded successfully.",
    priority: "low",
    category: "attendance",
    action_url: "/attendance",
    dedup_key: `att:check_in:${record.id}`,
  });

  // Generate recurring task instances for today (best-effort — never fails the check-in)
  let recurringTasksGenerated = 0;
  try {
    recurringTasksGenerated = await generateRecurringTasksForCheckIn(
      admin,
      callerId,
      employee,
      record.id,
      attendanceDate
    );
  } catch (err) {
    console.error("Recurring task generation failed:", err instanceof Error ? err.message : String(err));
  }

  return jsonResponse(200, {
    message: "Checked in successfully",
    record_id: record.id,
    check_in_at: record.check_in_at,
    required_checkout_at: record.required_checkout_at,
    required_total_minutes: record.required_total_minutes,
    final_status: record.final_status,
    recurring_tasks_generated: recurringTasksGenerated,
  });
}

/**
 * Generate recurring task instances for the employee on the check-in date.
 *
 * - Queries active, non-paused recurring_task_templates assigned to the employee
 *   whose start_date <= today and (end_date IS NULL OR end_date >= today).
 * - Skips Sundays (day 0).
 * - Creates a task instance + assignment + status history + audit log per template.
 * - Relies on the unique partial index idx_recurring_task_instance to prevent duplicates;
 *   unique-violation errors are caught and the duplicate is silently skipped.
 * - Notifies the employee, reporting manager, HR, and directors for each generated task.
 *
 * Returns the number of tasks actually created in this invocation.
 */
async function generateRecurringTasksForCheckIn(
  admin: ReturnType<typeof createClient>,
  callerId: string,
  employee: Record<string, unknown>,
  attendanceRecordId: string,
  attendanceDate: string
): Promise<number> {
  const employeeId = employee.id as string;
  const organizationId = employee.organization_id as string;

  // Sunday = day 0 — recurring tasks are not generated on Sundays.
  const todayDate = new Date(attendanceDate + "T00:00:00Z");
  if (todayDate.getUTCDay() === 0) {
    return 0;
  }

  // Fetch applicable recurring task templates
  const { data: templates, error: templatesError } = await admin
    .from("recurring_task_templates")
    .select("id, title, description, project_id, priority, estimated_minutes")
    .eq("assigned_employee_id", employeeId)
    .eq("is_active", true)
    .eq("is_paused", false)
    .lte("start_date", attendanceDate)
    .or(`end_date.is.null,end_date.gte.${attendanceDate}`);

  if (templatesError) {
    throw templatesError;
  }

  if (!templates || templates.length === 0) {
    return 0;
  }

  let generated = 0;

  for (const template of templates as Array<Record<string, unknown>>) {
    try {
      // Generate task_code via the existing RPC
      const { data: taskCode, error: codeError } = await admin.rpc("generate_task_code");
      if (codeError || !taskCode) {
        console.error("Failed to generate task_code:", codeError?.message ?? "Unknown");
        continue;
      }

      const now = new Date();

      // Insert the task instance
      const { data: task, error: taskError } = await admin
        .from("tasks")
        .insert({
          recurring_template_id: template.id,
          recurrence_date: attendanceDate,
          is_recurring_instance: true,
          assigned_employee_id: employeeId,
          project_id: template.project_id ?? null,
          task_code: taskCode,
          title: template.title,
          description: template.description ?? null,
          priority: template.priority ?? "normal",
          estimated_minutes: template.estimated_minutes ?? null,
          status: "IN_PROGRESS",
          is_self_assigned: false,
          organization_id: organizationId,
          created_by: callerId,
        })
        .select("id, task_code, title")
        .maybeSingle();

      if (taskError) {
        // Unique partial index idx_recurring_task_instance prevents duplicates for the
        // same (recurring_template_id, recurrence_date). A 23505 (unique_violation) here
        // means a task already exists for today — skip silently.
        if (taskError.code === "23505" || /unique/i.test(taskError.message)) {
          continue;
        }
        console.error("Failed to insert recurring task instance:", taskError.message);
        continue;
      }

      if (!task) {
        continue;
      }

      // Create task_assignments row
      await admin.from("task_assignments").insert({
        task_id: task.id,
        assigned_to: employeeId,
        assignment_type: "PRIMARY",
        is_current: true,
        organization_id: organizationId,
        created_by: callerId,
      });

      // Create task_status_history row
      await admin.from("task_status_history").insert({
        task_id: task.id,
        new_status: "IN_PROGRESS",
        changed_by: callerId,
        change_reason: "Auto-generated from recurring task template on check-in",
        organization_id: organizationId,
      });

      // Create audit log
      await admin.from("audit_logs").insert({
        actor_id: callerId,
        action: "recurring_task.instance_generated",
        entity_type: "task",
        entity_id: task.id,
        new_values: {
          recurring_template_id: template.id,
          recurrence_date: attendanceDate,
          assigned_employee_id: employeeId,
          status: "IN_PROGRESS",
          task_code: task.task_code,
          attendance_record_id: attendanceRecordId,
        },
      });

      generated++;

      // Notify the employee + reporting manager + HR + directors
      await notifyBusinessEvent(admin, {
        eventCode: "RECURRING_TASK_ASSIGNED",
        actorUserId: callerId,
        employeeId: employeeId,
        organizationId: organizationId,
        entityType: "task",
        entityId: task.id,
        title: "Recurring Task Assigned",
        message: `A recurring task "${task.title}" (${task.task_code}) has been assigned to you for today.`,
        priority: "normal",
        category: "tasks",
        actionUrl: `/tasks/${task.id}`,
        recipientRoles: ["hr_admin", "director"],
        includeEmployee: true,
        metadata: {
          recurring_template_id: template.id,
          recurrence_date: attendanceDate,
          task_code: task.task_code,
          attendance_record_id: attendanceRecordId,
        },
      });
    } catch (err) {
      // Per-template failure should not abort the whole loop.
      console.error(
        `Recurring task generation failed for template ${template.id}:`,
        err instanceof Error ? err.message : String(err)
      );
    }
  }

  return generated;
}

async function handleCheckOut(
  admin: ReturnType<typeof createClient>,
  supabaseUrl: string,
  serviceKey: string,
  callerId: string,
  employee: Record<string, unknown>,
  body: CheckOutRequest
): Promise<Response> {
  const hasPerm = await checkPermission(admin, callerId, "attendance.check_out_self");
  if (!hasPerm) {
    return jsonError(403, "You do not have permission to check out");
  }

  // Validate evidence
  const evidenceError = validateEvidencePayload(body, callerId);
  if (evidenceError) {
    return jsonError(400, evidenceError);
  }

  const now = new Date();
  const today = now.toISOString().slice(0, 10);

  // Find active attendance record
  const { data: record, error: recordError } = await admin
    .from("attendance_records")
    .select("id, check_in_at, required_checkout_at, required_total_minutes, final_status")
    .eq("employee_id", employee.id as string)
    .eq("attendance_date", today)
    .eq("final_status", "PENDING_CHECKOUT")
    .maybeSingle();

  if (recordError || !record) {
    return jsonError(404, "No active check-in found for today. Please check in first.");
  }

  // Upload evidence photo to storage (server-side with service role key)
  let storagePath: string;
  let fileSizeBytes: number;
  try {
    storagePath = await uploadEvidencePhoto(supabaseUrl, serviceKey, callerId, body.photo_base64, body.evidence_mime_type);
    fileSizeBytes = Math.ceil(body.photo_base64.length * 3 / 4);
  } catch (err) {
    return jsonError(500, `Failed to upload evidence photo: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Calculate elapsed minutes
  const checkInTime = new Date(record.check_in_at);
  const elapsedMs = now.getTime() - checkInTime.getTime();
  const elapsedMinutes = Math.floor(elapsedMs / (1000 * 60));

  // Determine final status — FULL_DAY at >= required_total_minutes (540), HALF_DAY below
  const requiredTotal = record.required_total_minutes ?? REQUIRED_TOTAL_MINUTES;
  const finalStatus = elapsedMinutes >= requiredTotal ? "FULL_DAY" : "HALF_DAY";
  const statusReason = finalStatus === "FULL_DAY"
    ? `Checked out at ${elapsedMinutes} minutes (full-day threshold: ${requiredTotal})`
    : `Checked out early at ${elapsedMinutes} minutes (full-day threshold: ${requiredTotal})`;

  // Update attendance record — manual checkout takes priority over any
  // pending automatic checkout. checkout_type = MANUAL, checkout_status = COMPLETED.
  const { error: updateError } = await admin
    .from("attendance_records")
    .update({
      check_out_at: now.toISOString(),
      actual_elapsed_minutes: elapsedMinutes,
      final_status: finalStatus,
      status_reason: statusReason,
      checkout_type: "MANUAL",
      checkout_status: "COMPLETED",
      check_out_evidence_status: "VERIFIED",
    })
    .eq("id", record.id)
    .eq("final_status", "PENDING_CHECKOUT");

  if (updateError) {
    return jsonError(500, `Failed to update attendance record: ${updateError.message}`);
  }

  // Create evidence record
  await admin.from("attendance_evidence").insert({
    attendance_record_id: record.id,
    employee_id: employee.id as string,
    evidence_type: "CHECK_OUT_PHOTO",
    storage_path: storagePath,
    mime_type: body.evidence_mime_type,
    file_size_bytes: fileSizeBytes,
    latitude: body.latitude,
    longitude: body.longitude,
    location_accuracy: body.location_accuracy ?? null,
    captured_at: now.toISOString(),
    uploaded_at: now.toISOString(),
    created_by: callerId,
  });

  // Create history entries
  await admin.from("attendance_history").insert([
    {
      attendance_record_id: record.id,
      employee_id: employee.id as string,
      event_type: "evidence_upload",
      event_data: {
        evidence_type: "CHECK_OUT_PHOTO",
        storage_path: storagePath,
        latitude: body.latitude,
        longitude: body.longitude,
      },
      performed_by: callerId,
    },
    {
      attendance_record_id: record.id,
      employee_id: employee.id as string,
      event_type: "check_out",
      event_data: {
        check_out_at: now.toISOString(),
        elapsed_minutes: elapsedMinutes,
      },
      performed_by: callerId,
    },
    {
      attendance_record_id: record.id,
      employee_id: employee.id as string,
      event_type: "status_calculated",
      event_data: {
        final_status: finalStatus,
        elapsed_minutes: elapsedMinutes,
        required_total_minutes: requiredTotal,
      },
      performed_by: callerId,
    },
  ]);

  // Create audit log
  await admin.from("audit_logs").insert({
    actor_id: callerId,
    action: "attendance.check_out",
    entity_type: "attendance_record",
    entity_id: record.id,
    old_values: { final_status: "PENDING_CHECKOUT" },
    new_values: {
      check_out_at: now.toISOString(),
      elapsed_minutes: elapsedMinutes,
      final_status: finalStatus,
    },
  });

  // Notify the employee that check-out was recorded
  const checkoutNotifications: any[] = [
    {
      recipient_id: callerId,
      notification_type: "ATTENDANCE_CHECKOUT_CONFIRMED",
      title: "Check-out Recorded",
      message: "Your check-out has been recorded successfully.",
      priority: "normal",
      category: "attendance",
      action_url: "/attendance",
      dedup_key: `att:checkout:${record.id}`,
    },
  ];

  if (finalStatus === "HALF_DAY") {
    checkoutNotifications.push({
      recipient_id: callerId,
      notification_type: "ATTENDANCE_HALF_DAY",
      title: "Half-Day Attendance",
      message: "Your attendance has been recorded as a half-day.",
      priority: "normal",
      category: "attendance",
      action_url: "/attendance",
      dedup_key: `att:checkout:${record.id}:half_day`,
    });
  } else if (finalStatus === "FULL_DAY") {
    checkoutNotifications.push({
      recipient_id: callerId,
      notification_type: "ATTENDANCE_FULL_DAY",
      title: "Full-Day Attendance",
      message: "Your attendance has been recorded as a full day.",
      priority: "low",
      category: "attendance",
      action_url: "/attendance",
      dedup_key: `att:checkout:${record.id}:full_day`,
    });
  }

  await admin.from("notifications").insert(checkoutNotifications);

  // Supervisory notification: HR + Directors (only for HALF_DAY)
  if (finalStatus === "HALF_DAY") {
    await notifyBusinessEvent(admin, {
      eventCode: "ATTENDANCE_HALF_DAY",
      actorUserId: callerId,
      employeeId: employee.id as string,
      organizationId: employee.organization_id as string,
      entityType: "attendance_record",
      entityId: record.id,
      title: "Half-Day Attendance Recorded",
      message: "A half-day attendance has been recorded.",
      priority: "high",
      category: "attendance",
      actionUrl: "/attendance-management",
      recipientRoles: ["hr_admin", "director"],
    });
  }

  return jsonResponse(200, {
    message: "Checked out successfully",
    record_id: record.id,
    check_out_at: now.toISOString(),
    elapsed_minutes: elapsedMinutes,
    required_total_minutes: requiredTotal,
    final_status: finalStatus,
  });
}

async function notifyBusinessEvent(
  adminClient: any,
  params: {
    eventCode: string;
    actorUserId: string;
    employeeId?: string;
    organizationId: string;
    entityType: string;
    entityId: string;
    title: string;
    message: string;
    priority?: "low" | "normal" | "high" | "urgent";
    category: string;
    actionUrl?: string;
    recipientRoles?: string[];
    includeEmployee?: boolean;
    includeActor?: boolean;
    acknowledgementRequired?: boolean;
    metadata?: Record<string, unknown>;
  }
): Promise<void> {
  try {
    const recipientUserIds = new Set<string>();

    if (params.recipientRoles && params.recipientRoles.length > 0) {
      const { data: roleUsers } = await adminClient
        .from("user_profiles")
        .select("id")
        .eq("organization_id", params.organizationId)
        .eq("status", "active")
        .eq("is_active", true)
        .in("role", params.recipientRoles);
      (roleUsers ?? []).forEach((u: { id: string }) => recipientUserIds.add(u.id));
    }

    if (params.employeeId) {
      const { data: managerLink } = await adminClient
        .from("employee_reporting_lines")
        .select("manager_id")
        .eq("employee_id", params.employeeId)
        .limit(1)
        .maybeSingle();
      if (managerLink) {
        const { data: managerEmp } = await adminClient
          .from("employees")
          .select("user_id")
          .eq("id", managerLink.manager_id)
          .eq("is_active", true)
          .maybeSingle();
        if (managerEmp?.user_id) recipientUserIds.add(managerEmp.user_id);
      }
      if (params.includeEmployee) {
        const { data: emp } = await adminClient
          .from("employees")
          .select("user_id")
          .eq("id", params.employeeId)
          .eq("is_active", true)
          .maybeSingle();
        if (emp?.user_id) recipientUserIds.add(emp.user_id);
      }
    }

    if (params.includeActor) recipientUserIds.add(params.actorUserId);
    if (!params.includeActor) recipientUserIds.delete(params.actorUserId);
    if (recipientUserIds.size === 0) return;

    const notificationsToInsert: Array<Record<string, unknown>> = [];
    for (const recipientId of recipientUserIds) {
      const idempotencyKey = `${params.organizationId}:${params.eventCode}:${params.entityId}:${recipientId}`;
      const { data: existing } = await adminClient
        .from("notifications")
        .select("id")
        .eq("idempotency_key", idempotencyKey)
        .maybeSingle();
      if (existing) continue;
      notificationsToInsert.push({
        recipient_id: recipientId,
        organization_id: params.organizationId,
        notification_type: params.eventCode,
        event_code: params.eventCode,
        title: params.title,
        message: params.message,
        priority: params.priority || "normal",
        category: params.category,
        action_url: params.actionUrl || null,
        dedup_key: idempotencyKey,
        idempotency_key: idempotencyKey,
        metadata: { ...params.metadata, entityType: params.entityType, entityId: params.entityId, actorUserId: params.actorUserId },
        related_entity_type: params.entityType,
        related_entity_id: params.entityId,
        acknowledgement_required: params.acknowledgementRequired || false,
        delivery_status: "in_app",
      });
    }
    if (notificationsToInsert.length === 0) return;

    const { data: inserted } = await adminClient
      .from("notifications")
      .insert(notificationsToInsert)
      .select("id, recipient_id");
    const deliveryJobs = (inserted ?? []).map((n: { id: string; recipient_id: string }) => ({
      notification_id: n.id,
      channel: "web_push",
      recipient: n.recipient_id,
      status: "queued",
      idempotency_key: `push:${n.id}`,
    }));
    if (deliveryJobs.length > 0) await adminClient.from("notification_deliveries").insert(deliveryJobs);
  } catch { /* best-effort */ }
}

async function checkPermission(
  admin: ReturnType<typeof createClient>,
  userId: string,
  permCode: string
): Promise<boolean> {
  const { data: profile } = await admin
    .from("user_profiles")
    .select("role")
    .eq("id", userId)
    .maybeSingle();

  if (!profile) return false;

  const { data: roleRow } = await admin
    .from("roles")
    .select("id")
    .eq("code", profile.role)
    .maybeSingle();

  if (!roleRow) return false;

  const { data: permRow } = await admin
    .from("permissions")
    .select("id")
    .eq("code", permCode)
    .maybeSingle();

  if (!permRow) return false;

  const { data: rp } = await admin
    .from("role_permissions")
    .select("role_id, permission_id")
    .eq("role_id", roleRow.id)
    .eq("permission_id", permRow.id)
    .maybeSingle();

  return !!rp;
}

function jsonResponse(status: number, data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function jsonError(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
