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

    const { data: callerProfile } = await admin
      .from("user_profiles")
      .select("id, role, organization_id")
      .eq("id", user.id)
      .maybeSingle();
    if (!callerProfile) return jsonError(403, "Profile not found");

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

// ============ Central notification helper ============
// Calls the create-business-notification edge function to resolve recipients
// server-side (manager, HR, directors) and create notifications idempotently.
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
    // Resolve recipients and insert notifications directly (avoid HTTP call overhead)
    const recipientUserIds = new Set<string>();

    // Resolve by roles
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

    // Resolve direct reporting manager
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

        if (managerEmp?.user_id) {
          recipientUserIds.add(managerEmp.user_id);
        }
      }

      // Include the affected employee
      if (params.includeEmployee) {
        const { data: emp } = await adminClient
          .from("employees")
          .select("user_id")
          .eq("id", params.employeeId)
          .eq("is_active", true)
          .maybeSingle();

        if (emp?.user_id) {
          recipientUserIds.add(emp.user_id);
        }
      }
    }

    // Include actor for confirmation
    if (params.includeActor) {
      recipientUserIds.add(params.actorUserId);
    }

    // Exclude actor from supervisory notifications unless explicitly included
    if (!params.includeActor) {
      recipientUserIds.delete(params.actorUserId);
    }

    if (recipientUserIds.size === 0) return;

    // Create notification rows with idempotency keys
    const notificationsToInsert: Array<Record<string, unknown>> = [];
    for (const recipientId of recipientUserIds) {
      const idempotencyKey = `${params.organizationId}:${params.eventCode}:${params.entityId}:${recipientId}`;

      // Check for existing (idempotent)
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

    // Create WEB_PUSH delivery jobs
    const deliveryJobs = (inserted ?? []).map((n: { id: string; recipient_id: string }) => ({
      notification_id: n.id,
      channel: "web_push",
      recipient: n.recipient_id,
      status: "queued",
      idempotency_key: `push:${n.id}`,
    }));

    if (deliveryJobs.length > 0) {
      await adminClient.from("notification_deliveries").insert(deliveryJobs);
    }
  } catch {
    // Notification failure must not roll back the business transaction
  }
}

// ============ calculate_days ============
async function handleCalculateDays(body: any, callerProfile: any) {
  const { from_date, to_date, branch_id, half_day_type, organization_id } = body;
  if (!from_date || !to_date) return jsonError(400, "from_date and to_date required");

  let holidays: string[] = [];
  const { data: holidayDates } = await admin
    .from("holiday_calendar_dates")
    .select("date, is_working_day_override")
    .eq("holiday_calendars.organization_id", organization_id || callerProfile.organization_id)
    .eq("holiday_calendars.branch_id", branch_id ?? null);

  const { data: calEvents } = await admin
    .from("calendar_events")
    .select("start_date, end_date, is_working_day_override, event_type")
    .eq("organization_id", organization_id || callerProfile.organization_id)
    .in("event_type", ["PUBLIC_HOLIDAY", "COMPANY_HOLIDAY", "BRANCH_HOLIDAY", "WORKING_DAY_OVERRIDE"]);

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

  const start = new Date(from_date);
  const end = new Date(to_date);
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

  const { data: employee } = await adminClient
    .from("employees")
    .select("id, organization_id, branch_id, full_name")
    .eq("user_id", callerProfile.id)
    .eq("is_active", true)
    .maybeSingle();
  if (!employee) return jsonError(403, "Active employee record not found");

  const calcResult = await calculateLeaveDays(
    adminClient,
    employee.organization_id,
    branch_id ?? employee.branch_id,
    from_date,
    to_date,
    half_day_type
  );

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

  await adminClient.from("leave_request_history").insert({
    leave_request_id: leaveReq.id,
    action: "SUBMITTED",
    performed_by: callerProfile.id,
    new_values: { status: "PENDING_MANAGER", requested_days: calcResult.requested_days },
  });

  await adminClient.from("audit_logs").insert({
    actor_id: callerProfile.id,
    action: "leave.request_submitted",
    entity_type: "leave_request",
    entity_id: leaveReq.id,
    new_values: { from_date, to_date, requested_days: calcResult.requested_days, leave_type_id },
  });

  // Central notification: notify manager + HR + directors (supervisory)
  await notifyBusinessEvent(adminClient, {
    eventCode: "LEAVE_REQUEST_SUBMITTED",
    actorUserId: callerProfile.id,
    employeeId: employee.id,
    organizationId: employee.organization_id,
    entityType: "leave_request",
    entityId: leaveReq.id,
    title: "New Leave Request",
    message: `${employee.full_name || "An employee"} submitted a leave request for review.`,
    priority: "normal",
    category: "leave",
    actionUrl: `/leave/requests/${leaveReq.id}`,
    recipientRoles: ["hr_admin", "director"],
    metadata: { leave_request_id: leaveReq.id },
  });

  // Confirmation notification to employee
  await notifyBusinessEvent(adminClient, {
    eventCode: "LEAVE_REQUEST_SUBMITTED_CONFIRMATION",
    actorUserId: callerProfile.id,
    employeeId: employee.id,
    organizationId: employee.organization_id,
    entityType: "leave_request",
    entityId: leaveReq.id,
    title: "Leave Request Submitted",
    message: "Your leave request has been submitted successfully and is pending manager review.",
    priority: "normal",
    category: "leave",
    actionUrl: "/my-leave",
    includeEmployee: true,
    includeActor: true,
    metadata: { leave_request_id: leaveReq.id },
  });

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

  const { data: callerEmp } = await adminClient
    .from("employees")
    .select("id")
    .eq("user_id", callerProfile.id)
    .maybeSingle();
  if (callerEmp && callerEmp.id === leaveReq.employee_id) {
    return jsonError(403, "Cannot approve own leave request");
  }

  if (decision === "APPROVED") {
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

      // Notify employee of insufficient balance
      await notifyBusinessEvent(adminClient, {
        eventCode: "LEAVE_BALANCE_INSUFFICIENT",
        actorUserId: callerProfile.id,
        employeeId: leaveReq.employee_id,
        organizationId: leaveReq.organization_id,
        entityType: "leave_request",
        entityId: leaveReq.id,
        title: "Leave Request Rejected - Insufficient Balance",
        message: "Your leave request was rejected due to insufficient leave balance.",
        priority: "high",
        category: "leave",
        actionUrl: "/my-leave",
        includeEmployee: true,
        metadata: { leave_request_id: leaveReq.id },
      });

      return jsonError(400, "Insufficient leave balance");
    }

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

    // Notify HR + Director that leave is pending final approval
    await notifyBusinessEvent(adminClient, {
      eventCode: "LEAVE_MANAGER_APPROVED",
      actorUserId: callerProfile.id,
      employeeId: leaveReq.employee_id,
      organizationId: leaveReq.organization_id,
      entityType: "leave_request",
      entityId: leaveReq.id,
      title: "Leave Pending HR Approval",
      message: "A leave request has been approved by the manager and is pending final HR approval.",
      priority: "normal",
      category: "leave",
      actionUrl: `/leave/requests/${leaveReq.id}`,
      recipientRoles: ["hr_admin", "director"],
      metadata: { leave_request_id: leaveReq.id },
    });

    // Notify employee
    await notifyBusinessEvent(adminClient, {
      eventCode: "LEAVE_MANAGER_APPROVED",
      actorUserId: callerProfile.id,
      employeeId: leaveReq.employee_id,
      organizationId: leaveReq.organization_id,
      entityType: "leave_request",
      entityId: leaveReq.id,
      title: "Leave Approved by Manager",
      message: "Your leave request has been approved by your manager and is now pending HR approval.",
      priority: "normal",
      category: "leave",
      actionUrl: "/my-leave",
      includeEmployee: true,
      metadata: { leave_request_id: leaveReq.id },
    });
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

    // Notify employee + HR + Director
    await notifyBusinessEvent(adminClient, {
      eventCode: "LEAVE_MANAGER_REJECTED",
      actorUserId: callerProfile.id,
      employeeId: leaveReq.employee_id,
      organizationId: leaveReq.organization_id,
      entityType: "leave_request",
      entityId: leaveReq.id,
      title: "Leave Request Rejected by Manager",
      message: "A leave request has been rejected by the reporting manager.",
      priority: "high",
      category: "leave",
      actionUrl: `/leave/requests/${leaveReq.id}`,
      recipientRoles: ["hr_admin", "director"],
      includeEmployee: true,
      metadata: { leave_request_id: leaveReq.id },
    });
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

    // Notify employee
    await notifyBusinessEvent(adminClient, {
      eventCode: "LEAVE_RETURNED_FOR_CLARIFICATION",
      actorUserId: callerProfile.id,
      employeeId: leaveReq.employee_id,
      organizationId: leaveReq.organization_id,
      entityType: "leave_request",
      entityId: leaveReq.id,
      title: "Leave Request Returned for Clarification",
      message: "Your manager has returned your leave request for clarification. Please review and resubmit.",
      priority: "normal",
      category: "leave",
      actionUrl: "/my-leave",
      includeEmployee: true,
      metadata: { leave_request_id: leaveReq.id },
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
    const idempotencyKey = `${leaveReq.id}:${leaveReq.leave_type_id}:LEAVE_USED`;
    await adminClient.rpc("apply_leave_transaction", {
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

    // Notify employee + manager + director
    await notifyBusinessEvent(adminClient, {
      eventCode: "LEAVE_FINAL_APPROVED",
      actorUserId: callerProfile.id,
      employeeId: leaveReq.employee_id,
      organizationId: leaveReq.organization_id,
      entityType: "leave_request",
      entityId: leaveReq.id,
      title: "Leave Approved",
      message: "Your leave request has been fully approved.",
      priority: "normal",
      category: "leave",
      actionUrl: "/my-leave",
      recipientRoles: ["director"],
      includeEmployee: true,
      metadata: { leave_request_id: leaveReq.id },
    });
  } else if (decision === "REJECTED") {
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

    // Notify employee + manager + director
    await notifyBusinessEvent(adminClient, {
      eventCode: "LEAVE_FINAL_REJECTED",
      actorUserId: callerProfile.id,
      employeeId: leaveReq.employee_id,
      organizationId: leaveReq.organization_id,
      entityType: "leave_request",
      entityId: leaveReq.id,
      title: "Leave Rejected by HR",
      message: "Your leave request has been rejected by HR.",
      priority: "high",
      category: "leave",
      actionUrl: "/my-leave",
      recipientRoles: ["director"],
      includeEmployee: true,
      metadata: { leave_request_id: leaveReq.id },
    });
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

  // Cancellation of approved leave = cancellation request (needs approval)
  if (leaveReq.status === "APPROVED") {
    // Restore balance
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

    // Notify manager + HR + Director of cancellation
    await notifyBusinessEvent(adminClient, {
      eventCode: "LEAVE_CANCELLATION_REQUESTED",
      actorUserId: callerProfile.id,
      employeeId: leaveReq.employee_id,
      organizationId: leaveReq.organization_id,
      entityType: "leave_request",
      entityId: leaveReq.id,
      title: "Approved Leave Cancelled",
      message: "An approved leave request has been cancelled and balance restored.",
      priority: "high",
      category: "leave",
      actionUrl: `/leave/requests/${leaveReq.id}`,
      recipientRoles: ["hr_admin", "director"],
      metadata: { leave_request_id: leaveReq.id, reason },
    });
  }

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

  // Notify manager + HR + Director
  await notifyBusinessEvent(adminClient, {
    eventCode: "LEAVE_REQUEST_WITHDRAWN",
    actorUserId: callerProfile.id,
    employeeId: leaveReq.employee_id,
    organizationId: leaveReq.organization_id,
    entityType: "leave_request",
    entityId: leaveReq.id,
    title: "Leave Request Withdrawn",
    message: "An employee has withdrawn their pending leave request.",
    priority: "normal",
    category: "leave",
    actionUrl: "/team-leave",
    recipientRoles: ["hr_admin", "director"],
    metadata: { leave_request_id: leaveReq.id },
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
