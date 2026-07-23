import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, Apikey",
};

const SLA_HOURS: Record<string, number> = {
  CRITICAL: 4,
  HIGH: 24,
  MEDIUM: 72,
  LOW: 168,
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return errorResponse("Missing authorization header", 401);

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
    } = await supabase.auth.getUser();
    if (authError || !user) return errorResponse("Unauthorized", 401);

    const body = await req.json();
    const { action } = body;

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
    if (!orgId) return errorResponse("No organization membership", 403);

    switch (action) {
      case "create":
        return await handleCreate(supabase, body, user.id, orgId, permissions);
      case "assign":
        return await handleAssign(supabase, body, user.id, permissions);
      case "escalate":
        return await handleEscalate(supabase, body, user.id, permissions);
      case "resolve":
        return await handleResolve(supabase, body, user.id, permissions);
      case "close":
        return await handleClose(supabase, body, user.id, permissions);
      case "reopen":
        return await handleReopen(supabase, body, user.id, permissions);
      case "comment":
        return await handleComment(supabase, body, user.id, permissions);
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
  dedupKey?: string
) {
  const notif: Record<string, unknown> = {
    recipient_id: recipientId,
    notification_type: type,
    title,
    message,
    priority,
  };
  if (dedupKey) notif.dedup_key = dedupKey;
  await supabase.from("notifications").insert(notif);
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

function calculateSlaDueAt(priority: string): string {
  const hours = SLA_HOURS[priority] || 72;
  const due = new Date(Date.now() + hours * 60 * 60 * 1000);
  return due.toISOString();
}

// ============================================================
// CREATE TICKET
// ============================================================
async function handleCreate(
  supabase: ReturnType<typeof createClient>,
  body: any,
  userId: string,
  orgId: string,
  perms: string[]
) {
  if (!hasPerm(perms, "ticket.create_self")) {
    return errorResponse("No permission to create tickets", 403);
  }

  const { category, subject, description, priority = "MEDIUM", related_task_id, branch_id } = body;

  if (!category) return errorResponse("Category is required", 400);
  if (!subject || !subject.trim()) return errorResponse("Subject is required", 400);
  if (!description || !description.trim()) return errorResponse("Description is required", 400);

  const validCategories = [
    "TASK_REASSIGNMENT", "UNREALISTIC_DEADLINE", "TARGET_CORRECTION",
    "TECHNICAL_ISSUE", "ACCESS_REQUEST", "RESOURCE_REQUEST",
    "ATTENDANCE_CORRECTION", "LEAVE_ISSUE", "HR_GRIEVANCE", "OTHER",
  ];
  if (!validCategories.includes(category)) {
    return errorResponse(`Invalid category: ${category}`, 400);
  }

  // Generate ticket code
  const { data: ticketCode, error: codeError } = await supabase.rpc("generate_ticket_code", {
    p_org_id: orgId,
  });
  if (codeError || !ticketCode) {
    return errorResponse("Failed to generate ticket code", 500);
  }

  const slaDueAt = calculateSlaDueAt(priority);

  const { data: ticket, error } = await supabase
    .from("tickets")
    .insert({
      organization_id: orgId,
      branch_id: branch_id || null,
      ticket_code: ticketCode,
      raised_by: userId,
      related_task_id: related_task_id || null,
      category,
      subject: subject.trim(),
      description: description.trim(),
      priority,
      status: "OPEN",
      sla_due_at: slaDueAt,
    })
    .select()
    .single();

  if (error) return errorResponse(`Failed to create ticket: ${error.message}`, 500);

  // Ticket history
  await supabase.from("ticket_history").insert({
    ticket_id: ticket.id,
    old_status: null,
    new_status: "OPEN",
    changed_by: userId,
    reason: "Ticket created",
  });

  // Notify directors/HR who can assign tickets
  const { data: assigners } = await supabase
    .from("user_profiles")
    .select("id")
    .eq("organization_id", orgId)
    .eq("status", "active")
    .eq("is_active", true)
    .in("role", ["director", "hr_admin", "manager"]);

  if (assigners) {
    for (const a of assigners) {
      await createNotification(
        supabase,
        a.id,
        "ticket_created",
        "New Ticket Created",
        `Ticket ${ticketCode}: ${subject}`,
        priority === "CRITICAL" || priority === "HIGH" ? "high" : "normal",
        `ticket_created:${ticket.id}:${a.id}`
      );
    }
  }

  await writeAudit(supabase, userId, "ticket.create", "ticket", ticket.id, null, { ticket_code: ticketCode });

  return successResponse({ ticket, ticket_code: ticketCode });
}

// ============================================================
// ASSIGN TICKET
// ============================================================
async function handleAssign(
  supabase: ReturnType<typeof createClient>,
  body: any,
  userId: string,
  perms: string[]
) {
  if (!hasPerm(perms, "ticket.assign")) {
    return errorResponse("No permission to assign tickets", 403);
  }

  const { ticket_id, assigned_to, assigned_department_id, reason } = body;
  if (!ticket_id) return errorResponse("Ticket ID required", 400);

  const { data: ticket } = await supabase
    .from("tickets")
    .select("*")
    .eq("id", ticket_id)
    .single();
  if (!ticket) return errorResponse("Ticket not found", 404);

  const oldStatus = ticket.status;
  const newStatus = "ASSIGNED";

  await supabase
    .from("tickets")
    .update({
      assigned_to: assigned_to || null,
      assigned_department_id: assigned_department_id || null,
      status: newStatus,
    })
    .eq("id", ticket_id);

  await supabase.from("ticket_history").insert({
    ticket_id,
    old_status: oldStatus,
    new_status: newStatus,
    changed_by: userId,
    reason: reason || "Ticket assigned",
    metadata: { assigned_to, assigned_department_id },
  });

  if (assigned_to) {
    await createNotification(
      supabase,
      assigned_to,
      "ticket_assigned",
      "Ticket Assigned to You",
      `Ticket ${ticket.ticket_code}: ${ticket.subject}`,
      "normal",
      `ticket_assigned:${ticket_id}:${assigned_to}`
    );
  }

  // Notify raiser
  await createNotification(
    supabase,
    ticket.raised_by,
    "ticket_assigned_raiser",
    "Ticket Assigned",
    `Your ticket ${ticket.ticket_code} has been assigned for resolution`,
    "normal",
    `ticket_assigned_raiser:${ticket_id}`
  );

  await writeAudit(supabase, userId, "ticket.assign", "ticket", ticket_id, { status: oldStatus }, { status: newStatus });

  return successResponse({ message: "Ticket assigned" });
}

// ============================================================
// ESCALATE TICKET
// ============================================================
async function handleEscalate(
  supabase: ReturnType<typeof createClient>,
  body: any,
  userId: string,
  perms: string[]
) {
  if (!hasPerm(perms, "ticket.escalate")) {
    return errorResponse("No permission to escalate tickets", 403);
  }

  const { ticket_id, escalated_to, reason } = body;
  if (!ticket_id) return errorResponse("Ticket ID required", 400);
  if (!reason || !reason.trim()) return errorResponse("Reason is required for escalation", 400);

  const { data: ticket } = await supabase
    .from("tickets")
    .select("*")
    .eq("id", ticket_id)
    .single();
  if (!ticket) return errorResponse("Ticket not found", 404);

  // Get current max escalation level
  const { data: escalations } = await supabase
    .from("ticket_escalations")
    .select("escalation_level")
    .eq("ticket_id", ticket_id)
    .order("escalation_level", { ascending: false })
    .limit(1);

  const nextLevel = (escalations?.[0]?.escalation_level || 0) + 1;

  // Create escalation record
  await supabase.from("ticket_escalations").insert({
    ticket_id,
    escalation_level: nextLevel,
    escalated_from: ticket.assigned_to || userId,
    escalated_to: escalated_to || null,
    reason: reason.trim(),
  });

  // Update ticket status
  const oldStatus = ticket.status;
  await supabase.from("tickets").update({ status: "ESCALATED" }).eq("id", ticket_id);

  await supabase.from("ticket_history").insert({
    ticket_id,
    old_status: oldStatus,
    new_status: "ESCALATED",
    changed_by: userId,
    reason: `Escalated to level ${nextLevel}: ${reason.trim()}`,
    metadata: { escalation_level: nextLevel, escalated_to },
  });

  // Notify escalated_to
  if (escalated_to) {
    await createNotification(
      supabase,
      escalated_to,
      "ticket_escalated",
      "Ticket Escalated to You",
      `Ticket ${ticket.ticket_code}: ${ticket.subject} has been escalated. Reason: ${reason}`,
      "high",
      `ticket_escalated:${ticket_id}:${nextLevel}`
    );
  }

  // Notify raiser
  await createNotification(
    supabase,
    ticket.raised_by,
    "ticket_escalated_raiser",
    "Ticket Escalated",
    `Your ticket ${ticket.ticket_code} has been escalated to level ${nextLevel}`,
    "high",
    `ticket_escalated_raiser:${ticket_id}:${nextLevel}`
  );

  await writeAudit(supabase, userId, "ticket.escalate", "ticket", ticket_id, { status: oldStatus }, { status: "ESCALATED" });

  return successResponse({ message: "Ticket escalated", escalation_level: nextLevel });
}

// ============================================================
// RESOLVE TICKET
// ============================================================
async function handleResolve(
  supabase: ReturnType<typeof createClient>,
  body: any,
  userId: string,
  perms: string[]
) {
  if (!hasPerm(perms, "ticket.resolve")) {
    return errorResponse("No permission to resolve tickets", 403);
  }

  const { ticket_id, resolution_summary } = body;
  if (!ticket_id) return errorResponse("Ticket ID required", 400);
  if (!resolution_summary || !resolution_summary.trim()) {
    return errorResponse("Resolution summary is required", 400);
  }

  const { data: ticket } = await supabase
    .from("tickets")
    .select("*")
    .eq("id", ticket_id)
    .single();
  if (!ticket) return errorResponse("Ticket not found", 404);

  const oldStatus = ticket.status;
  const resolvedAt = new Date().toISOString();

  await supabase
    .from("tickets")
    .update({
      status: "RESOLVED",
      resolved_at: resolvedAt,
      resolution_summary: resolution_summary.trim(),
    })
    .eq("id", ticket_id);

  await supabase.from("ticket_history").insert({
    ticket_id,
    old_status: oldStatus,
    new_status: "RESOLVED",
    changed_by: userId,
    reason: `Resolved: ${resolution_summary.trim()}`,
  });

  // Notify raiser
  await createNotification(
    supabase,
    ticket.raised_by,
    "ticket_resolved",
    "Ticket Resolved",
    `Ticket ${ticket.ticket_code}: ${ticket.subject} has been resolved`,
    "normal",
    `ticket_resolved:${ticket_id}`
  );

  await writeAudit(supabase, userId, "ticket.resolve", "ticket", ticket_id, { status: oldStatus }, { status: "RESOLVED" });

  return successResponse({ message: "Ticket resolved" });
}

// ============================================================
// CLOSE TICKET
// ============================================================
async function handleClose(
  supabase: ReturnType<typeof createClient>,
  body: any,
  userId: string,
  perms: string[]
) {
  if (!hasPerm(perms, "ticket.close")) {
    return errorResponse("No permission to close tickets", 403);
  }

  const { ticket_id, reason } = body;
  if (!ticket_id) return errorResponse("Ticket ID required", 400);

  const { data: ticket } = await supabase
    .from("tickets")
    .select("*")
    .eq("id", ticket_id)
    .single();
  if (!ticket) return errorResponse("Ticket not found", 404);

  if (ticket.status !== "RESOLVED") {
    return errorResponse("Only resolved tickets can be closed", 400);
  }

  const oldStatus = ticket.status;
  await supabase.from("tickets").update({ status: "CLOSED" }).eq("id", ticket_id);

  await supabase.from("ticket_history").insert({
    ticket_id,
    old_status: oldStatus,
    new_status: "CLOSED",
    changed_by: userId,
    reason: reason || "Ticket closed",
  });

  await createNotification(
    supabase,
    ticket.raised_by,
    "ticket_closed",
    "Ticket Closed",
    `Ticket ${ticket.ticket_code}: ${ticket.subject} has been closed`,
    "normal",
    `ticket_closed:${ticket_id}`
  );

  await writeAudit(supabase, userId, "ticket.close", "ticket", ticket_id, { status: oldStatus }, { status: "CLOSED" });

  return successResponse({ message: "Ticket closed" });
}

// ============================================================
// REOPEN TICKET
// ============================================================
async function handleReopen(
  supabase: ReturnType<typeof createClient>,
  body: any,
  userId: string,
  perms: string[]
) {
  if (!hasPerm(perms, "ticket.reopen")) {
    return errorResponse("No permission to reopen tickets", 403);
  }

  const { ticket_id, reason } = body;
  if (!ticket_id) return errorResponse("Ticket ID required", 400);
  if (!reason || !reason.trim()) return errorResponse("Reason is required to reopen", 400);

  const { data: ticket } = await supabase
    .from("tickets")
    .select("*")
    .eq("id", ticket_id)
    .single();
  if (!ticket) return errorResponse("Ticket not found", 404);

  if (!["RESOLVED", "CLOSED"].includes(ticket.status)) {
    return errorResponse("Only resolved or closed tickets can be reopened", 400);
  }

  const oldStatus = ticket.status;
  await supabase.from("tickets").update({ status: "REOPENED", resolved_at: null }).eq("id", ticket_id);

  await supabase.from("ticket_history").insert({
    ticket_id,
    old_status: oldStatus,
    new_status: "REOPENED",
    changed_by: userId,
    reason: `Reopened: ${reason.trim()}`,
  });

  // Notify assigners
  const { data: assigners } = await supabase
    .from("user_profiles")
    .select("id")
    .eq("organization_id", ticket.organization_id)
    .eq("status", "active")
    .in("role", ["director", "hr_admin", "manager"]);

  if (assigners) {
    for (const a of assigners) {
      await createNotification(
        supabase,
        a.id,
        "ticket_reopened",
        "Ticket Reopened",
        `Ticket ${ticket.ticket_code}: ${ticket.subject} has been reopened. Reason: ${reason}`,
        "normal",
        `ticket_reopened:${ticket_id}:${a.id}`
      );
    }
  }

  await writeAudit(supabase, userId, "ticket.reopen", "ticket", ticket_id, { status: oldStatus }, { status: "REOPENED" });

  return successResponse({ message: "Ticket reopened" });
}

// ============================================================
// ADD COMMENT
// ============================================================
async function handleComment(
  supabase: ReturnType<typeof createClient>,
  body: any,
  userId: string,
  perms: string[]
) {
  if (!hasPerm(perms, "ticket.comment")) {
    return errorResponse("No permission to comment on tickets", 403);
  }

  const { ticket_id, comment_text, is_internal = false } = body;
  if (!ticket_id) return errorResponse("Ticket ID required", 400);
  if (!comment_text || !comment_text.trim()) return errorResponse("Comment text is required", 400);

  const { data: comment, error } = await supabase
    .from("ticket_comments")
    .insert({
      ticket_id,
      author_id: userId,
      comment_text: comment_text.trim(),
      is_internal,
    })
    .select()
    .single();

  if (error) return errorResponse(`Failed to add comment: ${error.message}`, 500);

  return successResponse({ message: "Comment added", comment });
}
