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

    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) return errorResponse("Unauthorized", 401);

    const { data: profile } = await supabase
      .from("user_profiles")
      .select("id, organization_id, status, is_active")
      .eq("id", user.id).single();
    if (!profile || profile.status !== "active" || !profile.is_active)
      return errorResponse("Account not active", 403);

    const { data: perms } = await supabase.rpc("get_effective_permissions", { p_user_id: user.id });
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
  const hasExportPermission =
    perms.includes("export.organization") ||
    perms.includes("export.team") ||
    perms.includes("export.self");
  if (!hasExportPermission)
    return errorResponse("No permission to request exports", 403);

  const { export_type, format = "csv", filters = {} } = body;
  if (!export_type) return errorResponse("Export type required", 400);

  const validTypes = ["daily_reports", "missing_reports", "task_progress",
    "attendance_summary", "leave_summary", "ticket_summary", "follow_up_report",
    "branch_report", "department_report", "org_daily_summary"];
  if (!validTypes.includes(export_type))
    return errorResponse("Invalid export type", 400);

  // Date range validation
  if (filters.from_date && filters.to_date) {
    if (new Date(filters.from_date as string) > new Date(filters.to_date as string))
      return errorResponse("From date cannot be after to date", 400);
  }
  const MAX_RANGE_DAYS = 365;
  if (filters.from_date && filters.to_date) {
    const diffMs = new Date(filters.to_date as string).getTime() - new Date(filters.from_date as string).getTime();
    const diffDays = diffMs / (1000 * 60 * 60 * 24);
    if (diffDays > MAX_RANGE_DAYS)
      return errorResponse(`Date range exceeds maximum of ${MAX_RANGE_DAYS} days`, 400);
  }

  // Create export job (status queued, then processing)
  const { data: job, error: jobError } = await supabase
    .from("export_jobs").insert({
      organization_id: orgId, requested_by: userId, export_type,
      filters, format, status: "queued",
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    }).select().single();
  if (jobError) return errorResponse(`Failed to create export job: ${jobError.message}`, 500);

  // Transition to processing
  await supabase.from("export_jobs").update({
    status: "processing", started_at: new Date().toISOString(),
  }).eq("id", job.id);

  // Audit record for export request
  await supabase.from("audit_logs").insert({
    actor_id: userId,
    action: "export.requested",
    entity_type: "export_job",
    entity_id: job.id,
    new_values: { export_type, format, filters },
  });

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
      let attQuery = supabase
        .from("attendance_records")
        .select(`
          employee_id, attendance_date, final_status, check_in_at, check_out_at,
          actual_elapsed_minutes, correction_version,
          employees!inner (employee_code, full_name, branches (name), departments (name))
        `)
        .eq("organization_id", orgId);
      if (filters.from_date) attQuery = attQuery.gte("attendance_date", filters.from_date);
      if (filters.to_date) attQuery = attQuery.lte("attendance_date", filters.to_date);
      const { data: attData } = await attQuery.order("attendance_date", { ascending: false });
      const attRows = (attData || []).map((r: any) => ({
        employee_code: r.employees?.employee_code ?? "",
        employee_name: r.employees?.full_name ?? "",
        branch: r.employees?.branches?.name ?? "",
        department: r.employees?.departments?.name ?? "",
        date: r.attendance_date,
        check_in: r.check_in_at ?? "",
        check_out: r.check_out_at ?? "",
        total_minutes: r.actual_elapsed_minutes ?? "",
        status: r.final_status ?? "",
        correction_version: r.correction_version ?? 0,
      }));
      csvData = toCsv(attRows);
      rowCount = attRows.length;
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

  // Upload to storage (with UTF-8 BOM for spreadsheet compatibility)
  const fileName = `${orgId}/${job.id}.csv`;
  const { error: uploadError } = await supabase.storage
    .from("export-files")
    .upload(fileName, `\uFEFF${csvData}`, { contentType: "text/csv; charset=utf-8" });

  if (uploadError) {
    await supabase.from("export_jobs").update({
      status: "failed", failure_reason: uploadError.message,
      completed_at: new Date().toISOString(),
    }).eq("id", job.id);

    await supabase.from("audit_logs").insert({
      actor_id: userId,
      action: "export.failed",
      entity_type: "export_job",
      entity_id: job.id,
      new_values: { export_type, error: uploadError.message },
    });

    // Notify the requesting user that the export failed
    await supabase.from("notifications").insert({
      recipient_id: userId,
      notification_type: "EXPORT_FAILED",
      title: "Export Failed",
      message: "Your export request could not be completed. Please try again or contact support.",
      priority: "high",
      category: "system",
      action_url: "/export-center",
      dedup_key: `export:${job.id}:failed`,
      metadata: { job_id: job.id, export_type },
    });

    return errorResponse(`Failed to upload export: ${uploadError.message}`, 500);
  }

  await supabase.from("export_jobs").update({
    status: "completed", storage_path: fileName,
    completed_at: new Date().toISOString(),
  }).eq("id", job.id);

  // Audit record for export completion
  await supabase.from("audit_logs").insert({
    actor_id: userId,
    action: "export.completed",
    entity_type: "export_job",
    entity_id: job.id,
    new_values: { export_type, format, rows: rowCount, storage_path: fileName },
  });

  // Notify the requesting user that the export is ready
  await supabase.from("notifications").insert({
    recipient_id: userId,
    notification_type: "EXPORT_COMPLETED",
    title: "Export Ready",
    message: "Your export is ready to download from the Export Center.",
    priority: "normal",
    category: "system",
    action_url: "/export-center",
    dedup_key: `export:${job.id}:completed`,
    metadata: { job_id: job.id, export_type, rows: rowCount },
  });

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
  const canDownload =
    job.requested_by === userId ||
    perms.includes("export.audit_read") ||
    perms.includes("export.organization") ||
    perms.includes("export.team");
  if (!canDownload)
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
  const canCancel =
    job.requested_by === userId ||
    perms.includes("export.audit_read") ||
    perms.includes("export.organization");
  if (!canCancel)
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
