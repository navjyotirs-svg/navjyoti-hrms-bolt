import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return errorResponse("Missing authorization header", 401);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return errorResponse("Unauthorized", 401);

    const body = await req.json();
    const { action } = body;

    const { data: profile } = await supabase
      .from("user_profiles")
      .select("id, role, organization_id, status, is_active")
      .eq("id", user.id)
      .single();
    if (!profile || profile.status !== "active" || !profile.is_active)
      return errorResponse("Account not active", 403);

    const { data: perms } = await supabase.rpc("get_my_effective_permissions");
    const permissions: string[] = perms || [];
    const orgId = profile.organization_id;
    if (!orgId) return errorResponse("No organization membership", 403);

    const { data: employee } = await supabase
      .from("employees")
      .select("id, branch_id, department_id")
      .eq("user_id", user.id)
      .eq("is_active", true)
      .single();

    switch (action) {
      case "save_draft":
        return await handleSaveDraft(supabase, body, user.id, orgId, employee, permissions);
      case "submit":
        return await handleSubmit(supabase, body, user.id, orgId, employee, permissions);
      case "review":
        return await handleReview(supabase, body, user.id, permissions);
      case "reopen":
        return await handleReopen(supabase, body, user.id, permissions);
      case "add_comment":
        return await handleAddComment(supabase, body, user.id, permissions);
      case "add_task_item":
        return await handleAddTaskItem(supabase, body, user.id, permissions);
      case "delete_task_item":
        return await handleDeleteTaskItem(supabase, body, user.id, permissions);
      case "create_follow_up":
        return await handleCreateFollowUp(supabase, body, user.id, orgId, permissions);
      case "assign_follow_up":
        return await handleAssignFollowUp(supabase, body, user.id, permissions);
      case "resolve_follow_up":
        return await handleResolveFollowUp(supabase, body, user.id, permissions);
      case "close_follow_up":
        return await handleCloseFollowUp(supabase, body, user.id, permissions);
      default:
        return errorResponse(`Unknown action: ${action}`, 400);
    }
  } catch (err) {
    return errorResponse((err as Error).message, 500);
  }
});

function errorResponse(message: string, status: number) {
  return new Response(JSON.stringify({ error: message }), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
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

async function getKolkataDate(): Promise<string> {
  const now = new Date();
  const kolkataTime = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
  return kolkataTime.toISOString().slice(0, 10);
}

async function createNotification(
  supabase: ReturnType<typeof createClient>,
  recipientId: string,
  type: string,
  title: string,
  message: string,
  priority: string = "normal",
  dedupKey?: string
) {
  const notif: Record<string, unknown> = {
    recipient_id: recipientId, notification_type: type, title, message, priority,
  };
  if (dedupKey) notif.dedup_key = dedupKey;
  await supabase.from("notifications").insert(notif);
}

async function writeAudit(
  supabase: ReturnType<typeof createClient>,
  actorId: string, action: string, entityType: string, entityId: string,
  oldValues: unknown = null, newValues: unknown = null
) {
  await supabase.from("audit_logs").insert({
    actor_id: actorId, action, entity_type: entityType, entity_id: entityId,
    old_values: oldValues, new_values: newValues,
  });
}

async function insertHistory(
  supabase: ReturnType<typeof createClient>,
  reportId: string, action: string, oldStatus: string | null,
  newStatus: string | null, actorId: string, reason?: string
) {
  await supabase.from("daily_report_history").insert({
    daily_report_id: reportId, action, old_status: oldStatus,
    new_status: newStatus, actor_id: actorId, reason: reason || null,
  });
}

// ============================================================
// SAVE DRAFT
// ============================================================
async function handleSaveDraft(
  supabase: ReturnType<typeof createClient>,
  body: any, userId: string, orgId: string,
  employee: any, perms: string[]
) {
  if (!hasPerm(perms, "daily_report.submit"))
    return errorResponse("No permission to submit reports", 403);

  const reportDate = body.report_date || await getKolkataDate();
  const {
    overall_summary, work_planned, work_completed, overall_result,
    pending_work, blockers, support_required, follow_up_required,
    tomorrow_plan, task_items = [],
  } = body;

  const { data: existing } = await supabase
    .from("daily_reports")
    .select("id, status")
    .eq("employee_id", employee.id)
    .eq("report_date", reportDate)
    .maybeSingle();

  if (existing && !["draft", "returned"].includes(existing.status))
    return errorResponse("Report already submitted", 400);

  let reportId: string;

  if (existing) {
    await supabase.from("daily_reports").update({
      overall_summary: overall_summary || "", work_planned: work_planned || "",
      work_completed: work_completed || "", overall_result: overall_result || "",
      pending_work: pending_work || "", blockers: blockers || "",
      support_required: support_required || "", follow_up_required: follow_up_required || false,
      tomorrow_plan: tomorrow_plan || "", version: (existing as any).version + 1,
    }).eq("id", existing.id);
    reportId = existing.id;
  } else {
    const { data: newReport, error } = await supabase
      .from("daily_reports").insert({
        organization_id: orgId, branch_id: employee.branch_id,
        department_id: employee.department_id, employee_id: employee.id,
        report_date: reportDate, overall_summary: overall_summary || "",
        work_planned: work_planned || "", work_completed: work_completed || "",
        overall_result: overall_result || "", pending_work: pending_work || "",
        blockers: blockers || "", support_required: support_required || "",
        follow_up_required: follow_up_required || false, tomorrow_plan: tomorrow_plan || "",
        status: "draft",
      }).select().single();
    if (error) return errorResponse(`Failed to create draft: ${error.message}`, 500);
    reportId = newReport.id;
    await insertHistory(supabase, reportId, "created", null, "draft", userId);
  }

  if (task_items.length > 0) {
    await supabase.from("daily_report_task_items").delete().eq("daily_report_id", reportId);
    for (const item of task_items) {
      await supabase.from("daily_report_task_items").insert({
        daily_report_id: reportId, task_id: item.task_id || null,
        progress_before: item.progress_before || 0, progress_after: item.progress_after || 0,
        work_done: item.work_done || "", result_achieved: item.result_achieved || "",
        pending_item: item.pending_item || null, blocker: item.blocker || null,
        support_required: item.support_required || null, follow_up: item.follow_up || false,
        hours_spent: item.hours_spent || 0, evidence_required: item.evidence_required || false,
      });
    }
  }

  return successResponse({ message: "Draft saved", report_id: reportId });
}

// ============================================================
// SUBMIT
// ============================================================
async function handleSubmit(
  supabase: ReturnType<typeof createClient>,
  body: any, userId: string, orgId: string,
  employee: any, perms: string[]
) {
  if (!hasPerm(perms, "daily_report.submit"))
    return errorResponse("No permission to submit reports", 403);

  const reportDate = body.report_date || await getKolkataDate();
  const {
    overall_summary, work_planned, work_completed, overall_result,
    pending_work, blockers, support_required, follow_up_required,
    tomorrow_plan, task_items = [],
  } = body;

  if (!overall_summary || !overall_summary.trim())
    return errorResponse("Overall summary is required", 400);

  const { data: existing } = await supabase
    .from("daily_reports").select("id, status, version")
    .eq("employee_id", employee.id).eq("report_date", reportDate).maybeSingle();

  const newStatus = "submitted";
  let reportId: string;

  if (existing) {
    if (!["draft", "returned"].includes(existing.status))
      return errorResponse("Report already submitted", 400);
    await supabase.from("daily_reports").update({
      overall_summary, work_planned: work_planned || "", work_completed: work_completed || "",
      overall_result: overall_result || "", pending_work: pending_work || "",
      blockers: blockers || "", support_required: support_required || "",
      follow_up_required: follow_up_required || false, tomorrow_plan: tomorrow_plan || "",
      status: newStatus, submitted_at: new Date().toISOString(),
      version: existing.version + 1,
    }).eq("id", existing.id);
    reportId = existing.id;
    await insertHistory(supabase, reportId, "submitted", existing.status, newStatus, userId);
  } else {
    const { data: newReport, error } = await supabase
      .from("daily_reports").insert({
        organization_id: orgId, branch_id: employee.branch_id,
        department_id: employee.department_id, employee_id: employee.id,
        report_date: reportDate, overall_summary, work_planned: work_planned || "",
        work_completed: work_completed || "", overall_result: overall_result || "",
        pending_work: pending_work || "", blockers: blockers || "",
        support_required: support_required || "", follow_up_required: follow_up_required || false,
        tomorrow_plan: tomorrow_plan || "", status: newStatus,
        submitted_at: new Date().toISOString(),
      }).select().single();
    if (error) return errorResponse(`Failed to submit: ${error.message}`, 500);
    reportId = newReport.id;
    await insertHistory(supabase, reportId, "created", null, newStatus, userId);
    await insertHistory(supabase, reportId, "submitted", null, newStatus, userId);
  }

  if (task_items.length > 0) {
    await supabase.from("daily_report_task_items").delete().eq("daily_report_id", reportId);
    for (const item of task_items) {
      await supabase.from("daily_report_task_items").insert({
        daily_report_id: reportId, task_id: item.task_id || null,
        progress_before: item.progress_before || 0, progress_after: item.progress_after || 0,
        work_done: item.work_done || "", result_achieved: item.result_achieved || "",
        pending_item: item.pending_item || null, blocker: item.blocker || null,
        support_required: item.support_required || null, follow_up: item.follow_up || false,
        hours_spent: item.hours_spent || 0, evidence_required: item.evidence_required || false,
      });
    }
  }

  await writeAudit(supabase, userId, "daily_report.submit", "daily_report", reportId, null, { report_date: reportDate });

  return successResponse({ message: "Report submitted", report_id: reportId });
}

// ============================================================
// REVIEW (approve / return)
// ============================================================
async function handleReview(
  supabase: ReturnType<typeof createClient>,
  body: any, userId: string, perms: string[]
) {
  if (!hasPerm(perms, "daily_report.review"))
    return errorResponse("No permission to review reports", 403);

  const { report_id, decision, manager_comments } = body;
  if (!report_id) return errorResponse("Report ID required", 400);
  if (!decision || !["approved", "returned"].includes(decision))
    return errorResponse("Valid decision required (approved/returned)", 400);

  const { data: report } = await supabase
    .from("daily_reports").select("id, status, employee_id, report_date")
    .eq("id", report_id).single();
  if (!report) return errorResponse("Report not found", 404);
  if (report.status !== "submitted")
    return errorResponse(`Cannot review report in status: ${report.status}`, 400);

  const newStatus = decision === "approved" ? "approved" : "returned";
  await supabase.from("daily_reports").update({
    status: newStatus, reviewed_at: new Date().toISOString(), reviewed_by: userId,
    manager_comments: manager_comments || null,
  }).eq("id", report_id);

  await insertHistory(supabase, report_id, decision, report.status, newStatus, userId, manager_comments);

  const { data: emp } = await supabase
    .from("employees").select("user_id").eq("id", report.employee_id).single();

  if (emp) {
    const title = decision === "approved" ? "Daily Report Approved" : "Daily Report Returned";
    const msg = decision === "approved"
      ? `Your daily report for ${report.report_date} has been approved.`
      : `Your daily report for ${report.report_date} has been returned for correction. Reason: ${manager_comments || "No comments"}`;
    await createNotification(supabase, emp.user_id, "daily_report_reviewed", title, msg,
      decision === "approved" ? "normal" : "high",
      `daily_report_${decision}:${report_id}`);
  }

  await writeAudit(supabase, userId, `daily_report.${decision}`, "daily_report", report_id,
    { status: report.status }, { status: newStatus });

  return successResponse({ message: `Report ${decision}`, status: newStatus });
}

// ============================================================
// REOPEN
// ============================================================
async function handleReopen(
  supabase: ReturnType<typeof createClient>,
  body: any, userId: string, perms: string[]
) {
  if (!hasPerm(perms, "daily_report.reopen"))
    return errorResponse("No permission to reopen reports", 403);

  const { report_id, reason } = body;
  if (!report_id) return errorResponse("Report ID required", 400);
  if (!reason || !reason.trim()) return errorResponse("Reason is required", 400);

  const { data: report } = await supabase
    .from("daily_reports").select("id, status, employee_id, report_date")
    .eq("id", report_id).single();
  if (!report) return errorResponse("Report not found", 404);
  if (!["approved", "submitted"].includes(report.status))
    return errorResponse(`Cannot reopen report in status: ${report.status}`, 400);

  await supabase.from("daily_reports").update({
    status: "returned", reopened_at: new Date().toISOString(), reopened_by: userId,
    manager_comments: reason,
  }).eq("id", report_id);

  await insertHistory(supabase, report_id, "reopened", report.status, "returned", userId, reason);

  const { data: emp } = await supabase
    .from("employees").select("user_id").eq("id", report.employee_id).single();
  if (emp) {
    await createNotification(supabase, emp.user_id, "daily_report_reopened",
      "Daily Report Reopened",
      `Your daily report for ${report.report_date} has been reopened. Reason: ${reason}`,
      "high", `daily_report_reopened:${report_id}`);
  }

  await writeAudit(supabase, userId, "daily_report.reopen", "daily_report", report_id,
    { status: report.status }, { status: "returned" });

  return successResponse({ message: "Report reopened" });
}

// ============================================================
// ADD COMMENT
// ============================================================
async function handleAddComment(
  supabase: ReturnType<typeof createClient>,
  body: any, userId: string, perms: string[]
) {
  const { report_id, comment_text, comment_type = "general" } = body;
  if (!report_id) return errorResponse("Report ID required", 400);
  if (!comment_text || !comment_text.trim()) return errorResponse("Comment text required", 400);

  const validTypes = ["general", "feedback", "clarification", "escalation", "system"];
  if (!validTypes.includes(comment_type))
    return errorResponse("Invalid comment type", 400);

  const { data: comment, error } = await supabase
    .from("daily_report_comments").insert({
      daily_report_id: report_id, author_id: userId,
      comment_text: comment_text.trim(), comment_type,
    }).select().single();
  if (error) return errorResponse(`Failed to add comment: ${error.message}`, 500);

  return successResponse({ message: "Comment added", comment });
}

// ============================================================
// ADD TASK ITEM
// ============================================================
async function handleAddTaskItem(
  supabase: ReturnType<typeof createClient>,
  body: any, userId: string, perms: string[]
) {
  const { report_id, task_id, progress_before, progress_after, work_done,
    result_achieved, pending_item, blocker, support_required, follow_up, hours_spent,
    evidence_required } = body;
  if (!report_id) return errorResponse("Report ID required", 400);

  const { data: item, error } = await supabase
    .from("daily_report_task_items").insert({
      daily_report_id: report_id, task_id: task_id || null,
      progress_before: progress_before || 0, progress_after: progress_after || 0,
      work_done: work_done || "", result_achieved: result_achieved || "",
      pending_item: pending_item || null, blocker: blocker || null,
      support_required: support_required || null, follow_up: follow_up || false,
      hours_spent: hours_spent || 0, evidence_required: evidence_required || false,
    }).select().single();
  if (error) return errorResponse(`Failed to add task item: ${error.message}`, 500);

  return successResponse({ message: "Task item added", item });
}

// ============================================================
// DELETE TASK ITEM
// ============================================================
async function handleDeleteTaskItem(
  supabase: ReturnType<typeof createClient>,
  body: any, userId: string, perms: string[]
) {
  const { item_id } = body;
  if (!item_id) return errorResponse("Item ID required", 400);

  const { error } = await supabase.from("daily_report_task_items").delete().eq("id", item_id);
  if (error) return errorResponse(`Failed to delete: ${error.message}`, 500);

  return successResponse({ message: "Task item deleted" });
}

// ============================================================
// CREATE FOLLOW-UP
// ============================================================
async function handleCreateFollowUp(
  supabase: ReturnType<typeof createClient>,
  body: any, userId: string, orgId: string, perms: string[]
) {
  if (!hasPerm(perms, "follow_up.create"))
    return errorResponse("No permission to create follow-ups", 403);

  const { daily_report_id, task_id, employee_id, follow_up_type, subject,
    description, priority = "medium", due_at, assigned_to } = body;
  if (!employee_id) return errorResponse("Employee ID required", 400);
  if (!follow_up_type) return errorResponse("Follow-up type required", 400);
  if (!subject || !subject.trim()) return errorResponse("Subject required", 400);

  const validTypes = ["manager_action", "hr_support", "director_attention",
    "resource_request", "blocker_resolution", "client_follow_up", "task_escalation", "other"];
  if (!validTypes.includes(follow_up_type))
    return errorResponse("Invalid follow-up type", 400);

  const { data: followUp, error } = await supabase
    .from("management_follow_ups").insert({
      organization_id: orgId, daily_report_id: daily_report_id || null,
      task_id: task_id || null, employee_id, created_by: userId,
      assigned_to: assigned_to || null, follow_up_type, subject: subject.trim(),
      description: description || "", priority, due_at: due_at || null,
      status: assigned_to ? "assigned" : "open",
    }).select().single();
  if (error) return errorResponse(`Failed to create follow-up: ${error.message}`, 500);

  if (assigned_to) {
    await createNotification(supabase, assigned_to, "follow_up_assigned",
      "Follow-up Assigned", `A follow-up has been assigned to you: ${subject}`,
      priority, `follow_up_assigned:${followUp.id}`);
  }

  await writeAudit(supabase, userId, "follow_up.create", "management_follow_up", followUp.id, null, { subject });

  return successResponse({ message: "Follow-up created", follow_up: followUp });
}

// ============================================================
// ASSIGN FOLLOW-UP
// ============================================================
async function handleAssignFollowUp(
  supabase: ReturnType<typeof createClient>,
  body: any, userId: string, perms: string[]
) {
  if (!hasPerm(perms, "follow_up.assign"))
    return errorResponse("No permission to assign follow-ups", 403);

  const { follow_up_id, assigned_to } = body;
  if (!follow_up_id) return errorResponse("Follow-up ID required", 400);
  if (!assigned_to) return errorResponse("Assigned user ID required", 400);

  await supabase.from("management_follow_ups").update({
    assigned_to, status: "assigned",
  }).eq("id", follow_up_id);

  await createNotification(supabase, assigned_to, "follow_up_assigned",
    "Follow-up Assigned", `A follow-up has been assigned to you.`,
    "normal", `follow_up_assigned:${follow_up_id}`);

  return successResponse({ message: "Follow-up assigned" });
}

// ============================================================
// RESOLVE FOLLOW-UP
// ============================================================
async function handleResolveFollowUp(
  supabase: ReturnType<typeof createClient>,
  body: any, userId: string, perms: string[]
) {
  if (!hasPerm(perms, "follow_up.resolve"))
    return errorResponse("No permission to resolve follow-ups", 403);

  const { follow_up_id, resolution } = body;
  if (!follow_up_id) return errorResponse("Follow-up ID required", 400);
  if (!resolution || !resolution.trim()) return errorResponse("Resolution required", 400);

  await supabase.from("management_follow_ups").update({
    status: "resolved", resolution: resolution.trim(), resolved_at: new Date().toISOString(),
  }).eq("id", follow_up_id);

  return successResponse({ message: "Follow-up resolved" });
}

// ============================================================
// CLOSE FOLLOW-UP
// ============================================================
async function handleCloseFollowUp(
  supabase: ReturnType<typeof createClient>,
  body: any, userId: string, perms: string[]
) {
  if (!hasPerm(perms, "follow_up.close"))
    return errorResponse("No permission to close follow-ups", 403);

  const { follow_up_id, resolution } = body;
  if (!follow_up_id) return errorResponse("Follow-up ID required", 400);

  await supabase.from("management_follow_ups").update({
    status: "closed", resolution: resolution || null,
  }).eq("id", follow_up_id);

  return successResponse({ message: "Follow-up closed" });
}
