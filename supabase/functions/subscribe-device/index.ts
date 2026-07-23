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

    // Create a user-scoped client to verify the JWT
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

    // Load the user's organization_id from their profile
    const { data: profile, error: profileErr } = await userClient
      .from("user_profiles")
      .select("organization_id")
      .eq("id", userId)
      .maybeSingle();

    if (profileErr || !profile?.organization_id) {
      return errorResponse("User profile or organization not found", 403);
    }

    const body = await req.json().catch(() => ({}));

    if (!body.endpoint || !body.p256dh || !body.auth) {
      return errorResponse("Missing required subscription fields (endpoint, p256dh, auth)", 400);
    }

    // Compute VAPID key fingerprint from the configured public key
    const vapidPublicKey = Deno.env.get("VAPID_PUBLIC_KEY") || "";
    const vapidKeyFp = vapidPublicKey ? vapidPublicKey.slice(0, 16) : null;

    // Use service-role client to upsert (avoids RLS issues with duplicate detection)
    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Check for existing subscription with same endpoint + user
    const { data: existing } = await adminClient
      .from("push_subscriptions")
      .select("id, is_active")
      .eq("endpoint", body.endpoint)
      .eq("user_id", userId)
      .maybeSingle();

    if (existing) {
      // Refresh existing subscription — re-activate if it was revoked
      await adminClient
        .from("push_subscriptions")
        .update({
          p256dh_key: body.p256dh,
          auth_key: body.auth,
          user_agent: body.userAgent || null,
          device_name: body.deviceName || null,
          platform: body.platform || null,
          browser: body.browser || null,
          is_active: true,
          permission_status: "granted",
          last_used_at: new Date().toISOString(),
          revoked_at: null,
          vapid_key_fp: vapidKeyFp,
        })
        .eq("id", existing.id);

      return jsonResponse({
        success: true,
        message: "Subscription refreshed",
        subscriptionId: existing.id,
      });
    }

    // Insert new subscription
    const { data: inserted, error: insertErr } = await adminClient
      .from("push_subscriptions")
      .insert({
        user_id: userId,
        organization_id: profile.organization_id,
        endpoint: body.endpoint,
        p256dh_key: body.p256dh,
        auth_key: body.auth,
        user_agent: body.userAgent || null,
        device_name: body.deviceName || null,
        platform: body.platform || null,
        browser: body.browser || null,
        is_active: true,
        permission_status: "granted",
        last_used_at: new Date().toISOString(),
        vapid_key_fp: vapidKeyFp,
      })
      .select("id")
      .single();

    if (insertErr) {
      return errorResponse("Failed to store subscription", 500);
    }

    return jsonResponse({
      success: true,
      message: "Subscription stored",
      subscriptionId: inserted.id,
    });
  } catch (err) {
    return errorResponse((err as Error).message, 500);
  }
});

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
