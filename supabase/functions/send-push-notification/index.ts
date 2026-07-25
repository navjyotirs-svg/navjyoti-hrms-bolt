import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import webpush from "https://esm.sh/web-push@3.6.7";

const PUSH_FUNCTION_VERSION = "v4-webpush-lib";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface VapidConfig {
  publicKey: string;
  privateKey: string;
  subject: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  const correlationId = crypto.randomUUID();

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return json({ error: "Missing authorization header", correlationId }, 401);
    }

    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user) {
      return json({ error: "Not authenticated", correlationId }, 401);
    }

    const userId = userData.user.id;
    const body = await req.json().catch(() => ({}));

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    if (body.test) {
      return await sendTestPush(supabase, userId, correlationId);
    }

    if (body.notificationId) {
      return await sendPushForNotification(supabase, body.notificationId, correlationId);
    }

    return json({ error: "Invalid request: provide test=true or notificationId", correlationId }, 400);
  } catch (err) {
    return json({ error: `Server error: ${(err as Error).message}`, correlationId }, 500);
  }
});

async function sendTestPush(supabase: ReturnType<typeof createClient>, userId: string, correlationId: string): Promise<Response> {
  const { data: subs, error } = await supabase
    .from("push_subscriptions")
    .select("id, endpoint, p256dh_key, auth_key, vapid_key_fp")
    .eq("user_id", userId)
    .eq("is_active", true);

  if (error) return json({ error: "Failed to fetch subscriptions", correlationId }, 500);
  if (!subs || subs.length === 0) {
    return json({
      functionVersion: PUSH_FUNCTION_VERSION,
      correlationId,
      subscriptionsFound: 0,
      attempted: 0,
      sent: 0,
      failed: 0,
      invalidRemoved: 0,
      errorCategory: "NO_ACTIVE_SUBSCRIPTION",
      providerStatus: 0,
      message: "No active push subscriptions. Enable notifications first.",
    });
  }

  const vapidConfig = validateVapidConfig();
  if ("errorCategory" in vapidConfig) {
    return json({
      functionVersion: PUSH_FUNCTION_VERSION,
      correlationId,
      subscriptionsFound: subs.length,
      attempted: 0,
      sent: 0,
      failed: 0,
      invalidRemoved: 0,
      errorCategory: vapidConfig.errorCategory,
      providerStatus: 0,
      message: vapidConfig.message,
    });
  }

  webpush.setVapidDetails(vapidConfig.subject, vapidConfig.publicKey, vapidConfig.privateKey);

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
    return json({
      functionVersion: PUSH_FUNCTION_VERSION,
      correlationId,
      subscriptionsFound: subs.length,
      attempted: 0,
      sent: 0,
      failed: 0,
      invalidRemoved,
      errorCategory: "VAPID_KEY_INVALID",
      providerStatus: 0,
      message: "All subscriptions have stale VAPID key.",
    });
  }

  let sent = 0;
  let failed = 0;
  let deactivated = 0;
  let lastErrorCategory = "";
  let lastProviderStatus = 0;

  for (const sub of validSubs) {
    const pushSubscription = {
      endpoint: sub.endpoint,
      keys: { p256dh: sub.p256dh_key, auth: sub.auth_key },
    };

    const payload = JSON.stringify({
      title: "Navjyoti HRMS Test",
      body: "Push notifications are working on this device.",
      category: "system",
      priority: "normal",
      actionUrl: "/settings",
      icon: "/icon-192.png",
      badge: "/badge-72.png",
    });

    try {
      const response = await webpush.sendNotification(pushSubscription, payload, {
        TTL: 2419200,
        urgency: "normal",
      });

      if (response.statusCode === 201 || response.statusCode === 202 || response.statusCode === 200) {
        sent++;
      } else {
        failed++;
        lastProviderStatus = response.statusCode;
        lastErrorCategory = mapProviderStatus(response.statusCode);
        if (shouldDeactivate(lastErrorCategory)) {
          deactivated++;
          await supabase.from("push_subscriptions").update({ is_active: false, revoked_at: new Date().toISOString() }).eq("id", sub.id);
        }
      }
    } catch (err: unknown) {
      failed++;
      const we = err as { statusCode?: number; message?: string };
      lastProviderStatus = we.statusCode || 0;
      lastErrorCategory = mapProviderStatus(we.statusCode || 0);
      if (shouldDeactivate(lastErrorCategory)) {
        deactivated++;
        await supabase.from("push_subscriptions").update({ is_active: false, revoked_at: new Date().toISOString() }).eq("id", sub.id);
      }
    }
  }

  const success = sent > 0;
  return json({
    functionVersion: PUSH_FUNCTION_VERSION,
    correlationId,
    subscriptionsFound: subs.length,
    attempted: validSubs.length,
    sent,
    failed,
    invalidRemoved: invalidRemoved + deactivated,
    errorCategory: success ? "" : lastErrorCategory,
    providerStatus: lastProviderStatus,
    success,
    message: success ? `Test push sent to ${sent} device(s).` : mapErrorCategoryToMessage(lastErrorCategory || "UNKNOWN_SERVER_ERROR"),
  });
}

async function sendPushForNotification(supabase: ReturnType<typeof createClient>, notificationId: string, correlationId: string): Promise<Response> {
  const { data: notif, error: notifErr } = await supabase
    .from("notifications")
    .select("id, recipient_id, title, message, priority, category, action_url")
    .eq("id", notificationId)
    .maybeSingle();

  if (notifErr || !notif) {
    return json({ error: "Notification not found", correlationId }, 404);
  }

  const { data: prefs } = await supabase
    .from("notification_preferences")
    .select("push_enabled, attendance_push, task_push, leave_push, ticket_push, daily_report_push, calendar_push, announcement_push, security_push, quiet_hours_start, quiet_hours_end, timezone")
    .eq("user_id", notif.recipient_id)
    .maybeSingle();

  if (prefs) {
    if (!prefs.push_enabled) {
      return json({ success: false, message: "Push disabled in preferences", correlationId });
    }
    const categoryPushMap: Record<string, string> = {
      attendance: "attendance_push", task: "task_push", leave: "leave_push",
      ticket: "ticket_push", daily_report: "daily_report_push", follow_up: "daily_report_push",
      calendar: "calendar_push", announcement: "announcement_push",
      employee: "security_push", system: "security_push",
    };
    const pushField = categoryPushMap[notif.category];
    if (pushField && !prefs[pushField]) {
      return json({ success: false, message: `Push disabled for ${notif.category}`, correlationId });
    }

    if (prefs.quiet_hours_start && prefs.quiet_hours_end && notif.priority !== "urgent" && notif.priority !== "high") {
      const now = new Date();
      const tz = prefs.timezone || "Asia/Kolkata";
      const formatter = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false });
      const currentTime = formatter.format(now);
      if (isInQuietHours(currentTime, prefs.quiet_hours_start, prefs.quiet_hours_end)) {
        return json({ success: false, message: "Quiet hours active", correlationId });
      }
    }
  }

  const { data: subs, error: subErr } = await supabase
    .from("push_subscriptions")
    .select("id, endpoint, p256dh_key, auth_key, vapid_key_fp")
    .eq("user_id", notif.recipient_id)
    .eq("is_active", true);

  if (subErr || !subs || subs.length === 0) {
    return json({ success: false, message: "No active subscriptions", correlationId });
  }

  const vapidConfig = validateVapidConfig();
  if ("errorCategory" in vapidConfig) {
    return json({ success: false, message: vapidConfig.message, errorCategory: vapidConfig.errorCategory, correlationId });
  }

  webpush.setVapidDetails(vapidConfig.subject, vapidConfig.publicKey, vapidConfig.privateKey);

  const vapidKeyFp = vapidConfig.publicKey.slice(0, 16);
  const validSubs = subs.filter((s: { vapid_key_fp?: string | null }) => !s.vapid_key_fp || s.vapid_key_fp === vapidKeyFp);

  if (validSubs.length === 0) {
    return json({ success: false, message: "All subscriptions have stale VAPID key", correlationId });
  }

  const { data: existingDelivery } = await supabase
    .from("notification_deliveries")
    .select("id, status")
    .eq("notification_id", notificationId)
    .eq("channel", "web_push")
    .maybeSingle();

  if (existingDelivery && (existingDelivery.status === "sent" || existingDelivery.status === "delivered")) {
    return json({ success: true, message: "Push already sent", correlationId });
  }

  if (!existingDelivery) {
    await supabase.from("notification_deliveries").insert({
      notification_id: notificationId,
      channel: "web_push",
      recipient: notif.recipient_id,
      status: "processing",
      idempotency_key: `push-${notificationId}`,
    });
  }

  let sent = 0;
  let failed = 0;
  let deactivated = 0;

  for (const sub of validSubs) {
    const pushSubscription = {
      endpoint: sub.endpoint,
      keys: { p256dh: sub.p256dh_key, auth: sub.auth_key },
    };

    const payload = JSON.stringify({
      title: notif.title,
      body: notif.message,
      category: notif.category,
      priority: notif.priority,
      actionUrl: notif.action_url || "/notifications",
      notificationId: notif.id,
      icon: "/icon-192.png",
      badge: "/badge-72.png",
    });

    try {
      const response = await webpush.sendNotification(pushSubscription, payload, {
        TTL: 2419200,
        urgency: notif.priority === "urgent" ? "high" : "normal",
      });

      if (response.statusCode === 201 || response.statusCode === 202 || response.statusCode === 200) {
        sent++;
        await supabase.from("push_diagnostic_events").insert({
          correlation_id: correlationId,
          event_type: "PUSH_PROVIDER_ACCEPTED",
          notification_title: notif.title,
          action_route: notif.action_url || "/notifications",
        }).catch(() => {});
      } else {
        failed++;
        if (shouldDeactivate(mapProviderStatus(response.statusCode))) {
          deactivated++;
          await supabase.from("push_subscriptions").update({ is_active: false, revoked_at: new Date().toISOString() }).eq("id", sub.id);
        }
      }
    } catch (err: unknown) {
      failed++;
      const we = err as { statusCode?: number };
      if (shouldDeactivate(mapProviderStatus(we.statusCode || 0))) {
        deactivated++;
        await supabase.from("push_subscriptions").update({ is_active: false, revoked_at: new Date().toISOString() }).eq("id", sub.id);
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

  // Create supervisory notifications for Director/HR if this event is routed
  await createSupervisoryNotifications(supabase, notif, correlationId);

  return json({ success: sent > 0, message: `Push sent to ${sent} device(s)`, sent, failed, deactivated, correlationId });
}

async function createSupervisoryNotifications(supabase: ReturnType<typeof createClient>, notif: { id: string; recipient_id: string; title: string; message: string; priority: string; category: string; action_url: string | null }, correlationId: string): Promise<void> {
  try {
    // Look up the notification_type to check if it has supervisory routing
    const { data: notifWithType } = await supabase
      .from("notifications")
      .select("notification_type")
      .eq("id", notif.id)
      .maybeSingle();

    if (!notifWithType?.notification_type) return;

    // Check if this event code has supervisory routing configured
    const { data: routing } = await supabase
      .from("supervisory_notification_routing")
      .select("recipient_roles, channels")
      .eq("event_code", notifWithType.notification_type)
      .maybeSingle();

    if (!routing || !routing.recipient_roles || routing.recipient_roles.length === 0) return;

    // Find all users with the recipient roles in the same organization as the original recipient
    const { data: originalProfile } = await supabase
      .from("user_profiles")
      .select("organization_id")
      .eq("id", notif.recipient_id)
      .maybeSingle();

    if (!originalProfile?.organization_id) return;

    const { data: supervisors } = await supabase
      .from("user_profiles")
      .select("id")
      .eq("organization_id", originalProfile.organization_id)
      .in("role", routing.recipient_roles)
      .eq("status", "active")
      .neq("id", notif.recipient_id); // Don't notify the original recipient again

    if (!supervisors || supervisors.length === 0) return;

    // Create supervisory in-app notifications
    const supervisoryNotifs = supervisors.map((sup: { id: string }) => ({
      recipient_id: sup.id,
      notification_type: `SUPERVISORY_${notifWithType.notification_type}`,
      title: `[Supervisory] ${notif.title}`,
      message: notif.message,
      priority: notif.priority,
      category: notif.category,
      action_url: notif.action_url || "/notifications",
      dedup_key: `sup:${notif.id}:${sup.id}`,
      metadata: { supervisory: true, original_notification_id: notif.id, correlation_id: correlationId },
    }));

    await supabase.from("notifications").insert(supervisoryNotifs);
  } catch {
    // Supervisory notifications are best-effort — never block the main flow
  }
}

function validateVapidConfig(): VapidConfig | { errorCategory: string; message: string } {
  const privateKey = Deno.env.get("VAPID_PRIVATE_KEY");
  const publicKey = Deno.env.get("VAPID_PUBLIC_KEY");
  const subject = Deno.env.get("VAPID_SUBJECT") || "";

  if (!privateKey || !publicKey) {
    return { errorCategory: "VAPID_SECRET_MISSING", message: "VAPID keys are missing." };
  }
  if (!subject) {
    return { errorCategory: "VAPID_SECRET_MISSING", message: "VAPID subject is missing." };
  }
  if (!subject.startsWith("mailto:") && !subject.startsWith("https://")) {
    return { errorCategory: "VAPID_KEY_INVALID", message: "VAPID subject format is invalid." };
  }

  try {
    const privBytes = base64UrlDecode(privateKey);
    if (privBytes.length !== 32) return { errorCategory: "VAPID_KEY_INVALID", message: "VAPID private key is not 32 bytes." };
    const pubBytes = base64UrlDecode(publicKey);
    if (pubBytes.length !== 65) return { errorCategory: "VAPID_KEY_INVALID", message: "VAPID public key is not 65 bytes." };
  } catch {
    return { errorCategory: "VAPID_KEY_INVALID", message: "VAPID keys are not valid base64url." };
  }

  return { publicKey, privateKey, subject };
}

function shouldDeactivate(category: string): boolean {
  return category === "SUBSCRIPTION_EXPIRED" || category === "PUSH_PROVIDER_BAD_REQUEST" || category === "PUSH_PROVIDER_UNAUTHORIZED";
}

function mapProviderStatus(status: number): string {
  if (status === 404 || status === 410) return "SUBSCRIPTION_EXPIRED";
  if (status === 401 || status === 403) return "PUSH_PROVIDER_UNAUTHORIZED";
  if (status === 400) return "PUSH_PROVIDER_BAD_REQUEST";
  if (status === 429) return "PUSH_PROVIDER_RATE_LIMITED";
  if (status >= 500) return "PUSH_PROVIDER_ERROR";
  if (status === 0) return "NETWORK_TIMEOUT";
  return "UNKNOWN_SERVER_ERROR";
}

function mapErrorCategoryToMessage(category: string): string {
  switch (category) {
    case "VAPID_SECRET_MISSING": return "Push service is not configured. VAPID keys are missing.";
    case "VAPID_KEY_INVALID": return "Push authentication configuration is invalid. Please contact support.";
    case "SUBSCRIPTION_EXPIRED": return "This device subscription has expired. Please repair your push subscription.";
    case "PUSH_PROVIDER_BAD_REQUEST": return "The push provider rejected the request. Please repair your push subscription.";
    case "PUSH_PROVIDER_UNAUTHORIZED": return "Push provider rejected authentication. Please contact support.";
    case "PUSH_PROVIDER_RATE_LIMITED": return "Push provider rate limited this request. Please retry in a moment.";
    case "PUSH_PROVIDER_ERROR": return "Push provider returned an error. Please retry shortly.";
    case "NETWORK_TIMEOUT": return "Push request timed out. Please check your connection and retry.";
    case "NO_ACTIVE_SUBSCRIPTION": return "No active subscription found. Enable notifications in Account Settings first.";
    case "UNKNOWN_SERVER_ERROR":
    default: return "Push delivery failed. Please contact support if this persists.";
  }
}

function isInQuietHours(current: string, start: string, end: string): boolean {
  const toMinutes = (t: string) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
  const curr = toMinutes(current);
  const s = toMinutes(start);
  const e = toMinutes(end);
  if (s <= e) return curr >= s && curr < e;
  return curr >= s || curr < e;
}

function base64UrlDecode(str: string): Uint8Array {
  const padded = str + "=".repeat((4 - (str.length % 4)) % 4);
  const binary = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
