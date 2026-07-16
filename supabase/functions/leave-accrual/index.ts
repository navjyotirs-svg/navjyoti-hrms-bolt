import { createClient } from "npm:@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const targetMonth = url.searchParams.get("month");
    const isManualRun = targetMonth !== null;

    const now = new Date();
    const accrualYear = targetMonth
      ? parseInt(targetMonth.split("-")[0])
      : now.getFullYear();
    const accrualMonth = targetMonth
      ? parseInt(targetMonth.split("-")[1])
      : now.getMonth() + 1;
    const accrualMonthStr = `${accrualYear}-${String(accrualMonth).padStart(2, "0")}`;
    const effectiveDate = `${accrualYear}-${String(accrualMonth).padStart(2, "0")}-01`;

    const { data: employees, error: empError } = await admin
      .from("employees")
      .select("id, organization_id, full_name, employment_status")
      .eq("is_active", true)
      .in("employment_status", ["active", "invited"]);

    if (empError) throw new Error(`Failed to fetch employees: ${empError.message}`);

    const { data: leaveTypes, error: ltError } = await admin
      .from("leave_types")
      .select("id, organization_id, code, monthly_credit")
      .eq("is_active", true);

    if (ltError) throw new Error(`Failed to fetch leave types: ${ltError.message}`);

    const leaveTypesByOrg = new Map<string, typeof leaveTypes>();
    for (const lt of leaveTypes ?? []) {
      if (!leaveTypesByOrg.has(lt.organization_id)) {
        leaveTypesByOrg.set(lt.organization_id, []);
      }
      leaveTypesByOrg.get(lt.organization_id)!.push(lt);
    }

    let successCount = 0;
    let skipCount = 0;
    let errorCount = 0;

    for (const emp of employees ?? []) {
      const orgLeaveTypes = leaveTypesByOrg.get(emp.organization_id) ?? [];

      for (const lt of orgLeaveTypes) {
        const idempotencyKey = `${emp.id}:${lt.id}:${accrualMonthStr}:MONTHLY_ACCRUAL`;
        const accrualQuantity = parseFloat(lt.monthly_credit);

        const { data: result, error: rpcError } = await admin.rpc(
          "apply_leave_transaction",
          {
            p_employee_id: emp.id,
            p_leave_type_id: lt.id,
            p_organization_id: emp.organization_id,
            p_transaction_type: "MONTHLY_ACCRUAL",
            p_quantity: accrualQuantity,
            p_idempotency_key: idempotencyKey,
            p_reference_type: "monthly_accrual",
            p_description: `Monthly accrual for ${accrualMonthStr}`,
            p_effective_date: effectiveDate,
          }
        );

        if (rpcError) {
          errorCount++;
        } else if (result && result[0]) {
          if (result[0].message?.includes("Duplicate")) {
            skipCount++;
          } else {
            successCount++;
          }
        }
      }
    }

    await admin.from("audit_logs").insert({
      actor_id: null,
      action: "leave.accrual_job_run",
      entity_type: "system",
      entity_id: null,
      old_values: null,
      new_values: {
        month: accrualMonthStr,
        total_employees: employees?.length ?? 0,
        success_count: successCount,
        skip_count: skipCount,
        error_count: errorCount,
        manual_run: isManualRun,
      },
    });

    return new Response(
      JSON.stringify({
        success: true,
        month: accrualMonthStr,
        total_employees: employees?.length ?? 0,
        success_count: successCount,
        skip_count: skipCount,
        error_count: errorCount,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
