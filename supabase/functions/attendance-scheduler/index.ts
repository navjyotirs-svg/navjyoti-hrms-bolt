import { createClient } from "npm:@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, Apikey",
};

const PRE_ALERT_MINUTES = 2;

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

    const now = new Date();
    const preAlertMinutes = parseInt(Deno.env.get("ATTENDANCE_PRE_ALERT_MINUTES") ?? String(PRE_ALERT_MINUTES), 10);

    // Find all PENDING_CHECKOUT records that need reminders
    const { data: records, error } = await admin
      .from("attendance_records")
      .select(`
        id,
        employee_id,
        check_in_at,
        required_checkout_at,
        pre_checkout_reminder_sent_at,
        checkout_ready_reminder_sent_at,
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

    let preCheckoutSent = 0;
    let checkoutReadySent = 0;

    for (const record of records ?? []) {
      const requiredCheckout = new Date(record.required_checkout_at);
      const preCheckoutTime = new Date(requiredCheckout.getTime() - preAlertMinutes * 60 * 1000);
      const emp = record.employees as { user_id: string; organization_id: string };

      // Pre-checkout reminder
      if (!record.pre_checkout_reminder_sent_at && now >= preCheckoutTime) {
        const dedupKey = `${record.id}:ATTENDANCE_PRE_CHECKOUT`;
        const { error: notifError } = await admin
          .from("notifications")
          .insert({
            recipient_id: emp.user_id,
            notification_type: "ATTENDANCE_PRE_CHECKOUT",
            title: "Checkout Approaching",
            message: "Your checkout time is approaching in 2 minutes. Please get ready to check out and ensure your daily report is submitted.",
            priority: "high",
            dedup_key: dedupKey,
            metadata: {
              attendance_record_id: record.id,
              required_checkout_at: record.required_checkout_at,
            },
          });

        if (!notifError) {
          await admin
            .from("attendance_records")
            .update({ pre_checkout_reminder_sent_at: now.toISOString() })
            .eq("id", record.id);
          preCheckoutSent++;
        }
      }

      // Checkout-ready reminder
      if (!record.checkout_ready_reminder_sent_at && now >= requiredCheckout) {
        const dedupKey = `${record.id}:ATTENDANCE_CHECKOUT_READY`;
        const { error: notifError } = await admin
          .from("notifications")
          .insert({
            recipient_id: emp.user_id,
            notification_type: "ATTENDANCE_CHECKOUT_READY",
            title: "Checkout Ready",
            message: "Your required attendance duration is complete. You may now check out.",
            priority: "high",
            dedup_key: dedupKey,
            metadata: {
              attendance_record_id: record.id,
              required_checkout_at: record.required_checkout_at,
            },
          });

        if (!notifError) {
          await admin
            .from("attendance_records")
            .update({ checkout_ready_reminder_sent_at: now.toISOString() })
            .eq("id", record.id);
          checkoutReadySent++;
        }
      }
    }

    return jsonResponse(200, {
      message: "Scheduler run complete",
      records_checked: records?.length ?? 0,
      pre_checkout_sent: preCheckoutSent,
      checkout_ready_sent: checkoutReadySent,
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
