import { createClient } from "npm:@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function jsonError(status: number, message: string) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return jsonError(401, "Missing authorization");

    const token = authHeader.replace("Bearer ", "");
    const {
      data: { user },
      error: authError,
    } = await admin.auth.getUser(token);
    if (authError || !user) return jsonError(401, "Invalid token");

    // Get caller profile
    const { data: callerProfile } = await admin
      .from("user_profiles")
      .select("id, role, organization_id")
      .eq("id", user.id)
      .maybeSingle();
    if (!callerProfile) return jsonError(403, "Profile not found");

    // Get caller permissions
    const permissions = await getCallerPermissions(admin, callerProfile.role);

    const body = await req.json();
    const action = body.action;

    switch (action) {
      case "calculate_days":
        return await handleCalculateDays(body, callerProfile);
      case "submit":
        return await handleSubmit(body, callerProfile, permissions, admin);
      case "manager_review":
        return await handleManagerReview(body, callerProfile, permissions, admin);
      case "hr_review":
        return await handleHRReview(body, callerProfile, permissions, admin);
      case "cancel":
        return await handleCancel(body, callerProfile, permissions, admin);
      case "withdraw":
        return await handleWithdraw(body, callerProfile, permissions, admin);
      case "adjust_balance":
        return await handleAdjustBalance(body, callerProfile, permissions, admin);
      default:
        return jsonError(400, `Unknown action: ${action}`);
    }
  } catch (err) {
    return jsonError(500, (err as Error).message);
  }
});

// Fetch role_id and then permissions for a given role code
async function getCallerPermissions(adminClient: any, roleCode: string): Promise<string[]> {
  const { data: role } = await adminClient
    .from("roles")
    .select("id")
    .eq("code", roleCode)
    .maybeSingle();
  if (!role) return [];

  const { data: perms } = await adminClient
    .from("role_permissions")
    .select("permissions!inner(code)")
    .eq("role_id", role.id);

  return (perms ?? []).map((p: any) => p.permissions?.code).filter(Boolean);
}

// ============ calculate_days ============
async function handleCalculateDays(body: any, callerProfile: any) {
  const { from_date, to_date, branch_id, half_day_type, organization_id } = body;
  if (!from_date || !to_date) return jsonError(400, "from_date and to_date required");

  // Fetch holidays for the org/branch
  let holidays: string[] = [];
  const { data: holidayDates } = await admin
    .from("holiday_calendar_dates")
    .select("date, is_working_day_override")
    .eq("holiday_calendars.organization_id", organization_id || callerProfile.organization_id)
    .eq("holiday_calendars.branch_id", branch_id ?? null);

  // Also fetch calendar events that are holidays
  const { data: calEvents } = await admin
    .from("calendar_events")
    .select("start_date, end_date, is_working_day_override, event_type")
    .eq("organization_id", organization_id || callerProfile.organization_id)
    .in("event_type", ["PUBLIC_HOLIDAY", "COMPANY_HOLIDAY", "BRANCH_HOLIDAY", "WORKING_DAY_OVERRIDE"]);

  // Build holiday set
  const holidaySet = new Set<string>();
  const workingOverrideSet = new Set<string>();

  for (const ev of calEvents ?? []) {
    const start = new Date(ev.start_date);
    const end = new Date(ev.end_date);
    for (let d = start; d <= end; d.setDate(d.getDate() + 1)) {
      const dateStr = d.toISOString().slice(0, 10);
      if (ev.is_working_day_override) {
        workingOverrideSet.add(dateStr);
      } else if (ev.event_type !== "WORKING_DAY_OVERRIDE") {
        holidaySet.add(dateStr);
      }
    }
  }

  // Calculate leave days
  const start = new Date(from_date);
  const end = new Date(to_date);
  let leaveDays = 0;
  const dayDetails: { date: string; is_leave: boolean; reason: string }[] = [];

  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const dateStr = d.toISOString().slice(0, 10);
    const dayOfWeek = d.getDay(); // 0 = Sunday

    if (dayOfWeek === 0 && !workingOverrideSet.has(dateStr)) {
      dayDetails.push({ date: dateStr, is_leave: false, reason: "Sunday (weekly off)" });
      continue;
    }

    if (holidaySet.has(dateStr) && !workingOverrideSet.has(dateStr)) {
      dayDetails.push({ date: dateStr, is_leave: false, reason: "Holiday" });
      continue;
    }

    leaveDays += 1;
    dayDetails.push({ date: dateStr, is_leave: true, reason: "Leave day" });
  }

  // Handle half-day
  if (half_day_type && leaveDays > 0) {
    leaveDays = 0.5;
  }

  return new Response(
    JSON.stringify({ requested_days: leaveDays, day_details: dayDetails }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

// ============ submit ============
async function handleSubmit(
  body: any,
  callerProfile: any,
  permissions: string[],
  adminClient: any
) {
  if (!permissions.includes("leave.request_self")) {
    return jsonError(403, "No permission to request leave");
  }

  const { leave_type_id, from_date, to_date, half_day_type, reason, supporting_document_path, branch_id } = body;
  if (!leave_type_id || !from_date || !to_date || !reason) {
    return jsonError(400, "Missing required fields");
  }

  // Get employee
  const { data: employee } = await adminClient
    .from("employees")
    .select("id, organization_id, branch_id")
    .eq("user_id", callerProfile.id)
    .eq("is_active", true)
    .maybeSingle();
  if (!employee) return jsonError(403, "Active employee record not found");

  // Server-side calculate days
  const calcResult = await calculateLeaveDays(
    adminClient,
    employee.organization_id,
    branch_id ?? employee.branch_id,
    from_date,
    to_date,
    half_day_type
  );

  // Check for overlapping approved/pending leave
  const { data: overlap } = await adminClient
    .from("leave_requests")
    .select("id, status")
    .eq("employee_id", employee.id)
    .in("status", ["PENDING_MANAGER", "PENDING_HR", "APPROVED"])
    .or(`and(from_date.lte.${to_date},to_date.gte.${from_date})`)
    .maybeSingle();

  if (overlap) {
    return jsonError(409, "Overlapping leave request already exists for this date range");
  }

  // Create leave request
  const { data: leaveReq, error: insertError } = await adminClient
    .from("leave_requests")
    .insert({
      employee_id: employee.id,
      organization_id: employee.organization_id,
      branch_id: branch_id ?? employee.branch_id,
      leave_type_id,
      from_date,
      to_date,
      requested_days: calcResult.requested_days,
      half_day_type: half_day_type ?? null,
      reason,
      supporting_document_path: supporting_document_path ?? null,
      status: "PENDING_MANAGER",
      version: 0,
    })
    .select("id")
    .single();

  if (insertError) return jsonError(500, `Failed to create leave request: ${insertError.message}`);

  // Write history
  await adminClient.from("leave_request_history").insert({
    leave_request_id: leaveReq.id,
    action: "SUBMITTED",
    performed_by: callerProfile.id,
    new_values: { status: "PENDING_MANAGER", requested_days: calcResult.requested_days },
  });

  // Write audit
  await adminClient.from("audit_logs").insert({
    actor_id: callerProfile.id,
    action: "leave.request_submitted",
    entity_type: "leave_request",
    entity_id: leaveReq.id,
    new_values: { from_date, to_date, requested_days: calcResult.requested_days, leave_type_id },
  });

  // Create notification for manager
  const { data: managers } = await adminClient
    .from("employee_reporting_lines")
    .select("manager_id, employees!inner(user_id)")
    .eq("employee_id", employee.id)
    .limit(1);

  if (managers && managers.length > 0) {
    const managerUserId = managers[0].employees?.user_id;
    if (managerUserId) {
      await adminClient.from("notifications").insert({
        recipient_id: managerUserId,
        notification_type: "leave_request_submitted",
        title: "New Leave Request",
        message: `A leave request has been submitted for your review.`,
        priority: "normal",
        dedup_key: `leave:${leaveReq.id}:submitted`,
        metadata: { leave_request_id: leaveReq.id },
      });
    }
  }

  return new Response(
    JSON.stringify({
      success: true,
      leave_request_id: leaveReq.id,
      requested_days: calcResult.requested_days,
      day_details: calcResult.day_details,
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

// ============ manager_review ============
async function handleManagerReview(
  body: any,
  callerProfile: any,
  permissions: string[],
  adminClient: any
) {
  if (!permissions.includes("leave.review_manager") && !permissions.includes("leave.override_director")) {
    return jsonError(403, "No permission to review as manager");
  }

  const { leave_request_id, decision, remarks } = body;
  if (!leave_request_id || !decision) return jsonError(400, "leave_request_id and decision required");

  const { data: leaveReq } = await adminClient
    .from("leave_requests")
    .select("id, employee_id, organization_id, status, leave_type_id, requested_days")
    .eq("id", leave_request_id)
    .eq("organization_id", callerProfile.organization_id)
    .maybeSingle();

  if (!leaveReq) return jsonError(404, "Leave request not found");
  if (leaveReq.status !== "PENDING_MANAGER") return jsonError(400, "Leave request is not pending manager review");

  // Prevent self-approval
  const { data: callerEmp } = await adminClient
    .from("employees")
    .select("id")
    .eq("user_id", callerProfile.id)
    .maybeSingle();
  if (callerEmp && callerEmp.id === leaveReq.employee_id) {
    return jsonError(403, "Cannot approve own leave request");
  }

  if (decision === "APPROVED") {
    // Reserve balance
    const idempotencyKey = `${leaveReq.id}:${leaveReq.leave_type_id}:LEAVE_RESERVED`;
    const { data: reserveResult } = await adminClient.rpc("apply_leave_transaction", {
      p_employee_id: leaveReq.employee_id,
      p_leave_type_id: leaveReq.leave_type_id,
      p_organization_id: leaveReq.organization_id,
      p_transaction_type: "LEAVE_RESERVED",
      p_quantity: -parseFloat(leaveReq.requested_days),
      p_idempotency_key: idempotencyKey,
      p_reference_type: "leave_request",
      p_reference_id: leaveReq.id,
      p_description: `Balance reserved for leave request`,
      p_created_by: callerProfile.id,
    });

    if (reserveResult && reserveResult[0] && reserveResult[0].balance_after < 0) {
      // Insufficient balance — reject
      await adminClient.from("leave_requests").update({
        status: "REJECTED",
        manager_decision: "REJECTED",
        manager_remarks: "Insufficient balance",
        rejected_by: callerProfile.id,
        rejected_at: new Date().toISOString(),
      }).eq("id", leaveReq.id);

      await adminClient.from("leave_request_history").insert({
        leave_request_id: leaveReq.id,
        action: "MANAGER_REJECTED",
        performed_by: callerProfile.id,
        remarks: "Insufficient balance",
      });

      return jsonError(400, "Insufficient leave balance");
    }

    // Move to HR stage
    await adminClient.from("leave_requests").update({
      status: "PENDING_HR",
      manager_decision: "APPROVED",
      manager_remarks: remarks ?? null,
      current_approver_id: callerProfile.id,
      updated_at: new Date().toISOString(),
    }).eq("id", leaveReq.id);

    await adminClient.from("leave_request_history").insert({
      leave_request_id: leaveReq.id,
      action: "MANAGER_APPROVED",
      performed_by: callerProfile.id,
      remarks: remarks ?? null,
    });

    // Notify HR
    const { data: hrUsers } = await adminClient
      .from("user_profiles")
      .select("id")
      .eq("organization_id", callerProfile.organization_id)
      .eq("role", "hr_administrator")
      .eq("status", "active");

    for (const hr of hrUsers ?? []) {
      await adminClient.from("notifications").insert({
        recipient_id: hr.id,
        notification_type: "leave_pending_hr",
        title: "Leave Request Pending HR Approval",
        message: "A leave request is pending final HR approval.",
        priority: "normal",
        dedup_key: `leave:${leaveReq.id}:pending_hr:${hr.id}`,
        metadata: { leave_request_id: leaveReq.id },
      });
    }
  } else if (decision === "REJECTED") {
    await adminClient.from("leave_requests").update({
      status: "REJECTED",
      manager_decision: "REJECTED",
      manager_remarks: remarks ?? null,
      rejected_by: callerProfile.id,
      rejected_at: new Date().toISOString(),
    }).eq("id", leaveReq.id);

    await adminClient.from("leave_request_history").insert({
      leave_request_id: leaveReq.id,
      action: "MANAGER_REJECTED",
      performed_by: callerProfile.id,
      remarks: remarks ?? null,
    });

    // Notify employee
    const { data: emp } = await adminClient
      .from("employees")
      .select("user_id")
      .eq("id", leaveReq.employee_id)
      .maybeSingle();

    if (emp?.user_id) {
      await adminClient.from("notifications").insert({
        recipient_id: emp.user_id,
        notification_type: "leave_rejected",
        title: "Leave Request Rejected",
        message: "Your leave request has been rejected by your manager.",
        priority: "normal",
        dedup_key: `leave:${leaveReq.id}:rejected`,
        metadata: { leave_request_id: leaveReq.id },
      });
    }
  } else if (decision === "RETURNED") {
    await adminClient.from("leave_requests").update({
      status: "DRAFT",
      manager_decision: "RETURNED",
      manager_remarks: remarks ?? null,
    }).eq("id", leaveReq.id);

    await adminClient.from("leave_request_history").insert({
      leave_request_id: leaveReq.id,
      action: "RETURNED_FOR_CLARIFICATION",
      performed_by: callerProfile.id,
      remarks: remarks ?? null,
    });
  }

  return new Response(
    JSON.stringify({ success: true, message: `Manager decision: ${decision}` }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

// ============ hr_review ============
async function handleHRReview(
  body: any,
  callerProfile: any,
  permissions: string[],
  adminClient: any
) {
  if (!permissions.includes("leave.approve_hr") && !permissions.includes("leave.override_director")) {
    return jsonError(403, "No permission to approve as HR");
  }

  const { leave_request_id, decision, remarks } = body;
  if (!leave_request_id || !decision) return jsonError(400, "leave_request_id and decision required");

  const { data: leaveReq } = await adminClient
    .from("leave_requests")
    .select("id, employee_id, organization_id, status, leave_type_id, requested_days")
    .eq("id", leave_request_id)
    .eq("organization_id", callerProfile.organization_id)
    .maybeSingle();

  if (!leaveReq) return jsonError(404, "Leave request not found");
  if (leaveReq.status !== "PENDING_HR") return jsonError(400, "Leave request is not pending HR review");

  if (decision === "APPROVED") {
    // Convert reserved to used
    const idempotencyKey = `${leaveReq.id}:${leaveReq.leave_type_id}:LEAVE_USED`;
    const { data: useResult } = await adminClient.rpc("apply_leave_transaction", {
      p_employee_id: leaveReq.employee_id,
      p_leave_type_id: leaveReq.leave_type_id,
      p_organization_id: leaveReq.organization_id,
      p_transaction_type: "LEAVE_USED",
      p_quantity: -parseFloat(leaveReq.requested_days),
      p_idempotency_key: idempotencyKey,
      p_reference_type: "leave_request",
      p_reference_id: leaveReq.id,
      p_description: `Leave used for approved request`,
      p_created_by: callerProfile.id,
    });

    // Reverse the reservation
    const reverseKey = `${leaveReq.id}:${leaveReq.leave_type_id}:REVERSAL`;
    await adminClient.rpc("apply_leave_transaction", {
      p_employee_id: leaveReq.employee_id,
      p_leave_type_id: leaveReq.leave_type_id,
      p_organization_id: leaveReq.organization_id,
      p_transaction_type: "REVERSAL",
      p_quantity: parseFloat(leaveReq.requested_days),
      p_idempotency_key: reverseKey,
      p_reference_type: "leave_request",
      p_reference_id: leaveReq.id,
      p_description: "Reversing reservation, converting to used",
      p_created_by: callerProfile.id,
    });

    await adminClient.from("leave_requests").update({
      status: "APPROVED",
      hr_decision: "APPROVED",
      hr_remarks: remarks ?? null,
      approved_by: callerProfile.id,
      approved_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", leaveReq.id);

    await adminClient.from("leave_request_history").insert({
      leave_request_id: leaveReq.id,
      action: "HR_APPROVED",
      performed_by: callerProfile.id,
      remarks: remarks ?? null,
    });

    // Notify employee
    const { data: emp } = await adminClient
      .from("employees")
      .select("user_id")
      .eq("id", leaveReq.employee_id)
      .maybeSingle();

    if (emp?.user_id) {
      await adminClient.from("notifications").insert({
        recipient_id: emp.user_id,
        notification_type: "leave_approved",
        title: "Leave Approved",
        message: "Your leave request has been approved.",
        priority: "normal",
        dedup_key: `leave:${leaveReq.id}:approved`,
        metadata: { leave_request_id: leaveReq.id },
      });
    }
  } else if (decision === "REJECTED") {
    // Restore reserved balance
    const restoreKey = `${leaveReq.id}:${leaveReq.leave_type_id}:RESTORE_REJECT`;
    await adminClient.rpc("apply_leave_transaction", {
      p_employee_id: leaveReq.employee_id,
      p_leave_type_id: leaveReq.leave_type_id,
      p_organization_id: leaveReq.organization_id,
      p_transaction_type: "REVERSAL",
      p_quantity: parseFloat(leaveReq.requested_days),
      p_idempotency_key: restoreKey,
      p_reference_type: "leave_request",
      p_reference_id: leaveReq.id,
      p_description: "Restoring reserved balance after HR rejection",
      p_created_by: callerProfile.id,
    });

    await adminClient.from("leave_requests").update({
      status: "REJECTED",
      hr_decision: "REJECTED",
      hr_remarks: remarks ?? null,
      rejected_by: callerProfile.id,
      rejected_at: new Date().toISOString(),
    }).eq("id", leaveReq.id);

    await adminClient.from("leave_request_history").insert({
      leave_request_id: leaveReq.id,
      action: "HR_REJECTED",
      performed_by: callerProfile.id,
      remarks: remarks ?? null,
    });

    // Notify employee
    const { data: emp } = await adminClient
      .from("employees")
      .select("user_id")
      .eq("id", leaveReq.employee_id)
      .maybeSingle();

    if (emp?.user_id) {
      await adminClient.from("notifications").insert({
        recipient_id: emp.user_id,
        notification_type: "leave_rejected",
        title: "Leave Rejected",
        message: "Your leave request has been rejected by HR.",
        priority: "normal",
        dedup_key: `leave:${leaveReq.id}:hr_rejected`,
        metadata: { leave_request_id: leaveReq.id },
      });
    }
  }

  return new Response(
    JSON.stringify({ success: true, message: `HR decision: ${decision}` }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

// ============ cancel ============
async function handleCancel(
  body: any,
  callerProfile: any,
  permissions: string[],
  adminClient: any
) {
  const { leave_request_id, reason } = body;
  if (!leave_request_id || !reason) return jsonError(400, "leave_request_id and reason required");

  const { data: leaveReq } = await adminClient
    .from("leave_requests")
    .select("id, employee_id, organization_id, status, leave_type_id, requested_days")
    .eq("id", leave_request_id)
    .eq("organization_id", callerProfile.organization_id)
    .maybeSingle();

  if (!leaveReq) return jsonError(404, "Leave request not found");

  // Check permission: self cancel or manage cancel
  const { data: callerEmp } = await adminClient
    .from("employees")
    .select("id")
    .eq("user_id", callerProfile.id)
    .maybeSingle();

  const isSelf = callerEmp?.id === leaveReq.employee_id;
  if (!isSelf && !permissions.includes("leave.cancel_manage") && !permissions.includes("leave.override_director")) {
    return jsonError(403, "No permission to cancel this leave request");
  }
  if (isSelf && !permissions.includes("leave.cancel_self")) {
    return jsonError(403, "No permission to cancel own leave");
  }

  if (leaveReq.status === "CANCELLED" || leaveReq.status === "WITHDRAWN") {
    return jsonError(400, "Leave request already cancelled/withdrawn");
  }

  // If was approved, restore balance
  if (leaveReq.status === "APPROVED") {
    const restoreKey = `${leaveReq.id}:${leaveReq.leave_type_id}:CANCEL_RESTORE`;
    await adminClient.rpc("apply_leave_transaction", {
      p_employee_id: leaveReq.employee_id,
      p_leave_type_id: leaveReq.leave_type_id,
      p_organization_id: leaveReq.organization_id,
      p_transaction_type: "LEAVE_CANCELLED_RESTORED",
      p_quantity: parseFloat(leaveReq.requested_days),
      p_idempotency_key: restoreKey,
      p_reference_type: "leave_request",
      p_reference_id: leaveReq.id,
      p_description: `Balance restored after cancellation: ${reason}`,
      p_created_by: callerProfile.id,
    });
  }

  // If was in PENDING_HR, reverse the reservation
  if (leaveReq.status === "PENDING_HR") {
    const reverseKey = `${leaveReq.id}:${leaveReq.leave_type_id}:CANCEL_REVERSE`;
    await adminClient.rpc("apply_leave_transaction", {
      p_employee_id: leaveReq.employee_id,
      p_leave_type_id: leaveReq.leave_type_id,
      p_organization_id: leaveReq.organization_id,
      p_transaction_type: "REVERSAL",
      p_quantity: parseFloat(leaveReq.requested_days),
      p_idempotency_key: reverseKey,
      p_reference_type: "leave_request",
      p_reference_id: leaveReq.id,
      p_description: `Reversing reservation after cancellation: ${reason}`,
      p_created_by: callerProfile.id,
    });
  }

  await adminClient.from("leave_requests").update({
    status: "CANCELLED",
    cancelled_by: callerProfile.id,
    cancelled_at: new Date().toISOString(),
    cancellation_reason: reason,
    updated_at: new Date().toISOString(),
  }).eq("id", leaveReq.id);

  await adminClient.from("leave_request_history").insert({
    leave_request_id: leaveReq.id,
    action: "CANCELLED",
    performed_by: callerProfile.id,
    remarks: reason,
  });

  await adminClient.from("audit_logs").insert({
    actor_id: callerProfile.id,
    action: "leave.cancelled",
    entity_type: "leave_request",
    entity_id: leaveReq.id,
    new_values: { reason },
  });

  return new Response(
    JSON.stringify({ success: true, message: "Leave request cancelled" }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

// ============ withdraw ============
async function handleWithdraw(
  body: any,
  callerProfile: any,
  permissions: string[],
  adminClient: any
) {
  if (!permissions.includes("leave.cancel_self")) {
    return jsonError(403, "No permission to withdraw leave");
  }

  const { leave_request_id } = body;
  if (!leave_request_id) return jsonError(400, "leave_request_id required");

  const { data: leaveReq } = await adminClient
    .from("leave_requests")
    .select("id, employee_id, organization_id, status")
    .eq("id", leave_request_id)
    .eq("organization_id", callerProfile.organization_id)
    .maybeSingle();

  if (!leaveReq) return jsonError(404, "Leave request not found");

  const { data: callerEmp } = await adminClient
    .from("employees")
    .select("id")
    .eq("user_id", callerProfile.id)
    .maybeSingle();

  if (callerEmp?.id !== leaveReq.employee_id) {
    return jsonError(403, "Can only withdraw own leave requests");
  }

  if (!["DRAFT", "PENDING_MANAGER"].includes(leaveReq.status)) {
    return jsonError(400, "Can only withdraw draft or pending manager requests");
  }

  await adminClient.from("leave_requests").update({
    status: "WITHDRAWN",
    updated_at: new Date().toISOString(),
  }).eq("id", leaveReq.id);

  await adminClient.from("leave_request_history").insert({
    leave_request_id: leaveReq.id,
    action: "WITHDRAWN",
    performed_by: callerProfile.id,
  });

  return new Response(
    JSON.stringify({ success: true, message: "Leave request withdrawn" }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

// ============ adjust_balance ============
async function handleAdjustBalance(
  body: any,
  callerProfile: any,
  permissions: string[],
  adminClient: any
) {
  if (!permissions.includes("leave.balance_adjust") && !permissions.includes("leave.override_director")) {
    return jsonError(403, "No permission to adjust balances");
  }

  const { employee_id, leave_type_id, quantity, description } = body;
  if (!employee_id || !leave_type_id || quantity === undefined) {
    return jsonError(400, "employee_id, leave_type_id, and quantity required");
  }

  const { data: emp } = await adminClient
    .from("employees")
    .select("organization_id")
    .eq("id", employee_id)
    .maybeSingle();
  if (!emp) return jsonError(404, "Employee not found");
  if (emp.organization_id !== callerProfile.organization_id) {
    return jsonError(403, "Cross-organization access denied");
  }

  const idempotencyKey = `${employee_id}:${leave_type_id}:MANUAL:${Date.now()}`;
  const { data: result } = await adminClient.rpc("apply_leave_transaction", {
    p_employee_id: employee_id,
    p_leave_type_id: leave_type_id,
    p_organization_id: emp.organization_id,
    p_transaction_type: "MANUAL_ADJUSTMENT",
    p_quantity: parseFloat(quantity),
    p_idempotency_key: idempotencyKey,
    p_reference_type: "manual_adjustment",
    p_description: description ?? "Manual balance adjustment",
    p_created_by: callerProfile.id,
  });

  await adminClient.from("audit_logs").insert({
    actor_id: callerProfile.id,
    action: "leave.balance_adjusted",
    entity_type: "leave_balance",
    entity_id: employee_id,
    new_values: { leave_type_id, quantity, description },
  });

  return new Response(
    JSON.stringify({ success: true, result: result?.[0] }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

// ============ helper: calculate leave days ============
async function calculateLeaveDays(
  adminClient: any,
  orgId: string,
  branchId: string | null,
  fromDate: string,
  toDate: string,
  halfDayType: string | null
) {
  const { data: calEvents } = await adminClient
    .from("calendar_events")
    .select("start_date, end_date, is_working_day_override, event_type")
    .eq("organization_id", orgId)
    .in("event_type", ["PUBLIC_HOLIDAY", "COMPANY_HOLIDAY", "BRANCH_HOLIDAY", "WORKING_DAY_OVERRIDE"]);

  const holidaySet = new Set<string>();
  const workingOverrideSet = new Set<string>();

  for (const ev of calEvents ?? []) {
    const start = new Date(ev.start_date);
    const end = new Date(ev.end_date);
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const dateStr = d.toISOString().slice(0, 10);
      if (ev.is_working_day_override) {
        workingOverrideSet.add(dateStr);
      } else if (ev.event_type !== "WORKING_DAY_OVERRIDE") {
        holidaySet.add(dateStr);
      }
    }
  }

  const start = new Date(fromDate);
  const end = new Date(toDate);
  let leaveDays = 0;
  const dayDetails: { date: string; is_leave: boolean; reason: string }[] = [];

  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const dateStr = d.toISOString().slice(0, 10);
    const dayOfWeek = d.getDay();

    if (dayOfWeek === 0 && !workingOverrideSet.has(dateStr)) {
      dayDetails.push({ date: dateStr, is_leave: false, reason: "Sunday (weekly off)" });
      continue;
    }

    if (holidaySet.has(dateStr) && !workingOverrideSet.has(dateStr)) {
      dayDetails.push({ date: dateStr, is_leave: false, reason: "Holiday" });
      continue;
    }

    leaveDays += 1;
    dayDetails.push({ date: dateStr, is_leave: true, reason: "Leave day" });
  }

  if (halfDayType && leaveDays > 0) {
    leaveDays = 0.5;
  }

  return { requested_days: leaveDays, day_details: dayDetails };
}
