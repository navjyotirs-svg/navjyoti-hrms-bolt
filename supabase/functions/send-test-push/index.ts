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

interface StructuredResult {
  functionVersion: string;
  correlationId: string;
  subscriptionsFound: number;
  attempted: number;
  sent: number;
  failed: number;
  invalidRemoved: number;
  errorCategory: string;
  providerStatus: number;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  const correlationId = crypto.randomUUID();
  const baseResult: StructuredResult = {
    functionVersion: PUSH_FUNCTION_VERSION,
    correlationId,
    subscriptionsFound: 0,
    attempted: 0,
    sent: 0,
    failed: 0,
    invalidRemoved: 0,
    errorCategory: "",
    providerStatus: 0,
  };

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return json({ ...baseResult, errorCategory: "AUTHENTICATION_FAILED", message: "Missing authorization header" }, 401);
    }

    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user) {
      return json({ ...baseResult, errorCategory: "AUTHENTICATION_FAILED", message: "Not authenticated" }, 401);
    }

    const userId = userData.user.id;

    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // 1. Validate VAPID config
    const vapidConfig = validateVapidConfig();
    if ("errorCategory" in vapidConfig) {
      return json({ ...baseResult, errorCategory: vapidConfig.errorCategory, message: vapidConfig.message });
    }

    // Configure web-push library
    webpush.setVapidDetails(
      vapidConfig.subject,
      vapidConfig.publicKey,
      vapidConfig.privateKey
    );

    const vapidKeyFp = vapidConfig.publicKey.slice(0, 16);

    // 2. Fetch active subscriptions
    const { data: subs, error: subErr } = await adminClient
      .from("push_subscriptions")
      .select("id, endpoint, p256dh_key, auth_key, vapid_key_fp")
      .eq("user_id", userId)
      .eq("is_active", true);

    if (subErr) {
      return json({ ...baseResult, errorCategory: "UNKNOWN_SERVER_ERROR", message: "Failed to fetch subscriptions" }, 500);
    }

    const subscriptionsFound = subs?.length ?? 0;

    if (!subs || subs.length === 0) {
      return json({ ...baseResult, errorCategory: "NO_ACTIVE_SUBSCRIPTION", message: "No active subscription found. Enable notifications in Account Settings first." });
    }

    // 3. Detect VAPID key mismatch
    const staleSubs = subs.filter((s: { vapid_key_fp?: string | null }) => s.vapid_key_fp && s.vapid_key_fp !== vapidKeyFp);
    const validSubs = subs.filter((s: { vapid_key_fp?: string | null }) => !s.vapid_key_fp || s.vapid_key_fp === vapidKeyFp);

    let invalidRemoved = 0;
    for (const sub of staleSubs) {
      await adminClient
        .from("push_subscriptions")
        .update({ is_active: false, revoked_at: new Date().toISOString() })
        .eq("id", sub.id);
      invalidRemoved++;
    }

    if (validSubs.length === 0) {
      return json({
        ...baseResult,
        subscriptionsFound,
        invalidRemoved,
        errorCategory: "VAPID_KEY_INVALID",
        message: "Your push subscription was created with an older key. Please repair your push subscription.",
      });
    }

    // 4. Send push to each valid subscription
    let sent = 0;
    let failed = 0;
    let deactivated = 0;
    let lastErrorCategory = "";
    let lastProviderStatus = 0;

    for (const sub of validSubs) {
      const pushSubscription = {
        endpoint: sub.endpoint,
        keys: {
          p256dh: sub.p256dh_key,
          auth: sub.auth_key,
        },
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
          await adminClient.from("push_diagnostic_events").insert({
            correlation_id: correlationId,
            event_type: "PUSH_PROVIDER_ACCEPTED",
            notification_title: "Navjyoti HRMS Test",
            action_route: "/settings",
          }).catch(() => {});
        } else {
          failed++;
          lastProviderStatus = response.statusCode;
          const category = mapProviderStatus(response.statusCode);
          lastErrorCategory = category;

          if (category === "SUBSCRIPTION_EXPIRED" || category === "PUSH_PROVIDER_BAD_REQUEST" || category === "PUSH_PROVIDER_UNAUTHORIZED") {
            deactivated++;
            await adminClient
              .from("push_subscriptions")
              .update({ is_active: false, revoked_at: new Date().toISOString() })
              .eq("id", sub.id);
          }
        }
      } catch (err: unknown) {
        failed++;
        const we = err as { statusCode?: number; body?: unknown; message?: string };
        lastProviderStatus = we.statusCode || 0;
        lastErrorCategory = mapProviderStatus(we.statusCode || 0);

        if (lastErrorCategory === "SUBSCRIPTION_EXPIRED" || lastErrorCategory === "PUSH_PROVIDER_BAD_REQUEST" || lastErrorCategory === "PUSH_PROVIDER_UNAUTHORIZED") {
          deactivated++;
          await adminClient
            .from("push_subscriptions")
            .update({ is_active: false, revoked_at: new Date().toISOString() })
            .eq("id", sub.id);
        }
      }
    }

    const totalInvalidRemoved = invalidRemoved + deactivated;
    const success = sent > 0;
    const message = success
      ? `Test push sent to ${sent} device(s).`
      : mapErrorCategoryToMessage(lastErrorCategory || "UNKNOWN_SERVER_ERROR");

    return json({
      ...baseResult,
      subscriptionsFound,
      attempted: validSubs.length,
      sent,
      failed,
      invalidRemoved: totalInvalidRemoved,
      errorCategory: success ? "" : lastErrorCategory,
      providerStatus: lastProviderStatus,
      success,
      message,
    });
  } catch (err) {
    return json({
      ...baseResult,
      errorCategory: "UNKNOWN_SERVER_ERROR",
      message: `Server error: ${(err as Error).message}`,
    }, 500);
  }
});

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
    if (privBytes.length !== 32) {
      return { errorCategory: "VAPID_KEY_INVALID", message: "VAPID private key is not 32 bytes." };
    }
    const pubBytes = base64UrlDecode(publicKey);
    if (pubBytes.length !== 65) {
      return { errorCategory: "VAPID_KEY_INVALID", message: "VAPID public key is not 65 bytes." };
    }
  } catch {
    return { errorCategory: "VAPID_KEY_INVALID", message: "VAPID keys are not valid base64url." };
  }

  return { publicKey, privateKey, subject };
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
    case "VAPID_SECRET_MISSING":
      return "Push service is not configured. VAPID keys are missing.";
    case "VAPID_KEY_INVALID":
      return "Push authentication configuration is invalid. Please contact support.";
    case "VAPID_SIGNING_FAILED":
      return "Push authentication signing failed. Please contact support.";
    case "PAYLOAD_ENCRYPTION_FAILED":
      return "Push payload encryption failed. Please contact support.";
    case "SUBSCRIPTION_EXPIRED":
      return "This device subscription has expired. Please repair your push subscription.";
    case "PUSH_PROVIDER_BAD_REQUEST":
      return "The push provider rejected the request. Please repair your push subscription.";
    case "PUSH_PROVIDER_UNAUTHORIZED":
      return "Push provider rejected authentication. Please contact support.";
    case "PUSH_PROVIDER_RATE_LIMITED":
      return "Push provider rate limited this request. Please retry in a moment.";
    case "PUSH_PROVIDER_ERROR":
      return "Push provider returned an error. Please retry shortly.";
    case "NETWORK_TIMEOUT":
      return "Push request timed out. Please check your connection and retry.";
    case "NO_ACTIVE_SUBSCRIPTION":
      return "No active subscription found. Enable notifications in Account Settings first.";
    case "AUTHENTICATION_FAILED":
      return "Authentication failed. Please sign in again.";
    case "UNKNOWN_SERVER_ERROR":
    default:
      return "Push delivery failed. Please contact support if this persists.";
  }
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

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
