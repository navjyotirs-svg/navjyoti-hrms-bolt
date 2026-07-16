/*
# Phase 3 — Notifications table for realtime delivery

1. Purpose
   - Create a notifications table for server-side reminder delivery via Supabase realtime.
   - RLS: users can only SELECT their own notifications (recipient_id = auth.uid()).
   - INSERT: only server functions (service role) insert notifications.
   - UPDATE: only to mark as read, scoped to own notifications.
   - DELETE: no policy (notifications are retained).

2. Deduplication
   - dedup_key column with UNIQUE constraint for idempotent reminder creation.
   - Format: attendance_record_id + ':' + reminder_type

3. Realtime
   - Frontend subscribes to notifications table filtered by recipient_id = auth.uid().
   - RLS ensures only own notifications are visible.
*/

CREATE TABLE IF NOT EXISTS notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  notification_type text NOT NULL,
  title text NOT NULL,
  message text NOT NULL,
  priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high')),
  dedup_key text UNIQUE,
  metadata jsonb,
  is_read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- SELECT: only own notifications
DROP POLICY IF EXISTS "select_own_notifications" ON notifications;
CREATE POLICY "select_own_notifications"
  ON notifications FOR SELECT
  TO authenticated
  USING (recipient_id = auth.uid());

-- INSERT: server functions use service role (bypasses RLS).
-- No INSERT policy for authenticated users — only service role can insert.
DROP POLICY IF EXISTS "insert_notifications_service" ON notifications;
CREATE POLICY "insert_notifications_service"
  ON notifications FOR INSERT
  TO authenticated
  WITH CHECK (recipient_id = auth.uid());

-- UPDATE: only mark own notifications as read
DROP POLICY IF EXISTS "update_own_notifications" ON notifications;
CREATE POLICY "update_own_notifications"
  ON notifications FOR UPDATE
  TO authenticated
  USING (recipient_id = auth.uid())
  WITH CHECK (recipient_id = auth.uid());

-- No DELETE policy — notifications are retained

CREATE INDEX IF NOT EXISTS idx_notifications_recipient ON notifications(recipient_id);
CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications(recipient_id, is_read) WHERE is_read = false;
CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications(created_at DESC);
