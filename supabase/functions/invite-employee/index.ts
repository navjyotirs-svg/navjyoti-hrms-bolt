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

type FunctionRequest = InviteEmployeeRequest | ResendInvitationRequest | ActivateAccountRequest;

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

    if (!callerPerms.includes("employee.create")) {
      return jsonError(403, "You do not have permission to create employees");
    }

    const body: FunctionRequest = await req.json();
    const orgId = callerProfile.organization_id;
    const appUrl = getAppUrl();

    if (body.action === "resend_invitation") {
      return handleResendInvitation(admin, callerId, callerProfile, body as ResendInvitationRequest, appUrl);
    }

    if (body.action === "activate_account") {
      return handleActivateAccount(admin, callerId, callerProfile);
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
    .select("id")
    .eq("email", body.work_email)
    .maybeSingle();

  if (dupProfile) return jsonError(409, "A user with this email already exists");

  // Use inviteUserByEmail — sends a secure invitation email, no temporary password
  const { data: inviteData, error: inviteError } = await admin.auth.admin.inviteUserByEmail(
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

  const userId = inviteData.user.id;

  // Create user_profile — active immediately at invite time
  const { error: profileInsertError } = await admin.from("user_profiles").insert({
    id: userId,
    email: body.work_email,
    full_name: body.full_name,
    role: body.role,
    organization_id: orgId,
    status: "active",
    is_active: true,
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
      employment_status: "active",
      joining_date: body.joining_date,
      is_active: true,
    })
    .select("id")
    .maybeSingle();

  if (empError) {
    return jsonError(500, `Failed to create employee record: ${empError.message}`);
  }

  // Create org membership
  const { error: membershipError } = await admin
    .from("user_organization_memberships")
    .insert({ user_id: userId, organization_id: orgId, is_active: true });

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
    message: "Invitation email sent successfully",
    user_id: userId,
    employee_id: employee?.id,
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
    .select("id, user_id, organization_id, work_email, full_name, employment_status")
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

  // Resend invitation using the same email
  const { error: resendError } = await admin.auth.admin.inviteUserByEmail(
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
    message: "Invitation email resent successfully",
    employee_id: employee.id,
  });
}

async function handleActivateAccount(
  admin: ReturnType<typeof createClient>,
  callerId: string,
  callerProfile: { id: string; role: string; organization_id: string }
): Promise<Response> {
  // Activate the user's own profile after they set their password
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

  // Activate profile
  const { error: activateError } = await admin
    .from("user_profiles")
    .update({
      status: "active",
      is_active: true,
      updated_at: new Date().toISOString(),
    })
    .eq("id", callerId);

  if (activateError) {
    return jsonError(500, `Failed to activate profile: ${activateError.message}`);
  }

  // Update employee record from "invited" to "active"
  const { data: employee } = await admin
    .from("employees")
    .select("id, employment_status")
    .eq("user_id", callerId)
    .maybeSingle();

  if (employee && employee.employment_status === "invited") {
    await admin
      .from("employees")
      .update({
        employment_status: "active",
        updated_at: new Date().toISOString(),
      })
      .eq("id", employee.id);
  }

  // Audit log
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
