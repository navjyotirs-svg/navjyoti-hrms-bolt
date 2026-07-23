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

    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: subs, error: subErr } = await adminClient
      .from("push_subscriptions")
      .select("id, endpoint, p256dh_key, auth_key")
      .eq("user_id", userId)
      .eq("is_active", true);

    if (subErr) {
      return jsonResponse({ success: false, message: "Failed to fetch subscriptions", errorCategory: "server_error" });
    }

    if (!subs || subs.length === 0) {
      return jsonResponse({
        success: false,
        message: "No active push subscriptions. Enable notifications first.",
        errorCategory: "no_subscription",
      });
    }

    const vapidConfig = validateVapidConfig();
    if ("errorCategory" in vapidConfig) {
      return jsonResponse({ success: false, message: vapidConfig.message, errorCategory: vapidConfig.errorCategory });
    }

    let sent = 0;
    let failed = 0;
    let deactivated = 0;
    let lastErrorCategory = "";

    for (const sub of subs) {
      const result = await sendWebPush(sub, {
        title: "Test Notification",
        body: "This is a test push notification from Navjyoti HRMS.",
        category: "system",
        priority: "normal",
        actionUrl: "/notifications",
        icon: "/icon-192.png",
        badge: "/badge-72.png",
      }, vapidConfig);

      if (result.ok) {
        sent++;
      } else {
        failed++;
        lastErrorCategory = result.errorCategory;
        if (result.deactivate) {
          deactivated++;
          await adminClient
            .from("push_subscriptions")
            .update({ is_active: false, revoked_at: new Date().toISOString() })
            .eq("id", sub.id);
        }
      }
    }

    const message = sent > 0
      ? `Test push sent to ${sent} device(s).`
      : mapErrorCategoryToMessage(lastErrorCategory);

    return jsonResponse({
      success: sent > 0,
      message,
      sent,
      failed,
      deactivated,
      errorCategory: sent > 0 ? undefined : lastErrorCategory,
    });
  } catch (err) {
    return errorResponse((err as Error).message, 500);
  }
});

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
    return { errorCategory: "missing_vapid", message: "Push service is not configured correctly." };
  }

  if (!subject) {
    return { errorCategory: "missing_vapid", message: "Push service is not configured correctly." };
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
  icon?: string;
  badge?: string;
}

async function sendWebPush(
  sub: { endpoint: string; p256dh_key: string; auth_key: string },
  payload: PushPayload,
  vapid: VapidConfig
): Promise<{ ok: boolean; deactivate: boolean; errorCategory: string }> {
  try {
    const jwt = await generateVapidJWT(sub.endpoint, vapid.subject, vapid.privateKey, vapid.publicKey);
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
      return { ok: true, deactivate: false, errorCategory: "" };
    }

    if (response.status === 404 || response.status === 410) {
      return { ok: false, deactivate: true, errorCategory: "expired_subscription" };
    }

    if (response.status === 401 || response.status === 403) {
      return { ok: false, deactivate: false, errorCategory: "invalid_vapid" };
    }

    return { ok: false, deactivate: false, errorCategory: "temporary_failure" };
  } catch {
    return { ok: false, deactivate: false, errorCategory: "temporary_failure" };
  }
}

async function generateVapidJWT(
  endpoint: string,
  subject: string,
  privateKeyB64: string,
  publicKeyB64: string
): Promise<string> {
  const rawKey = base64UrlDecode(privateKeyB64);

  const key = await crypto.subtle.importKey(
    "raw",
    rawKey,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"]
  );

  const header = { typ: "JWT", alg: "ES256" };
  const now = Math.floor(Date.now() / 1000);
  const aud = new URL(endpoint).origin;
  const jwtPayload = {
    aud,
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

function mapErrorCategoryToMessage(category: string): string {
  switch (category) {
    case "missing_vapid":
      return "Push service is not configured correctly.";
    case "invalid_vapid":
      return "Push authentication configuration is invalid.";
    case "expired_subscription":
      return "This device subscription has expired. Please register notifications again.";
    case "permission_denied":
      return "Browser notifications are blocked.";
    case "no_service_worker":
      return "Push service worker is not active on this device.";
    case "temporary_failure":
      return "Push delivery is temporarily unavailable. Please retry.";
    default:
      return "Push delivery failed. Please try again.";
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
