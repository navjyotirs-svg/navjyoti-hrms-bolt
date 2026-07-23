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

    // Verify the user is authenticated
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return errorResponse("Missing authorization header", 401);
    }

    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user) {
      return errorResponse("Not authenticated", 401);
    }

    const userId = userData.user.id;
    const body = await req.json().catch(() => ({}));

    // Handle test push: send only to the current user's subscriptions
    if (body.test) {
      return await sendTestPush(supabase, userId);
    }

    // Handle real notification delivery
    if (body.notificationId) {
      return await sendPushForNotification(supabase, body.notificationId);
    }

    return errorResponse("Invalid request: provide test=true or notificationId", 400);
  } catch (err) {
    return errorResponse((err as Error).message, 500);
  }
});

async function sendTestPush(supabase: any, userId: string): Promise<Response> {
  const { data: subs, error } = await supabase
    .from("push_subscriptions")
    .select("id, endpoint, p256dh_key, auth_key")
    .eq("user_id", userId)
    .eq("is_active", true);

  if (error) return errorResponse("Failed to fetch subscriptions", 500);
  if (!subs || subs.length === 0) {
    return jsonResponse({
      success: false,
      message: "No active push subscriptions. Enable notifications first.",
    });
  }

  let sent = 0;
  let failed = 0;
  for (const sub of subs) {
    const result = await sendWebPush(sub, {
      title: "Test Notification",
      body: "This is a test push notification from Navjyoti HRMS.",
      category: "system",
      priority: "normal",
      actionUrl: "/notifications",
      icon: "/icon-192.png",
      badge: "/badge-72.png",
    });
    if (result.ok) sent++;
    else {
      failed++;
      if (result.deactivate) {
        await supabase
          .from("push_subscriptions")
          .update({ is_active: false, revoked_at: new Date().toISOString() })
          .eq("id", sub.id);
      }
    }
  }

  return jsonResponse({ success: true, message: `Test push sent to ${sent} device(s).`, sent, failed });
}

async function sendPushForNotification(supabase: any, notificationId: string): Promise<Response> {
  // Load the notification
  const { data: notif, error: notifErr } = await supabase
    .from("notifications")
    .select("id, recipient_id, title, message, priority, category, action_url")
    .eq("id", notificationId)
    .maybeSingle();

  if (notifErr || !notif) {
    return errorResponse("Notification not found", 404);
  }

  // Check user push preferences
  const { data: prefs } = await supabase
    .from("notification_preferences")
    .select("push_enabled, attendance_push, task_push, leave_push, ticket_push, daily_report_push, calendar_push, announcement_push, security_push, quiet_hours_start, quiet_hours_end, timezone")
    .eq("user_id", notif.recipient_id)
    .maybeSingle();

  if (prefs) {
    if (!prefs.push_enabled) {
      return jsonResponse({ success: false, message: "Push disabled in preferences" });
    }
    const categoryPushMap: Record<string, string> = {
      attendance: "attendance_push",
      task: "task_push",
      leave: "leave_push",
      ticket: "ticket_push",
      daily_report: "daily_report_push",
      follow_up: "daily_report_push",
      calendar: "calendar_push",
      announcement: "announcement_push",
      employee: "security_push",
      system: "security_push",
    };
    const pushField = categoryPushMap[notif.category];
    if (pushField && !prefs[pushField]) {
      return jsonResponse({ success: false, message: `Push disabled for ${notif.category} category` });
    }

    // Check quiet hours (non-urgent only)
    if (prefs.quiet_hours_start && prefs.quiet_hours_end && notif.priority !== "urgent" && notif.priority !== "high") {
      const now = new Date();
      const tz = prefs.timezone || "Asia/Kolkata";
      const formatter = new Intl.DateTimeFormat("en-US", {
        timeZone: tz,
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });
      const currentTime = formatter.format(now);
      const inQuietHours = isInQuietHours(currentTime, prefs.quiet_hours_start, prefs.quiet_hours_end);
      if (inQuietHours) {
        return jsonResponse({ success: false, message: "Quiet hours active — push delayed" });
      }
    }
  }

  // Load active subscriptions for the recipient
  const { data: subs, error: subErr } = await supabase
    .from("push_subscriptions")
    .select("id, endpoint, p256dh_key, auth_key")
    .eq("user_id", notif.recipient_id)
    .eq("is_active", true);

  if (subErr || !subs || subs.length === 0) {
    return jsonResponse({ success: false, message: "No active subscriptions" });
  }

  // Create delivery record
  const idempotencyKey = `push-${notificationId}`;
  const { data: existingDelivery } = await supabase
    .from("notification_deliveries")
    .select("id, status")
    .eq("notification_id", notificationId)
    .eq("channel", "web_push")
    .maybeSingle();

  if (existingDelivery && (existingDelivery.status === "sent" || existingDelivery.status === "delivered")) {
    return jsonResponse({ success: true, message: "Push already sent for this notification" });
  }

  if (!existingDelivery) {
    await supabase.from("notification_deliveries").insert({
      notification_id: notificationId,
      channel: "web_push",
      recipient: notif.recipient_id,
      status: "processing",
      idempotency_key: idempotencyKey,
    });
  }

  let sent = 0;
  let failed = 0;
  for (const sub of subs) {
    const result = await sendWebPush(sub, {
      title: notif.title,
      body: notif.message,
      category: notif.category,
      priority: notif.priority,
      actionUrl: notif.action_url || "/notifications",
      notificationId: notif.id,
      icon: "/icon-192.png",
      badge: "/badge-72.png",
    });
    if (result.ok) sent++;
    else {
      failed++;
      if (result.deactivate) {
        await supabase
          .from("push_subscriptions")
          .update({ is_active: false, revoked_at: new Date().toISOString() })
          .eq("id", sub.id);
      }
    }
  }

  // Update delivery record
  await supabase
    .from("notification_deliveries")
    .update({
      status: sent > 0 ? "sent" : "failed",
      delivered_at: sent > 0 ? new Date().toISOString() : null,
      last_attempt_at: new Date().toISOString(),
    })
    .eq("notification_id", notificationId)
    .eq("channel", "web_push");

  return jsonResponse({ success: sent > 0, message: `Push sent to ${sent} device(s)`, sent, failed });
}

interface PushPayload {
  title: string;
  body: string;
  category: string;
  priority: string;
  actionUrl: string;
  notificationId?: string;
  icon?: string;
  badge?: string;
}

async function sendWebPush(
  sub: { endpoint: string; p256dh_key: string; auth_key: string },
  payload: PushPayload
): Promise<{ ok: boolean; deactivate: boolean }> {
  const vapidPrivateKey = Deno.env.get("VAPID_PRIVATE_KEY");
  const vapidSubject = Deno.env.get("VAPID_SUBJECT") || "mailto:admin@navjyoti.org";

  if (!vapidPrivateKey) {
    return { ok: false, deactivate: false };
  }

  try {
    // Generate VAPID JWT
    const jwt = await generateVapidJWT(vapidSubject, vapidPrivateKey);

    // Build the push request
    const body = JSON.stringify(payload);
    const response = await fetch(sub.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "TTL": "2419200",
        "Authorization": `vapid t=${jwt},k=${Deno.env.get("VAPID_PUBLIC_KEY")}`,
        "Urgency": payload.priority === "urgent" ? "high" : "normal",
      },
      body,
    });

    if (response.ok || response.status === 201 || response.status === 202) {
      return { ok: true, deactivate: false };
    }

    // 404 or 410 means subscription is gone — deactivate
    if (response.status === 404 || response.status === 410) {
      return { ok: false, deactivate: true };
    }

    return { ok: false, deactivate: false };
  } catch {
    return { ok: false, deactivate: false };
  }
}

async function generateVapidJWT(subject: string, privateKeyB64: string): Promise<string> {
  // Decode the private key
  const rawKey = base64UrlDecode(privateKeyB64);

  // Import the key
  const key = await crypto.subtle.importKey(
    "pkcs8",
    rawKey,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"]
  );

  // Create JWT header and payload
  const header = { typ: "JWT", alg: "ES256" };
  const now = Math.floor(Date.now() / 1000);
  const jwtPayload = {
    aud: new URL("https://fcm.googleapis.com").origin,
    exp: now + 12 * 60 * 60,
    sub: subject,
  };

  const enc = new TextEncoder();
  const headerB64 = base64UrlEncode(enc.encode(JSON.stringify(header)));
  const payloadB64 = base64UrlEncode(enc.encode(JSON.stringify(jwtPayload)));
  const signingInput = `${headerB64}.${payloadB64}`;

  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    enc.encode(signingInput)
  );

  const signatureB64 = base64UrlEncode(new Uint8Array(signature));
  return `${signingInput}.${signatureB64}`;
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(str: string): Uint8Array {
  const padded = str + "=".repeat((4 - (str.length % 4)) % 4);
  const binary = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function isInQuietHours(current: string, start: string, end: string): boolean {
  const toMinutes = (t: string) => {
    const [h, m] = t.split(":").map(Number);
    return h * 60 + m;
  };
  const curr = toMinutes(current);
  const s = toMinutes(start);
  const e = toMinutes(end);
  if (s <= e) {
    return curr >= s && curr < e;
  } else {
    return curr >= s || curr < e;
  }
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function errorResponse(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
