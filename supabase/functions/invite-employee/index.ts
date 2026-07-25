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
    if (body.action === "activate_account") {
      return handleActivateAccount(admin, callerId, callerProfile);
    }

    // repair_activation is an admin action — require employee.create permission.
    if (body.action === "repair_activation") {
      if (!callerPerms.includes("employee.create")) {
        return jsonError(403, "You do not have permission to repair account activation");
      }
      return handleRepairActivation(admin, callerId, callerProfile, body as RepairActivationRequest);
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
    // Check if this is a stale invite: profile exists but no employee row
    // and the user never signed in (pending_activation or never activated).
    const { data: authUser } = await admin.auth.admin.getUserById(dupProfile.id);
    const neverSignedIn = !authUser?.user?.last_sign_in_at;
    const { data: existingEmp } = await admin
      .from("employees")
      .select("id")
      .eq("user_id", dupProfile.id)
      .maybeSingle();

    if (neverSignedIn && !existingEmp) {
      // Clean up the orphaned auth user and profile so we can re-invite cleanly
      await admin.from("user_organization_memberships").delete().eq("user_id", dupProfile.id);
      await admin.from("user_profiles").delete().eq("id", dupProfile.id);
      await admin.auth.admin.deleteUser(dupProfile.id);
    } else {
      return jsonError(409, "A user with this email already exists");
    }
  } else {
    // No profile row, but there may still be an orphaned auth user (e.g. employee
    // row was deleted but auth user was left behind). Check and clean up.
    const { data: existingAuthUsers } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    const orphanedAuth = existingAuthUsers?.users?.find(
      (u: { email?: string; last_sign_in_at?: string | null }) =>
        u.email === body.work_email && !u.last_sign_in_at
    );
    if (orphanedAuth) {
      await admin.auth.admin.deleteUser(orphanedAuth.id);
    }
  }

  // Use generateLink to create the auth user AND get a direct setup link.
  // This avoids relying on Supabase's rate-limited built-in email service.
  const { data: linkData, error: inviteError } = await admin.auth.admin.generateLink(
    "invite",
    body.work_email,
    {
      redirectTo: `${appUrl}/set-password`,
      data: {
        full_name: body.full_name,
        employee_code: body.employee_code,
        organization_id: orgId,
        invited_by: callerId,
      },
    }
  );

  if (inviteError) {
    return jsonError(500, `Failed to send invitation: ${inviteError.message}`);
  }

  const userId = linkData.user.id;
  const setupLink = linkData.properties?.action_link ?? `${appUrl}/set-password`;

  // Create user_profile — pending activation until password is set
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

  // Create employee record
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

  // Create org membership — inactive until password is set
  const { error: membershipError } = await admin
    .from("user_organization_memberships")
    .insert({ user_id: userId, organization_id: orgId, is_active: false });

  if (membershipError) {
    console.error("Membership creation failed:", membershipError.message);
  }

  // Create reporting line if manager specified
  if (body.reporting_manager_id && employee) {
    const { error: reportingError } = await admin
      .from("employee_reporting_lines")
      .insert({ employee_id: employee.id, manager_id: body.reporting_manager_id });

    if (reportingError) {
      console.error("Reporting line creation failed:", reportingError.message);
    }
  }

  // Audit log
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

  // Rate limit: check last audit log for this action
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

  // Resend invitation using generateLink (avoids rate-limited built-in email service)
  const { data: resendLinkData, error: resendError } = await admin.auth.admin.generateLink(
    "invite",
    employee.work_email,
    {
      redirectTo: `${appUrl}/set-password`,
      data: {
        full_name: employee.full_name,
        employee_code: employee.employee_code,
        organization_id: callerProfile.organization_id,
        invited_by: callerId,
      },
    }
  );

  if (resendError) {
    return jsonError(500, `Failed to resend invitation: ${resendError.message}`);
  }

  const setupLink = resendLinkData.properties?.action_link ?? `${appUrl}/set-password`;

  // Audit log
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

async function handleActivateAccount(
  admin: ReturnType<typeof createClient>,
  callerId: string,
  callerProfile: { id: string; role: string; organization_id: string }
): Promise<Response> {
  // Activate the user's own profile after they set their password.
  // Synchronizes user_profiles, employees, and org membership in one pass.
  const { data: profile, error: profileError } = await admin
    .from("user_profiles")
    .select("id, status, organization_id")
    .eq("id", callerId)
    .maybeSingle();

  if (profileError || !profile) {
    return jsonError(404, "User profile not found");
  }

  if (profile.organization_id !== callerProfile.organization_id) {
    return jsonError(403, "Organization mismatch");
  }

  if (profile.status === "active") {
    return jsonResponse(200, { message: "Account already active" });
  }

  const nowIso = new Date().toISOString();

  // 1. Activate user_profiles
  const { error: activateError } = await admin
    .from("user_profiles")
    .update({
      status: "active",
      is_active: true,
      updated_at: nowIso,
    })
    .eq("id", callerId);

  if (activateError) {
    return jsonError(500, `Failed to activate profile: ${activateError.message}`);
  }

  // 2. Activate employee record
  const { data: employee } = await admin
    .from("employees")
    .select("id, employment_status")
    .eq("user_id", callerId)
    .maybeSingle();

  if (employee) {
    const prevStatus = employee.employment_status;
    await admin
      .from("employees")
      .update({
        employment_status: "active",
        is_active: true,
        updated_at: nowIso,
      })
      .eq("id", employee.id);

    // 3. Write employee status history
    await admin.from("employee_status_history").insert({
      employee_id: employee.id,
      old_status: prevStatus,
      new_status: "active",
      actor_id: callerId,
      effective_date: new Date().toISOString().slice(0, 10),
      reason: "Account activated after password setup",
    });
  }

  // 4. Activate organization membership (re-link if missing)
  const { data: membership } = await admin
    .from("user_organization_memberships")
    .select("id")
    .eq("user_id", callerId)
    .eq("organization_id", callerProfile.organization_id)
    .maybeSingle();

  if (membership) {
    await admin
      .from("user_organization_memberships")
      .update({ is_active: true })
      .eq("id", membership.id);
  } else {
    await admin
      .from("user_organization_memberships")
      .insert({ user_id: callerId, organization_id: callerProfile.organization_id, is_active: true });
  }

  // 5. Audit log
  await admin.from("audit_logs").insert({
    actor_id: callerId,
    action: "employee.activate_self",
    entity_type: "user_profile",
    entity_id: callerId,
    old_values: { status: profile.status },
    new_values: { status: "active", is_active: true },
  });

  return jsonResponse(200, { message: "Account activated successfully" });
}

async function handleRepairActivation(
  admin: ReturnType<typeof createClient>,
  callerId: string,
  callerProfile: { id: string; role: string; organization_id: string },
  body: RepairActivationRequest
): Promise<Response> {
  // Idempotent repair: inspect, re-link, activate, synchronize.
  const { data: employee, error: empError } = await admin
    .from("employees")
    .select("id, user_id, organization_id, employment_status, is_active, work_email, full_name")
    .eq("id", body.employee_id)
    .maybeSingle();

  if (empError || !employee) {
    return jsonError(404, "Employee not found");
  }

  if (employee.organization_id !== callerProfile.organization_id) {
    return jsonError(403, "Cross-organization access denied");
  }

  const userId = employee.user_id as string;
  const nowIso = new Date().toISOString();

  // 1. Ensure auth user exists
  const { data: authUser, error: authError } = await admin.auth.admin.getUserById(userId);
  if (authError || !authUser.user) {
    // Auth user missing — cannot repair without re-inviting. Return instructions.
    return jsonError(409, "Auth account missing for this employee. Please re-invite the employee with their work email to recreate the account.");
  }

  // 2. Synchronize user_profiles
  const { data: profile } = await admin
    .from("user_profiles")
    .select("id, status, role")
    .eq("id", userId)
    .maybeSingle();

  const prevProfileStatus = profile?.status ?? "missing";
  const profileRole = profile?.role ?? "employee";
  await admin
    .from("user_profiles")
    .upsert({
      id: userId,
      email: employee.work_email,
      full_name: employee.full_name,
      organization_id: callerProfile.organization_id,
      role: profileRole,
      status: "active",
      is_active: true,
      updated_at: nowIso,
    });

  // 3. Synchronize employee record
  const prevEmpStatus = employee.employment_status;
  await admin
    .from("employees")
    .update({
      employment_status: "active",
      is_active: true,
      updated_at: nowIso,
    })
    .eq("id", employee.id);

  // 4. Write employee status history
  await admin.from("employee_status_history").insert({
    employee_id: employee.id,
    old_status: prevEmpStatus,
    new_status: "active",
    actor_id: callerId,
    effective_date: new Date().toISOString().slice(0, 10),
    reason: "Account activation repaired by administrator",
  });

  // 5. Re-link / activate org membership (no duplicates)
  const { data: existingMembership } = await admin
    .from("user_organization_memberships")
    .select("id")
    .eq("user_id", userId)
    .eq("organization_id", callerProfile.organization_id)
    .maybeSingle();

  if (existingMembership) {
    await admin
      .from("user_organization_memberships")
      .update({ is_active: true })
      .eq("id", existingMembership.id);
  } else {
    await admin
      .from("user_organization_memberships")
      .insert({ user_id: userId, organization_id: callerProfile.organization_id, is_active: true });
  }

  // 6. Audit log
  await admin.from("audit_logs").insert({
    actor_id: callerId,
    action: "employee.repair_activation",
    entity_type: "employee",
    entity_id: employee.id,
    old_values: { profile_status: prevProfileStatus, employment_status: prevEmpStatus },
    new_values: { profile_status: "active", employment_status: "active", is_active: true },
  });

  return jsonResponse(200, {
    message: "Account activation repaired successfully",
    employee_id: employee.id,
    user_id: userId,
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
