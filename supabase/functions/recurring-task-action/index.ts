import { createClient } from "npm:@supabase/supabase-js@2.45.0";

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
      global: { headers: { Authorization: authHeader } },
    });

    const { data: callerData, error: callerError } = await callerClient.auth.getUser();
    if (callerError || !callerData.user) return jsonError(401, "Invalid session");

    const callerId = callerData.user.id;

    const { data: profile } = await admin
      .from("user_profiles")
      .select("id, role, organization_id, status, is_active")
      .eq("id", callerId)
      .maybeSingle();

    if (!profile || profile.status !== "active" || !profile.is_active) {
      return jsonError(403, "Account not active");
    }

    const { data: perms } = await admin.rpc("get_effective_permissions", { p_user_id: callerId });
    const permissions: string[] = perms || [];
    const orgId = profile.organization_id;
    if (!orgId) return jsonError(403, "No organization membership");

    const body = await req.json();
    const { action } = body;

    switch (action) {
      case "create":
        return await handleCreate(admin, body, callerId, orgId, permissions, profile.role);
      case "update":
        return await handleUpdate(admin, body, callerId, orgId, permissions, profile.role);
      case "pause":
        return await handlePause(admin, body, callerId, orgId, permissions, true);
      case "resume":
        return await handlePause(admin, body, callerId, orgId, permissions, false);
      case "deactivate":
        return await handleDeactivate(admin, body, callerId, orgId, permissions);
      default:
        return jsonError(400, `Unknown action: ${action}`);
    }
  } catch (err) {
    return jsonError(500, (err as Error).message);
  }
});

async function generateTemplateCode(admin: ReturnType<typeof createClient>, orgId: string): Promise<string> {
  const year = new Date().getFullYear();
  const { data } = await admin.rpc("generate_recurring_template_code", { p_org_id: orgId });
  return data || `RCT-${year}-000001`;
}

async function handleCreate(
  admin: ReturnType<typeof createClient>,
  body: any,
  callerId: string,
  orgId: string,
  perms: string[],
  role: string
) {
  if (!perms.includes("recurring_task.create")) {
    return jsonError(403, "No permission to create recurring tasks");
  }

  const {
    project_id, title, description, expected_result, priority,
    target_quantity, target_unit, estimated_hours, task_cost,
    assigned_employee_id, start_date, end_date,
  } = body;

  if (!project_id || !title || !assigned_employee_id || !start_date) {
    return jsonError(400, "project_id, title, assigned_employee_id, and start_date are required");
  }

  // Validate project belongs to org
  const { data: project } = await admin
    .from("projects")
    .select("id")
    .eq("id", project_id)
    .eq("organization_id", orgId)
    .maybeSingle();
  if (!project) return jsonError(403, "Project does not belong to your organization");

  // Validate assigned employee belongs to org
  const { data: employee } = await admin
    .from("employees")
    .select("id, organization_id, is_active")
    .eq("id", assigned_employee_id)
    .maybeSingle();
  if (!employee || employee.organization_id !== orgId) {
    return jsonError(403, "Assigned employee does not belong to your organization");
  }
  if (!employee.is_active) {
    return jsonError(400, "Assigned employee is not active");
  }

  // Manager scope check
  if (role === "manager") {
    const { data: inSubtree } = await admin.rpc("is_in_reporting_subtree", {
      p_manager_id: (await getEmployeeId(admin, callerId)),
      p_employee_id: assigned_employee_id,
    });
    if (!inSubtree) {
      return jsonError(403, "You can only create recurring tasks for employees in your reporting scope");
    }
  }

  const template_code = await generateTemplateCode(admin, orgId);

  const { data: template, error } = await admin
    .from("recurring_task_templates")
    .insert({
      organization_id: orgId,
      project_id,
      template_code,
      title,
      description: description || null,
      expected_result: expected_result || null,
      priority: priority || "MEDIUM",
      target_quantity: target_quantity || null,
      target_unit: target_unit || null,
      estimated_hours: estimated_hours || null,
      task_cost: task_cost || null,
      assigned_employee_id,
      created_by: callerId,
      recurrence_type: "DAILY",
      start_date,
      end_date: end_date || null,
      assignment_trigger: "EMPLOYEE_CHECK_IN",
      is_active: true,
      is_paused: false,
    })
    .select("id, template_code")
    .maybeSingle();

  if (error || !template) {
    return jsonError(500, `Failed to create recurring task template: ${error?.message ?? "Unknown"}`);
  }

  await admin.from("audit_logs").insert({
    actor_id: callerId,
    action: "recurring_task.create",
    entity_type: "recurring_task_template",
    entity_id: template.id,
    new_values: { title, template_code, assigned_employee_id, project_id },
  });

  return jsonResponse(200, { template_id: template.id, template_code, message: "Recurring task template created" });
}

async function handleUpdate(
  admin: ReturnType<typeof createClient>,
  body: any,
  callerId: string,
  orgId: string,
  perms: string[],
  role: string
) {
  if (!perms.includes("recurring_task.update")) {
    return jsonError(403, "No permission to update recurring tasks");
  }

  const { template_id, title, description, expected_result, priority, end_date, estimated_hours } = body;
  if (!template_id) return jsonError(400, "template_id is required");

  const { data: existing } = await admin
    .from("recurring_task_templates")
    .select("*")
    .eq("id", template_id)
    .eq("organization_id", orgId)
    .maybeSingle();

  if (!existing) return jsonError(404, "Recurring task template not found");

  const updates: Record<string, unknown> = {};
  if (title !== undefined) updates.title = title;
  if (description !== undefined) updates.description = description;
  if (expected_result !== undefined) updates.expected_result = expected_result;
  if (priority !== undefined) updates.priority = priority;
  if (end_date !== undefined) updates.end_date = end_date;
  if (estimated_hours !== undefined) updates.estimated_hours = estimated_hours;

  const { error } = await admin.from("recurring_task_templates").update(updates).eq("id", template_id);
  if (error) return jsonError(500, `Failed to update: ${error.message}`);

  await admin.from("audit_logs").insert({
    actor_id: callerId,
    action: "recurring_task.modified",
    entity_type: "recurring_task_template",
    entity_id: template_id,
    old_values: existing,
    new_values: updates,
  });

  return jsonResponse(200, { message: "Recurring task template updated" });
}

async function handlePause(
  admin: ReturnType<typeof createClient>,
  body: any,
  callerId: string,
  orgId: string,
  perms: string[],
  pause: boolean
) {
  if (!perms.includes("recurring_task.pause")) {
    return jsonError(403, "No permission to pause/resume recurring tasks");
  }

  const { template_id } = body;
  if (!template_id) return jsonError(400, "template_id is required");

  const { data: existing } = await admin
    .from("recurring_task_templates")
    .select("*")
    .eq("id", template_id)
    .eq("organization_id", orgId)
    .maybeSingle();

  if (!existing) return jsonError(404, "Recurring task template not found");

  const { error } = await admin.from("recurring_task_templates")
    .update({ is_paused: pause })
    .eq("id", template_id);
  if (error) return jsonError(500, `Failed: ${error.message}`);

  await admin.from("audit_logs").insert({
    actor_id: callerId,
    action: pause ? "recurring_task.paused" : "recurring_task.resumed",
    entity_type: "recurring_task_template",
    entity_id: template_id,
  });

  return jsonResponse(200, { message: pause ? "Template paused" : "Template resumed" });
}

async function handleDeactivate(
  admin: ReturnType<typeof createClient>,
  body: any,
  callerId: string,
  orgId: string,
  perms: string[]
) {
  if (!perms.includes("recurring_task.deactivate")) {
    return jsonError(403, "No permission to deactivate recurring tasks");
  }

  const { template_id } = body;
  if (!template_id) return jsonError(400, "template_id is required");

  const { data: existing } = await admin
    .from("recurring_task_templates")
    .select("*")
    .eq("id", template_id)
    .eq("organization_id", orgId)
    .maybeSingle();

  if (!existing) return jsonError(404, "Recurring task template not found");

  const { error } = await admin.from("recurring_task_templates")
    .update({ is_active: false, deactivated_at: new Date().toISOString() })
    .eq("id", template_id);
  if (error) return jsonError(500, `Failed: ${error.message}`);

  await admin.from("audit_logs").insert({
    actor_id: callerId,
    action: "recurring_task.deactivated",
    entity_type: "recurring_task_template",
    entity_id: template_id,
  });

  return jsonResponse(200, { message: "Recurring task template deactivated" });
}

async function getEmployeeId(admin: ReturnType<typeof createClient>, userId: string): Promise<string | null> {
  const { data } = await admin.from("employees").select("id").eq("user_id", userId).maybeSingle();
  return data?.id || null;
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
