import { createClient } from "npm:@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, Apikey",
};

const REQUIRED_TOTAL_MINUTES = 540;

interface CorrectionRequest {
  action: "request_correction";
  attendance_record_id: string;
  correction_type: string;
  requested_check_in_at?: string;
  requested_check_out_at?: string;
  reason: string;
  supporting_document_path?: string;
}

interface CorrectionReview {
  action: "review_correction";
  correction_id: string;
  decision: "APPROVED" | "REJECTED";
  reviewer_remarks?: string;
}

type Request = CorrectionRequest | CorrectionReview;

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

    const body: Request = await req.json();

    if (body.action === "request_correction") {
      return handleRequestCorrection(admin, callerId, profile, body as CorrectionRequest);
    } else if (body.action === "review_correction") {
      return handleReviewCorrection(admin, callerId, profile, body as CorrectionReview);
    } else {
      return jsonError(400, "Invalid action");
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return jsonError(500, message);
  }
});

async function handleRequestCorrection(
  admin: ReturnType<typeof createClient>,
  callerId: string,
  profile: { id: string; role: string; organization_id: string },
  body: CorrectionRequest
): Promise<Response> {
  const hasPerm = await checkPermission(admin, callerId, "attendance.correct_request_self");
  if (!hasPerm) {
    return jsonError(403, "You do not have permission to request corrections");
  }

  // Fetch the attendance record
  const { data: record, error: recordError } = await admin
    .from("attendance_records")
    .select("id, employee_id, organization_id, check_in_at, check_out_at, final_status, correction_version")
    .eq("id", body.attendance_record_id)
    .maybeSingle();

  if (recordError || !record) {
    return jsonError(404, "Attendance record not found");
  }

  // Verify ownership
  const { data: employee } = await admin
    .from("employees")
    .select("user_id")
    .eq("id", record.employee_id)
    .maybeSingle();

  if (!employee || employee.user_id !== callerId) {
    return jsonError(403, "You can only request corrections for your own attendance");
  }

  // Create correction request
  const { data: correction, error: corrError } = await admin
    .from("attendance_corrections")
    .insert({
      attendance_record_id: body.attendance_record_id,
      employee_id: record.employee_id,
      requested_by: callerId,
      correction_type: body.correction_type,
      requested_check_in_at: body.requested_check_in_at ?? null,
      requested_check_out_at: body.requested_check_out_at ?? null,
      reason: body.reason,
      supporting_document_path: body.supporting_document_path ?? null,
      status: "PENDING",
    })
    .select("id")
    .maybeSingle();

  if (corrError || !correction) {
    return jsonError(500, `Failed to create correction request: ${corrError?.message ?? "Unknown"}`);
  }

  // Create history entry
  await admin.from("attendance_history").insert({
    attendance_record_id: record.id,
    employee_id: record.employee_id,
    event_type: "correction_request",
    event_data: {
      correction_id: correction.id,
      correction_type: body.correction_type,
      reason: body.reason,
    },
    performed_by: callerId,
  });

  // Audit log
  await admin.from("audit_logs").insert({
    actor_id: callerId,
    action: "attendance.correction_request",
    entity_type: "attendance_correction",
    entity_id: correction.id,
    new_values: {
      attendance_record_id: body.attendance_record_id,
      correction_type: body.correction_type,
      reason: body.reason,
    },
  });

  return jsonResponse(200, {
    message: "Correction request submitted",
    correction_id: correction.id,
  });
}

async function handleReviewCorrection(
  admin: ReturnType<typeof createClient>,
  callerId: string,
  profile: { id: string; role: string; organization_id: string },
  body: CorrectionReview
): Promise<Response> {
  const hasPerm = await checkPermission(admin, callerId, "attendance.correct_manage");
  if (!hasPerm) {
    return jsonError(403, "You do not have permission to manage corrections");
  }

  // Fetch correction
  const { data: correction, error: corrError } = await admin
    .from("attendance_corrections")
    .select(`
      id,
      attendance_record_id,
      employee_id,
      correction_type,
      requested_check_in_at,
      requested_check_out_at,
      reason,
      status
    `)
    .eq("id", body.correction_id)
    .maybeSingle();

  if (corrError || !correction) {
    return jsonError(404, "Correction request not found");
  }

  if (correction.status !== "PENDING") {
    return jsonError(409, `Correction already ${correction.status.toLowerCase()}`);
  }

  // Verify same org
  const { data: employee } = await admin
    .from("employees")
    .select("organization_id")
    .eq("id", correction.employee_id)
    .maybeSingle();

  if (!employee || employee.organization_id !== profile.organization_id) {
    return jsonError(403, "Cross-organization access denied");
  }

  const now = new Date();

  // Update correction status
  await admin
    .from("attendance_corrections")
    .update({
      status: body.decision,
      reviewed_by: callerId,
      reviewer_remarks: body.reviewer_remarks ?? null,
      reviewed_at: now.toISOString(),
    })
    .eq("id", correction.id);

  // Fetch the attendance record
  const { data: record } = await admin
    .from("attendance_records")
    .select("id, check_in_at, check_out_at, required_checkout_at, required_total_minutes, final_status, correction_version")
    .eq("id", correction.attendance_record_id)
    .maybeSingle();

  if (!record) {
    return jsonError(404, "Attendance record not found");
  }

  if (body.decision === "APPROVED") {
    // Preserve original values in history
    const oldValues = {
      check_in_at: record.check_in_at,
      check_out_at: record.check_out_at,
      final_status: record.final_status,
      correction_version: record.correction_version,
    };

    // Apply corrected values
    const newCheckIn = correction.requested_check_in_at ?? record.check_in_at;
    const newCheckOut = correction.requested_check_out_at ?? record.check_out_at;
    const newVersion = (record.correction_version ?? 0) + 1;

    // Recalculate status
    let newStatus = record.final_status;
    let newElapsed = null as number | null;
    let statusReason = "Corrected by authorized reviewer";

    if (newCheckOut) {
      const elapsedMs = new Date(newCheckOut).getTime() - new Date(newCheckIn).getTime();
      newElapsed = Math.floor(elapsedMs / (1000 * 60));
      const totalMinutes = record.required_total_minutes ?? REQUIRED_TOTAL_MINUTES;
      newStatus = newElapsed >= totalMinutes ? "FULL_DAY" : "HALF_DAY";
      statusReason = `Corrected: ${newElapsed} minutes elapsed (required: ${totalMinutes})`;
    }

    // Recalculate required_checkout_at if check_in changed
    let newRequiredCheckout = record.required_checkout_at;
    if (correction.requested_check_in_at) {
      const totalMinutes = record.required_total_minutes ?? REQUIRED_TOTAL_MINUTES;
      newRequiredCheckout = new Date(
        new Date(newCheckIn).getTime() + totalMinutes * 60 * 1000
      ).toISOString();
    }

    await admin
      .from("attendance_records")
      .update({
        check_in_at: newCheckIn,
        check_out_at: newCheckOut,
        required_checkout_at: newRequiredCheckout,
        actual_elapsed_minutes: newElapsed,
        final_status: newStatus,
        status_reason: statusReason,
        corrected_at: now.toISOString(),
        corrected_by: callerId,
        correction_version: newVersion,
      })
      .eq("id", record.id);

    // History entries
    await admin.from("attendance_history").insert([
      {
        attendance_record_id: record.id,
        employee_id: correction.employee_id,
        event_type: "correction_approved",
        event_data: {
          correction_id: correction.id,
          old_values: oldValues,
          new_values: {
            check_in_at: newCheckIn,
            check_out_at: newCheckOut,
            final_status: newStatus,
            correction_version: newVersion,
          },
        },
        performed_by: callerId,
      },
      {
        attendance_record_id: record.id,
        employee_id: correction.employee_id,
        event_type: "record_recalculated",
        event_data: {
          final_status: newStatus,
          elapsed_minutes: newElapsed,
          correction_version: newVersion,
        },
        performed_by: callerId,
      },
    ]);

    // Audit log
    await admin.from("audit_logs").insert({
      actor_id: callerId,
      action: "attendance.correction_approved",
      entity_type: "attendance_record",
      entity_id: record.id,
      old_values: oldValues,
      new_values: {
        check_in_at: newCheckIn,
        check_out_at: newCheckOut,
        final_status: newStatus,
        correction_version: newVersion,
      },
    });
  } else {
    // Rejected
    await admin.from("attendance_history").insert({
      attendance_record_id: record.id,
      employee_id: correction.employee_id,
      event_type: "correction_rejected",
      event_data: {
        correction_id: correction.id,
        reviewer_remarks: body.reviewer_remarks,
      },
      performed_by: callerId,
    });

    await admin.from("audit_logs").insert({
      actor_id: callerId,
      action: "attendance.correction_rejected",
      entity_type: "attendance_correction",
      entity_id: correction.id,
      new_values: { reviewer_remarks: body.reviewer_remarks },
    });
  }

  return jsonResponse(200, {
    message: `Correction ${body.decision.toLowerCase()}`,
    correction_id: correction.id,
  });
}

async function checkPermission(
  admin: ReturnType<typeof createClient>,
  userId: string,
  permCode: string
): Promise<boolean> {
  const { data: prof } = await admin
    .from("user_profiles")
    .select("role")
    .eq("id", userId)
    .maybeSingle();

  if (!prof) return false;

  const { data: roleRow } = await admin
    .from("roles")
    .select("id")
    .eq("code", prof.role)
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
