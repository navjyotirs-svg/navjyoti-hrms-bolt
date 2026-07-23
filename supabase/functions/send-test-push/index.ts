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

    // Verify the user is authenticated
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

    // Use service-role client to read subscriptions (keys are sensitive)
    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Load active subscriptions for the current user only
    const { data: subs, error: subErr } = await adminClient
      .from("push_subscriptions")
      .select("id, endpoint, p256dh_key, auth_key")
      .eq("user_id", userId)
      .eq("is_active", true);

    if (subErr) {
      return errorResponse("Failed to fetch subscriptions", 500);
    }

    if (!subs || subs.length === 0) {
      return jsonResponse({
        success: false,
        message: "No active push subscriptions. Enable notifications first.",
      });
    }

    const vapidPrivateKey = Deno.env.get("VAPID_PRIVATE_KEY");
    const vapidPublicKey = Deno.env.get("VAPID_PUBLIC_KEY");
    const vapidSubject = Deno.env.get("VAPID_SUBJECT") || "mailto:admin@navjyoti.org";

    if (!vapidPrivateKey || !vapidPublicKey) {
      return errorResponse("VAPID keys not configured", 500);
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
      }, vapidPrivateKey, vapidPublicKey, vapidSubject);

      if (result.ok) {
        sent++;
      } else {
        failed++;
        if (result.deactivate) {
          await adminClient
            .from("push_subscriptions")
            .update({ is_active: false, revoked_at: new Date().toISOString() })
            .eq("id", sub.id);
        }
      }
    }

    return jsonResponse({
      success: sent > 0,
      message: sent > 0
        ? `Test push sent to ${sent} device(s).`
        : "Failed to send push. Check browser notification settings.",
      sent,
      failed,
    });
  } catch (err) {
    return errorResponse((err as Error).message, 500);
  }
});

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
  vapidPrivateKey: string,
  vapidPublicKey: string,
  vapidSubject: string
): Promise<{ ok: boolean; deactivate: boolean }> {
  try {
    const jwt = await generateVapidJWT(vapidSubject, vapidPrivateKey);
    const body = JSON.stringify(payload);

    const response = await fetch(sub.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "TTL": "2419200",
        "Authorization": `vapid t=${jwt},k=${vapidPublicKey}`,
        "Urgency": payload.priority === "urgent" ? "high" : "normal",
      },
      body,
    });

    if (response.ok || response.status === 201 || response.status === 202) {
      return { ok: true, deactivate: false };
    }

    if (response.status === 404 || response.status === 410) {
      return { ok: false, deactivate: true };
    }

    return { ok: false, deactivate: false };
  } catch {
    return { ok: false, deactivate: false };
  }
}

async function generateVapidJWT(subject: string, privateKeyB64: string): Promise<string> {
  const rawKey = base64UrlDecode(privateKeyB64);
  const key = await crypto.subtle.importKey(
    "pkcs8",
    rawKey,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"]
  );

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
