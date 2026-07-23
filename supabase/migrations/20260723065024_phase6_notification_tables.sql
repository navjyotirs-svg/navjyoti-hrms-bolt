/*
# Phase 6 — Notification, Announcement, Export Tables

## Summary
Creates 6 tables: notification_preferences, notification_deliveries, email_templates,
announcements, announcement_acknowledgements, export_jobs.

Also extends notifications table with new columns for Phase 6 inbox features.

## Tables
1. notification_preferences — per-user notification channel settings
2. notification_deliveries — email/in-app delivery tracking
3. email_templates — reusable email templates with variable schemas
4. announcements — org-wide broadcast messages with targeting
5. announcement_acknowledgements — read receipts for announcements
6. export_jobs — async export job queue with storage paths

## Modified tables
- notifications: adds category, read_at, action_url, expires_at, archived, delivery_status columns
- notifications: extends priority CHECK to include 'urgent'
*/

-- ============================================================
-- Extend notifications table
-- ============================================================
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT 'system'
  CHECK (category IN ('attendance','leave','task','ticket','daily_report','follow_up','calendar','employee','system','announcement'));
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS read_at timestamptz;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS action_url text;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS expires_at timestamptz;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS archived boolean NOT NULL DEFAULT false;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS delivery_status text NOT NULL DEFAULT 'in_app'
  CHECK (delivery_status IN ('in_app','queued','processing','sent','delivered','failed','retry','cancelled'));

-- Update priority CHECK to include 'urgent' (existing uses lowercase)
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_priority_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_priority_check
  CHECK (priority IN ('low','normal','high','urgent'));

-- ============================================================
-- 1. notification_preferences
-- ============================================================
CREATE TABLE IF NOT EXISTS notification_preferences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  in_app_enabled boolean NOT NULL DEFAULT true,
  email_enabled boolean NOT NULL DEFAULT false,
  sound_enabled boolean NOT NULL DEFAULT false,
  attendance_notifications boolean NOT NULL DEFAULT true,
  leave_notifications boolean NOT NULL DEFAULT true,
  task_notifications boolean NOT NULL DEFAULT true,
  ticket_notifications boolean NOT NULL DEFAULT true,
  daily_report_notifications boolean NOT NULL DEFAULT true,
  calendar_notifications boolean NOT NULL DEFAULT true,
  announcement_notifications boolean NOT NULL DEFAULT true,
  quiet_hours_start time,
  quiet_hours_end time,
  timezone text NOT NULL DEFAULT 'Asia/Kolkata',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_notif_prefs_user ON notification_preferences (user_id);

DROP TRIGGER IF EXISTS notification_preferences_updated_at ON notification_preferences;
CREATE TRIGGER notification_preferences_updated_at BEFORE UPDATE ON notification_preferences
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

-- ============================================================
-- 2. notification_deliveries
-- ============================================================
CREATE TABLE IF NOT EXISTS notification_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_id uuid NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  channel text NOT NULL CHECK (channel IN ('in_app','email')),
  provider text,
  recipient text NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN (
    'queued','processing','sent','delivered','failed','retry','cancelled'
  )),
  attempt_count integer NOT NULL DEFAULT 0,
  last_attempt_at timestamptz,
  delivered_at timestamptz,
  failure_code text,
  failure_message text,
  idempotency_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_deliveries_notif ON notification_deliveries (notification_id);
CREATE INDEX IF NOT EXISTS idx_deliveries_status ON notification_deliveries (status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_deliveries_idem ON notification_deliveries (idempotency_key) WHERE idempotency_key IS NOT NULL;

DROP TRIGGER IF EXISTS notification_deliveries_updated_at ON notification_deliveries;
CREATE TRIGGER notification_deliveries_updated_at BEFORE UPDATE ON notification_deliveries
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

-- ============================================================
-- 3. email_templates
-- ============================================================
CREATE TABLE IF NOT EXISTS email_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  template_code text NOT NULL,
  subject_template text NOT NULL,
  body_html text NOT NULL DEFAULT '',
  body_text text NOT NULL DEFAULT '',
  variables_schema jsonb NOT NULL DEFAULT '{}',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_email_templates_code ON email_templates (template_code);

DROP TRIGGER IF EXISTS email_templates_updated_at ON email_templates;
CREATE TRIGGER email_templates_updated_at BEFORE UPDATE ON email_templates
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

-- Seed default templates
INSERT INTO email_templates (template_code, subject_template, body_text, variables_schema)
VALUES
  ('TASK_ASSIGNED', 'New Task Assigned: {{task_code}}', 'You have been assigned a new task: {{task_title}} ({{task_code}}). Please review and accept.', '{"task_code":"string","task_title":"string"}'),
  ('TASK_DEADLINE_REMINDER', 'Task Deadline Reminder: {{task_code}}', 'Task {{task_code}}: {{task_title}} is due on {{deadline}}.', '{"task_code":"string","task_title":"string","deadline":"string"}'),
  ('LEAVE_STATUS', 'Leave Request Update: {{status}}', 'Your leave request from {{from_date}} to {{to_date}} has been {{status}}.', '{"status":"string","from_date":"string","to_date":"string"}'),
  ('DAILY_REPORT_DUE', 'Daily Report Due for {{report_date}}', 'Your daily report for {{report_date}} is due. Please submit before cutoff.', '{"report_date":"string"}'),
  ('DAILY_REPORT_MISSING', 'Missing Daily Report for {{report_date}}', 'Your daily report for {{report_date}} was not submitted. Please submit it.', '{"report_date":"string"}'),
  ('DAILY_REPORT_RETURNED', 'Daily Report Returned for Correction: {{report_date}}', 'Your daily report for {{report_date}} has been returned for correction. Reason: {{reason}}', '{"report_date":"string","reason":"string"}'),
  ('FOLLOW_UP_ASSIGNED', 'Follow-up Assigned: {{subject}}', 'A follow-up action has been assigned to you: {{subject}}. Priority: {{priority}}', '{"subject":"string","priority":"string"}'),
  ('CALENDAR_EVENT', 'Calendar Event: {{event_title}}', 'Event: {{event_title}} on {{event_date}}.', '{"event_title":"string","event_date":"string"}'),
  ('EMPLOYEE_INVITATION', 'Invitation to Join {{org_name}}', 'You have been invited to join {{org_name}}. Please set your password to activate your account.', '{"org_name":"string"}'),
  ('PASSWORD_RECOVERY', 'Password Recovery', 'A password recovery request was made. Please use the link to reset your password.', '{}')
ON CONFLICT DO NOTHING;

-- ============================================================
-- 4. announcements
-- ============================================================
CREATE TABLE IF NOT EXISTS announcements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  title text NOT NULL,
  message text NOT NULL,
  priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
  target_scope text NOT NULL CHECK (target_scope IN ('all','branch','department','role','employee')),
  branch_id uuid REFERENCES branches(id) ON DELETE CASCADE,
  department_id uuid REFERENCES departments(id) ON DELETE CASCADE,
  role_code text,
  employee_id uuid REFERENCES employees(id) ON DELETE CASCADE,
  publish_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  acknowledgement_required boolean NOT NULL DEFAULT false,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_announcements_org ON announcements (organization_id, publish_at);
CREATE INDEX IF NOT EXISTS idx_announcements_scope ON announcements (target_scope);

DROP TRIGGER IF EXISTS announcements_updated_at ON announcements;
CREATE TRIGGER announcements_updated_at BEFORE UPDATE ON announcements
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

-- ============================================================
-- 5. announcement_acknowledgements
-- ============================================================
CREATE TABLE IF NOT EXISTS announcement_acknowledgements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  announcement_id uuid NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  acknowledged_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ack_unique ON announcement_acknowledgements (announcement_id, user_id);
CREATE INDEX IF NOT EXISTS idx_ack_user ON announcement_acknowledgements (user_id);

-- ============================================================
-- 6. export_jobs
-- ============================================================
CREATE TABLE IF NOT EXISTS export_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  requested_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  export_type text NOT NULL CHECK (export_type IN (
    'daily_reports','missing_reports','task_progress','attendance_summary',
    'leave_summary','ticket_summary','follow_up_report','branch_report',
    'department_report','org_daily_summary'
  )),
  filters jsonb NOT NULL DEFAULT '{}',
  format text NOT NULL CHECK (format IN ('csv','xlsx','pdf')),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN (
    'queued','processing','completed','failed','expired','cancelled'
  )),
  storage_path text,
  failure_reason text,
  requested_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  expires_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_export_jobs_org ON export_jobs (organization_id);
CREATE INDEX IF NOT EXISTS idx_export_jobs_status ON export_jobs (status);
CREATE INDEX IF NOT EXISTS idx_export_jobs_requested_by ON export_jobs (requested_by);
