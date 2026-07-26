import { createClient } from "npm:@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, Apikey",
};

// Standard working duration: 9 hours (540 minutes) from check-in.
const STANDARD_SHIFT_MINUTES = 540;
// Reminder offsets (minutes before the expected checkout time).
const REMINDER_30_MINUTES = 30;
const REMINDER_10_MINUTES = 10;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const config = await loadAttendanceConfig(admin);
    const shiftMinutes = config.totalMinutes || STANDARD_SHIFT_MINUTES;

    const now = new Date();
    const { data: records, error } = await admin
      .from("attendance_records")
      .select(`
        id,
        employee_id,
        organization_id,
        check_in_at,
        required_checkout_at,
        checkout_reminder_30_sent_at,
        checkout_reminder_10_sent_at,
        checkout_due_notification_sent_at,
        employees!inner (
          user_id,
          organization_id
        )
      `)
      .eq("final_status", "PENDING_CHECKOUT")
      .is("check_out_at", null);

    if (error) {
      return jsonError(500, `Failed to fetch attendance records: ${error.message}`);
    }

    let reminder30Sent = 0;
    let reminder10Sent = 0;
    let dueSent = 0;
    let autoClosed = 0;

    for (const record of records ?? []) {
      const emp = record.employees as { user_id: string; organization_id: string };
      const expectedCheckout = new Date(record.required_checkout_at);
      const reminder30Time = new Date(expectedCheckout.getTime() - REMINDER_30_MINUTES * 60 * 1000);
      const reminder10Time = new Date(expectedCheckout.getTime() - REMINDER_10_MINUTES * 60 * 1000);

      // --- Notification 1: 30 minutes before expected checkout ---
      if (!record.checkout_reminder_30_sent_at && now >= reminder30Time) {
        const sent = await sendNotification(admin, {
          recipient_id: emp.user_id,
          dedupKey: `${record.id}:CHECKOUT_REMINDER_30`,
          notification_type: "ATTENDANCE_CHECKOUT_REMINDER_30",
          title: "Checkout Reminder",
          message: `Your required working hours will be completed at ${formatTime(expectedCheckout)}. Please remember to check out before leaving.`,
          priority: "high",
          metadata: { attendance_record_id: record.id, expected_checkout_at: record.required_checkout_at },
        });
        if (sent) {
          await admin.from("attendance_records")
            .update({ checkout_reminder_30_sent_at: now.toISOString() })
            .eq("id", record.id);
          reminder30Sent++;
        }
      }

      // --- Notification 2: 10 minutes before expected checkout ---
      if (!record.checkout_reminder_10_sent_at && now >= reminder10Time) {
        const sent = await sendNotification(admin, {
          recipient_id: emp.user_id,
          dedupKey: `${record.id}:CHECKOUT_REMINDER_10`,
          notification_type: "ATTENDANCE_CHECKOUT_REMINDER_10",
          title: "Checkout Approaching",
          message: "Your checkout time is approaching. Please complete your pending work and remember to check out.",
          priority: "high",
          metadata: { attendance_record_id: record.id, expected_checkout_at: record.required_checkout_at },
        });
        if (sent) {
          await admin.from("attendance_records")
            .update({ checkout_reminder_10_sent_at: now.toISOString() })
            .eq("id", record.id);
          reminder10Sent++;
        }
      }

      // --- Notification 3: at expected checkout time ---
      if (!record.checkout_due_notification_sent_at && now >= expectedCheckout) {
        const sent = await sendNotification(admin, {
          recipient_id: emp.user_id,
          dedupKey: `${record.id}:CHECKOUT_DUE`,
          notification_type: "ATTENDANCE_CHECKOUT_DUE",
          title: "Working Hours Completed — Check Out Now",
          message: "You have completed your required working hours. Please check out now to close today's attendance.",
          priority: "high",
          metadata: { attendance_record_id: record.id, expected_checkout_at: record.required_checkout_at },
        });
        if (sent) {
          await admin.from("attendance_records")
            .update({ checkout_due_notification_sent_at: now.toISOString() })
            .eq("id", record.id);
          dueSent++;
        }
      }

      // --- Automatic checkout at check_in + shiftMinutes ---
      // Priority rule: only close records that still have no manual checkout.
      // The UPDATE is guarded by `check_out_at IS NULL` so a manual checkout
      // that happened between our SELECT and UPDATE is never overwritten.
      if (now >= expectedCheckout) {
        const { data: updated, error: updateError } = await admin
          .from("attendance_records")
          .update({
            check_out_at: record.required_checkout_at,
            actual_elapsed_minutes: shiftMinutes,
            final_status: "FULL_DAY",
            checkout_type: "AUTO",
            checkout_status: "MISSED_CHECKOUT",
            status_reason: `Automatic checkout: employee did not manually check out. Closed at ${shiftMinutes} minutes (check-in + ${shiftMinutes} min).`,
          })
          .eq("id", record.id)
          .is("check_out_at", null)
          .eq("final_status", "PENDING_CHECKOUT")
          .select("id")
          .maybeSingle();

        if (!updateError && updated) {
          autoClosed++;
          // History + audit
          await admin.from("attendance_history").insert({
            attendance_record_id: record.id,
            employee_id: record.employee_id,
            event_type: "check_out",
            event_data: {
              check_out_at: record.required_checkout_at,
              elapsed_minutes: shiftMinutes,
              checkout_type: "AUTO",
              checkout_status: "MISSED_CHECKOUT",
              automatic: true,
            },
          });
          await admin.from("attendance_history").insert({
            attendance_record_id: record.id,
            employee_id: record.employee_id,
            event_type: "status_calculated",
            event_data: {
              final_status: "FULL_DAY",
              elapsed_minutes: shiftMinutes,
              required_total_minutes: shiftMinutes,
              checkout_type: "AUTO",
              checkout_status: "MISSED_CHECKOUT",
            },
          });
          await admin.from("audit_logs").insert({
            actor_id: null,
            action: "attendance.auto_checkout",
            entity_type: "attendance_record",
            entity_id: record.id,
            old_values: { final_status: "PENDING_CHECKOUT", checkout_status: "PENDING" },
            new_values: {
              check_out_at: record.required_checkout_at,
              elapsed_minutes: shiftMinutes,
              final_status: "FULL_DAY",
              checkout_type: "AUTO",
              checkout_status: "MISSED_CHECKOUT",
            },
          });
          // Notify the employee that attendance was auto-closed
          await sendNotification(admin, {
            recipient_id: emp.user_id,
            dedupKey: `${record.id}:AUTO_CHECKOUT_CLOSED`,
            notification_type: "ATTENDANCE_AUTO_CHECKOUT",
            title: "Attendance Auto-Closed",
            message: "Your attendance was automatically closed because you did not manually check out. You have been marked Present (Full Day).",
            priority: "normal",
            metadata: { attendance_record_id: record.id, checkout_type: "AUTO", checkout_status: "MISSED_CHECKOUT" },
          });
        }
      }
    }

    return jsonResponse(200, {
      message: "Scheduler run complete",
      records_checked: records?.length ?? 0,
      reminder_30_sent: reminder30Sent,
      reminder_10_sent: reminder10Sent,
      checkout_due_sent: dueSent,
      auto_checkouts: autoClosed,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return jsonError(500, message);
  }
});

async function sendNotification(
  admin: ReturnType<typeof createClient>,
  params: {
    recipient_id: string;
    dedupKey: string;
    notification_type: string;
    title: string;
    message: string;
    priority: string;
    metadata: Record<string, unknown>;
  }
): Promise<boolean> {
  const { error } = await admin.from("notifications").insert({
    recipient_id: params.recipient_id,
    notification_type: params.notification_type,
    title: params.title,
    message: params.message,
    priority: params.priority,
    category: "attendance",
    action_url: "/attendance",
    dedup_key: params.dedupKey,
    metadata: params.metadata,
  });
  return !error;
}

async function loadAttendanceConfig(admin: ReturnType<typeof createClient>): Promise<{
  testMode: boolean;
  isProduction: boolean;
  totalMinutes: number;
  preAlertMinutes: number;
}> {
  const { data, error } = await admin.rpc("get_attendance_config");
  if (error || !data) {
    return { testMode: false, isProduction: false, totalMinutes: STANDARD_SHIFT_MINUTES, preAlertMinutes: 2 };
  }

  const cfg = data as Record<string, string>;
  const testMode = cfg["ATTENDANCE_TEST_MODE"] === "true";
  const isProduction = cfg["SUPABASE_ENV"] === "production";
  const totalMinutes = parseInt(cfg["ATTENDANCE_TOTAL_MINUTES"] ?? String(STANDARD_SHIFT_MINUTES), 10);
  const preAlertMinutes = parseInt(cfg["ATTENDANCE_PRE_ALERT_MINUTES"] ?? "2", 10);

  return { testMode, isProduction, totalMinutes, preAlertMinutes };
}

function formatTime(ts: string | Date): string {
  return new Date(ts).toLocaleTimeString("en-IN", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
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
