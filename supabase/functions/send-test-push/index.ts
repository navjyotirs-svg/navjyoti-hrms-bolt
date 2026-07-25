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

    // Check VAPID config first
    const vapidConfig = validateVapidConfig();
    if ("errorCategory" in vapidConfig) {
      return jsonResponse({
        success: false,
        message: vapidConfig.message,
        subscriptionsFound: 0,
        attempted: 0,
        sent: 0,
        failed: 0,
        invalidRemoved: 0,
        results: [],
        errorCategory: vapidConfig.errorCategory,
      });
    }

    const vapidKeyFp = vapidConfig.publicKey.slice(0, 16);

    const { data: subs, error: subErr } = await adminClient
      .from("push_subscriptions")
      .select("id, endpoint, p256dh_key, auth_key, vapid_key_fp")
      .eq("user_id", userId)
      .eq("is_active", true);

    if (subErr) {
      return jsonResponse({
        success: false,
        message: "Failed to fetch subscriptions from database.",
        subscriptionsFound: 0,
        attempted: 0,
        sent: 0,
        failed: 0,
        invalidRemoved: 0,
        results: [{ statusCode: 0, errorCategory: "server_error" }],
        errorCategory: "server_error",
      });
    }

    const subscriptionsFound = subs?.length ?? 0;

    if (!subs || subs.length === 0) {
      return jsonResponse({
        success: false,
        message: "No active subscription was found. Enable notifications in Account Settings first.",
        subscriptionsFound: 0,
        attempted: 0,
        sent: 0,
        failed: 0,
        invalidRemoved: 0,
        results: [{ statusCode: 0, errorCategory: "no_subscription" }],
        errorCategory: "no_subscription",
      });
    }

    // Detect VAPID key mismatch — subscriptions with old fingerprint need re-registration
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
      return jsonResponse({
        success: false,
        message: "Your push subscription was created with an older key and has been deactivated. Please repair your push subscription in Account Settings.",
        subscriptionsFound,
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
          await adminClient
            .from("push_subscriptions")
            .update({ is_active: false, revoked_at: new Date().toISOString() })
            .eq("id", sub.id);
        }
      }
    }

    const totalInvalidRemoved = invalidRemoved + deactivated;
    const message = sent > 0
      ? `Test push sent to ${sent} device(s).`
      : mapErrorCategoryToMessage(results[0]?.errorCategory || "temporary_failure");

    return jsonResponse({
      success: sent > 0,
      message,
      subscriptionsFound,
      attempted: validSubs.length,
      sent,
      failed,
      invalidRemoved: totalInvalidRemoved,
      results,
      errorCategory: sent > 0 ? undefined : results[0]?.errorCategory,
    });
  } catch (err) {
    return errorResponse(`Server error: ${(err as Error).message}`, 500);
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

/**
 * Generate a VAPID JWT for Web Push authentication.
 *
 * The VAPID private key is a 32-byte raw P-256 scalar stored as base64url.
 * Web Crypto's importKey for ECDSA private keys requires PKCS#8 DER format,
 * not raw scalar bytes. We construct a minimal PKCS#8 wrapper around the
 * raw key before importing it.
 */
async function generateVapidJWT(
  endpoint: string,
  subject: string,
  privateKeyB64: string
): Promise<string> {
  const rawKey = base64UrlDecode(privateKeyB64);

  // Construct PKCS#8 DER wrapper for a P-256 ECDSA private key.
  // The fixed prefix is the ASN.1 structure:
  //   SEQUENCE { INTEGER 1, SEQUENCE { OID secp256r1 }, OCTET STRING { ... } }
  // where the inner OCTET STRING contains the raw 32-byte scalar.
  const pkcs8Prefix = new Uint8Array([
    0x30, 0x77, 0x02, 0x01, 0x01, 0x04, 0x20,
    ...rawKey,
    0xa0, 0x0a, 0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07,
    0xa1, 0x42, 0x03, 0x40, 0x00,
    0x04,
  ]);

  // We need the public key bytes (65 bytes, uncompressed point) for the PKCS#8.
  // However, Web Crypto can import with just the private scalar if we use
  // the ECDSA import with "pkcs8" format and a proper PKCS#8 structure.
  // For VAPID, we only need the private key for signing — the public key is
  // sent separately in the Authorization header.

  // Actually, the simplest correct approach: use the JWK format for import.
  // P-256 private key JWK only needs: kty, crv, d (private scalar), x, y (public point).
  // But we don't have x, y from the raw private key alone.

  // Alternative: Use the raw scalar directly with a minimal PKCS#8 wrapper.
  // The PKCS#8 for ECDSA P-256 is:
  // SEQUENCE { version=1, privateKeyAlgorithm, privateKey }
  // We can build this with just the 32-byte scalar.

  // Build the full PKCS#8 DER manually:
  // SEQUENCE {
  //   INTEGER 1
  //   SEQUENCE { OID 1.2.840.10045.2.1 (ecPublicKey), OID 1.2.840.10045.3.1.7 (secp256r1) }
  //   OCTET STRING { SEQUENCE { INTEGER 1, OCTET STRING <32 bytes> } }
  // }

  const oidEcPublicKey = new Uint8Array([0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01]);
  const oidSecp256r1 = new Uint8Array([0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07]);

  // Inner: OCTET STRING containing the raw private key scalar
  const innerOctetString = new Uint8Array([0x04, 0x20, ...rawKey]);
  // Inner SEQUENCE { INTEGER 1, OCTET STRING }
  const innerSeq = new Uint8Array([0x30, 0x26, 0x02, 0x01, 0x01, ...innerOctetString]);
  // Outer OCTET STRING wrapping inner
  const outerOctetString = new Uint8Array([0x04, 0x28, ...innerSeq]);
  // Algorithm identifier SEQUENCE
  const algoSeq = new Uint8Array([0x30, 0x13, ...oidEcPublicKey, ...oidSecp256r1]);
  // Top-level SEQUENCE { INTEGER 1, algoSeq, outerOctetString }
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
      return "Push service is not configured correctly. VAPID keys are missing.";
    case "invalid_vapid":
      return "Push authentication configuration is invalid. Please contact support.";
    case "expired_subscription":
      return "This device subscription has expired. Please repair your push subscription.";
    case "malformed_subscription":
      return "This device subscription is malformed. Please repair your push subscription.";
    case "permission_denied":
      return "Browser notifications are blocked. Please allow notifications in your browser settings.";
    case "no_service_worker":
      return "Push service worker is not active on this device. Please reload the page.";
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
    case "server_error":
      return "Server error while processing push request. Please contact support.";
    case "temporary_failure":
    default:
      return "Push delivery is temporarily unavailable. Please retry.";
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
