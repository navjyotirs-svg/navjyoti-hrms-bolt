import { createClient } from "npm:@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, Apikey",
};

const FUNCTION_VERSION = "attendance-evidence-v5";
const REQUIRED_TOTAL_MINUTES = 540;
const ATTENDANCE_POLICY_VERSION = "POLICY_540_FULL_DAY";
const APPROVED_EVIDENCE_MIMES = [
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
];
const MAX_EVIDENCE_BYTES = 10 * 1024 * 1024;

interface CheckInRequest {
  action: "check_in";
  photo_base64: string;
  evidence_mime_type: string;
  latitude: number;
  longitude: number;
  location_accuracy?: number;
  requestId?: string;
}

interface CheckOutRequest {
  action: "check_out";
  photo_base64: string;
  evidence_mime_type: string;
  latitude: number;
  longitude: number;
  location_accuracy?: number;
  requestId?: string;
}

type AttendanceRequest = CheckInRequest | CheckOutRequest;

interface StructuredError {
  success: false;
  errorCode: string;
  message: string;
  correlationId: string;
  retryable: boolean;
}

interface StructuredSuccess {
  success: true;
  action: string;
  attendanceRecordId: string;
  finalStatus: string;
  functionVersion: string;
  correlationId: string;
  secondaryWarnings: string[];
  [key: string]: unknown;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return structuredError(405, "UNKNOWN_ATTENDANCE_ERROR", "Method not allowed", false);
  }

  const correlationId = crypto.randomUUID();

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    if (!supabaseUrl || !serviceKey || !anonKey) {
      return structuredError(500, "FUNCTION_BOOT_FAILED", "Server configuration error", false, correlationId);
    }

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return structuredError(401, "INVALID_AUTH_TOKEN", "Missing authorization header", false, correlationId);
    }

    const callerClient = createClient(supabaseUrl, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: callerData, error: callerError } =
      await callerClient.auth.getUser(authHeader.replace("Bearer ", ""));

    if (callerError || !callerData.user) {
      return structuredError(401, "SESSION_EXPIRED", "Your session has expired. Please sign in again.", false, correlationId);
    }

    const callerId = callerData.user.id;

    const { data: profile, error: profileError } = await admin
      .from("user_profiles")
      .select("id, role, organization_id, status")
      .eq("id", callerId)
      .maybeSingle();

    if (profileError || !profile) {
      return structuredError(403, "EMPLOYEE_NOT_FOUND", "Profile not found", false, correlationId);
    }

    if (profile.status === "disabled") {
      return structuredError(403, "SESSION_EXPIRED", "Account disabled", false, correlationId);
    }

    const { data: employee, error: empError } = await admin
      .from("employees")
      .select("id, organization_id, branch_id, employment_status, is_active, user_id")
      .eq("user_id", callerId)
      .maybeSingle();

    if (empError || !employee) {
      return structuredError(403, "EMPLOYEE_NOT_FOUND", "Employee record not found", false, correlationId);
    }

    if (!employee.is_active || !["active", "on_probation", "confirmed", "notice_period"].includes(employee.employment_status)) {
      return structuredError(403, "MEMBERSHIP_INACTIVE", "Employee is not active", false, correlationId);
    }

    const body: AttendanceRequest = await req.json();

    if (body.action === "check_in") {
      return await handleCheckIn(admin, supabaseUrl, serviceKey, callerId, employee, body as CheckInRequest, correlationId);
    } else if (body.action === "check_out") {
      return await handleCheckOut(admin, supabaseUrl, serviceKey, callerId, employee, body as CheckOutRequest, correlationId);
    } else {
      return structuredError(400, "UNKNOWN_ATTENDANCE_ERROR", "Invalid action", false, correlationId);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return structuredError(500, "UNKNOWN_ATTENDANCE_ERROR", message, true, correlationId);
  }
});

async function uploadEvidencePhoto(
  supabaseUrl: string,
  serviceKey: string,
  callerId: string,
  photoBase64: string,
  mimeType: string
): Promise<{ path: string; size: number }> {
  const ext = mimeType.split("/")[1] ?? "jpg";
  const path = `${callerId}/${crypto.randomUUID()}.${ext}`;

  const binaryString = atob(photoBase64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }

  const uploadUrl = `${supabaseUrl}/storage/v1/object/attendance-evidence/${path}`;

  const resp = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": mimeType,
      "x-upsert": "false",
    },
    body: bytes,
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Storage upload failed (${resp.status}): ${text}`);
  }

  return { path, size: bytes.byteLength };
}

function validateEvidencePayload(body: CheckInRequest | CheckOutRequest): string | null {
  if (!body.photo_base64 || typeof body.photo_base64 !== "string") {
    return "Photo evidence is required";
  }
  if (!body.evidence_mime_type) {
    return "Photo MIME type is required";
  }
  if (typeof body.latitude !== "number" || typeof body.longitude !== "number") {
    return "Latitude and longitude are required";
  }
  if (!Number.isFinite(body.latitude) || !Number.isFinite(body.longitude)) {
    return "Location coordinates are invalid";
  }
  if (!APPROVED_EVIDENCE_MIMES.includes(body.evidence_mime_type)) {
    return "Invalid image format. Approved formats: JPG, JPEG, PNG, WebP";
  }
  const estimatedBytes = Math.ceil((body.photo_base64.length * 3) / 4);
  if (estimatedBytes > MAX_EVIDENCE_BYTES) {
    return "Image size exceeds 10MB limit";
  }
  return null;
}

async function checkIdempotency(
  admin: ReturnType<typeof createClient>,
  requestId: string,
  action: string
): Promise<Record<string, unknown> | null> {
  if (!requestId) return null;
  const { data } = await admin
    .from("attendance_idempotency")
    .select("response_data")
    .eq("request_id", requestId)
    .eq("action", action)
    .maybeSingle();
  return (data as { response_data?: Record<string, unknown> } | null)?.response_data ?? null;
}

async function storeIdempotency(
  admin: ReturnType<typeof createClient>,
  requestId: string,
  action: string,
  responseData: Record<string, unknown>
): Promise<void> {
  if (!requestId) return;
  try {
    await admin.from("attendance_idempotency").upsert(
      {
        request_id: requestId,
        action,
        response_data: responseData,
      },
      { onConflict: "request_id,action" }
    );
  } catch { /* best-effort */ }
}

async function handleCheckIn(
  admin: ReturnType<typeof createClient>,
  supabaseUrl: string,
  serviceKey: string,
  callerId: string,
  employee: Record<string, unknown>,
  body: CheckInRequest,
  correlationId: string
): Promise<Response> {
  const hasPerm = await checkPermission(admin, callerId, "attendance.check_in_self");
  if (!hasPerm) {
    return structuredError(403, "SESSION_EXPIRED", "You do not have permission to check in", false, correlationId);
  }

  const evidenceError = validateEvidencePayload(body);
  if (evidenceError) {
    return structuredError(400, "EVIDENCE_INVALID", evidenceError, false, correlationId);
  }

  const cached = await checkIdempotency(admin, body.requestId ?? "", "check_in");
  if (cached) {
    return jsonResponse(200, { ...cached, idempotent: true });
  }

  const now = new Date();
  const attendanceDate = now.toISOString().slice(0, 10);
  const requiredCheckoutAt = new Date(now.getTime() + REQUIRED_TOTAL_MINUTES * 60 * 1000);

  const { data: existing } = await admin
    .from("attendance_records")
    .select("id")
    .eq("employee_id", employee.id as string)
    .eq("attendance_date", attendanceDate)
    .eq("final_status", "PENDING_CHECKOUT")
    .maybeSingle();

  if (existing) {
    return structuredError(409, "ATTENDANCE_ALREADY_EXISTS", "You have already checked in today. Please check out first.", false, correlationId);
  }

  let storagePath: string;
  let fileSizeBytes: number;
  try {
    const upload = await uploadEvidencePhoto(supabaseUrl, serviceKey, callerId, body.photo_base64, body.evidence_mime_type);
    storagePath = upload.path;
    fileSizeBytes = upload.size;
  } catch (err) {
    return structuredError(500, "PHOTO_UPLOAD_FAILED", `Failed to upload evidence photo: ${err instanceof Error ? err.message : String(err)}`, true, correlationId);
  }

  const { data: record, error: insertError } = await admin
    .from("attendance_records")
    .insert({
      employee_id: employee.id as string,
      organization_id: employee.organization_id as string,
      branch_id: employee.branch_id as string | null,
      attendance_date: attendanceDate,
      check_in_at: now.toISOString(),
      required_checkout_at: requiredCheckoutAt.toISOString(),
      required_total_minutes: REQUIRED_TOTAL_MINUTES,
      attendance_policy_version: ATTENDANCE_POLICY_VERSION,
      final_status: "PENDING_CHECKOUT",
      check_in_evidence_status: "VERIFIED",
      created_by: callerId,
    })
    .select("id, check_in_at, required_checkout_at, required_total_minutes, final_status")
    .maybeSingle();

  if (insertError || !record) {
    return structuredError(500, "DATABASE_UPDATE_FAILED", `Failed to create attendance record: ${insertError?.message ?? "Unknown"}`, true, correlationId);
  }

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
    return structuredError(500, "DATABASE_UPDATE_FAILED", `Failed to store check-in evidence: ${evidenceError.message}`, true, correlationId);
  }

  try {
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
  } catch { /* best-effort */ }

  try {
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
  } catch { /* best-effort */ }

  const secondaryWarnings: string[] = [];

  try {
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
  } catch (err) {
    secondaryWarnings.push(`Notification failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  let recurringTasksGenerated = 0;
  try {
    recurringTasksGenerated = await generateRecurringTasksForCheckIn(
      admin, callerId, employee, record.id, attendanceDate
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    secondaryWarnings.push(`Recurring task generation failed: ${msg}`);
    console.error("Recurring task generation failed:", msg);
  }

  const responseData: StructuredSuccess = {
    success: true,
    action: "check_in",
    attendanceRecordId: record.id,
    finalStatus: record.final_status,
    functionVersion: FUNCTION_VERSION,
    correlationId,
    secondaryWarnings,
    message: "Checked in successfully",
    record_id: record.id,
    check_in_at: record.check_in_at,
    required_checkout_at: record.required_checkout_at,
    required_total_minutes: record.required_total_minutes,
    recurring_tasks_generated: recurringTasksGenerated,
  };

  await storeIdempotency(admin, body.requestId ?? "", "check_in", responseData);

  return jsonResponse(200, responseData);
}

async function generateRecurringTasksForCheckIn(
  admin: ReturnType<typeof createClient>,
  callerId: string,
  employee: Record<string, unknown>,
  attendanceRecordId: string,
  attendanceDate: string
): Promise<number> {
  const employeeId = employee.id as string;
  const organizationId = employee.organization_id as string;

  const todayDate = new Date(attendanceDate + "T00:00:00Z");
  if (todayDate.getUTCDay() === 0) return 0;

  const { data: templates, error: templatesError } = await admin
    .from("recurring_task_templates")
    .select("id, title, description, project_id, priority, estimated_minutes")
    .eq("assigned_employee_id", employeeId)
    .eq("is_active", true)
    .eq("is_paused", false)
    .lte("start_date", attendanceDate)
    .or(`end_date.is.null,end_date.gte.${attendanceDate}`);

  if (templatesError) throw templatesError;
  if (!templates || templates.length === 0) return 0;

  let generated = 0;

  for (const template of templates as Array<Record<string, unknown>>) {
    try {
      const { data: taskCode, error: codeError } = await admin.rpc("generate_task_code");
      if (codeError || !taskCode) continue;

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

      if (taskError || !task) continue;

      await admin.from("task_assignments").insert({
        task_id: task.id, assigned_to: employeeId, assignment_type: "PRIMARY",
        is_current: true, organization_id: organizationId, created_by: callerId,
      });

      await admin.from("task_status_history").insert({
        task_id: task.id, new_status: "IN_PROGRESS", changed_by: callerId,
        change_reason: "Auto-generated from recurring task template on check-in",
        organization_id: organizationId,
      });

      await admin.from("audit_logs").insert({
        actor_id: callerId, action: "recurring_task.instance_generated",
        entity_type: "task", entity_id: task.id,
        new_values: {
          recurring_template_id: template.id, recurrence_date: attendanceDate,
          assigned_employee_id: employeeId, status: "IN_PROGRESS",
          task_code: task.task_code, attendance_record_id: attendanceRecordId,
        },
      });

      generated++;

      try {
        await notifyBusinessEvent(admin, {
          eventCode: "RECURRING_TASK_ASSIGNED", actorUserId: callerId,
          employeeId, organizationId, entityType: "task", entityId: task.id,
          title: "Recurring Task Assigned",
          message: `A recurring task "${task.title}" (${task.task_code}) has been assigned to you for today.`,
          priority: "normal", category: "tasks", actionUrl: `/tasks/${task.id}`,
          recipientRoles: ["hr_admin", "director"], includeEmployee: true,
          metadata: { recurring_template_id: template.id, recurrence_date: attendanceDate, task_code: task.task_code, attendance_record_id: attendanceRecordId },
        });
      } catch { /* best-effort */ }
    } catch (err) {
      console.error(`Recurring task generation failed for template ${template.id}:`, err instanceof Error ? err.message : String(err));
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
  body: CheckOutRequest,
  correlationId: string
): Promise<Response> {
  const hasPerm = await checkPermission(admin, callerId, "attendance.check_out_self");
  if (!hasPerm) {
    return structuredError(403, "SESSION_EXPIRED", "You do not have permission to check out", false, correlationId);
  }

  const evidenceError = validateEvidencePayload(body);
  if (evidenceError) {
    return structuredError(400, "EVIDENCE_INVALID", evidenceError, false, correlationId);
  }

  const cached = await checkIdempotency(admin, body.requestId ?? "", "check_out");
  if (cached) {
    return jsonResponse(200, { ...cached, idempotent: true });
  }

  const now = new Date();
  const today = now.toISOString().slice(0, 10);

  const { data: record, error: recordError } = await admin
    .from("attendance_records")
    .select("id, check_in_at, required_checkout_at, required_total_minutes, final_status")
    .eq("employee_id", employee.id as string)
    .eq("attendance_date", today)
    .eq("final_status", "PENDING_CHECKOUT")
    .maybeSingle();

  if (recordError || !record) {
    return structuredError(404, "ACTIVE_ATTENDANCE_NOT_FOUND", "No active check-in found for today. Please check in first.", false, correlationId);
  }

  let storagePath: string;
  let fileSizeBytes: number;
  try {
    const upload = await uploadEvidencePhoto(supabaseUrl, serviceKey, callerId, body.photo_base64, body.evidence_mime_type);
    storagePath = upload.path;
    fileSizeBytes = upload.size;
  } catch (err) {
    return structuredError(500, "PHOTO_UPLOAD_FAILED", `Checkout photo could not be uploaded: ${err instanceof Error ? err.message : String(err)}`, true, correlationId);
  }

  const checkInTime = new Date(record.check_in_at);
  const elapsedMs = now.getTime() - checkInTime.getTime();
  const elapsedMinutes = Math.floor(elapsedMs / (1000 * 60));

  const requiredTotal = record.required_total_minutes ?? REQUIRED_TOTAL_MINUTES;
  const finalStatus = elapsedMinutes >= requiredTotal ? "FULL_DAY" : "HALF_DAY";
  const statusReason = finalStatus === "FULL_DAY"
    ? `Checked out at ${elapsedMinutes} minutes (full-day threshold: ${requiredTotal})`
    : `Checked out early at ${elapsedMinutes} minutes (full-day threshold: ${requiredTotal})`;

  const { error: updateError, count: updatedCount } = await admin
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
    return structuredError(500, "DATABASE_UPDATE_FAILED", `Failed to update attendance record: ${updateError.message}`, true, correlationId);
  }

  if (updatedCount === 0) {
    const responseData: StructuredSuccess = {
      success: true,
      action: "check_out",
      attendanceRecordId: record.id,
      finalStatus,
      functionVersion: FUNCTION_VERSION,
      correlationId,
      secondaryWarnings: [],
      message: "Checked out successfully",
      record_id: record.id,
      check_out_at: now.toISOString(),
      elapsed_minutes: elapsedMinutes,
      required_total_minutes: requiredTotal,
      idempotent: true,
    };
    return jsonResponse(200, responseData);
  }

  const secondaryWarnings: string[] = [];

  const { error: evidenceInsertError } = await admin.from("attendance_evidence").insert({
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

  if (evidenceInsertError) {
    secondaryWarnings.push(`Evidence insert failed: ${evidenceInsertError.message}`);
    console.error("Evidence insert failed after checkout:", evidenceInsertError.message);
  }

  try {
    await admin.from("attendance_history").insert([
      {
        attendance_record_id: record.id, employee_id: employee.id as string,
        event_type: "evidence_upload",
        event_data: { evidence_type: "CHECK_OUT_PHOTO", storage_path: storagePath, latitude: body.latitude, longitude: body.longitude },
        performed_by: callerId,
      },
      {
        attendance_record_id: record.id, employee_id: employee.id as string,
        event_type: "check_out",
        event_data: { check_out_at: now.toISOString(), elapsed_minutes: elapsedMinutes },
        performed_by: callerId,
      },
      {
        attendance_record_id: record.id, employee_id: employee.id as string,
        event_type: "status_calculated",
        event_data: { final_status: finalStatus, elapsed_minutes: elapsedMinutes, required_total_minutes: requiredTotal },
        performed_by: callerId,
      },
    ]);
  } catch (err) {
    secondaryWarnings.push(`History insert failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  try {
    await admin.from("audit_logs").insert({
      actor_id: callerId, action: "attendance.check_out",
      entity_type: "attendance_record", entity_id: record.id,
      old_values: { final_status: "PENDING_CHECKOUT" },
      new_values: { check_out_at: now.toISOString(), elapsed_minutes: elapsedMinutes, final_status: finalStatus },
    });
  } catch (err) {
    secondaryWarnings.push(`Audit log failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  const notificationsToInsert: Record<string, unknown>[] = [
    {
      recipient_id: callerId, notification_type: "ATTENDANCE_CHECKOUT_CONFIRMED",
      title: "Check-out Recorded", message: "Your check-out has been recorded successfully.",
      priority: "normal", category: "attendance", action_url: "/attendance",
      dedup_key: `att:checkout:${record.id}`,
    },
  ];

  if (finalStatus === "HALF_DAY") {
    notificationsToInsert.push({
      recipient_id: callerId, notification_type: "ATTENDANCE_HALF_DAY",
      title: "Half-Day Attendance", message: "Your attendance has been recorded as a half-day.",
      priority: "normal", category: "attendance", action_url: "/attendance",
      dedup_key: `att:checkout:${record.id}:half_day`,
    });
  } else {
    notificationsToInsert.push({
      recipient_id: callerId, notification_type: "ATTENDANCE_FULL_DAY",
      title: "Full-Day Attendance", message: "Your attendance has been recorded as a full day.",
      priority: "low", category: "attendance", action_url: "/attendance",
      dedup_key: `att:checkout:${record.id}:full_day`,
    });
  }

  try {
    await admin.from("notifications").insert(notificationsToInsert);
  } catch (err) {
    secondaryWarnings.push(`Notification failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (finalStatus === "HALF_DAY") {
    try {
      await notifyBusinessEvent(admin, {
        eventCode: "ATTENDANCE_HALF_DAY", actorUserId: callerId,
        employeeId: employee.id as string, organizationId: employee.organization_id as string,
        entityType: "attendance_record", entityId: record.id,
        title: "Half-Day Attendance Recorded", message: "A half-day attendance has been recorded.",
        priority: "high", category: "attendance", actionUrl: "/attendance-management",
        recipientRoles: ["hr_admin", "director"],
      });
    } catch (err) {
      secondaryWarnings.push(`Supervisory notification failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const responseData: StructuredSuccess = {
    success: true,
    action: "check_out",
    attendanceRecordId: record.id,
    finalStatus,
    functionVersion: FUNCTION_VERSION,
    correlationId,
    secondaryWarnings,
    message: "Checked out successfully",
    record_id: record.id,
    check_out_at: now.toISOString(),
    elapsed_minutes: elapsedMinutes,
    required_total_minutes: requiredTotal,
  };

  await storeIdempotency(admin, body.requestId ?? "", "check_out", responseData);

  return jsonResponse(200, responseData);
}

async function notifyBusinessEvent(
  adminClient: ReturnType<typeof createClient>,
  params: {
    eventCode: string; actorUserId: string; employeeId?: string; organizationId: string;
    entityType: string; entityId: string; title: string; message: string;
    priority?: "low" | "normal" | "high" | "urgent"; category: string; actionUrl?: string;
    recipientRoles?: string[]; includeEmployee?: boolean; includeActor?: boolean;
    acknowledgementRequired?: boolean; metadata?: Record<string, unknown>;
  }
): Promise<void> {
  const recipientUserIds = new Set<string>();

  if (params.recipientRoles && params.recipientRoles.length > 0) {
    const { data: roleUsers } = await adminClient
      .from("user_profiles")
      .select("id")
      .eq("organization_id", params.organizationId)
      .eq("status", "active")
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
        .eq("id", (managerLink as { manager_id: string }).manager_id)
        .eq("is_active", true)
        .maybeSingle();
      if ((managerEmp as { user_id?: string } | null)?.user_id) {
        recipientUserIds.add((managerEmp as { user_id: string }).user_id);
      }
    }
    if (params.includeEmployee) {
      const { data: emp } = await adminClient
        .from("employees")
        .select("user_id")
        .eq("id", params.employeeId)
        .eq("is_active", true)
        .maybeSingle();
      if ((emp as { user_id?: string } | null)?.user_id) {
        recipientUserIds.add((emp as { user_id: string }).user_id);
      }
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
      recipient_id: recipientId, organization_id: params.organizationId,
      notification_type: params.eventCode, event_code: params.eventCode,
      title: params.title, message: params.message,
      priority: params.priority || "normal", category: params.category,
      action_url: params.actionUrl || null, dedup_key: idempotencyKey,
      idempotency_key: idempotencyKey,
      metadata: { ...params.metadata, entityType: params.entityType, entityId: params.entityId, actorUserId: params.actorUserId },
      related_entity_type: params.entityType, related_entity_id: params.entityId,
      acknowledgement_required: params.acknowledgementRequired || false, delivery_status: "in_app",
    });
  }
  if (notificationsToInsert.length === 0) return;

  const { data: inserted } = await adminClient
    .from("notifications")
    .insert(notificationsToInsert)
    .select("id, recipient_id");
  const deliveryJobs = (inserted ?? []).map((n: { id: string; recipient_id: string }) => ({
    notification_id: n.id, channel: "web_push", recipient: n.recipient_id,
    status: "queued", idempotency_key: `push:${n.id}`,
  }));
  if (deliveryJobs.length > 0) await adminClient.from("notification_deliveries").insert(deliveryJobs);
}

async function checkPermission(
  admin: ReturnType<typeof createClient>,
  userId: string,
  permCode: string
): Promise<boolean> {
  const { data: profile } = await admin
    .from("user_profiles").select("role").eq("id", userId).maybeSingle();
  if (!profile) return false;

  const { data: roleRow } = await admin
    .from("roles").select("id").eq("code", (profile as { role: string }).role).maybeSingle();
  if (!roleRow) return false;

  const { data: permRow } = await admin
    .from("permissions").select("id").eq("code", permCode).maybeSingle();
  if (!permRow) return false;

  const { data: rp } = await admin
    .from("role_permissions")
    .select("role_id, permission_id")
    .eq("role_id", (roleRow as { id: string }).id)
    .eq("permission_id", (permRow as { id: string }).id)
    .maybeSingle();

  return !!rp;
}

function jsonResponse(status: number, data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function structuredError(
  status: number,
  errorCode: string,
  message: string,
  retryable: boolean,
  correlationId?: string
): Response {
  const body: StructuredError = {
    success: false,
    errorCode,
    message,
    correlationId: correlationId ?? crypto.randomUUID(),
    retryable,
  };
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
