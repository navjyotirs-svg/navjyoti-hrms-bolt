import { createClient } from "npm:@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, Apikey",
};

const VALID_STATUSES = [
  "invited", "pending_activation", "active", "on_probation", "confirmed",
  "transferred", "suspended", "notice_period", "resigned",
  "terminated", "inactive", "offboarded",
];

interface ManageRequest {
  action: "change_status" | "transfer" | "offboard";
  employee_id: string;
  // change_status
  new_status?: string;
  reason?: string;
  effective_date?: string;
  // transfer
  to_branch_id?: string | null;
  to_department_id?: string | null;
  to_manager_id?: string | null;
  // offboard
  last_working_date?: string;
}

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
    const { data: callerProfile, error: profileError } = await admin
      .from("user_profiles")
      .select("id, role, organization_id, status")
      .eq("id", callerId)
      .maybeSingle();

    if (profileError || !callerProfile) {
      return jsonError(403, "Profile not found");
    }

    if (callerProfile.status === "disabled") {
      return jsonError(403, "Account disabled");
    }

    // Check caller permissions
    const { data: roleRow } = await admin
      .from("roles")
      .select("id")
      .eq("code", callerProfile.role)
      .maybeSingle();

    if (!roleRow) return jsonError(403, "Invalid caller role");

    const { data: permRows } = await admin
      .from("role_permissions")
      .select("permissions!inner(code)")
      .eq("role_id", roleRow.id);

    const callerPerms =
      permRows?.map((p: { permissions: { code: string } }) => p.permissions.code) ?? [];

    const body: ManageRequest = await req.json();
    const orgId = callerProfile.organization_id;

    // Fetch the employee
    const { data: employee, error: empError } = await admin
      .from("employees")
      .select("id, user_id, organization_id, branch_id, department_id, reporting_manager_id, employment_status, full_name")
      .eq("id", body.employee_id)
      .maybeSingle();

    if (empError || !employee) {
      return jsonError(404, "Employee not found");
    }

    // Verify same org
    if (employee.organization_id !== orgId) {
      return jsonError(403, "Cross-organization access denied");
    }

    if (body.action === "change_status") {
      return handleChangeStatus(admin, callerId, callerPerms, employee, body);
    } else if (body.action === "transfer") {
      return handleTransfer(admin, callerId, callerPerms, employee, body, orgId);
    } else if (body.action === "offboard") {
      return handleOffboard(admin, callerId, callerPerms, employee, body);
    } else {
      return jsonError(400, "Invalid action");
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return jsonError(500, message);
  }
});

async function handleChangeStatus(
  admin: ReturnType<typeof createClient>,
  callerId: string,
  callerPerms: string[],
  employee: Record<string, unknown>,
  body: ManageRequest
): Promise<Response> {
  if (!callerPerms.includes("employee.status.manage")) {
    return jsonError(403, "You do not have permission to change employee status");
  }

  if (!body.new_status || !VALID_STATUSES.includes(body.new_status)) {
    return jsonError(400, "Invalid or missing new_status");
  }

  const oldStatus = employee.employment_status as string;
  const effectiveDate = body.effective_date || new Date().toISOString().slice(0, 10);

  // Update employee status
  const { error: updateError } = await admin
    .from("employees")
    .update({
      employment_status: body.new_status,
      is_active: !["inactive", "offboarded", "terminated", "suspended"].includes(body.new_status),
      updated_at: new Date().toISOString(),
    })
    .eq("id", employee.id as string);

  if (updateError) {
    return jsonError(500, `Failed to update status: ${updateError.message}`);
  }

  // If offboarded or terminated, disable user account
  if (["offboarded", "terminated", "inactive"].includes(body.new_status)) {
    await admin
      .from("user_profiles")
      .update({ status: "disabled", is_active: false, updated_at: new Date().toISOString() })
      .eq("id", employee.user_id as string);
  }

  // If suspended, disable but don't offboard
  if (body.new_status === "suspended") {
    await admin
      .from("user_profiles")
      .update({ status: "disabled", is_active: false, updated_at: new Date().toISOString() })
      .eq("id", employee.user_id as string);
  }

  // If reactivated (active, confirmed, on_probation), enable account
  if (["active", "confirmed", "on_probation"].includes(body.new_status)) {
    await admin
      .from("user_profiles")
      .update({ status: "active", is_active: true, updated_at: new Date().toISOString() })
      .eq("id", employee.user_id as string);
  }

  // Write status history
  await admin.from("employee_status_history").insert({
    employee_id: employee.id as string,
    old_status: oldStatus,
    new_status: body.new_status,
    reason: body.reason || null,
    actor_id: callerId,
    effective_date: effectiveDate,
  });

  // Write audit log
  await admin.from("audit_logs").insert({
    actor_id: callerId,
    action: "employee.status_change",
    entity_type: "employee",
    entity_id: employee.id as string,
    old_values: { employment_status: oldStatus },
    new_values: { employment_status: body.new_status, reason: body.reason },
  });

  return jsonResponse(200, {
    message: "Status updated successfully",
    employee_id: employee.id,
    old_status: oldStatus,
    new_status: body.new_status,
  });
}

async function handleTransfer(
  admin: ReturnType<typeof createClient>,
  callerId: string,
  callerPerms: string[],
  employee: Record<string, unknown>,
  body: ManageRequest,
  orgId: string
): Promise<Response> {
  if (!callerPerms.includes("employee.transfer.manage")) {
    return jsonError(403, "You do not have permission to transfer employees");
  }

  const effectiveDate = body.effective_date || new Date().toISOString().slice(0, 10);

  // Record the transfer
  const { error: transferError } = await admin
    .from("employee_transfers")
    .insert({
      employee_id: employee.id as string,
      from_organization_id: employee.organization_id as string,
      from_branch_id: employee.branch_id as string | null,
      from_department_id: employee.department_id as string | null,
      from_manager_id: employee.reporting_manager_id as string | null,
      to_organization_id: orgId,
      to_branch_id: body.to_branch_id || null,
      to_department_id: body.to_department_id || null,
      to_manager_id: body.to_manager_id || null,
      effective_date: effectiveDate,
      reason: body.reason || null,
      initiated_by: callerId,
      status: "completed",
    });

  if (transferError) {
    return jsonError(500, `Failed to record transfer: ${transferError.message}`);
  }

  // Update employee with new assignments
  const { error: updateError } = await admin
    .from("employees")
    .update({
      branch_id: body.to_branch_id || null,
      department_id: body.to_department_id || null,
      reporting_manager_id: body.to_manager_id || null,
      employment_status: "transferred",
      updated_at: new Date().toISOString(),
    })
    .eq("id", employee.id as string);

  if (updateError) {
    return jsonError(500, `Failed to update employee: ${updateError.message}`);
  }

  // Update reporting line
  if (body.to_manager_id) {
    // Remove old reporting lines
    await admin
      .from("employee_reporting_lines")
      .delete()
      .eq("employee_id", employee.id as string);

    // Insert new reporting line
    await admin
      .from("employee_reporting_lines")
      .insert({
        employee_id: employee.id as string,
        manager_id: body.to_manager_id,
      });
  }

  // Write audit log
  await admin.from("audit_logs").insert({
    actor_id: callerId,
    action: "employee.transfer",
    entity_type: "employee",
    entity_id: employee.id as string,
    old_values: {
      branch_id: employee.branch_id,
      department_id: employee.department_id,
      reporting_manager_id: employee.reporting_manager_id,
    },
    new_values: {
      branch_id: body.to_branch_id,
      department_id: body.to_department_id,
      reporting_manager_id: body.to_manager_id,
      reason: body.reason,
    },
  });

  return jsonResponse(200, {
    message: "Transfer completed successfully",
    employee_id: employee.id,
  });
}

async function handleOffboard(
  admin: ReturnType<typeof createClient>,
  callerId: string,
  callerPerms: string[],
  employee: Record<string, unknown>,
  body: ManageRequest
): Promise<Response> {
  if (!callerPerms.includes("employee.offboarding.manage")) {
    return jsonError(403, "You do not have permission to offboard employees");
  }

  // Create offboarding record
  const { error: offboardError } = await admin
    .from("employee_offboarding")
    .insert({
      employee_id: employee.id as string,
      reason: body.reason || null,
      last_working_date: body.last_working_date || null,
      initiated_by: callerId,
      status: "initiated",
    });

  if (offboardError) {
    return jsonError(500, `Failed to create offboarding record: ${offboardError.message}`);
  }

  // Update employee status
  const { error: updateError } = await admin
    .from("employees")
    .update({
      employment_status: "offboarded",
      is_active: false,
      updated_at: new Date().toISOString(),
    })
    .eq("id", employee.id as string);

  if (updateError) {
    return jsonError(500, `Failed to update employee: ${updateError.message}`);
  }

  // Disable user account
  await admin
    .from("user_profiles")
    .update({ status: "disabled", is_active: false, updated_at: new Date().toISOString() })
    .eq("id", employee.user_id as string);

  // Write status history
  await admin.from("employee_status_history").insert({
    employee_id: employee.id as string,
    old_status: employee.employment_status as string,
    new_status: "offboarded",
    reason: body.reason || "Offboarded",
    actor_id: callerId,
    effective_date: body.last_working_date || new Date().toISOString().slice(0, 10),
  });

  // Write audit log
  await admin.from("audit_logs").insert({
    actor_id: callerId,
    action: "employee.offboard",
    entity_type: "employee",
    entity_id: employee.id as string,
    new_values: {
      reason: body.reason,
      last_working_date: body.last_working_date,
    },
  });

  return jsonResponse(200, {
    message: "Offboarding initiated successfully",
    employee_id: employee.id,
  });
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
