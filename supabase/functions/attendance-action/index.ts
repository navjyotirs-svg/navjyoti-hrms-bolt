import { createClient } from "npm:@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, Apikey",
};

const REQUIRED_TOTAL_MINUTES = 540;
const REQUIRED_WORK_MINUTES = 480;
const REQUIRED_BREAK_MINUTES = 60;

interface CheckInRequest {
  action: "check_in";
}

interface CheckOutRequest {
  action: "check_out";
  evidence_storage_path: string;
  evidence_mime_type: string;
  evidence_file_size: number;
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

    // Check test mode (server environment only)
    const testMode = Deno.env.get("ATTENDANCE_TEST_MODE") === "true";
    const isProduction = Deno.env.get("DENO_DEPLOYMENT_ID") !== undefined && !testMode;
    const totalMinutes = testMode && !isProduction
      ? parseInt(Deno.env.get("ATTENDANCE_TOTAL_MINUTES") ?? "540", 10)
      : REQUIRED_TOTAL_MINUTES;

    const body: AttendanceRequest = await req.json();

    if (body.action === "check_in") {
      return handleCheckIn(admin, callerId, employee, totalMinutes);
    } else if (body.action === "check_out") {
      return handleCheckOut(admin, callerId, employee, body as CheckOutRequest);
    } else {
      return jsonError(400, "Invalid action");
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return jsonError(500, message);
  }
});

async function handleCheckIn(
  admin: ReturnType<typeof createClient>,
  callerId: string,
  employee: Record<string, unknown>,
  totalMinutes: number
): Promise<Response> {
  // Check permission
  const hasPerm = await checkPermission(admin, callerId, "attendance.check_in_self");
  if (!hasPerm) {
    return jsonError(403, "You do not have permission to check in");
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
      required_work_minutes: REQUIRED_WORK_MINUTES,
      required_break_minutes: REQUIRED_BREAK_MINUTES,
      required_total_minutes: totalMinutes,
      final_status: "PENDING_CHECKOUT",
      created_by: callerId,
    })
    .select("id, check_in_at, required_checkout_at, required_total_minutes, final_status")
    .maybeSingle();

  if (insertError || !record) {
    return jsonError(500, `Failed to create attendance record: ${insertError?.message ?? "Unknown"}`);
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
    },
  });

  return jsonResponse(200, {
    message: "Checked in successfully",
    record_id: record.id,
    check_in_at: record.check_in_at,
    required_checkout_at: record.required_checkout_at,
    required_total_minutes: record.required_total_minutes,
    final_status: record.final_status,
  });
}

async function handleCheckOut(
  admin: ReturnType<typeof createClient>,
  callerId: string,
  employee: Record<string, unknown>,
  body: CheckOutRequest
): Promise<Response> {
  const hasPerm = await checkPermission(admin, callerId, "attendance.check_out_self");
  if (!hasPerm) {
    return jsonError(403, "You do not have permission to check out");
  }

  // Validate evidence
  if (!body.evidence_storage_path || !body.evidence_mime_type || !body.evidence_file_size) {
    return jsonError(400, "Evidence storage path, MIME type, and file size are required");
  }

  if (typeof body.latitude !== "number" || typeof body.longitude !== "number") {
    return jsonError(400, "Latitude and longitude are required");
  }

  // Validate MIME type
  const approvedMimes = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
  if (!approvedMimes.includes(body.evidence_mime_type)) {
    return jsonError(400, "Invalid image format. Approved formats: JPG, JPEG, PNG, WebP");
  }

  // Validate file size (10MB max)
  if (body.evidence_file_size > 10 * 1024 * 1024) {
    return jsonError(400, "Image size exceeds 10MB limit");
  }

  // Validate evidence ownership — path must start with caller's user_id
  const expectedPrefix = `${callerId}/`;
  if (!body.evidence_storage_path.startsWith(expectedPrefix)) {
    return jsonError(403, "Evidence does not belong to the authenticated user");
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

  // Calculate elapsed minutes
  const checkInTime = new Date(record.check_in_at);
  const elapsedMs = now.getTime() - checkInTime.getTime();
  const elapsedMinutes = Math.floor(elapsedMs / (1000 * 60));

  // Determine final status
  const finalStatus = elapsedMinutes >= record.required_total_minutes ? "FULL_DAY" : "HALF_DAY";
  const statusReason = finalStatus === "FULL_DAY"
    ? `Checked out at ${elapsedMinutes} minutes (required: ${record.required_total_minutes})`
    : `Checked out early at ${elapsedMinutes} minutes (required: ${record.required_total_minutes})`;

  // Update attendance record
  const { error: updateError } = await admin
    .from("attendance_records")
    .update({
      check_out_at: now.toISOString(),
      actual_elapsed_minutes: elapsedMinutes,
      final_status: finalStatus,
      status_reason: statusReason,
    })
    .eq("id", record.id);

  if (updateError) {
    return jsonError(500, `Failed to update attendance record: ${updateError.message}`);
  }

  // Create evidence record
  await admin.from("attendance_evidence").insert({
    attendance_record_id: record.id,
    employee_id: employee.id as string,
    evidence_type: "CHECK_OUT_PHOTO",
    storage_path: body.evidence_storage_path,
    mime_type: body.evidence_mime_type,
    file_size_bytes: body.evidence_file_size,
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
        storage_path: body.evidence_storage_path,
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
        required_total_minutes: record.required_total_minutes,
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

  return jsonResponse(200, {
    message: "Checked out successfully",
    record_id: record.id,
    check_out_at: now.toISOString(),
    elapsed_minutes: elapsedMinutes,
    required_total_minutes: record.required_total_minutes,
    final_status: finalStatus,
  });
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
