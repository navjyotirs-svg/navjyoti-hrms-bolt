import { createClient } from "npm:@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

interface BusinessNotificationRequest {
  eventCode: string;
  actorUserId: string;
  employeeId?: string;
  organizationId: string;
  entityType: string;
  entityId: string;
  title: string;
  message: string;
  priority?: "low" | "normal" | "high" | "urgent";
  category: string;
  actionUrl?: string;
  metadata?: Record<string, unknown>;
  // Who should receive this notification
  recipientRoles?: string[]; // e.g. ["manager", "hr_admin", "director"]
  includeEmployee?: boolean; // notify the affected employee
  includeActor?: boolean; // notify the actor (for confirmations)
  acknowledgementRequired?: boolean;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const body: BusinessNotificationRequest = await req.json();

    const result = await createBusinessNotification(body);

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ success: false, error: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

export async function createBusinessNotification(
  req: BusinessNotificationRequest
): Promise<{ success: boolean; notificationsCreated: number; recipients: string[]; error?: string }> {
  const {
    eventCode,
    actorUserId,
    employeeId,
    organizationId,
    entityType,
    entityId,
    title,
    message,
    priority = "normal",
    category,
    actionUrl,
    metadata = {},
    recipientRoles = [],
    includeEmployee = false,
    includeActor = false,
    acknowledgementRequired = false,
  } = req;

  // 1. Resolve all recipients
  const recipientUserIds = new Set<string>();

  // Resolve by roles (manager, hr_admin, director, etc.)
  if (recipientRoles.length > 0) {
    const roleRecipients = await resolveRoleRecipients(organizationId, recipientRoles, actorUserId);
    roleRecipients.forEach((id) => recipientUserIds.add(id));
  }

  // Resolve direct reporting manager
  if (employeeId) {
    const managerUserId = await resolveReportingManager(employeeId);
    if (managerUserId) {
      recipientUserIds.add(managerUserId);
    }
  }

  // Include the affected employee
  if (includeEmployee && employeeId) {
    const empUserId = await resolveEmployeeUserId(employeeId);
    if (empUserId) {
      recipientUserIds.add(empUserId);
    }
  }

  // Include the actor (for confirmation notifications)
  if (includeActor) {
    recipientUserIds.add(actorUserId);
  }

  // Exclude the actor from supervisory notifications (they triggered it, no need to notify themselves)
  // unless includeActor is explicitly true
  if (!includeActor) {
    recipientUserIds.delete(actorUserId);
  }

  if (recipientUserIds.size === 0) {
    return { success: true, notificationsCreated: 0, recipients: [] };
  }

  // 2. Create notification rows with idempotency keys
  const notificationsToInsert: Array<Record<string, unknown>> = [];
  const recipients: string[] = [];

  for (const recipientId of recipientUserIds) {
    const idempotencyKey = `${organizationId}:${eventCode}:${entityId}:${recipientId}`;

    // Check for existing notification with same idempotency key
    const { data: existing } = await admin
      .from("notifications")
      .select("id")
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();

    if (existing) {
      // Already created — skip (idempotent)
      continue;
    }

    notificationsToInsert.push({
      recipient_id: recipientId,
      organization_id: organizationId,
      notification_type: eventCode,
      event_code: eventCode,
      title,
      message,
      priority,
      category,
      action_url: actionUrl || null,
      dedup_key: idempotencyKey,
      idempotency_key: idempotencyKey,
      metadata: { ...metadata, entityType, entityId, actorUserId },
      related_entity_type: entityType,
      related_entity_id: entityId,
      acknowledgement_required: acknowledgementRequired,
      delivery_status: "in_app",
    });
    recipients.push(recipientId);
  }

  if (notificationsToInsert.length === 0) {
    return { success: true, notificationsCreated: 0, recipients: [] };
  }

  // 3. Insert notifications
  const { data: inserted, error: insertError } = await admin
    .from("notifications")
    .insert(notificationsToInsert)
    .select("id, recipient_id");

  if (insertError) {
    return { success: false, notificationsCreated: 0, recipients: [], error: insertError.message };
  }

  // 4. Create WEB_PUSH delivery jobs for each notification
  const deliveryJobs: Array<Record<string, unknown>> = [];
  for (const notif of inserted ?? []) {
    deliveryJobs.push({
      notification_id: notif.id,
      channel: "web_push",
      recipient: notif.recipient_id,
      status: "queued",
      idempotency_key: `push:${notif.id}`,
    });
  }

  if (deliveryJobs.length > 0) {
    await admin.from("notification_deliveries").insert(deliveryJobs).then(() => {});
  }

  // 5. Write audit event
  try {
    await admin.from("audit_logs").insert({
      actor_id: actorUserId,
      action: `notification.${eventCode}`,
      entity_type: entityType,
      entity_id: entityId,
      new_values: { recipients: recipients, event_code: eventCode },
    });
  } catch {
    // audit is best-effort
  }

  return {
    success: true,
    notificationsCreated: inserted?.length || 0,
    recipients,
  };
}

// Resolve users by role in the same organization (active only)
async function resolveRoleRecipients(
  organizationId: string,
  roles: string[],
  excludeUserId: string
): Promise<string[]> {
  const { data: users } = await admin
    .from("user_profiles")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("status", "active")
    .eq("is_active", true)
    .in("role", roles);

  return (users ?? [])
    .map((u: { id: string }) => u.id)
    .filter((id: string) => id !== excludeUserId);
}

// Resolve the direct reporting manager's user_id for an employee
async function resolveReportingManager(employeeId: string): Promise<string | null> {
  const { data: managerLink } = await admin
    .from("employee_reporting_lines")
    .select("manager_id, employees!inner(user_id, is_active)")
    .eq("employee_id", employeeId)
    .limit(1)
    .maybeSingle();

  if (!managerLink) return null;

  // The manager_id in employee_reporting_lines is an employee_id, not a user_id
  // We need to look up the manager's employee record to get their user_id
  const { data: managerEmp } = await admin
    .from("employees")
    .select("user_id")
    .eq("id", managerLink.manager_id)
    .eq("is_active", true)
    .maybeSingle();

  return managerEmp?.user_id || null;
}

// Resolve the user_id for an employee record
async function resolveEmployeeUserId(employeeId: string): Promise<string | null> {
  const { data: emp } = await admin
    .from("employees")
    .select("user_id")
    .eq("id", employeeId)
    .eq("is_active", true)
    .maybeSingle();

  return emp?.user_id || null;
}
