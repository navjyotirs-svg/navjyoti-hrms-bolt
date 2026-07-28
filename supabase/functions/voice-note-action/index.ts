import { createClient } from "npm:@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const MAX_DURATION_SECONDS = 300;
const MAX_FILE_SIZE = 15 * 1024 * 1024;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return jsonError(401, "Missing authorization header");

    const callerClient = createClient(supabaseUrl, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: { Authorization: authHeader } },
    });

    const { data: callerData, error: callerError } = await callerClient.auth.getUser();
    if (callerError || !callerData.user) return jsonError(401, "Invalid session");

    const callerId = callerData.user.id;

    const { data: profile } = await admin
      .from("user_profiles")
      .select("id, role, organization_id, status, is_active")
      .eq("id", callerId)
      .maybeSingle();

    if (!profile || profile.status !== "active" || !profile.is_active) {
      return jsonError(403, "Account not active");
    }

    const { data: perms } = await admin.rpc("get_effective_permissions", { p_user_id: callerId });
    const permissions: string[] = perms || [];
    const orgId = profile.organization_id;
    if (!orgId) return jsonError(403, "No organization membership");

    const body = await req.json();
    const { action } = body;

    switch (action) {
      case "send":
        return await handleSend(admin, body, callerId, orgId, permissions);
      case "record_play":
        return await handleRecordPlay(admin, body, callerId);
      case "acknowledge":
        return await handleAcknowledge(admin, body, callerId);
      case "delete":
        return await handleDelete(admin, body, callerId, orgId);
      default:
        return jsonError(400, `Unknown action: ${action}`);
    }
  } catch (err) {
    return jsonError(500, (err as Error).message);
  }
});

async function handleSend(
  admin: ReturnType<typeof createClient>,
  body: any,
  callerId: string,
  orgId: string,
  perms: string[]
) {
  if (!perms.includes("voice_note.send")) {
    return jsonError(403, "No permission to send voice notes");
  }

  const { recipient_employee_id, title, message, storage_path, mime_type, file_size_bytes, duration_seconds } = body;

  if (!recipient_employee_id || !storage_path || !mime_type || !file_size_bytes) {
    return jsonError(400, "Recipient, storage path, MIME type, and file size are required");
  }

  if (file_size_bytes > MAX_FILE_SIZE) {
    return jsonError(400, `File size exceeds ${MAX_FILE_SIZE} bytes limit`);
  }

  if (duration_seconds && duration_seconds > MAX_DURATION_SECONDS) {
    return jsonError(400, `Duration exceeds ${MAX_DURATION_SECONDS} seconds limit`);
  }

  // Validate storage path ownership
  const expectedPrefix = `${callerId}/`;
  if (!storage_path.startsWith(expectedPrefix)) {
    return jsonError(403, "Audio file does not belong to the authenticated user");
  }

  // Resolve recipient employee
  const { data: recipientEmp, error: recipientError } = await admin
    .from("employees")
    .select("id, user_id, organization_id, is_active, employment_status")
    .eq("id", recipient_employee_id)
    .maybeSingle();

  if (recipientError || !recipientEmp) {
    return jsonError(404, "Recipient employee not found");
  }

  if (recipientEmp.organization_id !== orgId) {
    return jsonError(403, "Cross-organization voice notes are not allowed");
  }

  if (!recipientEmp.is_active) {
    return jsonError(403, "Recipient is not an active employee");
  }

  if (!recipientEmp.user_id) {
    return jsonError(400, "Recipient has no user account");
  }

  // Manager scope check: manager can only send to reporting subtree
  const senderRole = await getRoleCode(admin, callerId);
  if (senderRole === "manager") {
    const { data: inSubtree } = await admin.rpc("is_in_reporting_subtree", {
      p_manager_id: (await getEmployeeId(admin, callerId)),
      p_employee_id: recipient_employee_id,
    });
    if (!inSubtree) {
      return jsonError(403, "You can only send voice notes to employees in your reporting scope");
    }
  }

  // Resolve sender employee
  const { data: senderEmp } = await admin
    .from("employees")
    .select("id, full_name")
    .eq("user_id", callerId)
    .maybeSingle();

  // Create voice note
  const { data: voiceNote, error: insertError } = await admin
    .from("voice_notes")
    .insert({
      organization_id: orgId,
      sender_user_id: callerId,
      sender_employee_id: senderEmp?.id || null,
      title: title || null,
      message: message || null,
      storage_path,
      mime_type,
      file_size_bytes,
      duration_seconds: duration_seconds || null,
      status: "SENT",
    })
    .select("id")
    .maybeSingle();

  if (insertError || !voiceNote) {
    return jsonError(500, `Failed to create voice note: ${insertError?.message ?? "Unknown"}`);
  }

  // Create recipient row
  const { error: recipientInsertError } = await admin
    .from("voice_note_recipients")
    .insert({
      voice_note_id: voiceNote.id,
      recipient_user_id: recipientEmp.user_id,
      recipient_employee_id: recipientEmp.id,
      delivered_at: new Date().toISOString(),
    });

  if (recipientInsertError) {
    return jsonError(500, `Failed to create recipient record: ${recipientInsertError.message}`);
  }

  // Audit log
  await admin.from("audit_logs").insert({
    actor_id: callerId,
    action: "voice_note.send",
    entity_type: "voice_note",
    entity_id: voiceNote.id,
    new_values: { recipient_employee_id, title, duration_seconds },
  });

  // Notify recipient
  const senderName = senderEmp?.full_name || "A manager";
  const safeTitle = title ? `: ${title}` : "";
  await notifyBusinessEvent(admin, {
    eventCode: "VOICE_NOTE_RECEIVED",
    actorUserId: callerId,
    organizationId: orgId,
    entityType: "voice_note",
    entityId: voiceNote.id,
    title: "Voice Note Received",
    message: `You received a new voice note${safeTitle} from ${senderName}.`,
    priority: "high",
    category: "voice_note",
    actionUrl: `/voice-notes/${voiceNote.id}`,
    recipientUserIds: [recipientEmp.user_id],
  });

  return jsonResponse(200, { voice_note_id: voiceNote.id, message: "Voice note sent successfully" });
}

async function handleRecordPlay(
  admin: ReturnType<typeof createClient>,
  body: any,
  callerId: string
) {
  const { voice_note_id } = body;
  if (!voice_note_id) return jsonError(400, "voice_note_id is required");

  // Verify the caller is a recipient
  const { data: recipient } = await admin
    .from("voice_note_recipients")
    .select("id, first_played_at, play_count")
    .eq("voice_note_id", voice_note_id)
    .eq("recipient_user_id", callerId)
    .maybeSingle();

  if (!recipient) return jsonError(403, "You are not a recipient of this voice note");

  const now = new Date().toISOString();
  await admin
    .from("voice_note_recipients")
    .update({
      last_played_at: now,
      play_count: (recipient.play_count || 0) + 1,
      first_played_at: recipient.first_played_at || now,
    })
    .eq("id", recipient.id);

  return jsonResponse(200, { message: "Play recorded" });
}

async function handleAcknowledge(
  admin: ReturnType<typeof createClient>,
  body: any,
  callerId: string
) {
  const { voice_note_id } = body;
  if (!voice_note_id) return jsonError(400, "voice_note_id is required");

  const { data: recipient } = await admin
    .from("voice_note_recipients")
    .select("id")
    .eq("voice_note_id", voice_note_id)
    .eq("recipient_user_id", callerId)
    .maybeSingle();

  if (!recipient) return jsonError(403, "You are not a recipient of this voice note");

  await admin
    .from("voice_note_recipients")
    .update({ acknowledged_at: new Date().toISOString() })
    .eq("id", recipient.id);

  return jsonResponse(200, { message: "Acknowledged" });
}

async function handleDelete(
  admin: ReturnType<typeof createClient>,
  body: any,
  callerId: string,
  orgId: string
) {
  const { voice_note_id } = body;
  if (!voice_note_id) return jsonError(400, "voice_note_id is required");

  const { data: voiceNote } = await admin
    .from("voice_notes")
    .select("sender_user_id, storage_path")
    .eq("id", voice_note_id)
    .maybeSingle();

  if (!voiceNote) return jsonError(404, "Voice note not found");
  if (voiceNote.sender_user_id !== callerId) return jsonError(403, "Only the sender can delete a voice note");

  await admin
    .from("voice_notes")
    .update({ status: "DELETED", deleted_at: new Date().toISOString() })
    .eq("id", voice_note_id);

  // Delete from storage
  await admin.storage.from("voice-notes").remove([voiceNote.storage_path]);

  await admin.from("audit_logs").insert({
    actor_id: callerId,
    action: "voice_note.delete",
    entity_type: "voice_note",
    entity_id: voice_note_id,
  });

  return jsonResponse(200, { message: "Voice note deleted" });
}

async function notifyBusinessEvent(
  admin: ReturnType<typeof createClient>,
  params: {
    eventCode: string;
    actorUserId: string;
    organizationId: string;
    entityType: string;
    entityId: string;
    title: string;
    message: string;
    priority?: string;
    category: string;
    actionUrl?: string;
    recipientUserIds?: string[];
  }
) {
  try {
    const recipientIds = params.recipientUserIds || [];
    if (recipientIds.length === 0) return;

    const notificationsToInsert: any[] = [];
    for (const recipientId of recipientIds) {
      const idempotencyKey = `${params.organizationId}:${params.eventCode}:${params.entityId}:${recipientId}`;
      const { data: existing } = await admin
        .from("notifications")
        .select("id")
        .eq("idempotency_key", idempotencyKey)
        .maybeSingle();
      if (existing) continue;

      notificationsToInsert.push({
        recipient_id: recipientId,
        organization_id: params.organizationId,
        notification_type: params.eventCode,
        event_code: params.eventCode,
        title: params.title,
        message: params.message,
        priority: params.priority || "normal",
        category: params.category,
        action_url: params.actionUrl || null,
        dedup_key: idempotencyKey,
        idempotency_key: idempotencyKey,
        related_entity_type: params.entityType,
        related_entity_id: params.entityId,
        delivery_status: "in_app",
      });
    }

    if (notificationsToInsert.length === 0) return;
    const { data: inserted } = await admin.from("notifications").insert(notificationsToInsert).select("id, recipient_id");
    const deliveryJobs = (inserted || []).map((n: any) => ({
      notification_id: n.id,
      channel: "web_push",
      recipient: n.recipient_id,
      status: "queued",
      idempotency_key: `push:${n.id}`,
    }));
    if (deliveryJobs.length > 0) await admin.from("notification_deliveries").insert(deliveryJobs);
  } catch { /* best-effort */ }
}

async function getRoleCode(admin: ReturnType<typeof createClient>, userId: string): Promise<string | null> {
  const { data } = await admin.from("user_profiles").select("role").eq("id", userId).maybeSingle();
  return data?.role || null;
}

async function getEmployeeId(admin: ReturnType<typeof createClient>, userId: string): Promise<string | null> {
  const { data } = await admin.from("employees").select("id").eq("user_id", userId).maybeSingle();
  return data?.id || null;
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
