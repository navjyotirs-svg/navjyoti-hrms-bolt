/*
# Push delivery diagnostics and supervisory notification routing

1. New Tables
- `push_diagnostic_events` — records each stage of push delivery for end-to-end tracing.
  - `id` uuid PK
  - `user_id` uuid NOT NULL (the user whose device received the push)
  - `correlation_id` text NOT NULL (links all stages of one push attempt)
  - `event_type` text NOT NULL — one of: PUSH_PROVIDER_ACCEPTED, SERVICE_WORKER_PUSH_RECEIVED,
    SHOW_NOTIFICATION_CALLED, SHOW_NOTIFICATION_SUCCEEDED, SHOW_NOTIFICATION_FAILED
  - `notification_title` text (safe title only — never VAPID keys, endpoints, or tokens)
  - `action_route` text (safe action URL only)
  - `service_worker_version` text (the SW version string reported by the client)
  - `error_category` text (only for FAILED events)
  - `created_at` timestamptz DEFAULT now()

- `supervisory_notification_routing` — maps a notification event code to the roles that
  should receive a supervisory in-app/push notification when the event fires.
  - `id` uuid PK
  - `event_code` text NOT NULL UNIQUE
  - `recipient_roles` text[] NOT NULL DEFAULT '{}' (array of role codes: director, hr_admin, etc.)
  - `channels` text[] NOT NULL DEFAULT '{in_app,push}' (delivery channels for supervisors)
  - `created_at` timestamptz DEFAULT now()
  - `updated_at` timestamptz DEFAULT now()

2. Security
- RLS enabled on both tables.
- push_diagnostic_events: owner-scoped — users can only read/write their own diagnostic events.
- supervisory_notification_routing: read access for all authenticated users; write access
  for director and hr_admin only (enforced via user_profiles.role check).

3. Important Notes
- No VAPID keys, subscription endpoints, p256dh/auth keys, JWTs, or access tokens are ever
  stored in push_diagnostic_events. Only safe metadata: title, action route, SW version,
  correlation ID, and error category.
- The routing table is seeded with the supervisory events from the event catalogue so
  Directors and HR receive immediate notifications for meaningful business-state changes.
*/

CREATE TABLE IF NOT EXISTS push_diagnostic_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  correlation_id text NOT NULL,
  event_type text NOT NULL CHECK (event_type IN (
    'PUSH_PROVIDER_ACCEPTED',
    'SERVICE_WORKER_PUSH_RECEIVED',
    'SHOW_NOTIFICATION_CALLED',
    'SHOW_NOTIFICATION_SUCCEEDED',
    'SHOW_NOTIFICATION_FAILED'
  )),
  notification_title text,
  action_route text,
  service_worker_version text,
  error_category text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE push_diagnostic_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_push_diagnostics" ON push_diagnostic_events;
CREATE POLICY "select_own_push_diagnostics" ON push_diagnostic_events FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "insert_own_push_diagnostics" ON push_diagnostic_events;
CREATE POLICY "insert_own_push_diagnostics" ON push_diagnostic_events FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "delete_own_push_diagnostics" ON push_diagnostic_events;
CREATE POLICY "delete_own_push_diagnostics" ON push_diagnostic_events FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_push_diag_correlation ON push_diagnostic_events(correlation_id);
CREATE INDEX IF NOT EXISTS idx_push_diag_user_created ON push_diagnostic_events(user_id, created_at DESC);

-- Supervisory notification routing table
CREATE TABLE IF NOT EXISTS supervisory_notification_routing (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_code text NOT NULL UNIQUE,
  recipient_roles text[] NOT NULL DEFAULT '{}',
  channels text[] NOT NULL DEFAULT '{in_app,push}',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE supervisory_notification_routing ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "read_supervisory_routing" ON supervisory_notification_routing;
CREATE POLICY "read_supervisory_routing" ON supervisory_notification_routing FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "manage_supervisory_routing" ON supervisory_notification_routing;
CREATE POLICY "manage_supervisory_routing" ON supervisory_notification_routing FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
      AND user_profiles.role IN ('director', 'hr_admin', 'system_admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
      AND user_profiles.role IN ('director', 'hr_admin', 'system_admin')
    )
  );

-- Seed supervisory routing for Director/HR events
INSERT INTO supervisory_notification_routing (event_code, recipient_roles, channels)
VALUES
  ('EMPLOYEE_INVITATION_SENT', '{director,hr_admin}', '{in_app,push}'),
  ('EMPLOYEE_ACTIVATED', '{director,hr_admin}', '{in_app,push}'),
  ('EMPLOYEE_ROLE_CHANGED', '{director,hr_admin}', '{in_app,push}'),
  ('EMPLOYEE_SUSPENDED', '{director,hr_admin}', '{in_app,push}'),
  ('EMPLOYEE_REACTIVATED', '{director,hr_admin}', '{in_app,push}'),
  ('EMPLOYEE_OFFBOARDED', '{director,hr_admin}', '{in_app,push}'),
  ('EMPLOYEE_MANAGER_CHANGED', '{director,hr_admin}', '{in_app}'),
  ('EMPLOYEE_DEPARTMENT_CHANGED', '{director,hr_admin}', '{in_app}'),
  ('EMPLOYEE_BRANCH_CHANGED', '{director,hr_admin}', '{in_app}'),
  ('ATTENDANCE_CHECK_IN_CONFIRMED', '{director,hr_admin}', '{in_app}'),
  ('ATTENDANCE_CHECKOUT_CONFIRMED', '{director,hr_admin}', '{in_app}'),
  ('ATTENDANCE_HALF_DAY', '{director,hr_admin}', '{in_app,push}'),
  ('ATTENDANCE_FULL_DAY', '{director,hr_admin}', '{in_app}'),
  ('ATTENDANCE_MISSING_CHECKOUT', '{director,hr_admin}', '{in_app,push}'),
  ('ATTENDANCE_CORRECTION_SUBMITTED', '{director,hr_admin,manager}', '{in_app,push}'),
  ('ATTENDANCE_CORRECTION_APPROVED', '{director,hr_admin}', '{in_app}'),
  ('ATTENDANCE_CORRECTION_REJECTED', '{director,hr_admin}', '{in_app}'),
  ('ATTENDANCE_CAMERA_LOCATION_ERROR', '{director,hr_admin}', '{in_app,push}'),
  ('TASK_ASSIGNED', '{director,hr_admin}', '{in_app}'),
  ('TASK_ACCEPTED', '{director,hr_admin}', '{in_app}'),
  ('TASK_REJECTED', '{director,hr_admin}', '{in_app,push}'),
  ('TASK_BLOCKER', '{director,hr_admin,manager}', '{in_app,push}'),
  ('TASK_SUBMITTED', '{director,hr_admin,manager}', '{in_app,push}'),
  ('TASK_REVIEWED', '{director,hr_admin}', '{in_app}'),
  ('TASK_REASSIGNED', '{director,hr_admin}', '{in_app}'),
  ('TASK_DEADLINE_CHANGED', '{director,hr_admin}', '{in_app}'),
  ('TASK_CANCELLED', '{director,hr_admin}', '{in_app}'),
  ('LEAVE_REQUEST_SUBMITTED', '{director,hr_admin,manager}', '{in_app,push}'),
  ('LEAVE_PENDING_HR', '{director,hr_admin}', '{in_app,push}'),
  ('LEAVE_APPROVED', '{director,hr_admin}', '{in_app}'),
  ('LEAVE_REJECTED', '{director,hr_admin}', '{in_app}'),
  ('LEAVE_RETURNED', '{director,hr_admin}', '{in_app}'),
  ('LEAVE_CANCELLED', '{director,hr_admin}', '{in_app}'),
  ('LEAVE_BALANCE_ADJUSTED', '{director,hr_admin}', '{in_app}'),
  ('TICKET_CREATED', '{director,hr_admin}', '{in_app,push}'),
  ('TICKET_ESCALATED', '{director,hr_admin}', '{in_app,push}'),
  ('TICKET_SLA_BREACHED', '{director,hr_admin}', '{in_app,push}'),
  ('TICKET_REOPENED', '{director,hr_admin}', '{in_app}'),
  ('DAILY_REPORT_MISSING', '{director,hr_admin,manager}', '{in_app,push}'),
  ('DAILY_REPORT_RETURNED', '{director,hr_admin}', '{in_app}'),
  ('DAILY_REPORT_REVIEWED', '{director,hr_admin}', '{in_app}'),
  ('FOLLOW_UP_OVERDUE', '{director,hr_admin,manager}', '{in_app,push}'),
  ('SECURITY_PASSWORD_CHANGED', '{director,hr_admin}', '{in_app,push}'),
  ('SECURITY_NEW_DEVICE', '{director,hr_admin}', '{in_app,push}'),
  ('EXPORT_FAILED', '{director,hr_admin}', '{in_app}')
ON CONFLICT (event_code) DO NOTHING;
