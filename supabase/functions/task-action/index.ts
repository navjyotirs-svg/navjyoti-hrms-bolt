import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, Apikey",
};

const APPROVED_MIME_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/jpg",
  "image/png",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/csv",
];

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return errorResponse("Missing authorization header", 401);
    }

    // Use user JWT only to verify identity, then use pure service role for DB ops
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const {
      data: { user },
      error: authError,
    } = await userClient.auth.getUser();
    if (authError || !user) {
      return errorResponse("Unauthorized", 401);
    }

    const body = await req.json();
    const { action } = body;

    // Resolve user profile and permissions
    const { data: profile } = await supabase
      .from("user_profiles")
      .select("id, role, organization_id, status, is_active")
      .eq("id", user.id)
      .single();

    if (!profile || profile.status !== "active" || !profile.is_active) {
      return errorResponse("Account not active", 403);
    }

    const { data: perms } = await supabase.rpc("get_effective_permissions", { p_user_id: user.id });
    const permissions: string[] = perms || [];

    const orgId = profile.organization_id;
    if (!orgId) {
      return errorResponse("No organization membership", 403);
    }

    switch (action) {
      case "create":
        return await handleCreate(supabase, body, user.id, orgId, permissions);
      case "accept":
        return await handleAccept(supabase, body, user.id, permissions);
      case "reject":
        return await handleReject(supabase, body, user.id, permissions);
      case "request_change":
        return await handleRequestChange(supabase, body, user.id, permissions);
      case "review_request":
        return await handleReviewRequest(supabase, body, user.id, permissions);
      case "add_progress":
        return await handleAddProgress(supabase, body, user.id, permissions);
      case "submit":
        return await handleSubmit(supabase, body, user.id, permissions);
      case "review_submission":
        return await handleReviewSubmission(supabase, body, user.id, permissions);
      case "reassign":
        return await handleReassign(supabase, body, user.id, permissions);
      case "change_deadline":
        return await handleChangeDeadline(supabase, body, user.id, permissions);
      case "cancel":
        return await handleCancel(supabase, body, user.id, permissions);
      case "add_comment":
        return await handleAddComment(supabase, body, user.id, permissions);
      case "add_dependency":
        return await handleAddDependency(supabase, body, user.id, permissions);
      case "update_cost":
        return await handleUpdateCost(supabase, body, user.id, orgId, permissions);
      case "self_assign":
        return await handleSelfAssign(supabase, body, user.id, orgId, permissions);
      case "save_draft":
        return await handleSaveDraft(supabase, body, user.id, orgId);
      case "load_draft":
        return await handleLoadDraft(supabase, user.id);
      case "discard_draft":
        return await handleDiscardDraft(supabase, body, user.id);
      case "remove_assignee":
        return await handleRemoveAssignee(supabase, body, user.id, orgId, permissions);
      default:
        return errorResponse(`Unknown action: ${action}`, 400);
    }
  } catch (err) {
    return errorResponse((err as Error).message, 500);
  }
});

function errorResponse(message: string, status: number) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function successResponse(data: unknown) {
  return new Response(JSON.stringify(data), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function hasPerm(perms: string[], code: string): boolean {
  return perms.includes(code);
}

async function createNotification(
  supabase: ReturnType<typeof createClient>,
  recipientId: string,
  type: string,
  title: string,
  message: string,
  priority: string = "normal",
  dedupKey?: string,
  category: string = "task",
  actionUrl: string = "/my-tasks"
) {
  const notif: Record<string, unknown> = {
    recipient_id: recipientId,
    notification_type: type,
    title,
    message,
    priority,
    category,
    action_url: actionUrl,
  };
  if (dedupKey) notif.dedup_key = dedupKey;
  await supabase.from("notifications").insert(notif);
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

async function getCreatorName(supabase: ReturnType<typeof createClient>, userId: string): Promise<string> {
  try {
    const { data: profile } = await supabase
      .from("user_profiles")
      .select("full_name")
      .eq("id", userId)
      .maybeSingle();
    if (profile?.full_name) return profile.full_name;
    const { data: emp } = await supabase
      .from("employees")
      .select("full_name")
      .eq("user_id", userId)
      .maybeSingle();
    return emp?.full_name || "A user";
  } catch {
    return "A user";
  }
}

async function recalcOverallTaskStatus(
  supabase: ReturnType<typeof createClient>,
  taskId: string,
  currentStatus: string,
  _actorId: string
): Promise<string> {
  try {
    const { data: assignments } = await supabase
      .from("task_assignments")
      .select("assignment_status, is_current")
      .eq("task_id", taskId)
      .eq("is_current", true);
    if (!assignments || assignments.length === 0) return currentStatus;

    const statuses = assignments.map((a: { assignment_status: string }) => a.assignment_status);
    const allPending = statuses.every((s: string) => s === "ACCEPTANCE_PENDING");
    const allCompleted = statuses.every((s: string) => s === "COMPLETED");
    const allCancelled = statuses.every((s: string) => s === "CANCELLED");
    const allSubmitted = statuses.every((s: string) => s === "SUBMITTED" || s === "COMPLETED");
    const anyReassignment = statuses.some((s: string) => s === "REASSIGNMENT_REQUESTED");
    const anyActive = statuses.some((s: string) => s === "ACCEPTED" || s === "IN_PROGRESS" || s === "SUBMITTED" || s === "COMPLETED");

    let newStatus = currentStatus;
    if (allCancelled) newStatus = "CANCELLED";
    else if (allCompleted) newStatus = "COMPLETED";
    else if (anyReassignment) newStatus = "REASSIGNMENT_REQUESTED";
    else if (allSubmitted) newStatus = "SUBMITTED";
    else if (allPending) newStatus = "ACCEPTANCE_PENDING";
    else if (anyActive) newStatus = "IN_PROGRESS";

    if (newStatus !== currentStatus) {
      await supabase.from("tasks").update({ status: newStatus, version: 1 }).eq("id", taskId);
    }
    return newStatus;
  } catch {
    return currentStatus;
  }
}

async function handleSaveDraft(
  supabase: ReturnType<typeof createClient>,
  body: any,
  userId: string,
  orgId: string
) {
  const {
    draft_id,
    project_id,
    title,
    description,
    priority = "MEDIUM",
    expected_result,
    target_quantity,
    target_unit,
    estimated_hours,
    task_cost,
    deadline_at,
    start_date,
    task_type = "GENERAL",
    acceptance_required = true,
    branch_id,
    department_id,
    assignee_employee_ids = [],
  } = body;

  const now = new Date().toISOString();
  const draftData: Record<string, unknown> = {
    organization_id: orgId,
    created_by: userId,
    project_id: project_id || null,
    title: title || "",
    description: description || "",
    priority,
    expected_result: expected_result || "",
    target_quantity: target_quantity || null,
    target_unit: target_unit || null,
    estimated_hours: estimated_hours || null,
    task_cost: task_cost || null,
    deadline_at: deadline_at || null,
    start_date: start_date || new Date().toISOString().slice(0, 10),
    task_type,
    acceptance_required,
    branch_id: branch_id || null,
    department_id: department_id || null,
    last_saved_at: now,
    expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
  };

  let draftId = draft_id;

  if (draft_id) {
    const { data: existing } = await supabase
      .from("task_drafts")
      .select("id")
      .eq("id", draft_id)
      .eq("created_by", userId)
      .maybeSingle();
    if (existing) {
      await supabase.from("task_drafts").update({ ...draftData, updated_at: now }).eq("id", draft_id);
    } else {
      draftId = null;
    }
  }

  if (!draftId) {
    const { data: newDraft, error } = await supabase
      .from("task_drafts")
      .insert({ ...draftData, created_at: now, updated_at: now })
      .select("id")
      .single();
    if (error) return errorResponse(`Failed to save draft: ${error.message}`, 500);
    draftId = newDraft.id;
  }

  // Sync assignees: delete old, insert new
  await supabase.from("task_draft_assignees").delete().eq("draft_id", draftId);
  if (assignee_employee_ids.length > 0) {
    const assigneeRows = assignee_employee_ids.map((eid: string) => ({ draft_id: draftId, employee_id: eid }));
    await supabase.from("task_draft_assignees").insert(assigneeRows);
  }

  return successResponse({ draft_id: draftId, last_saved_at: now });
}

async function handleLoadDraft(
  supabase: ReturnType<typeof createClient>,
  userId: string
) {
  const { data: draft } = await supabase
    .from("task_drafts")
    .select("*")
    .eq("created_by", userId)
    .order("last_saved_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!draft) return successResponse({ draft: null });

  const { data: assignees } = await supabase
    .from("task_draft_assignees")
    .select("employee_id")
    .eq("draft_id", draft.id);

  return successResponse({
    draft: {
      ...draft,
      assignee_employee_ids: (assignees || []).map((a: { employee_id: string }) => a.employee_id),
    },
  });
}

async function handleDiscardDraft(
  supabase: ReturnType<typeof createClient>,
  body: any,
  userId: string
) {
  const { draft_id } = body;
  if (draft_id) {
    await supabase.from("task_drafts").delete().eq("id", draft_id).eq("created_by", userId);
  } else {
    await supabase.from("task_drafts").delete().eq("created_by", userId);
  }
  return successResponse({ message: "Draft discarded" });
}

async function handleRemoveAssignee(
  supabase: ReturnType<typeof createClient>,
  body: any,
  userId: string,
  orgId: string,
  perms: string[]
) {
  if (!hasPerm(perms, "task.reassign")) {
    return errorResponse("No permission to remove assignees", 403);
  }
  const { task_id, assignment_id, reason } = body;
  if (!task_id || !assignment_id) return errorResponse("Task ID and assignment ID required", 400);

  const { data: assignment } = await supabase
    .from("task_assignments")
    .select("id, assigned_to, assignment_status, is_current")
    .eq("id", assignment_id)
    .eq("task_id", task_id)
    .maybeSingle();
  if (!assignment) return errorResponse("Assignment not found", 404);

  // If assignee already accepted or started work, require reason and preserve history
  const needsReason = ["ACCEPTED", "IN_PROGRESS", "SUBMITTED"].includes(assignment.assignment_status);
  if (needsReason && !reason) {
    return errorResponse("Reason required to remove an assignee who has already accepted or started work", 400);
  }

  // End the assignment (preserve history — don't delete)
  await supabase
    .from("task_assignments")
    .update({
      is_current: false,
      ended_at: new Date().toISOString(),
      assignment_status: "CANCELLED",
      rejection_reason: reason || "Removed by manager",
    })
    .eq("id", assignment_id);

  // Status history
  await supabase.from("task_status_history").insert({
    task_id,
    old_status: null,
    new_status: "CANCELLED",
    changed_by: userId,
    reason: `Assignee removed: ${reason || "Removed by manager"}`,
  });

  // Recalculate overall task status
  const { data: task } = await supabase.from("tasks").select("status").eq("id", task_id).single();
  if (task) {
    await recalcOverallTaskStatus(supabase, task_id, task.status, userId);
  }

  // Notify the affected employee
  await createNotification(
    supabase,
    assignment.assigned_to,
    "TASK_ASSIGNMENT_CANCELLED",
    "Task Assignment Cancelled",
    `Your assignment has been cancelled. Reason: ${reason || "Removed by manager"}`,
    "normal",
    `task_assign_cancelled:${task_id}:${assignment_id}`,
    "task",
    "/my-tasks"
  );

  await writeAudit(supabase, userId, "task.remove_assignee", "task_assignment", assignment_id, { assignment_status: assignment.assignment_status }, { assignment_status: "CANCELLED", reason });

  return successResponse({ message: "Assignee removed" });
}

async function writeAudit(
  supabase: ReturnType<typeof createClient>,
  actorId: string,
  action: string,
  entityType: string,
  entityId: string,
  oldValues: unknown = null,
  newValues: unknown = null
) {
  await supabase.from("audit_logs").insert({
    actor_id: actorId,
    action,
    entity_type: entityType,
    entity_id: entityId,
    old_values: oldValues,
    new_values: newValues,
  });
}

// ============================================================
// CREATE TASK
// ============================================================
async function handleCreate(
  supabase: ReturnType<typeof createClient>,
  body: any,
  userId: string,
  orgId: string,
  perms: string[]
) {
  if (!hasPerm(perms, "task.create")) {
    return errorResponse("No permission to create tasks", 403);
  }

  const {
    title,
    description,
    assignee_id,
    assignee_ids,
    project_id,
    priority = "MEDIUM",
    task_type = "GENERAL",
    start_date,
    deadline,
    deadline_at,
    expected_result,
    target_quantity,
    target_unit,
    estimated_hours,
    acceptance_required = true,
    branch_id,
    department_id,
    collaborators = [],
    reviewers = [],
    dependencies = [],
    task_cost,
    draft_id,
  } = body;

  if (!title || !title.trim()) return errorResponse("Title is required", 400);
  if (!description || !description.trim()) return errorResponse("Description is required", 400);
  if (!project_id) return errorResponse("Project is required", 400);
  if (!start_date) return errorResponse("Start date is required", 400);

  // Resolve assignee IDs: support both new multi-assignee (assignee_ids array) and legacy single assignee_id
  const allAssigneeIds: string[] = [];
  if (assignee_ids && Array.isArray(assignee_ids) && assignee_ids.length > 0) {
 allAssigneeIds.push(...assignee_ids);
  } else if (assignee_id) {
    allAssigneeIds.push(assignee_id);
  }

  // Deduplicate
  const uniqueAssigneeIds = [...new Set(allAssigneeIds)];
  if (uniqueAssigneeIds.length === 0) {
    return errorResponse("At least one assignee is required", 400);
  }

  // Validate deadline: prefer deadline_at (timestamptz), fall back to deadline (date)
  let deadlineAt: string | null = null;
  let deadlineDate: string | null = null;
  if (deadline_at) {
    deadlineAt = deadline_at;
    deadlineDate = deadline_at.slice(0, 10);
  } else if (deadline) {
    deadlineDate = deadline;
    // Default to 6:00 PM IST (12:30 UTC) if no time provided
    deadlineAt = `${deadline}T12:30:00Z`;
  } else {
    return errorResponse("Deadline date and time are required", 400);
  }

  // Validate deadline is in the future
  const deadlineDateObj = new Date(deadlineAt);
  const startDateObj = new Date(start_date);
  if (deadlineDateObj < new Date()) {
    return errorResponse("Deadline must be in the future", 400);
  }
  if (deadlineDateObj < startDateObj) {
    return errorResponse("Deadline cannot be before start date", 400);
  }

  // Validate project belongs to same org
  const { data: project } = await supabase
    .from("projects")
    .select("id, organization_id")
    .eq("id", project_id)
    .single();
  if (!project || project.organization_id !== orgId) {
    return errorResponse("Project not in same organization", 403);
  }

  // Validate task_cost if provided
  let parsedCost: number | null = null;
  if (task_cost !== undefined && task_cost !== null && task_cost !== '') {
    parsedCost = Number(task_cost);
    if (isNaN(parsedCost) || parsedCost < 0) {
      return errorResponse("Task cost must be zero or greater", 400);
    }
    parsedCost = Math.round(parsedCost * 100) / 100;
  }
  if (parsedCost !== null && !hasPerm(perms, "task.cost_set")) {
    return errorResponse("No permission to set task cost", 403);
  }

  // Validate ALL assignees belong to same org and have active employee records
  const assigneeEmployeeMap = new Map<string, string>(); // user_id -> employee_id
  for (const assigneeId of uniqueAssigneeIds) {
    const { data: assigneeProfile } = await supabase
      .from("user_profiles")
      .select("id, organization_id")
      .eq("id", assigneeId)
      .maybeSingle();
    if (!assigneeProfile || assigneeProfile.organization_id !== orgId) {
      return errorResponse(`Assignee ${assigneeId} not in same organization`, 403);
    }
    const { data: assigneeEmployee } = await supabase
      .from("employees")
      .select("id")
      .eq("user_id", assigneeId)
      .eq("is_active", true)
      .maybeSingle();
    if (!assigneeEmployee) {
      return errorResponse(`Assignee has no active employee record`, 400);
    }
    assigneeEmployeeMap.set(assigneeId, assigneeEmployee.id);
  }

  // Generate task code server-side
  const { data: taskCode, error: codeError } = await supabase.rpc("generate_task_code", {
    p_org_id: orgId,
  });
  if (codeError || !taskCode) {
    return errorResponse("Failed to generate task code", 500);
  }

  const initialStatus = acceptance_required ? "ACCEPTANCE_PENDING" : "ASSIGNED";
  const firstAssigneeId = uniqueAssigneeIds[0];
  const firstEmployeeId = assigneeEmployeeMap.get(firstAssigneeId)!;

  // Create task
  const { data: task, error: taskError } = await supabase
    .from("tasks")
    .insert({
      organization_id: orgId,
      branch_id: branch_id || null,
      department_id: department_id || null,
      project_id,
      task_code: taskCode,
      title: title.trim(),
      description: description.trim(),
      priority,
      task_type,
      created_by: userId,
      owner_id: firstAssigneeId,
      assigned_employee_id: firstEmployeeId,
      start_date,
      original_deadline: deadlineDate,
      current_deadline: deadlineDate,
      deadline_at: deadlineAt,
      expected_result: expected_result || "",
      target_quantity: target_quantity || null,
      target_unit: target_unit || null,
      estimated_hours: estimated_hours || null,
      status: initialStatus,
      acceptance_required,
      task_cost: parsedCost,
      task_cost_currency: 'INR',
      task_cost_updated_by: parsedCost !== null ? userId : null,
      task_cost_updated_at: parsedCost !== null ? new Date().toISOString() : null,
    })
    .select()
    .single();

  if (taskError) {
    return errorResponse(`Failed to create task: ${taskError.message}`, 500);
  }

  // Create assignments for ALL selected employees
  const assignmentsToInsert = uniqueAssigneeIds.map((assigneeId: string) => ({
    task_id: task.id,
    assigned_to: assigneeId,
    assigned_by: userId,
    assignment_type: "PRIMARY",
    assignment_status: acceptance_required ? "ACCEPTANCE_PENDING" : "ACCEPTED",
    accepted_at: acceptance_required ? null : new Date().toISOString(),
  }));
  const { error: assignError } = await supabase
    .from("task_assignments")
    .insert(assignmentsToInsert);
  if (assignError) {
    return errorResponse(`Failed to create assignments: ${assignError.message}`, 500);
  }

  // Create collaborator assignments
  for (const c of collaborators) {
    if (!uniqueAssigneeIds.includes(c)) {
      await supabase.from("task_assignments").insert({
        task_id: task.id,
        assigned_to: c,
        assigned_by: userId,
        assignment_type: "COLLABORATOR",
      });
    }
  }

  // Create reviewer assignments
  for (const r of reviewers) {
    if (!uniqueAssigneeIds.includes(r) && !collaborators.includes(r)) {
      await supabase.from("task_assignments").insert({
        task_id: task.id,
        assigned_to: r,
        assigned_by: userId,
        assignment_type: "REVIEWER",
      });
    }
  }

  // Create dependencies
  for (const dep of dependencies) {
    const { data: isCircular } = await supabase.rpc("check_circular_dependency", {
      p_task_id: task.id,
      p_depends_on_id: dep,
    });
    if (isCircular) continue;
    await supabase.from("task_dependencies").insert({
      task_id: task.id,
      depends_on_task_id: dep,
      created_by: userId,
    });
  }

  // Create status history
  await supabase.from("task_status_history").insert({
    task_id: task.id,
    old_status: null,
    new_status: initialStatus,
    changed_by: userId,
    reason: `Task created with ${uniqueAssigneeIds.length} assignee(s)`,
  });

  // Notify each assignee individually (no duplicates)
  for (const assigneeId of uniqueAssigneeIds) {
    await createNotification(
      supabase,
      assigneeId,
      "TASK_ASSIGNED",
      "New Task Assigned",
      `You have been assigned a new task: ${title.trim()}`,
      "normal",
      `task_assigned:${task.id}:${assigneeId}`,
      "task",
      "/my-tasks"
    );
    if (parsedCost !== null) {
      await createNotification(
        supabase,
        assigneeId,
        "TASK_COST_CREATED",
        "Task Assigned with Cost",
        `Task ${taskCode}: ${title.trim()} has been assigned with an operational task cost.`,
        "normal",
        `task_cost_created:${task.id}:${assigneeId}`,
        "task",
        "/my-tasks"
      );
    }
  }

  // Supervisory notification summarising the assignment
  const creatorName = await getCreatorName(supabase, userId);
  await notifyBusinessEvent(supabase, {
    eventCode: "TASK_CREATED",
    actorUserId: userId,
    organizationId: orgId,
    entityType: "task",
    entityId: task.id,
    title: "New Task Created",
    message: `${creatorName} assigned '${title.trim()}' to ${uniqueAssigneeIds.length} employee(s).`,
    priority: "normal",
    category: "task",
    actionUrl: "/team-tasks",
    recipientRoles: ["hr_admin", "director", "manager"],
  });

  // Audit
  await writeAudit(supabase, userId, "task.create", "task", task.id, null, { task_code: taskCode, title, assignee_count: uniqueAssigneeIds.length });

  // Clear the creator's draft if draft_id provided
  if (draft_id) {
    await supabase.from("task_drafts").delete().eq("id", draft_id).eq("created_by", userId);
  } else {
    // Clear any existing drafts by this user (task creation succeeded)
    await supabase.from("task_drafts").delete().eq("created_by", userId);
  }

  return successResponse({ task, task_code: taskCode, assignment_count: uniqueAssigneeIds.length });
}

// ============================================================
// SELF-ASSIGN TASK
// ============================================================
async function handleSelfAssign(
  supabase: ReturnType<typeof createClient>,
  body: any,
  userId: string,
  orgId: string,
  perms: string[]
) {
  if (!hasPerm(perms, "task.self_assign")) {
    return errorResponse("No permission to self-assign tasks", 403);
  }

  const {
    project_id,
    title,
    description,
    priority = "MEDIUM",
    start_date,
    deadline,
    reason,
    expected_result,
    target_quantity,
    target_unit,
    estimated_hours,
    task_cost,
  } = body;

  // Required fields
  if (!project_id) return errorResponse("Project is required", 400);
  if (!title || !title.trim()) return errorResponse("Title is required", 400);
  if (!priority) return errorResponse("Priority is required", 400);
  if (!start_date) return errorResponse("Start date is required", 400);
  if (!deadline) return errorResponse("Deadline is required", 400);
  if (!reason || !reason.trim()) return errorResponse("Reason is required for self-assignment", 400);
  if (new Date(deadline) < new Date(start_date)) {
    return errorResponse("Deadline cannot be before start date", 400);
  }

  // Validate project belongs to same org
  const { data: project } = await supabase
    .from("projects")
    .select("id, organization_id")
    .eq("id", project_id)
    .single();
  if (!project || project.organization_id !== orgId) {
    return errorResponse("Project not in same organization", 403);
  }

  // Validate task_cost if provided
  let parsedCost: number | null = null;
  if (task_cost !== undefined && task_cost !== null && task_cost !== '') {
    parsedCost = Number(task_cost);
    if (isNaN(parsedCost) || parsedCost < 0) {
      return errorResponse("Task cost must be zero or greater", 400);
    }
    parsedCost = Math.round(parsedCost * 100) / 100;
  }

  if (parsedCost !== null && !hasPerm(perms, "task.cost_set")) {
    return errorResponse("No permission to set task cost", 403);
  }

  // Resolve the authenticated user's active employee record
  const { data: employee, error: empError } = await supabase
    .from("employees")
    .select("id, user_id, full_name, organization_id")
    .eq("user_id", userId)
    .eq("is_active", true)
    .maybeSingle();
  if (empError || !employee) {
    return errorResponse("No active employee record found for user", 403);
  }
  if (employee.organization_id !== orgId) {
    return errorResponse("Cross-organization access denied", 403);
  }

  // Generate task code server-side
  const { data: taskCode, error: codeError } = await supabase.rpc("generate_task_code", {
    p_org_id: orgId,
  });
  if (codeError || !taskCode) {
    return errorResponse("Failed to generate task code", 500);
  }

  // Create task (self-assigned, already IN_PROGRESS)
  const { data: task, error: taskError } = await supabase
    .from("tasks")
    .insert({
      organization_id: orgId,
      project_id,
      task_code: taskCode,
      title: title.trim(),
      description: description ? description.trim() : "",
      priority,
      task_type: "GENERAL",
      created_by: userId,
      owner_id: userId,
      assigned_employee_id: employee.id,
      start_date,
      original_deadline: deadline,
      current_deadline: deadline,
      expected_result: expected_result || "",
      target_quantity: target_quantity || null,
      target_unit: target_unit || null,
      estimated_hours: estimated_hours || null,
      status: "IN_PROGRESS",
      acceptance_required: false,
      is_self_assigned: true,
      self_assigned_by: userId,
      self_assigned_at: new Date().toISOString(),
      self_assign_reason: reason.trim(),
      task_cost: parsedCost,
      task_cost_currency: 'INR',
      task_cost_updated_by: parsedCost !== null ? userId : null,
      task_cost_updated_at: parsedCost !== null ? new Date().toISOString() : null,
    })
    .select()
    .single();

  if (taskError) {
    return errorResponse(`Failed to create self-assigned task: ${taskError.message}`, 500);
  }

  // Create primary assignment (to self)
  await supabase.from("task_assignments").insert({
    task_id: task.id,
    assigned_to: userId,
    assigned_by: userId,
    assignment_type: "PRIMARY",
    is_current: true,
  });

  // Status history (null -> IN_PROGRESS)
  await supabase.from("task_status_history").insert({
    task_id: task.id,
    old_status: null,
    new_status: "IN_PROGRESS",
    changed_by: userId,
    reason: `Self-assigned: ${reason.trim()}`,
  });

  // Audit
  await writeAudit(supabase, userId, "task.self_assign", "task", task.id, null, {
    task_code: taskCode,
    title,
    project_id,
    reason: reason.trim(),
  });

  // Notify reporting manager + HR + directors
  const message = `${employee.full_name} self-assigned a ${priority} priority task: ${title}.`;
  await notifyBusinessEvent(supabase, {
    eventCode: "TASK_SELF_ASSIGNED",
    actorUserId: userId,
    employeeId: employee.id,
    organizationId: orgId,
    entityType: "task",
    entityId: task.id,
    title: "Task Self-Assigned",
    message,
    priority: "normal",
    category: "task",
    actionUrl: "/team-tasks",
    recipientRoles: ["hr_admin", "director"],
  });

  // Notify the employee (confirmation)
  await createNotification(
    supabase,
    userId,
    "TASK_SELF_ASSIGNED",
    "Task Self-Assigned",
    `Your self-assigned task ${taskCode}: ${title} has been created and is now in progress.`,
    "normal",
    `task_self_assigned:${task.id}`,
    "task",
    "/team-tasks"
  );

  return successResponse({ task_id: task.id, task_code: taskCode });
}

// ============================================================
// ACCEPT TASK
// ============================================================
async function handleAccept(
  supabase: ReturnType<typeof createClient>,
  body: any,
  userId: string,
  perms: string[]
) {
  if (!hasPerm(perms, "task.accept_self")) {
    return errorResponse("No permission to accept tasks", 403);
  }

  const { task_id } = body;
  if (!task_id) return errorResponse("Task ID required", 400);

  // Verify user is current assignee
  const { data: assignment } = await supabase
    .from("task_assignments")
    .select("id, task_id, assignment_status")
    .eq("task_id", task_id)
    .eq("assigned_to", userId)
    .eq("is_current", true)
    .eq("assignment_type", "PRIMARY")
    .maybeSingle();

  if (!assignment) {
    return errorResponse("You are not the primary assignee of this task", 403);
  }

  // Get current task status
  const { data: task } = await supabase
    .from("tasks")
    .select("status, task_code, title")
    .eq("id", task_id)
    .single();
  if (!task) return errorResponse("Task not found", 404);

  if (!["ACCEPTANCE_PENDING", "ASSIGNED", "REVISION_REQUESTED", "REASSIGNMENT_REQUESTED"].includes(task.status)) {
    return errorResponse(`Task cannot be accepted in status: ${task.status}`, 400);
  }

  // Update THIS assignment's status (per-assignee workflow)
  await supabase
    .from("task_assignments")
    .update({
      accepted_at: new Date().toISOString(),
      assignment_status: "ACCEPTED",
    })
    .eq("id", assignment.id);

  // Recalculate overall task status from all assignments
  const newTaskStatus = await recalcOverallTaskStatus(supabase, task_id, task.status, userId);

  // Status history
  await supabase.from("task_status_history").insert({
    task_id,
    old_status: task.status,
    new_status: newTaskStatus,
    changed_by: userId,
    reason: "Task accepted by assignee",
  });

  // Notify creator
  const { data: task2 } = await supabase
    .from("tasks")
    .select("created_by")
    .eq("id", task_id)
    .single();
  if (task2) {
    await createNotification(
      supabase,
      task2.created_by,
      "TASK_ACCEPTED",
      "Task Accepted",
      `Task ${task.task_code}: ${task.title} has been accepted`,
      "normal",
      `task_accepted:${task_id}:${userId}`,
      "task",
      "/team-tasks"
    );
  }

  await writeAudit(supabase, userId, "task.accept", "task", task_id, { status: task.status }, { status: newTaskStatus });

  return successResponse({ message: "Task accepted", status: newTaskStatus, assignment_status: "ACCEPTED" });
}

// ============================================================
// REJECT TASK (before acceptance, with mandatory fields)
// ============================================================
async function handleReject(
  supabase: ReturnType<typeof createClient>,
  body: any,
  userId: string,
  perms: string[]
) {
  if (!hasPerm(perms, "task.request_change_self")) {
    return errorResponse("No permission to reject tasks", 403);
  }

  const {
    task_id,
    reason,
    current_workload,
    assigned_target,
    assigned_deadline,
    proposed_target,
    proposed_deadline,
    support_required,
  } = body;

  if (!task_id) return errorResponse("Task ID required", 400);
  if (!reason || !reason.trim()) return errorResponse("Reason is required for rejection", 400);
  if (!current_workload) return errorResponse("Current workload is required", 400);
  if (!assigned_target) return errorResponse("Assigned target is required", 400);
  if (!assigned_deadline) return errorResponse("Assigned deadline is required", 400);
  if (!proposed_target) return errorResponse("Proposed target is required", 400);
  if (!proposed_deadline) return errorResponse("Proposed deadline is required", 400);
  if (!support_required) return errorResponse("Support required is required", 400);

  // Verify user is assignee
  const { data: assignment } = await supabase
    .from("task_assignments")
    .select("id")
    .eq("task_id", task_id)
    .eq("assigned_to", userId)
    .eq("is_current", true)
    .maybeSingle();
  if (!assignment) return errorResponse("You are not an assignee of this task", 403);

  const { data: task } = await supabase
    .from("tasks")
    .select("status, task_code, title, created_by")
    .eq("id", task_id)
    .single();
  if (!task) return errorResponse("Task not found", 404);

  if (!["ACCEPTANCE_PENDING", "ASSIGNED"].includes(task.status)) {
    return errorResponse(`Task cannot be rejected in status: ${task.status}`, 400);
  }

  // Create action request
  const { data: request } = await supabase
    .from("task_action_requests")
    .insert({
      task_id,
      employee_id: userId,
      request_type: "REJECTION",
      current_workload,
      reason: reason.trim(),
      assigned_target,
      assigned_deadline,
      proposed_target,
      proposed_deadline,
      support_required,
      status: "PENDING",
    })
    .select()
    .single();

  // Update task status to REJECTED
  await supabase.from("tasks").update({ status: "REJECTED" }).eq("id", task_id);

  // Status history
  await supabase.from("task_status_history").insert({
    task_id,
    old_status: task.status,
    new_status: "REJECTED",
    changed_by: userId,
    reason: `Rejection: ${reason.trim()}`,
    metadata: { request_id: request?.id },
  });

  // Notify creator/manager
  await createNotification(
    supabase,
    task.created_by,
    "TASK_REJECTED",
    "Task Rejected",
    `Task ${task.task_code}: ${task.title} has been rejected. Reason: ${reason}`,
    "high",
    `task_rejected:${task_id}`,
    "task",
    "/task-review"
  );

  // Supervisory notification: HR + Directors
  const { data: rejectAssignee } = await supabase
    .from("employees")
    .select("id, organization_id")
    .eq("user_id", userId)
    .eq("is_active", true)
    .maybeSingle();
  if (rejectAssignee) {
    await notifyBusinessEvent(supabase, {
      eventCode: "TASK_REJECTED",
      actorUserId: userId,
      employeeId: rejectAssignee.id,
      organizationId: rejectAssignee.organization_id,
      entityType: "task",
      entityId: task_id,
      title: "Task Rejected",
      message: `Task ${task.task_code} has been rejected by the assignee.`,
      priority: "high",
      category: "task",
      actionUrl: "/team-tasks",
      recipientRoles: ["hr_admin", "director"],
    });
  }

  await writeAudit(supabase, userId, "task.reject", "task", task_id, { status: task.status }, { status: "REJECTED" });

  return successResponse({ message: "Task rejected with mandatory fields", request_id: request?.id });
}

// ============================================================
// REQUEST CHANGE (clarification, revision, reassignment, deadline, target)
// ============================================================
async function handleRequestChange(
  supabase: ReturnType<typeof createClient>,
  body: any,
  userId: string,
  perms: string[]
) {
  if (!hasPerm(perms, "task.request_change_self")) {
    return errorResponse("No permission to request changes", 403);
  }

  const {
    task_id,
    request_type,
    reason,
    current_workload,
    assigned_target,
    assigned_deadline,
    proposed_target,
    proposed_deadline,
    support_required,
  } = body;

  if (!task_id) return errorResponse("Task ID required", 400);
  if (!request_type) return errorResponse("Request type required", 400);
  if (!reason || !reason.trim()) return errorResponse("Reason is required", 400);

  const validTypes = ["CLARIFICATION", "REVISION", "REASSIGNMENT", "DEADLINE_EXTENSION", "TARGET_CORRECTION", "SUPPORT_REQUEST"];
  if (!validTypes.includes(request_type)) {
    return errorResponse(`Invalid request type: ${request_type}`, 400);
  }

  // Mandatory fields for non-clarification requests
  if (request_type !== "CLARIFICATION" && request_type !== "SUPPORT_REQUEST") {
    if (!current_workload) return errorResponse("Current workload is required", 400);
    if (!assigned_target) return errorResponse("Assigned target is required", 400);
    if (!assigned_deadline) return errorResponse("Assigned deadline is required", 400);
    if (!proposed_target) return errorResponse("Proposed target is required", 400);
    if (!proposed_deadline) return errorResponse("Proposed deadline is required", 400);
    if (!support_required) return errorResponse("Support required is required", 400);
  }

  // Verify user is assignee
  const { data: assignment } = await supabase
    .from("task_assignments")
    .select("id")
    .eq("task_id", task_id)
    .eq("assigned_to", userId)
    .eq("is_current", true)
    .maybeSingle();
  if (!assignment) return errorResponse("You are not an assignee of this task", 403);

  const { data: task } = await supabase
    .from("tasks")
    .select("status, task_code, title, created_by")
    .eq("id", task_id)
    .single();
  if (!task) return errorResponse("Task not found", 404);

  // Create action request
  const { data: request, error } = await supabase
    .from("task_action_requests")
    .insert({
      task_id,
      employee_id: userId,
      request_type,
      current_workload: current_workload || null,
      reason: reason.trim(),
      assigned_target: assigned_target || null,
      assigned_deadline: assigned_deadline || null,
      proposed_target: proposed_target || null,
      proposed_deadline: proposed_deadline || null,
      support_required: support_required || null,
      status: "PENDING",
    })
    .select()
    .single();

  if (error) return errorResponse(`Failed to create request: ${error.message}`, 500);

  // Update task status based on request type
  let newStatus = task.status;
  if (request_type === "REVISION") newStatus = "REVISION_REQUESTED";
  else if (request_type === "REASSIGNMENT") newStatus = "REASSIGNMENT_REQUESTED";

  if (newStatus !== task.status) {
    await supabase.from("tasks").update({ status: newStatus }).eq("id", task_id);
    await supabase.from("task_status_history").insert({
      task_id,
      old_status: task.status,
      new_status: newStatus,
      changed_by: userId,
      reason: `${request_type} requested: ${reason.trim()}`,
      metadata: { request_id: request.id },
    });
  }

  // Notify creator/manager
  await createNotification(
    supabase,
    task.created_by,
    "TASK_CHANGE_REQUEST",
    `${request_type.replace(/_/g, " ")} Request`,
    `Task ${task.task_code}: ${request_type} requested. Reason: ${reason}`,
    "normal",
    `task_change_request:${request.id}`,
    "task",
    "/task-review"
  );

  // Supervisory notification: HR + Directors (only for REASSIGNMENT)
  if (request_type === "REASSIGNMENT") {
    const { data: reassignAssignee } = await supabase
      .from("employees")
      .select("id, organization_id")
      .eq("user_id", userId)
      .eq("is_active", true)
      .maybeSingle();
    if (reassignAssignee) {
      await notifyBusinessEvent(supabase, {
        eventCode: "TASK_REASSIGNMENT_REQUESTED",
        actorUserId: userId,
        employeeId: reassignAssignee.id,
        organizationId: reassignAssignee.organization_id,
        entityType: "task",
        entityId: task_id,
        title: "Task Reassignment Requested",
        message: `A reassignment has been requested for task ${task.task_code}.`,
        priority: "high",
        category: "task",
        actionUrl: "/team-tasks",
        recipientRoles: ["hr_admin", "director"],
      });
    }
  }

  await writeAudit(supabase, userId, "task.request_change", "task_action_request", request.id, null, { request_type, task_id });

  return successResponse({ message: "Request created", request });
}

// ============================================================
// REVIEW REQUEST (approve/reject/return)
// ============================================================
async function handleReviewRequest(
  supabase: ReturnType<typeof createClient>,
  body: any,
  userId: string,
  perms: string[]
) {
  if (!hasPerm(perms, "task.review")) {
    return errorResponse("No permission to review requests", 403);
  }

  const { request_id, decision, reviewer_remarks, new_deadline, new_target, new_assignee_id } = body;
  if (!request_id) return errorResponse("Request ID required", 400);
  if (!decision || !["APPROVED", "REJECTED", "RETURNED_FOR_DETAILS"].includes(decision)) {
    return errorResponse("Valid decision required (APPROVED/REJECTED/RETURNED_FOR_DETAILS)", 400);
  }

  const { data: request } = await supabase
    .from("task_action_requests")
    .select("*")
    .eq("id", request_id)
    .single();
  if (!request) return errorResponse("Request not found", 404);
  if (request.status !== "PENDING") return errorResponse("Request already reviewed", 400);

  // Prevent self-review
  if (request.employee_id === userId) {
    return errorResponse("Cannot review own request", 403);
  }

  // Update request
  await supabase
    .from("task_action_requests")
    .update({
      status: decision,
      reviewed_by: userId,
      reviewer_remarks: reviewer_remarks || null,
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", request_id);

  const { data: task } = await supabase
    .from("tasks")
    .select("*")
    .eq("id", request.task_id)
    .single();
  if (!task) return errorResponse("Task not found", 404);

  if (decision === "APPROVED") {
    let oldDeadline = task.current_deadline;
    let newDeadline = new_deadline || request.proposed_deadline || task.current_deadline;

    // Apply deadline change if different
    if (newDeadline && newDeadline !== oldDeadline) {
      await supabase.from("tasks").update({ current_deadline: newDeadline }).eq("id", task.id);
      await supabase.from("task_deadline_history").insert({
        task_id: task.id,
        old_deadline: oldDeadline,
        new_deadline: newDeadline,
        changed_by: userId,
        change_reason: `Approved ${request.request_type}: ${request.reason}`,
        request_id: request.id,
      });
    }

    // Apply target change if provided
    if (new_target) {
      await supabase.from("tasks").update({ target_quantity: new_target }).eq("id", task.id);
    }

    // Apply reassignment if provided
    if (new_assignee_id || request.request_type === "REASSIGNMENT") {
      const newAssignee = new_assignee_id || request.proposed_target;
      if (newAssignee) {
        // End current primary assignment
        await supabase
          .from("task_assignments")
          .update({ is_current: false, ended_at: new Date().toISOString() })
          .eq("task_id", task.id)
          .eq("assignment_type", "PRIMARY")
          .eq("is_current", true);

        // Create new primary assignment
        await supabase.from("task_assignments").insert({
          task_id: task.id,
          assigned_to: newAssignee,
          assigned_by: userId,
          assignment_type: "PRIMARY",
        });

        await supabase.from("tasks").update({ owner_id: newAssignee }).eq("id", task.id);
      }
    }

    // Set task back to ACCEPTANCE_PENDING or ACCEPTED
    const newTaskStatus = task.acceptance_required ? "ACCEPTANCE_PENDING" : "ASSIGNED";
    await supabase.from("tasks").update({ status: newTaskStatus }).eq("id", task.id);

    await supabase.from("task_status_history").insert({
      task_id: task.id,
      old_status: task.status,
      new_status: newTaskStatus,
      changed_by: userId,
      reason: `Request approved: ${request.request_type}`,
      metadata: { request_id: request.id },
    });

    // Notify employee
    await createNotification(
      supabase,
      request.employee_id,
      "TASK_REQUEST_APPROVED",
      "Request Approved",
      `Your ${request.request_type} request for task ${task.task_code} has been approved`,
      "normal",
      `task_request_approved:${request.id}`,
      "task",
      "/my-tasks"
    );
  } else if (decision === "REJECTED") {
    // Revert task status
    const revertStatus = task.acceptance_required ? "ACCEPTANCE_PENDING" : "ASSIGNED";
    await supabase.from("tasks").update({ status: revertStatus }).eq("id", task.id);

    await supabase.from("task_status_history").insert({
      task_id: task.id,
      old_status: task.status,
      new_status: revertStatus,
      changed_by: userId,
      reason: `Request rejected: ${reviewer_remarks || "No remarks"}`,
      metadata: { request_id: request.id },
    });

    await createNotification(
      supabase,
      request.employee_id,
      "TASK_REQUEST_REJECTED",
      "Request Rejected",
      `Your ${request.request_type} request for task ${task.task_code} has been rejected`,
      "normal",
      `task_request_rejected:${request.id}`,
      "task",
      "/my-tasks"
    );
  } else {
    // RETURNED_FOR_DETAILS
    await createNotification(
      supabase,
      request.employee_id,
      "TASK_REQUEST_RETURNED",
      "Request Returned for Details",
      `Your ${request.request_type} request for task ${task.task_code} needs more details`,
      "normal",
      `task_request_returned:${request.id}`,
      "task",
      "/my-tasks"
    );
  }

  await writeAudit(supabase, userId, "task.review_request", "task_action_request", request_id, { status: "PENDING" }, { status: decision });

  return successResponse({ message: `Request ${decision.toLowerCase()}`, request_id });
}

// ============================================================
// ADD PROGRESS UPDATE
// ============================================================
async function handleAddProgress(
  supabase: ReturnType<typeof createClient>,
  body: any,
  userId: string,
  perms: string[]
) {
  if (!hasPerm(perms, "task.progress_update_self")) {
    return errorResponse("No permission to add progress updates", 403);
  }

  const { task_id, progress_percent, work_completed, result_so_far, blocker, support_required, hours_spent } = body;
  if (!task_id) return errorResponse("Task ID required", 400);
  if (progress_percent === undefined || progress_percent < 0 || progress_percent > 100) {
    return errorResponse("Progress percent must be between 0 and 100", 400);
  }
  if (!work_completed) return errorResponse("Work completed is required", 400);

  // Verify user is assignee
  const { data: assignment } = await supabase
    .from("task_assignments")
    .select("id")
    .eq("task_id", task_id)
    .eq("assigned_to", userId)
    .eq("is_current", true)
    .maybeSingle();
  if (!assignment) return errorResponse("You are not an assignee of this task", 403);

  const { data: task } = await supabase.from("tasks").select("status").eq("id", task_id).single();
  if (!task) return errorResponse("Task not found", 404);

  // Task must be ACCEPTED or IN_PROGRESS
  if (!["ACCEPTED", "IN_PROGRESS", "REVISION_REQUIRED"].includes(task.status)) {
    return errorResponse(`Cannot add progress in status: ${task.status}`, 400);
  }

  // If task is ACCEPTED, move to IN_PROGRESS
  if (task.status === "ACCEPTED") {
    await supabase.from("tasks").update({ status: "IN_PROGRESS" }).eq("id", task_id);
    await supabase.from("task_status_history").insert({
      task_id,
      old_status: "ACCEPTED",
      new_status: "IN_PROGRESS",
      changed_by: userId,
      reason: "First progress update",
    });
  }

  // Insert progress update
  const { data: progress, error } = await supabase
    .from("task_progress_updates")
    .insert({
      task_id,
      employee_id: userId,
      progress_percent,
      work_completed,
      result_so_far: result_so_far || "",
      blocker: blocker || null,
      support_required: support_required || null,
      hours_spent: hours_spent || null,
    })
    .select()
    .single();

  if (error) return errorResponse(`Failed to add progress: ${error.message}`, 500);

  // Notify if blocker
  if (blocker) {
    const { data: task2 } = await supabase.from("tasks").select("created_by, task_code, title").eq("id", task_id).single();
    if (task2) {
      await createNotification(
        supabase,
        task2.created_by,
        "TASK_BLOCKER",
        "Task Blocker Reported",
        `Task ${task2.task_code}: Blocker reported - ${blocker}`,
        "high",
        `task_blocker:${task_id}:${new Date().toISOString().slice(0, 10)}`,
        "task",
        "/task-review"
      );
    }

    // Supervisory notification: HR + Directors
    const { data: blockerAssignee } = await supabase
      .from("employees")
      .select("id, organization_id")
      .eq("user_id", userId)
      .eq("is_active", true)
      .maybeSingle();
    if (blockerAssignee) {
      await notifyBusinessEvent(supabase, {
        eventCode: "TASK_BLOCKER_REPORTED",
        actorUserId: userId,
        employeeId: blockerAssignee.id,
        organizationId: blockerAssignee.organization_id,
        entityType: "task",
        entityId: task_id,
        title: "Task Blocker Reported",
        message: `A blocker has been reported on task ${task2?.task_code || task_id}.`,
        priority: "high",
        category: "task",
        actionUrl: "/team-tasks",
        recipientRoles: ["hr_admin", "director"],
      });
    }
  }

  await writeAudit(supabase, userId, "task.progress_update", "task_progress_updates", progress.id, null, { task_id, progress_percent });

  return successResponse({ message: "Progress update added", progress });
}

// ============================================================
// SUBMIT TASK
// ============================================================
async function handleSubmit(
  supabase: ReturnType<typeof createClient>,
  body: any,
  userId: string,
  perms: string[]
) {
  if (!hasPerm(perms, "task.submit_self")) {
    return errorResponse("No permission to submit tasks", 403);
  }

  const { task_id, result_summary, submission_note } = body;
  if (!task_id) return errorResponse("Task ID required", 400);
  if (!result_summary || !result_summary.trim()) return errorResponse("Result summary is required", 400);

  // Verify user is assignee
  const { data: assignment } = await supabase
    .from("task_assignments")
    .select("id")
    .eq("task_id", task_id)
    .eq("assigned_to", userId)
    .eq("is_current", true)
    .maybeSingle();
  if (!assignment) return errorResponse("You are not an assignee of this task", 403);

  const { data: task } = await supabase
    .from("tasks")
    .select("status, task_code, title, created_by")
    .eq("id", task_id)
    .single();
  if (!task) return errorResponse("Task not found", 404);

  if (!["IN_PROGRESS", "REVISION_REQUIRED", "ACCEPTED"].includes(task.status)) {
    return errorResponse(`Cannot submit in status: ${task.status}`, 400);
  }

  // Create submission
  const { data: submission, error } = await supabase
    .from("task_submissions")
    .insert({
      task_id,
      submitted_by: userId,
      submission_note: submission_note || "",
      result_summary: result_summary.trim(),
    })
    .select()
    .single();

  if (error) return errorResponse(`Failed to submit: ${error.message}`, 500);

  // Update task status to SUBMITTED
  await supabase.from("tasks").update({ status: "SUBMITTED" }).eq("id", task_id);

  await supabase.from("task_status_history").insert({
    task_id,
    old_status: task.status,
    new_status: "SUBMITTED",
    changed_by: userId,
    reason: "Task submitted for review",
    metadata: { submission_id: submission.id },
  });

  // Notify creator/manager
  await createNotification(
    supabase,
    task.created_by,
    "TASK_SUBMITTED",
    "Task Submitted for Review",
    `Task ${task.task_code}: ${task.title} has been submitted for review`,
    "normal",
    `task_submitted:${task_id}:${submission.id}`,
    "task",
    "/task-review"
  );

  // Supervisory notification: HR + Directors
  const { data: submitAssignee } = await supabase
    .from("employees")
    .select("id, organization_id")
    .eq("user_id", userId)
    .eq("is_active", true)
    .maybeSingle();
  if (submitAssignee) {
    await notifyBusinessEvent(supabase, {
      eventCode: "TASK_SUBMITTED",
      actorUserId: userId,
      employeeId: submitAssignee.id,
      organizationId: submitAssignee.organization_id,
      entityType: "task",
      entityId: task_id,
      title: "Task Submitted for Review",
      message: `Task ${task.task_code} has been submitted for review.`,
      priority: "normal",
      category: "task",
      actionUrl: "/task-review",
      recipientRoles: ["hr_admin", "director"],
    });
  }

  await writeAudit(supabase, userId, "task.submit", "task_submissions", submission.id, null, { task_id });

  return successResponse({ message: "Task submitted", submission });
}

// ============================================================
// REVIEW SUBMISSION (approve/revision/reject)
// ============================================================
async function handleReviewSubmission(
  supabase: ReturnType<typeof createClient>,
  body: any,
  userId: string,
  perms: string[]
) {
  if (!hasPerm(perms, "task.review")) {
    return errorResponse("No permission to review submissions", 403);
  }

  const { submission_id, decision, reviewer_feedback } = body;
  if (!submission_id) return errorResponse("Submission ID required", 400);
  if (!decision || !["APPROVED", "REVISION_REQUIRED", "REJECTED"].includes(decision)) {
    return errorResponse("Valid decision required", 400);
  }

  const { data: submission } = await supabase
    .from("task_submissions")
    .select("*")
    .eq("id", submission_id)
    .single();
  if (!submission) return errorResponse("Submission not found", 404);
  if (submission.review_status !== "PENDING_REVIEW") {
    return errorResponse("Submission already reviewed", 400);
  }

  // Prevent self-review
  if (submission.submitted_by === userId) {
    return errorResponse("Cannot review own submission", 403);
  }

  // Update submission
  await supabase
    .from("task_submissions")
    .update({
      review_status: decision,
      reviewed_by: userId,
      reviewed_at: new Date().toISOString(),
      reviewer_feedback: reviewer_feedback || null,
    })
    .eq("id", submission_id);

  const { data: task } = await supabase
    .from("tasks")
    .select("*")
    .eq("id", submission.task_id)
    .single();
  if (!task) return errorResponse("Task not found", 404);

  let newTaskStatus: string;
  let completionOutcome: string | null = null;

  if (decision === "APPROVED") {
    newTaskStatus = "COMPLETED";
    const completedAt = new Date().toISOString();

    // Calculate completion outcome
    const { data: outcome } = await supabase.rpc("calculate_completion_outcome", {
      p_completed_at: completedAt,
      p_deadline: task.current_deadline,
    });
    completionOutcome = outcome;

    await supabase
      .from("tasks")
      .update({
        status: newTaskStatus,
        completed_at: completedAt,
        completion_outcome: completionOutcome,
      })
      .eq("id", task.id);
  } else if (decision === "REVISION_REQUIRED") {
    newTaskStatus = "REVISION_REQUIRED";
    await supabase.from("tasks").update({ status: newTaskStatus }).eq("id", task.id);
  } else {
    newTaskStatus = "REJECTED";
    await supabase.from("tasks").update({ status: newTaskStatus }).eq("id", task.id);
  }

  // Status history
  await supabase.from("task_status_history").insert({
    task_id: task.id,
    old_status: task.status,
    new_status: newTaskStatus,
    changed_by: userId,
    reason: `Submission ${decision.toLowerCase()}: ${reviewer_feedback || "No feedback"}`,
    metadata: { submission_id, completion_outcome: completionOutcome },
  });

  // Notify submitter
  const reviewLabel = decision === "APPROVED" ? "Approved" : decision === "REVISION_REQUIRED" ? "Revision Required" : "Rejected";
  await createNotification(
    supabase,
    submission.submitted_by,
    "TASK_REVIEWED",
    `Submission ${reviewLabel}`,
    `Task ${task.task_code}: Your submission has been ${reviewLabel.toLowerCase()}`,
    decision === "APPROVED" ? "normal" : "high",
    `task_reviewed:${submission_id}`,
    "task",
    "/my-tasks"
  );

  await writeAudit(
    supabase,
    userId,
    "task.review_submission",
    "task_submissions",
    submission_id,
    { review_status: "PENDING_REVIEW" },
    { review_status: decision, completion_outcome: completionOutcome }
  );

  return successResponse({
    message: `Submission ${decision.toLowerCase()}`,
    completion_outcome: completionOutcome,
  });
}

// ============================================================
// REASSIGN TASK
// ============================================================
async function handleReassign(
  supabase: ReturnType<typeof createClient>,
  body: any,
  userId: string,
  perms: string[]
) {
  if (!hasPerm(perms, "task.reassign")) {
    return errorResponse("No permission to reassign tasks", 403);
  }

  const { task_id, new_assignee_id, reason } = body;
  if (!task_id) return errorResponse("Task ID required", 400);
  if (!new_assignee_id) return errorResponse("New assignee ID required", 400);
  if (!reason || !reason.trim()) return errorResponse("Reason is required for reassignment", 400);

  const { data: task } = await supabase
    .from("tasks")
    .select("id, task_code, title, organization_id, owner_id, status, acceptance_required")
    .eq("id", task_id)
    .single();
  if (!task) return errorResponse("Task not found", 404);

  // Validate new assignee is in same org
  const { data: newAssignee } = await supabase
    .from("user_profiles")
    .select("id, organization_id")
    .eq("id", new_assignee_id)
    .single();
  if (!newAssignee || newAssignee.organization_id !== task.organization_id) {
    return errorResponse("New assignee not in same organization", 403);
  }

  // End current primary assignment
  await supabase
    .from("task_assignments")
    .update({ is_current: false, ended_at: new Date().toISOString() })
    .eq("task_id", task_id)
    .eq("assignment_type", "PRIMARY")
    .eq("is_current", true);

  // Create new primary assignment
  await supabase.from("task_assignments").insert({
    task_id,
    assigned_to: new_assignee_id,
    assigned_by: userId,
    assignment_type: "PRIMARY",
    reason: reason.trim(),
  });

  // Update task owner
  const newStatus = task.acceptance_required ? "ACCEPTANCE_PENDING" : "ASSIGNED";
  await supabase.from("tasks").update({ owner_id: new_assignee_id, status: newStatus }).eq("id", task_id);

  // Status history
  await supabase.from("task_status_history").insert({
    task_id,
    old_status: task.status,
    new_status: newStatus,
    changed_by: userId,
    reason: `Reassigned to ${new_assignee_id}: ${reason.trim()}`,
  });

  // Notify new assignee
  await createNotification(
    supabase,
    new_assignee_id,
    "TASK_REASSIGNED",
    "Task Reassigned to You",
    `Task ${task.task_code}: ${task.title} has been reassigned to you`,
    "normal",
    `task_reassigned:${task_id}:${new_assignee_id}`,
    "task",
    "/my-tasks"
  );

  await writeAudit(supabase, userId, "task.reassign", "task", task_id, { owner_id: task.owner_id }, { owner_id: new_assignee_id });

  return successResponse({ message: "Task reassigned" });
}

// ============================================================
// CHANGE DEADLINE
// ============================================================
async function handleChangeDeadline(
  supabase: ReturnType<typeof createClient>,
  body: any,
  userId: string,
  perms: string[]
) {
  if (!hasPerm(perms, "task.change_deadline")) {
    return errorResponse("No permission to change deadlines", 403);
  }

  const { task_id, new_deadline, reason } = body;
  if (!task_id) return errorResponse("Task ID required", 400);
  if (!new_deadline) return errorResponse("New deadline required", 400);
  if (!reason || !reason.trim()) return errorResponse("Reason is required for deadline change", 400);

  const { data: task } = await supabase
    .from("tasks")
    .select("id, task_code, title, current_deadline, owner_id")
    .eq("id", task_id)
    .single();
  if (!task) return errorResponse("Task not found", 404);

  const oldDeadline = task.current_deadline;

  // Update task
  await supabase.from("tasks").update({ current_deadline: new_deadline }).eq("id", task_id);

  // Create deadline history
  await supabase.from("task_deadline_history").insert({
    task_id,
    old_deadline: oldDeadline,
    new_deadline,
    changed_by: userId,
    change_reason: reason.trim(),
  });

  // Notify assignee
  await createNotification(
    supabase,
    task.owner_id,
    "TASK_DEADLINE_CHANGED",
    "Task Deadline Changed",
    `Task ${task.task_code}: Deadline changed from ${oldDeadline} to ${new_deadline}. Reason: ${reason}`,
    "normal",
    `task_deadline_changed:${task_id}:${new_deadline}`,
    "task",
    "/my-tasks"
  );

  await writeAudit(supabase, userId, "task.change_deadline", "task", task_id, { current_deadline: oldDeadline }, { current_deadline: new_deadline });

  return successResponse({ message: "Deadline updated", old_deadline: oldDeadline, new_deadline });
}

// ============================================================
// CANCEL TASK
// ============================================================
async function handleCancel(
  supabase: ReturnType<typeof createClient>,
  body: any,
  userId: string,
  perms: string[]
) {
  if (!hasPerm(perms, "task.cancel")) {
    return errorResponse("No permission to cancel tasks", 403);
  }

  const { task_id, reason, impact_note } = body;
  if (!task_id) return errorResponse("Task ID required", 400);
  if (!reason || !reason.trim()) return errorResponse("Reason is required for cancellation", 400);

  const { data: task } = await supabase
    .from("tasks")
    .select("id, task_code, title, status, owner_id")
    .eq("id", task_id)
    .single();
  if (!task) return errorResponse("Task not found", 404);

  if (task.status === "COMPLETED" || task.status === "CANCELLED") {
    return errorResponse(`Cannot cancel task in status: ${task.status}`, 400);
  }

  const cancelledAt = new Date().toISOString();

  await supabase
    .from("tasks")
    .update({
      status: "CANCELLED",
      cancelled_at: cancelledAt,
      cancellation_reason: reason.trim(),
    })
    .eq("id", task_id);

  // Status history
  await supabase.from("task_status_history").insert({
    task_id,
    old_status: task.status,
    new_status: "CANCELLED",
    changed_by: userId,
    reason: `Cancelled: ${reason.trim()}. Impact: ${impact_note || "None noted"}`,
  });

  // Notify assignee
  await createNotification(
    supabase,
    task.owner_id,
    "TASK_CANCELLED",
    "Task Cancelled",
    `Task ${task.task_code}: ${task.title} has been cancelled. Reason: ${reason}`,
    "high",
    `task_cancelled:${task_id}`,
    "task",
    "/my-tasks"
  );

  await writeAudit(supabase, userId, "task.cancel", "task", task_id, { status: task.status }, { status: "CANCELLED" });

  return successResponse({ message: "Task cancelled" });
}

// ============================================================
// ADD COMMENT
// ============================================================
async function handleAddComment(
  supabase: ReturnType<typeof createClient>,
  body: any,
  userId: string,
  perms: string[]
) {
  if (!hasPerm(perms, "task.comment")) {
    return errorResponse("No permission to comment on tasks", 403);
  }

  const { task_id, comment_text, is_internal = false } = body;
  if (!task_id) return errorResponse("Task ID required", 400);
  if (!comment_text || !comment_text.trim()) return errorResponse("Comment text is required", 400);

  const { data: comment, error } = await supabase
    .from("task_comments")
    .insert({
      task_id,
      author_id: userId,
      comment_text: comment_text.trim(),
      is_internal,
    })
    .select()
    .single();

  if (error) return errorResponse(`Failed to add comment: ${error.message}`, 500);

  return successResponse({ message: "Comment added", comment });
}

// ============================================================
// ADD DEPENDENCY
// ============================================================
async function handleAddDependency(
  supabase: ReturnType<typeof createClient>,
  body: any,
  userId: string,
  perms: string[]
) {
  if (!hasPerm(perms, "task.create") && !hasPerm(perms, "task.assign")) {
    return errorResponse("No permission to add dependencies", 403);
  }

  const { task_id, depends_on_task_id, dependency_type = "BLOCKS_START" } = body;
  if (!task_id || !depends_on_task_id) return errorResponse("Both task_id and depends_on_task_id required", 400);
  if (task_id === depends_on_task_id) return errorResponse("Cannot depend on self", 400);

  // Check circular dependency
  const { data: isCircular } = await supabase.rpc("check_circular_dependency", {
    p_task_id: task_id,
    p_depends_on_id: depends_on_task_id,
  });
  if (isCircular) {
    return errorResponse("Circular dependency detected", 400);
  }

  const { data: dep, error } = await supabase
    .from("task_dependencies")
    .insert({
      task_id,
      depends_on_task_id,
      dependency_type,
      created_by: userId,
    })
    .select()
    .single();

  if (error) return errorResponse(`Failed to add dependency: ${error.message}`, 500);

  return successResponse({ message: "Dependency added", dependency: dep });
}

// ============================================================
// UPDATE TASK COST
// ============================================================
async function handleUpdateCost(
  supabase: ReturnType<typeof createClient>,
  body: any,
  userId: string,
  orgId: string,
  perms: string[]
) {
  if (!hasPerm(perms, "task.cost_update")) {
    return errorResponse("No permission to update task cost", 403);
  }

  const { task_id, new_cost, reason } = body;
  if (!task_id) return errorResponse("Task ID required", 400);
  if (!reason || !reason.trim()) return errorResponse("Change reason is required", 400);

  let parsedCost: number | null = null;
  if (new_cost !== undefined && new_cost !== null && new_cost !== '') {
    parsedCost = Number(new_cost);
    if (isNaN(parsedCost) || parsedCost < 0) {
      return errorResponse("Task cost must be zero or greater", 400);
    }
    parsedCost = Math.round(parsedCost * 100) / 100;
  }

  const { data: task, error: taskError } = await supabase
    .from("tasks")
    .select("id, task_cost, task_cost_currency, organization_id")
    .eq("id", task_id)
    .single();

  if (taskError || !task) return errorResponse("Task not found", 404);
  if (task.organization_id !== orgId) return errorResponse("Cross-organization access denied", 403);

  const oldCost = task.task_cost;

  // Update task cost
  const { error: updateError } = await supabase
    .from("tasks")
    .update({
      task_cost: parsedCost,
      task_cost_currency: 'INR',
      task_cost_updated_by: userId,
      task_cost_updated_at: new Date().toISOString(),
    })
    .eq("id", task_id);

  if (updateError) return errorResponse(`Failed to update cost: ${updateError.message}`, 500);

  // Insert history record
  await supabase.from("task_cost_history").insert({
    task_id,
    old_cost: oldCost,
    new_cost: parsedCost,
    currency: 'INR',
    reason: reason.trim(),
    changed_by: userId,
  });

  // Audit log
  await writeAudit(supabase, userId, "task.cost_update", "task", task_id, { task_cost: oldCost }, { task_cost: parsedCost });

  return successResponse({ message: "Task cost updated", old_cost: oldCost, new_cost: parsedCost });
}
