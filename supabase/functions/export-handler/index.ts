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
    const body = await req.json().catch(() => ({}));
    const { action } = body;

    // Cron-triggered cleanup action (no auth needed — service role)
    if (action === "cleanup") {
      return await handleCleanup();
    }

    // Authenticated actions
    if (!authHeader) return errorResponse("Missing authorization header", 401);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return errorResponse("Unauthorized", 401);

    const { data: profile } = await supabase
      .from("user_profiles")
      .select("id, organization_id, status, is_active")
      .eq("id", user.id).single();
    if (!profile || profile.status !== "active" || !profile.is_active)
      return errorResponse("Account not active", 403);

    const { data: perms } = await supabase.rpc("get_my_effective_permissions");
    const permissions: string[] = perms || [];
    const orgId = profile.organization_id;
    if (!orgId) return errorResponse("No organization membership", 403);

    switch (action) {
      case "request_export":
        return await handleRequestExport(supabase, body, user.id, orgId, permissions);
      case "get_download_url":
        return await handleGetDownloadUrl(supabase, body, user.id, orgId, permissions);
      case "cancel_export":
        return await handleCancelExport(supabase, body, user.id, orgId, permissions);
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

// CSV formula injection prevention
function escapeCsvField(value: string): string {
  if (!value) return "";
  const firstChar = value.charAt(0);
  if (["=", "+", "-", "@"].includes(firstChar)) {
    return `'${value}`;
  }
  return value;
}

function toCsv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  const lines = [headers.join(",")];
  for (const row of rows) {
    const values = headers.map(h => {
      const v = row[h];
      if (v === null || v === undefined) return "";
      const s = typeof v === "object" ? JSON.stringify(v) : String(v);
      const escaped = escapeCsvField(s);
      if (escaped.includes(",") || escaped.includes('"') || escaped.includes("\n")) {
        return `"${escaped.replace(/"/g, '""')}"`;
      }
      return escaped;
    });
    lines.push(values.join(","));
  }
  return lines.join("\n");
}

// ============================================================
// REQUEST EXPORT
// ============================================================
async function handleRequestExport(
  supabase: ReturnType<typeof createClient>,
  body: any, userId: string, orgId: string, perms: string[]
) {
  if (!perms.includes("export.request"))
    return errorResponse("No permission to request exports", 403);

  const { export_type, format = "csv", filters = {} } = body;
  if (!export_type) return errorResponse("Export type required", 400);

  const validTypes = ["daily_reports", "missing_reports", "task_progress",
    "attendance_summary", "leave_summary", "ticket_summary", "follow_up_report",
    "branch_report", "department_report", "org_daily_summary"];
  if (!validTypes.includes(export_type))
    return errorResponse("Invalid export type", 400);

  // Create export job
  const { data: job, error: jobError } = await supabase
    .from("export_jobs").insert({
      organization_id: orgId, requested_by: userId, export_type,
      filters, format, status: "processing", started_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    }).select().single();
  if (jobError) return errorResponse(`Failed to create export job: ${jobError.message}`, 500);

  // Generate CSV data
  let csvData = "";
  let rowCount = 0;

  switch (export_type) {
    case "daily_reports": {
      let query = supabase.from("daily_reports")
        .select("report_date, status, overall_summary, work_completed, blockers, submitted_at, reviewed_at")
        .eq("organization_id", orgId)
        .order("report_date", { ascending: false });
      if (filters.from_date) query = query.gte("report_date", filters.from_date);
      if (filters.to_date) query = query.lte("report_date", filters.to_date);
      const { data } = await query;
      csvData = toCsv(data || []);
      rowCount = data?.length || 0;
      break;
    }
    case "missing_reports": {
      const targetDate = filters.date || new Date().toISOString().slice(0, 10);
      const { data: reports } = await supabase
        .from("daily_reports").select("employee_id, report_date")
        .eq("organization_id", orgId).eq("report_date", targetDate);
      const reportedEmpIds = new Set((reports || []).map(r => r.employee_id));
      const { data: allEmps } = await supabase
        .from("employees").select("id, employee_code, first_name, last_name")
        .eq("organization_id", orgId).eq("is_active", true);
      const missing = (allEmps || []).filter(e => !reportedEmpIds.has(e.id))
        .map(e => ({ employee_code: e.employee_code, name: `${e.first_name} ${e.last_name}`, date: targetDate }));
      csvData = toCsv(missing);
      rowCount = missing.length;
      break;
    }
    case "task_progress": {
      const { data } = await supabase
        .from("tasks").select("task_code, title, status, priority, current_deadline, completed_at")
        .eq("organization_id", orgId).order("created_at", { ascending: false });
      csvData = toCsv(data || []);
      rowCount = data?.length || 0;
      break;
    }
    case "attendance_summary": {
      const { data } = await supabase
        .from("attendance_records").select("employee_id, attendance_date, status, check_in_time, check_out_time")
        .eq("organization_id", orgId);
      if (filters.from_date) data;
      csvData = toCsv(data || []);
      rowCount = data?.length || 0;
      break;
    }
    case "leave_summary": {
      const { data } = await supabase
        .from("leave_requests").select("employee_id, leave_type, from_date, to_date, status, created_at")
        .eq("organization_id", orgId);
      csvData = toCsv(data || []);
      rowCount = data?.length || 0;
      break;
    }
    case "ticket_summary": {
      const { data } = await supabase
        .from("tickets").select("ticket_code, title, status, priority, created_at, resolved_at")
        .eq("organization_id", orgId);
      csvData = toCsv(data || []);
      rowCount = data?.length || 0;
      break;
    }
    case "follow_up_report": {
      const { data } = await supabase
        .from("management_follow_ups")
        .select("subject, follow_up_type, priority, status, due_at, resolved_at, created_at")
        .eq("organization_id", orgId);
      csvData = toCsv(data || []);
      rowCount = data?.length || 0;
      break;
    }
    default: {
      csvData = toCsv([{ message: "Export type not yet implemented" }]);
      break;
    }
  }

  // Upload to storage
  const fileName = `${orgId}/${job.id}.csv`;
  const { error: uploadError } = await supabase.storage
    .from("export-files")
    .upload(fileName, csvData, { contentType: "text/csv" });

  if (uploadError) {
    await supabase.from("export_jobs").update({
      status: "failed", failure_reason: uploadError.message,
      completed_at: new Date().toISOString(),
    }).eq("id", job.id);
    return errorResponse(`Failed to upload export: ${uploadError.message}`, 500);
  }

  await supabase.from("export_jobs").update({
    status: "completed", storage_path: fileName,
    completed_at: new Date().toISOString(),
  }).eq("id", job.id);

  return successResponse({ message: "Export completed", job_id: job.id, rows: rowCount });
}

// ============================================================
// GET DOWNLOAD URL
// ============================================================
async function handleGetDownloadUrl(
  supabase: ReturnType<typeof createClient>,
  body: any, userId: string, orgId: string, perms: string[]
) {
  const { job_id } = body;
  if (!job_id) return errorResponse("Job ID required", 400);

  const { data: job } = await supabase
    .from("export_jobs").select("id, storage_path, status, expires_at, requested_by")
    .eq("id", job_id).eq("organization_id", orgId).single();
  if (!job) return errorResponse("Export job not found", 404);
  if (job.status !== "completed") return errorResponse("Export not completed", 400);
  if (job.requested_by !== userId && !perms.includes("export.audit_read"))
    return errorResponse("Not authorized to download this export", 403);

  if (job.expires_at && new Date(job.expires_at) < new Date())
    return errorResponse("Export has expired", 410);

  const { data, error } = await supabase.storage
    .from("export-files").createSignedUrl(job.storage_path, 300);

  if (error || !data) return errorResponse("Failed to generate download URL", 500);

  return successResponse({ download_url: data.signedUrl, expires_in_seconds: 300 });
}

// ============================================================
// CANCEL EXPORT
// ============================================================
async function handleCancelExport(
  supabase: ReturnType<typeof createClient>,
  body: any, userId: string, orgId: string, perms: string[]
) {
  const { job_id } = body;
  if (!job_id) return errorResponse("Job ID required", 400);

  const { data: job } = await supabase
    .from("export_jobs").select("id, status, requested_by")
    .eq("id", job_id).eq("organization_id", orgId).single();
  if (!job) return errorResponse("Export job not found", 404);
  if (job.requested_by !== userId && !perms.includes("export.audit_read"))
    return errorResponse("Not authorized", 403);
  if (!["queued", "processing"].includes(job.status))
    return errorResponse("Cannot cancel completed export", 400);

  await supabase.from("export_jobs").update({
    status: "cancelled", completed_at: new Date().toISOString(),
  }).eq("id", job_id);

  return successResponse({ message: "Export cancelled" });
}

// ============================================================
// CLEANUP (cron-triggered)
// ============================================================
async function handleCleanup() {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const now = new Date().toISOString();

  // Mark expired jobs
  const { data: expired } = await supabase
    .from("export_jobs")
    .select("id, storage_path")
    .lt("expires_at", now)
    .in("status", ["completed"]);

  for (const job of expired || []) {
    if (job.storage_path) {
      await supabase.storage.from("export-files").remove([job.storage_path]);
    }
    await supabase.from("export_jobs").update({ status: "expired" }).eq("id", job.id);
  }

  return new Response(JSON.stringify({
    message: "Cleanup completed",
    expired_count: expired?.length || 0,
  }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
