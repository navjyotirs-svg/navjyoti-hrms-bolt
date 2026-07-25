import { createClient } from "npm:@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, Apikey",
};

const VALID_ROLES = [
  "director",
  "hr_admin",
  "manager",
  "team_leader",
  "employee",
  "intern",
  "system_admin",
];

const PROD_APP_URL = "https://navjyotirs-svg-navjy-hpxl.bolt.host";

function getAppUrl(): string {
  const envUrl = Deno.env.get("APP_URL");
  if (envUrl) return envUrl.replace(/\/$/, "");
  return PROD_APP_URL;
}

interface InviteEmployeeRequest {
  full_name: string;
  work_email: string;
  role: string;
  branch_id?: string | null;
  department_id?: string | null;
  designation?: string;
  reporting_manager_id?: string | null;
  joining_date: string;
  work_mode: string;
  employee_code: string;
}

interface ResendInvitationRequest {
  action: "resend_invitation";
  employee_id: string;
}

interface ActivateAccountRequest {
  action: "activate_account";
}

interface RepairActivationRequest {
  action: "repair_activation";
  employee_id: string;
}

type FunctionRequest = InviteEmployeeRequest | ResendInvitationRequest | ActivateAccountRequest | RepairActivationRequest;

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

    const body: FunctionRequest = await req.json();
    const orgId = callerProfile.organization_id;
    const appUrl = getAppUrl();

    // activate_account is called by the employee themselves after setting their
    // password — it must NOT require employee.create permission.
    // Uses the atomic SECURITY DEFINER RPC for transactional safety.
    if (body.action === "activate_account") {
      const { data: rpcResult, error: rpcError } = await callerClient.rpc("activate_employee_account");

      if (rpcError) {
        return jsonError(500, `Activation failed: ${rpcError.message}`);
      }

      const result = rpcResult as { success: boolean; error?: string; message?: string; employment_status?: string };
      if (!result.success) {
        return jsonError(400, result.message || result.error || "Activation failed");
      }

      return jsonResponse(200, { message: result.message || "Account activated successfully", employment_status: result.employment_status });
    }

    // repair_activation is an admin action — require employee.create or employee.status.manage permission.
    // Uses the atomic SECURITY DEFINER RPC for transactional safety.
    if (body.action === "repair_activation") {
      if (!callerPerms.includes("employee.create") && !callerPerms.includes("employee.status.manage")) {
        return jsonError(403, "You do not have permission to repair account activation");
      }
      const repairBody = body as RepairActivationRequest;
      const { data: rpcResult, error: rpcError } = await callerClient.rpc("repair_employee_account", {
        p_employee_id: repairBody.employee_id,
      });

      if (rpcError) {
        return jsonError(500, `Repair failed: ${rpcError.message}`);
      }

      const result = rpcResult as { success: boolean; error?: string; message?: string; repaired?: string[] };
      if (!result.success) {
        return jsonError(400, result.message || result.error || "Repair failed");
      }

      return jsonResponse(200, { message: result.message || "Account repaired successfully", repaired: result.repaired, employee_id: repairBody.employee_id });
    }

    // resend_invitation and default invite require employee.create permission.
    if (!callerPerms.includes("employee.create")) {
      return jsonError(403, "You do not have permission to create employees");
    }

    if (body.action === "resend_invitation") {
      return handleResendInvitation(admin, callerId, callerProfile, body as ResendInvitationRequest, appUrl);
    }

    return handleInvite(admin, callerId, callerProfile, body as InviteEmployeeRequest, orgId, appUrl);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return jsonError(500, message);
  }
});

async function handleInvite(
  admin: ReturnType<typeof createClient>,
  callerId: string,
  callerProfile: { id: string; role: string; organization_id: string },
  body: InviteEmployeeRequest,
  orgId: string,
  appUrl: string
): Promise<Response> {
  if (!body.full_name || !body.work_email || !body.role || !body.joining_date || !body.employee_code) {
    return jsonError(400, "Missing required fields");
  }

  if (!VALID_ROLES.includes(body.role)) {
    return jsonError(400, "Invalid role code");
  }

  if (body.role === "director" && callerProfile.role !== "director") {
    return jsonError(403, "Only a Director can assign Director-level access");
  }

  if (
    body.role === "system_admin" &&
    callerProfile.role !== "director" &&
    callerProfile.role !== "system_admin"
  ) {
    return jsonError(403, "Only a Director or System Administrator can assign System Administrator role");
  }

  const { data: dupCode } = await admin
    .from("employees")
    .select("id")
    .eq("organization_id", orgId)
    .eq("employee_code", body.employee_code)
    .maybeSingle();

  if (dupCode) return jsonError(409, "Employee code already exists");

  const { data: dupEmail } = await admin
    .from("employees")
    .select("id")
    .eq("organization_id", orgId)
    .eq("work_email", body.work_email)
    .maybeSingle();

  if (dupEmail) return jsonError(409, "Work email already exists");

  const { data: dupProfile } = await admin
    .from("user_profiles")
    .select("id, status")
    .eq("email", body.work_email)
    .maybeSingle();

  if (dupProfile) {
    const { data: authUser } = await admin.auth.admin.getUserById(dupProfile.id);
    const neverSignedIn = !authUser?.user?.last_sign_in_at;
    const { data: existingEmp } = await admin
      .from("employees")
      .select("id")
      .eq("user_id", dupProfile.id)
      .maybeSingle();

    if (neverSignedIn && !existingEmp) {
      await admin.from("user_organization_memberships").delete().eq("user_id", dupProfile.id);
      await admin.from("user_profiles").delete().eq("id", dupProfile.id);
      await admin.auth.admin.deleteUser(dupProfile.id);
    } else {
      return jsonError(409, "A user with this email already exists");
    }
  } else {
    const { data: existingAuthUsers } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    const orphanedAuth = existingAuthUsers?.users?.find(
      (u: { email?: string; last_sign_in_at?: string | null }) =>
        u.email === body.work_email && !u.last_sign_in_at
    );
    if (orphanedAuth) {
      await admin.auth.admin.deleteUser(orphanedAuth.id);
    }
  }

  const { data: linkData, error: inviteError } = await admin.auth.admin.generateLink({
    type: "invite",
    email: body.work_email,
    options: {
      redirectTo: `${appUrl}/set-password`,
      data: {
        full_name: body.full_name,
        employee_code: body.employee_code,
        organization_id: orgId,
        invited_by: callerId,
      },
    },
  });

  if (inviteError) {
    return jsonError(500, `Failed to send invitation: ${inviteError.message}`);
  }

  const userId = linkData.user.id;
  const setupLink = linkData.properties?.action_link ?? `${appUrl}/set-password`;

  const { error: profileInsertError } = await admin.from("user_profiles").insert({
    id: userId,
    email: body.work_email,
    full_name: body.full_name,
    role: body.role,
    organization_id: orgId,
    status: "pending_activation",
    is_active: false,
  });

  if (profileInsertError) {
    return jsonError(500, `Failed to create user profile: ${profileInsertError.message}`);
  }

  const { data: employee, error: empError } = await admin
    .from("employees")
    .insert({
      user_id: userId,
      organization_id: orgId,
      branch_id: body.branch_id || null,
      department_id: body.department_id || null,
      employee_code: body.employee_code,
      full_name: body.full_name,
      designation: body.designation || null,
      work_email: body.work_email,
      work_mode: body.work_mode || "Office",
      employment_status: "invited",
      joining_date: body.joining_date,
      is_active: false,
    })
    .select("id")
    .maybeSingle();

  if (empError) {
    return jsonError(500, `Failed to create employee record: ${empError.message}`);
  }

  const { error: membershipError } = await admin
    .from("user_organization_memberships")
    .insert({ user_id: userId, organization_id: orgId, is_active: false });

  if (membershipError) {
    console.error("Membership creation failed:", membershipError.message);
  }

  if (body.reporting_manager_id && employee) {
    const { error: reportingError } = await admin
      .from("employee_reporting_lines")
      .insert({ employee_id: employee.id, manager_id: body.reporting_manager_id });

    if (reportingError) {
      console.error("Reporting line creation failed:", reportingError.message);
    }
  }

  await admin.from("audit_logs").insert({
    actor_id: callerId,
    action: "employee.invite",
    entity_type: "employee",
    entity_id: employee?.id,
    new_values: {
      user_id: userId,
      full_name: body.full_name,
      work_email: body.work_email,
      role: body.role,
      employee_code: body.employee_code,
      organization_id: orgId,
      invited_at: new Date().toISOString(),
    },
  });

  return jsonResponse(201, {
    message: "Employee invited successfully. Share the setup link below with the employee.",
    user_id: userId,
    employee_id: employee?.id,
    setup_link: setupLink,
  });
}

async function handleResendInvitation(
  admin: ReturnType<typeof createClient>,
  callerId: string,
  callerProfile: { id: string; role: string; organization_id: string },
  body: ResendInvitationRequest,
  appUrl: string
): Promise<Response> {
  const { data: employee, error: empError } = await admin
    .from("employees")
    .select("id, user_id, organization_id, work_email, full_name, employment_status, employee_code")
    .eq("id", body.employee_id)
    .maybeSingle();

  if (empError || !employee) {
    return jsonError(404, "Employee not found");
  }

  if (employee.organization_id !== callerProfile.organization_id) {
    return jsonError(403, "Cross-organization access denied");
  }

  const { data: userProfile } = await admin
    .from("user_profiles")
    .select("id, status, email")
    .eq("id", employee.user_id)
    .maybeSingle();

  if (!userProfile) {
    return jsonError(404, "User profile not found");
  }

  if (userProfile.status !== "pending_activation") {
    return jsonError(400, "Invitation can only be resent for pending activation accounts");
  }

  const { data: lastInvite } = await admin
    .from("audit_logs")
    .select("created_at")
    .eq("actor_id", callerId)
    .eq("action", "employee.invite")
    .eq("entity_id", employee.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (lastInvite) {
    const lastTime = new Date(lastInvite.created_at).getTime();
    const elapsed = Date.now() - lastTime;
    if (elapsed < 60 * 1000) {
      return jsonError(429, "Please wait at least 1 minute before resending an invitation");
    }
  }

  const { data: resendLinkData, error: resendError } = await admin.auth.admin.generateLink({
    type: "invite",
    email: employee.work_email,
    options: {
      redirectTo: `${appUrl}/set-password`,
      data: {
        full_name: employee.full_name,
        employee_code: employee.employee_code,
        organization_id: callerProfile.organization_id,
        invited_by: callerId,
      },
    },
  });

  if (resendError) {
    return jsonError(500, `Failed to resend invitation: ${resendError.message}`);
  }

  const setupLink = resendLinkData.properties?.action_link ?? `${appUrl}/set-password`;

  await admin.from("audit_logs").insert({
    actor_id: callerId,
    action: "employee.invite_resend",
    entity_type: "employee",
    entity_id: employee.id,
    new_values: {
      work_email: employee.work_email,
      resent_at: new Date().toISOString(),
    },
  });

  return jsonResponse(200, {
    message: "Invitation link generated successfully. Share it with the employee.",
    employee_id: employee.id,
    setup_link: setupLink,
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
