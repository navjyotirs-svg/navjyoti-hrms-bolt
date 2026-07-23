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
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Get today's date in Kolkata timezone
    const now = new Date();
    const kolkataTime = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
    const today = kolkataTime.toISOString().slice(0, 10);
    const kolkataHour = kolkataTime.getHours();

    let remindersSent = 0;
    let missingReports = 0;
    let autoLateCount = 0;

    // 1. Send "report due" reminders before cutoff (if enabled)
    const { data: orgs } = await supabase
      .from("organizations")
      .select("id, name, require_daily_report, report_submission_cutoff_time, missing_report_reminder_enabled, late_report_allowed")
      .eq("require_daily_report", true);

    for (const org of orgs || []) {
      const cutoffTime = org.report_submission_cutoff_time || "18:00";
      const [cutoffHour] = cutoffTime.split(":").map(Number);

      // Get all active employees in this org
      const { data: employees } = await supabase
        .from("employees")
        .select("id, user_id")
        .eq("organization_id", org.id)
        .eq("is_active", true);

      for (const emp of employees || []) {
        // Check if report exists for today
        const { data: report } = await supabase
          .from("daily_reports")
          .select("id, status")
          .eq("employee_id", emp.id)
          .eq("report_date", today)
          .maybeSingle();

        if (!report && kolkataHour < cutoffHour) {
          // Send due reminder (idempotent)
          const dedupKey = `report_due:${emp.id}:${today}`;
          const { data: existing } = await supabase
            .from("notifications").select("id").eq("dedup_key", dedupKey).maybeSingle();
          if (!existing) {
            await supabase.from("notifications").insert({
              recipient_id: emp.user_id,
              notification_type: "daily_report_due",
              title: "Daily Report Due",
              message: `Your daily report for ${today} is due. Please submit before ${cutoffTime}.`,
              priority: "normal", dedup_key: dedupKey, category: "daily_report",
            });
            remindersSent++;
          }
        }

        if (!report && kolkataHour >= cutoffHour && org.missing_report_reminder_enabled) {
          // Send missing report reminder (idempotent)
          const dedupKey = `report_missing:${emp.id}:${today}`;
          const { data: existing } = await supabase
            .from("notifications").select("id").eq("dedup_key", dedupKey).maybeSingle();
          if (!existing) {
            await supabase.from("notifications").insert({
              recipient_id: emp.user_id,
              notification_type: "daily_report_missing",
              title: "Missing Daily Report",
              message: `Your daily report for ${today} was not submitted. Please submit it.`,
              priority: "high", dedup_key: dedupKey, category: "daily_report",
            });
            missingReports++;
          }
        }

        // Auto-submit draft reports as late after cutoff
        if (report && report.status === "draft" && kolkataHour >= cutoffHour && org.late_report_allowed) {
          await supabase.from("daily_reports").update({
            status: "late", submitted_at: new Date().toISOString(),
          }).eq("id", report.id);
          await supabase.from("daily_report_history").insert({
            daily_report_id: report.id, action: "auto_late",
            old_status: "draft", new_status: "late",
            actor_id: null, reason: "Auto-submitted as late after cutoff",
          });
          autoLateCount++;
        }
      }
    }

    // 2. Generate daily summary snapshot for orgs with consolidated reporting
    for (const org of orgs || []) {
      const { data: summary } = await supabase
        .from("daily_reports")
        .select("id, status, employee_id, branch_id, department_id, overall_summary, blockers, follow_up_required")
        .eq("organization_id", org.id)
        .eq("report_date", today);

      if (summary && summary.length > 0) {
        const checksum = await crypto.subtle.digest("SHA-256",
          new TextEncoder().encode(JSON.stringify(summary)));
        const checksumHex = Array.from(new Uint8Array(checksum))
          .map(b => b.toString(16).padStart(2, "0")).join("");

        await supabase.from("management_report_snapshots").insert({
          organization_id: org.id, report_type: "daily_summary", report_date: today,
          scope_type: "organization", scope_id: org.id,
          data_snapshot: { total_reports: summary.length,
            submitted: summary.filter(r => r.status === "submitted").length,
            approved: summary.filter(r => r.status === "approved").length,
            late: summary.filter(r => r.status === "late").length,
            missing: summary.filter(r => r.status === "missing").length,
            with_blockers: summary.filter(r => r.blockers).length,
            follow_ups_required: summary.filter(r => r.follow_up_required).length,
          }, checksum: checksumHex,
        });
      }
    }

    return new Response(JSON.stringify({
      message: "Report scheduler completed",
      reminders_sent: remindersSent, missing_reminders: missingReports,
      auto_late: autoLateCount, date: today,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
