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

    // Verify caller session
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

    // Check caller permissions via direct query
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

    const body: InviteEmployeeRequest = await req.json();
    const orgId = callerProfile.organization_id;

    // Validate required fields
    if (!body.full_name || !body.work_email || !body.role || !body.joining_date || !body.employee_code) {
      return jsonError(400, "Missing required fields");
    }

    if (!VALID_ROLES.includes(body.role)) {
      return jsonError(400, "Invalid role code");
    }

    // Only director can assign director role
    if (body.role === "director" && callerProfile.role !== "director") {
      return jsonError(403, "Only a Director can assign Director-level access");
    }

    // Only director or system_admin can assign system_admin
    if (
      body.role === "system_admin" &&
      callerProfile.role !== "director" &&
      callerProfile.role !== "system_admin"
    ) {
      return jsonError(403, "Only a Director or System Administrator can assign System Administrator role");
    }

    // Check for duplicate employee_code
    const { data: dupCode } = await admin
      .from("employees")
      .select("id")
      .eq("organization_id", orgId)
      .eq("employee_code", body.employee_code)
      .maybeSingle();

    if (dupCode) return jsonError(409, "Employee code already exists");

    // Check for duplicate work_email
    const { data: dupEmail } = await admin
      .from("employees")
      .select("id")
      .eq("organization_id", orgId)
      .eq("work_email", body.work_email)
      .maybeSingle();

    if (dupEmail) return jsonError(409, "Work email already exists");

    // Step 1: Create auth user
    const { data: newUser, error: createError } = await admin.auth.admin.createUser({
      email: body.work_email,
      email_confirm: false,
      user_metadata: { full_name: body.full_name },
    });

    let userId: string;

    if (createError) {
      // User may already exist in auth — try to find them
      if (createError.message.includes("already") || createError.message.includes("exists")) {
        const { data: userList } = await admin.auth.admin.listUsers();
        const found = userList?.users?.find((u) => u.email === body.work_email);
        if (found) {
          userId = found.id;
        } else {
          return jsonError(500, `Failed to create auth user: ${createError.message}`);
        }
      } else {
        return jsonError(500, `Failed to create auth user: ${createError.message}`);
      }
    } else {
      userId = newUser.user.id;
    }

    // Step 2: Upsert user_profile
    const { error: profileUpsertError } = await admin.from("user_profiles").upsert(
      {
        id: userId,
        email: body.work_email,
        full_name: body.full_name,
        role: body.role,
        organization_id: orgId,
        status: "pending_activation",
        is_active: false,
      },
      { onConflict: "id" }
    );

    if (profileUpsertError) {
      return jsonError(500, `Failed to create user profile: ${profileUpsertError.message}`);
    }

    // Step 3: Create employee record
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

    // Step 4: Create org membership
    const { error: membershipError } = await admin
      .from("user_organization_memberships")
      .insert({ user_id: userId, organization_id: orgId, is_active: true });

    if (membershipError) {
      console.error("Membership creation failed:", membershipError.message);
    }

    // Step 5: Create reporting line if manager specified
    if (body.reporting_manager_id && employee) {
      const { error: reportingError } = await admin
        .from("employee_reporting_lines")
        .insert({ employee_id: employee.id, manager_id: body.reporting_manager_id });

      if (reportingError) {
        console.error("Reporting line creation failed:", reportingError.message);
      }
    }

    // Step 6: Write audit log
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
      },
    });

    return jsonResponse(201, {
      message: "Employee invited successfully",
      user_id: userId,
      employee_id: employee?.id,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return jsonError(500, message);
  }
});

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
