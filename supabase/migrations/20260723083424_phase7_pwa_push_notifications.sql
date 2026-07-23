/*
# Phase 7 — PWA Push Notification Infrastructure

## Summary
Creates the push_subscriptions table, extends notification_deliveries to support
the WEB_PUSH channel, extends notification_preferences with push-specific fields,
and adds organization-level permission policy settings.

## New Tables
1. push_subscriptions — stores per-device web push subscription endpoints + keys
2. organization_permission_settings — configurable org-level permission requirements

## Modified Tables
- notification_deliveries: extends channel CHECK to include 'web_push'
- notification_preferences: adds push_enabled, category-specific push flags,
  quiet hours already existed, timezone already existed

## Security
- RLS enabled on all new tables
- push_subscriptions: owner-scoped CRUD (user can only manage their own subscriptions)
- organization_permission_settings: read by org members, write by directors/hr_admins
- Endpoint and keys never exposed cross-user
- Cross-organization access denied

## Important Notes
1. VAPID keys must be configured as edge function secrets (VAPID_PUBLIC_KEY,
   VAPID_PRIVATE_KEY, VAPID_SUBJECT) — never in the frontend bundle.
2. The push_subscriptions table stores encrypted endpoint + p256dh + auth keys
   per device. Multiple devices per user are supported.
3. Duplicate endpoint prevention via unique index on endpoint + user_id.
4. Invalid subscriptions are deactivated by the send-push-notification function.
*/

-- ============================================================
-- 1. push_subscriptions
-- ============================================================
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  endpoint text NOT NULL,
  p256dh_key text NOT NULL,
  auth_key text NOT NULL,
  user_agent text,
  device_name text,
  platform text,
  browser text,
  is_active boolean NOT NULL DEFAULT true,
  permission_status text NOT NULL DEFAULT 'granted' CHECK (permission_status IN ('granted','denied','default')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_push_sub_endpoint_user ON push_subscriptions (endpoint, user_id);
CREATE INDEX IF NOT EXISTS idx_push_sub_user_active ON push_subscriptions (user_id, is_active);
CREATE INDEX IF NOT EXISTS idx_push_sub_org ON push_subscriptions (organization_id);

ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_push_subs" ON push_subscriptions;
CREATE POLICY "select_own_push_subs" ON push_subscriptions FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "insert_own_push_subs" ON push_subscriptions;
CREATE POLICY "insert_own_push_subs" ON push_subscriptions FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "update_own_push_subs" ON push_subscriptions;
CREATE POLICY "update_own_push_subs" ON push_subscriptions FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "delete_own_push_subs" ON push_subscriptions;
CREATE POLICY "delete_own_push_subs" ON push_subscriptions FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

DROP TRIGGER IF EXISTS push_subscriptions_updated_at ON push_subscriptions;
CREATE TRIGGER push_subscriptions_updated_at BEFORE UPDATE ON push_subscriptions
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

-- ============================================================
-- 2. organization_permission_settings
-- ============================================================
CREATE TABLE IF NOT EXISTS organization_permission_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL UNIQUE REFERENCES organizations(id) ON DELETE CASCADE,
  notification_permission_required boolean NOT NULL DEFAULT true,
  location_permission_required boolean NOT NULL DEFAULT true,
  allow_dashboard_without_push boolean NOT NULL DEFAULT true,
  allow_dashboard_without_location boolean NOT NULL DEFAULT true,
  permission_reminder_enabled boolean NOT NULL DEFAULT true,
  permission_reminder_interval_days integer NOT NULL DEFAULT 7,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_org_perm_settings_org ON organization_permission_settings (organization_id);

ALTER TABLE organization_permission_settings ENABLE ROW LEVEL SECURITY;

-- Any authenticated user who belongs to the org can read settings
DROP POLICY IF EXISTS "select_org_perm_settings" ON organization_permission_settings;
CREATE POLICY "select_org_perm_settings" ON organization_permission_settings FOR SELECT
  TO authenticated USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
      AND user_profiles.organization_id = organization_permission_settings.organization_id
    )
  );

-- Only directors, hr_admins, and system_admin can update
DROP POLICY IF EXISTS "update_org_perm_settings" ON organization_permission_settings;
CREATE POLICY "update_org_perm_settings" ON organization_permission_settings FOR UPDATE
  TO authenticated USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
      AND user_profiles.organization_id = organization_permission_settings.organization_id
      AND user_profiles.role IN ('director','hr_admin','system_admin')
    )
  ) WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
      AND user_profiles.organization_id = organization_permission_settings.organization_id
      AND user_profiles.role IN ('director','hr_admin','system_admin')
    )
  );

-- Insert: only directors/hr_admins/system_admin, and only for their own org
DROP POLICY IF EXISTS "insert_org_perm_settings" ON organization_permission_settings;
CREATE POLICY "insert_org_perm_settings" ON organization_permission_settings FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
      AND user_profiles.organization_id = organization_permission_settings.organization_id
      AND user_profiles.role IN ('director','hr_admin','system_admin')
    )
  );

DROP TRIGGER IF EXISTS org_perm_settings_updated_at ON organization_permission_settings;
CREATE TRIGGER org_perm_settings_updated_at BEFORE UPDATE ON organization_permission_settings
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

-- ============================================================
-- 3. Extend notification_deliveries channel to include web_push
-- ============================================================
ALTER TABLE notification_deliveries DROP CONSTRAINT IF EXISTS notification_deliveries_channel_check;
ALTER TABLE notification_deliveries ADD CONSTRAINT notification_deliveries_channel_check
  CHECK (channel IN ('in_app','email','web_push'));

-- ============================================================
-- 4. Extend notification_preferences with push-specific fields
-- ============================================================
ALTER TABLE notification_preferences ADD COLUMN IF NOT EXISTS push_enabled boolean NOT NULL DEFAULT true;
ALTER TABLE notification_preferences ADD COLUMN IF NOT EXISTS attendance_push boolean NOT NULL DEFAULT true;
ALTER TABLE notification_preferences ADD COLUMN IF NOT EXISTS task_push boolean NOT NULL DEFAULT true;
ALTER TABLE notification_preferences ADD COLUMN IF NOT EXISTS leave_push boolean NOT NULL DEFAULT true;
ALTER TABLE notification_preferences ADD COLUMN IF NOT EXISTS ticket_push boolean NOT NULL DEFAULT true;
ALTER TABLE notification_preferences ADD COLUMN IF NOT EXISTS daily_report_push boolean NOT NULL DEFAULT true;
ALTER TABLE notification_preferences ADD COLUMN IF NOT EXISTS calendar_push boolean NOT NULL DEFAULT true;
ALTER TABLE notification_preferences ADD COLUMN IF NOT EXISTS announcement_push boolean NOT NULL DEFAULT true;
ALTER TABLE notification_preferences ADD COLUMN IF NOT EXISTS security_push boolean NOT NULL DEFAULT true;

-- ============================================================
-- 5. Seed default permission settings for existing organizations
-- ============================================================
INSERT INTO organization_permission_settings (organization_id)
SELECT id FROM organizations
WHERE id NOT IN (SELECT organization_id FROM organization_permission_settings)
ON CONFLICT DO NOTHING;
