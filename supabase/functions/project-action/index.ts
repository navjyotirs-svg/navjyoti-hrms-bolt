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
        return await handleCreate(admin, body, callerId, orgId, permissions);
      case "update":
        return await handleUpdate(admin, body, callerId, orgId, permissions);
      case "change_status":
        return await handleChangeStatus(admin, body, callerId, orgId, permissions);
      case "archive":
        return await handleArchive(admin, body, callerId, orgId, permissions);
      default:
        return jsonError(400, `Unknown action: ${action}`);
    }
  } catch (err) {
    return jsonError(500, (err as Error).message);
  }
});

async function generateProjectCode(admin: ReturnType<typeof createClient>, orgId: string): Promise<string> {
  const year = new Date().getFullYear();
  const { data } = await admin.rpc("generate_project_code", { p_org_id: orgId });
  return data || `PRJ-${year}-000001`;
}

async function handleCreate(
  admin: ReturnType<typeof createClient>,
  body: any,
  callerId: string,
  orgId: string,
  perms: string[]
) {
  if (!perms.includes("project.create")) {
    return jsonError(403, "No permission to create projects");
  }

  const { project_name, description, project_owner_employee_id, branch_id, department_id, priority, start_date, expected_end_date } = body;

  if (!project_name) return jsonError(400, "Project name is required");

  const project_code = await generateProjectCode(admin, orgId);

  const { data: project, error } = await admin
    .from("projects")
    .insert({
      organization_id: orgId,
      project_code,
      project_name,
      description: description || null,
      project_owner_employee_id: project_owner_employee_id || null,
      branch_id: branch_id || null,
      department_id: department_id || null,
      priority: priority || "MEDIUM",
      start_date: start_date || new Date().toISOString().slice(0, 10),
      expected_end_date: expected_end_date || null,
      status: "ACTIVE",
      created_by: callerId,
      is_active: true,
    })
    .select("id, project_code")
    .maybeSingle();

  if (error || !project) {
    return jsonError(500, `Failed to create project: ${error?.message ?? "Unknown"}`);
  }

  await admin.from("project_history").insert({
    project_id: project.id,
    action: "CREATED",
    new_values: { project_name, project_code, priority },
    changed_by: callerId,
  });

  await admin.from("audit_logs").insert({
    actor_id: callerId,
    action: "project.create",
    entity_type: "project",
    entity_id: project.id,
    new_values: { project_name, project_code },
  });

  return jsonResponse(200, { project_id: project.id, project_code, message: "Project created successfully" });
}

async function handleUpdate(
  admin: ReturnType<typeof createClient>,
  body: any,
  callerId: string,
  orgId: string,
  perms: string[]
) {
  const { project_id, project_name, description, project_owner_employee_id, branch_id, department_id, priority, expected_end_date } = body;

  if (!project_id) return jsonError(400, "project_id is required");

  const { data: existing } = await admin
    .from("projects")
    .select("*")
    .eq("id", project_id)
    .eq("organization_id", orgId)
    .maybeSingle();

  if (!existing) return jsonError(404, "Project not found");

  const canUpdate = perms.includes("project.update_all") || perms.includes("project.update_team");
  if (!canUpdate) return jsonError(403, "No permission to update projects");

  const updates: Record<string, unknown> = {};
  if (project_name !== undefined) updates.project_name = project_name;
  if (description !== undefined) updates.description = description;
  if (project_owner_employee_id !== undefined) updates.project_owner_employee_id = project_owner_employee_id;
  if (branch_id !== undefined) updates.branch_id = branch_id;
  if (department_id !== undefined) updates.department_id = department_id;
  if (priority !== undefined) updates.priority = priority;
  if (expected_end_date !== undefined) updates.expected_end_date = expected_end_date;

  const { error } = await admin.from("projects").update(updates).eq("id", project_id);
  if (error) return jsonError(500, `Failed to update project: ${error.message}`);

  await admin.from("project_history").insert({
    project_id,
    action: "UPDATED",
    old_values: existing,
    new_values: updates,
    changed_by: callerId,
  });

  await admin.from("audit_logs").insert({
    actor_id: callerId,
    action: "project.update",
    entity_type: "project",
    entity_id: project_id,
    old_values: existing,
    new_values: updates,
  });

  return jsonResponse(200, { message: "Project updated successfully" });
}

async function handleChangeStatus(
  admin: ReturnType<typeof createClient>,
  body: any,
  callerId: string,
  orgId: string,
  perms: string[]
) {
  const { project_id, new_status } = body;
  if (!project_id || !new_status) return jsonError(400, "project_id and new_status are required");

  const validStatuses = ["DRAFT", "ACTIVE", "ON_HOLD", "COMPLETED", "CANCELLED", "ARCHIVED"];
  if (!validStatuses.includes(new_status)) return jsonError(400, "Invalid status");

  const { data: existing } = await admin
    .from("projects")
    .select("*")
    .eq("id", project_id)
    .eq("organization_id", orgId)
    .maybeSingle();

  if (!existing) return jsonError(404, "Project not found");

  const canUpdate = perms.includes("project.update_all") || perms.includes("project.update_team");
  if (!canUpdate) return jsonError(403, "No permission to update projects");

  const updates: Record<string, unknown> = { status: new_status };
  if (new_status === "COMPLETED") updates.actual_end_date = new Date().toISOString().slice(0, 10);
  if (new_status === "ARCHIVED") updates.is_active = false;

  const { error } = await admin.from("projects").update(updates).eq("id", project_id);
  if (error) return jsonError(500, `Failed to update status: ${error.message}`);

  await admin.from("project_history").insert({
    project_id,
    action: "STATUS_CHANGED",
    old_values: { status: existing.status },
    new_values: { status: new_status },
    changed_by: callerId,
  });

  await admin.from("audit_logs").insert({
    actor_id: callerId,
    action: "project.status_change",
    entity_type: "project",
    entity_id: project_id,
    old_values: { status: existing.status },
    new_values: { status: new_status },
  });

  return jsonResponse(200, { message: "Project status updated" });
}

async function handleArchive(
  admin: ReturnType<typeof createClient>,
  body: any,
  callerId: string,
  orgId: string,
  perms: string[]
) {
  if (!perms.includes("project.archive")) {
    return jsonError(403, "No permission to archive projects");
  }

  const { project_id } = body;
  if (!project_id) return jsonError(400, "project_id is required");

  const { data: existing } = await admin
    .from("projects")
    .select("*")
    .eq("id", project_id)
    .eq("organization_id", orgId)
    .maybeSingle();

  if (!existing) return jsonError(404, "Project not found");

  const { error } = await admin.from("projects").update({
    status: "ARCHIVED",
    is_active: false,
  }).eq("id", project_id);

  if (error) return jsonError(500, `Failed to archive: ${error.message}`);

  await admin.from("project_history").insert({
    project_id,
    action: "ARCHIVED",
    old_values: { status: existing.status, is_active: existing.is_active },
    new_values: { status: "ARCHIVED", is_active: false },
    changed_by: callerId,
  });

  await admin.from("audit_logs").insert({
    actor_id: callerId,
    action: "project.archive",
    entity_type: "project",
    entity_id: project_id,
  });

  return jsonResponse(200, { message: "Project archived" });
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
