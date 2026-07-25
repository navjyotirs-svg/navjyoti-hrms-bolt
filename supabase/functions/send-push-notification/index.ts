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

    if (body.test) {
      return await sendTestPush(supabase, userId);
    }

    if (body.notificationId) {
      return await sendPushForNotification(supabase, body.notificationId);
    }

    return errorResponse("Invalid request: provide test=true or notificationId", 400);
  } catch (err) {
    return errorResponse(`Server error: ${(err as Error).message}`, 500);
  }
});

async function sendTestPush(supabase: any, userId: string): Promise<Response> {
  const { data: subs, error } = await supabase
    .from("push_subscriptions")
    .select("id, endpoint, p256dh_key, auth_key, vapid_key_fp")
    .eq("user_id", userId)
    .eq("is_active", true);

  if (error) return errorResponse("Failed to fetch subscriptions", 500);
  if (!subs || subs.length === 0) {
    return jsonResponse({
      success: false,
      message: "No active push subscriptions. Enable notifications first.",
      subscriptionsFound: 0,
      attempted: 0,
      sent: 0,
      failed: 0,
      invalidRemoved: 0,
      results: [{ statusCode: 0, errorCategory: "no_subscription" }],
      errorCategory: "no_subscription",
    });
  }

  const vapidConfig = validateVapidConfig();
  if ("errorCategory" in vapidConfig) {
    return jsonResponse({
      success: false,
      message: vapidConfig.message,
      subscriptionsFound: subs.length,
      attempted: 0,
      sent: 0,
      failed: 0,
      invalidRemoved: 0,
      results: [{ statusCode: 0, errorCategory: vapidConfig.errorCategory }],
      errorCategory: vapidConfig.errorCategory,
    });
  }

  const vapidKeyFp = vapidConfig.publicKey.slice(0, 16);
  const staleSubs = subs.filter((s: { vapid_key_fp?: string | null }) => s.vapid_key_fp && s.vapid_key_fp !== vapidKeyFp);
  const validSubs = subs.filter((s: { vapid_key_fp?: string | null }) => !s.vapid_key_fp || s.vapid_key_fp === vapidKeyFp);

  let invalidRemoved = 0;
  for (const sub of staleSubs) {
    await supabase
      .from("push_subscriptions")
      .update({ is_active: false, revoked_at: new Date().toISOString() })
      .eq("id", sub.id);
    invalidRemoved++;
  }

  if (validSubs.length === 0) {
    return jsonResponse({
      success: false,
      message: "Your push subscription was created with an older key and has been deactivated. Please repair your push subscription.",
      subscriptionsFound: subs.length,
      attempted: 0,
      sent: 0,
      failed: 0,
      invalidRemoved,
      results: [{ statusCode: 0, errorCategory: "vapid_key_mismatch" }],
      errorCategory: "vapid_key_mismatch",
    });
  }

  let sent = 0;
  let failed = 0;
  let deactivated = 0;
  const results: { statusCode: number; errorCategory: string }[] = [];

  for (const sub of validSubs) {
    const result = await sendWebPush(sub, {
      title: "Navjyoti HRMS Test",
      body: "Push notifications are working on this device.",
      category: "system",
      priority: "normal",
      actionUrl: "/settings",
      icon: "/icon-192.png",
      badge: "/badge-72.png",
    }, vapidConfig);

    results.push({ statusCode: result.statusCode, errorCategory: result.errorCategory });

    if (result.ok) {
      sent++;
    } else {
      failed++;
      if (result.deactivate) {
        deactivated++;
        await supabase
          .from("push_subscriptions")
          .update({ is_active: false, revoked_at: new Date().toISOString() })
          .eq("id", sub.id);
      }
    }
  }

  const message = sent > 0
    ? `Test push sent to ${sent} device(s).`
    : mapErrorCategoryToMessage(results[0]?.errorCategory || "temporary_failure");

  return jsonResponse({
    success: sent > 0,
    message,
    subscriptionsFound: subs.length,
    attempted: validSubs.length,
    sent,
    failed,
    invalidRemoved: invalidRemoved + deactivated,
    results,
    errorCategory: sent > 0 ? undefined : results[0]?.errorCategory,
  });
}

async function sendPushForNotification(supabase: any, notificationId: string): Promise<Response> {
  const { data: notif, error: notifErr } = await supabase
    .from("notifications")
    .select("id, recipient_id, title, message, priority, category, action_url")
    .eq("id", notificationId)
    .maybeSingle();

  if (notifErr || !notif) {
    return errorResponse("Notification not found", 404);
  }

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

  const { data: subs, error: subErr } = await supabase
    .from("push_subscriptions")
    .select("id, endpoint, p256dh_key, auth_key, vapid_key_fp")
    .eq("user_id", notif.recipient_id)
    .eq("is_active", true);

  if (subErr || !subs || subs.length === 0) {
    return jsonResponse({ success: false, message: "No active subscriptions" });
  }

  const vapidConfig = validateVapidConfig();
  if ("errorCategory" in vapidConfig) {
    return jsonResponse({ success: false, message: vapidConfig.message, errorCategory: vapidConfig.errorCategory });
  }

  const vapidKeyFp = vapidConfig.publicKey.slice(0, 16);
  const validSubs = subs.filter((s: { vapid_key_fp?: string | null }) => !s.vapid_key_fp || s.vapid_key_fp === vapidKeyFp);

  if (validSubs.length === 0) {
    return jsonResponse({ success: false, message: "All subscriptions have stale VAPID key" });
  }

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
  let deactivated = 0;

  for (const sub of validSubs) {
    const result = await sendWebPush(sub, {
      title: notif.title,
      body: notif.message,
      category: notif.category,
      priority: notif.priority,
      actionUrl: notif.action_url || "/notifications",
      notificationId: notif.id,
      icon: "/icon-192.png",
      badge: "/badge-72.png",
    }, vapidConfig);

    if (result.ok) {
      sent++;
    } else {
      failed++;
      if (result.deactivate) {
        deactivated++;
        await supabase
          .from("push_subscriptions")
          .update({ is_active: false, revoked_at: new Date().toISOString() })
          .eq("id", sub.id);
      }
    }
  }

  await supabase
    .from("notification_deliveries")
    .update({
      status: sent > 0 ? "sent" : "failed",
      delivered_at: sent > 0 ? new Date().toISOString() : null,
      last_attempt_at: new Date().toISOString(),
    })
    .eq("notification_id", notificationId)
    .eq("channel", "web_push");

  return jsonResponse({
    success: sent > 0,
    message: `Push sent to ${sent} device(s)`,
    sent,
    failed,
    deactivated,
  });
}

interface VapidConfig {
  publicKey: string;
  privateKey: string;
  subject: string;
}

type VapidConfigResult = VapidConfig | { errorCategory: string; message: string };

function validateVapidConfig(): VapidConfigResult {
  const privateKey = Deno.env.get("VAPID_PRIVATE_KEY");
  const publicKey = Deno.env.get("VAPID_PUBLIC_KEY");
  const subject = Deno.env.get("VAPID_SUBJECT") || "";

  if (!privateKey || !publicKey) {
    return { errorCategory: "missing_vapid", message: "Push service is not configured correctly. VAPID keys are missing." };
  }

  if (!subject) {
    return { errorCategory: "missing_vapid", message: "Push service is not configured correctly. VAPID subject is missing." };
  }

  if (!subject.startsWith("mailto:") && !subject.startsWith("https://")) {
    return { errorCategory: "invalid_vapid", message: "Push authentication configuration is invalid." };
  }

  try {
    const privBytes = base64UrlDecode(privateKey);
    if (privBytes.length !== 32) {
      return { errorCategory: "invalid_vapid", message: "Push authentication configuration is invalid." };
    }
    const pubBytes = base64UrlDecode(publicKey);
    if (pubBytes.length !== 65) {
      return { errorCategory: "invalid_vapid", message: "Push authentication configuration is invalid." };
    }
  } catch {
    return { errorCategory: "invalid_vapid", message: "Push authentication configuration is invalid." };
  }

  return { publicKey, privateKey, subject };
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

interface SendResult {
  ok: boolean;
  deactivate: boolean;
  statusCode: number;
  errorCategory: string;
}

async function sendWebPush(
  sub: { endpoint: string; p256dh_key: string; auth_key: string },
  payload: PushPayload,
  vapid: VapidConfig
): Promise<SendResult> {
  try {
    const jwt = await generateVapidJWT(sub.endpoint, vapid.subject, vapid.privateKey);
    const body = JSON.stringify(payload);

    const response = await fetch(sub.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "TTL": "2419200",
        "Authorization": `vapid t=${jwt},k=${vapid.publicKey}`,
        "Urgency": payload.priority === "urgent" ? "high" : "normal",
      },
      body,
    });

    if (response.ok || response.status === 201 || response.status === 202) {
      return { ok: true, deactivate: false, statusCode: response.status, errorCategory: "" };
    }

    if (response.status === 404 || response.status === 410) {
      return { ok: false, deactivate: true, statusCode: response.status, errorCategory: "expired_subscription" };
    }

    if (response.status === 401 || response.status === 403) {
      return { ok: false, deactivate: true, statusCode: response.status, errorCategory: "invalid_vapid" };
    }

    if (response.status === 400) {
      return { ok: false, deactivate: true, statusCode: response.status, errorCategory: "malformed_subscription" };
    }

    if (response.status === 429) {
      return { ok: false, deactivate: false, statusCode: response.status, errorCategory: "rate_limited" };
    }

    if (response.status >= 500) {
      return { ok: false, deactivate: false, statusCode: response.status, errorCategory: "provider_error" };
    }

    return { ok: false, deactivate: false, statusCode: response.status, errorCategory: "temporary_failure" };
  } catch (err) {
    const msg = (err as Error).message || "";
    if (msg.includes("timed out") || msg.includes("timeout")) {
      return { ok: false, deactivate: false, statusCode: 0, errorCategory: "timeout" };
    }
    if (msg.includes("network") || msg.includes("connect") || msg.includes("fetch")) {
      return { ok: false, deactivate: false, statusCode: 0, errorCategory: "network_error" };
    }
    return { ok: false, deactivate: false, statusCode: 0, errorCategory: "temporary_failure" };
  }
}

async function generateVapidJWT(
  endpoint: string,
  subject: string,
  privateKeyB64: string
): Promise<string> {
  const rawKey = base64UrlDecode(privateKeyB64);

  // Build PKCS#8 DER for ECDSA P-256 private key from raw 32-byte scalar.
  const oidEcPublicKey = new Uint8Array([0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01]);
  const oidSecp256r1 = new Uint8Array([0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07]);
  const innerOctetString = new Uint8Array([0x04, 0x20, ...rawKey]);
  const innerSeq = new Uint8Array([0x30, 0x26, 0x02, 0x01, 0x01, ...innerOctetString]);
  const outerOctetString = new Uint8Array([0x04, 0x28, ...innerSeq]);
  const algoSeq = new Uint8Array([0x30, 0x13, ...oidEcPublicKey, ...oidSecp256r1]);
  const pkcs8 = new Uint8Array([0x30, 0x74, 0x02, 0x01, 0x01, ...algoSeq, ...outerOctetString]);

  const key = await crypto.subtle.importKey(
    "pkcs8",
    pkcs8,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"]
  );

  const header = { typ: "JWT", alg: "ES256" };
  const now = Math.floor(Date.now() / 1000);
  const aud = new URL(endpoint).origin;
  const jwtPayload = { aud, exp: now + 12 * 60 * 60, sub: subject };

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

function mapErrorCategoryToMessage(category: string): string {
  switch (category) {
    case "missing_vapid":
      return "Push service is not configured correctly. VAPID keys are missing.";
    case "invalid_vapid":
      return "Push authentication configuration is invalid. Please contact support.";
    case "expired_subscription":
      return "This device subscription has expired. Please repair your push subscription.";
    case "malformed_subscription":
      return "This device subscription is malformed. Please repair your push subscription.";
    case "vapid_key_mismatch":
      return "Your push subscription was created with an older key. Please repair your push subscription.";
    case "rate_limited":
      return "Push provider rate limited this request. Please retry in a moment.";
    case "provider_error":
      return "Push provider returned an error. Please retry shortly.";
    case "timeout":
      return "Push request timed out. Please check your connection and retry.";
    case "network_error":
      return "Network error while contacting push provider. Please check your connection.";
    case "no_subscription":
      return "No active subscription was found. Enable notifications in Account Settings first.";
    case "temporary_failure":
    default:
      return "Push delivery is temporarily unavailable. Please retry.";
  }
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
