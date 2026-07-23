/*
# Phase 6 — RLS Policies and Helper Functions

## Summary
Enables RLS on all 13 Phase 6 tables and creates CRUD policies.
Creates 2 new SECURITY DEFINER helper functions: can_read_daily_report, can_read_follow_up.

## New Helper Functions
1. can_read_daily_report(p_report_id) — checks org, read_all perm, own report, team read via reporting subtree
2. can_read_follow_up(p_follow_up_id) — checks org, read_all perm, assigned_to, team read via reporting subtree

## RLS Enabled Tables
- daily_reports, daily_report_task_items, daily_report_attachments, daily_report_history,
  daily_report_comments, management_follow_ups, management_report_snapshots,
  notification_preferences, notification_deliveries, email_templates,
  announcements, announcement_acknowledgements, export_jobs
*/

-- ============================================================
-- Helper Functions
-- ============================================================

CREATE OR REPLACE FUNCTION public.can_read_daily_report(p_report_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_org uuid;
  v_uid uuid := auth.uid();
  v_emp_id uuid;
  v_report_emp_id uuid;
  v_has_read_all boolean;
  v_has_read_team boolean;
BEGIN
  IF v_uid IS NULL THEN RETURN false; END IF;

  SELECT organization_id, employee_id INTO v_org, v_report_emp_id
  FROM daily_reports WHERE id = p_report_id;
  IF v_org IS NULL THEN RETURN false; END IF;
  IF v_org <> current_user_org_id() THEN RETURN false; END IF;

  v_has_read_all := current_user_has_permission('daily_report.read_all');
  IF v_has_read_all THEN RETURN true; END IF;

  v_emp_id := current_user_employee_id();
  IF v_emp_id = v_report_emp_id THEN RETURN true; END IF;

  v_has_read_team := current_user_has_permission('daily_report.read_team');
  IF v_has_read_team THEN
    RETURN is_in_reporting_subtree(v_emp_id, v_report_emp_id);
  END IF;

  RETURN false;
END;
$function$;

CREATE OR REPLACE FUNCTION public.can_read_follow_up(p_follow_up_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_org uuid;
  v_uid uuid := auth.uid();
  v_emp_id uuid;
  v_follow_emp_id uuid;
  v_assigned_to uuid;
  v_has_read_all boolean;
  v_has_read_team boolean;
BEGIN
  IF v_uid IS NULL THEN RETURN false; END IF;

  SELECT organization_id, employee_id, assigned_to
  INTO v_org, v_follow_emp_id, v_assigned_to
  FROM management_follow_ups WHERE id = p_follow_up_id;
  IF v_org IS NULL THEN RETURN false; END IF;
  IF v_org <> current_user_org_id() THEN RETURN false; END IF;

  v_has_read_all := current_user_has_permission('follow_up.read_all');
  IF v_has_read_all THEN RETURN true; END IF;

  IF v_assigned_to = v_uid THEN RETURN true; END IF;

  v_emp_id := current_user_employee_id();
  v_has_read_team := current_user_has_permission('follow_up.read_team');
  IF v_has_read_team THEN
    RETURN is_in_reporting_subtree(v_emp_id, v_follow_emp_id);
  END IF;

  RETURN false;
END;
$function$;

-- ============================================================
-- 1. daily_reports
-- ============================================================
ALTER TABLE daily_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_daily_reports" ON daily_reports;
CREATE POLICY "select_daily_reports" ON daily_reports FOR SELECT
  TO authenticated USING (can_read_daily_report(id));

DROP POLICY IF EXISTS "insert_daily_reports" ON daily_reports;
CREATE POLICY "insert_daily_reports" ON daily_reports FOR INSERT
  TO authenticated WITH CHECK (
    organization_id = current_user_org_id()
    AND employee_id = current_user_employee_id()
    AND current_user_has_permission('daily_report.submit')
  );

DROP POLICY IF EXISTS "update_daily_reports" ON daily_reports;
CREATE POLICY "update_daily_reports" ON daily_reports FOR UPDATE
  TO authenticated USING (
    organization_id = current_user_org_id()
    AND (
      employee_id = current_user_employee_id()
      OR current_user_has_permission('daily_report.review')
      OR current_user_has_permission('daily_report.reopen')
    )
  ) WITH CHECK (organization_id = current_user_org_id());

-- ============================================================
-- 2. daily_report_task_items
-- ============================================================
ALTER TABLE daily_report_task_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_daily_report_task_items" ON daily_report_task_items;
CREATE POLICY "select_daily_report_task_items" ON daily_report_task_items FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM daily_reports WHERE id = daily_report_task_items.daily_report_id AND can_read_daily_report(daily_reports.id))
  );

DROP POLICY IF EXISTS "insert_daily_report_task_items" ON daily_report_task_items;
CREATE POLICY "insert_daily_report_task_items" ON daily_report_task_items FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (
      SELECT 1 FROM daily_reports
      WHERE id = daily_report_task_items.daily_report_id
      AND organization_id = current_user_org_id()
      AND employee_id = current_user_employee_id()
    )
  );

DROP POLICY IF EXISTS "update_daily_report_task_items" ON daily_report_task_items;
CREATE POLICY "update_daily_report_task_items" ON daily_report_task_items FOR UPDATE
  TO authenticated USING (
    EXISTS (
      SELECT 1 FROM daily_reports
      WHERE id = daily_report_task_items.daily_report_id
      AND organization_id = current_user_org_id()
      AND employee_id = current_user_employee_id()
    )
  ) WITH CHECK (
    EXISTS (
      SELECT 1 FROM daily_reports
      WHERE id = daily_report_task_items.daily_report_id
      AND organization_id = current_user_org_id()
    )
  );

DROP POLICY IF EXISTS "delete_daily_report_task_items" ON daily_report_task_items;
CREATE POLICY "delete_daily_report_task_items" ON daily_report_task_items FOR DELETE
  TO authenticated USING (
    EXISTS (
      SELECT 1 FROM daily_reports
      WHERE id = daily_report_task_items.daily_report_id
      AND organization_id = current_user_org_id()
      AND employee_id = current_user_employee_id()
    )
  );

-- ============================================================
-- 3. daily_report_attachments
-- ============================================================
ALTER TABLE daily_report_attachments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_daily_report_attachments" ON daily_report_attachments;
CREATE POLICY "select_daily_report_attachments" ON daily_report_attachments FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM daily_reports WHERE id = daily_report_attachments.daily_report_id AND can_read_daily_report(daily_reports.id))
  );

DROP POLICY IF EXISTS "insert_daily_report_attachments" ON daily_report_attachments;
CREATE POLICY "insert_daily_report_attachments" ON daily_report_attachments FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (
      SELECT 1 FROM daily_reports
      WHERE id = daily_report_attachments.daily_report_id
      AND organization_id = current_user_org_id()
      AND employee_id = current_user_employee_id()
    )
  );

DROP POLICY IF EXISTS "delete_daily_report_attachments" ON daily_report_attachments;
CREATE POLICY "delete_daily_report_attachments" ON daily_report_attachments FOR DELETE
  TO authenticated USING (
    EXISTS (
      SELECT 1 FROM daily_reports
      WHERE id = daily_report_attachments.daily_report_id
      AND organization_id = current_user_org_id()
      AND employee_id = current_user_employee_id()
    )
  );

-- ============================================================
-- 4. daily_report_history — append-only, SELECT + INSERT only
-- ============================================================
ALTER TABLE daily_report_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_daily_report_history" ON daily_report_history;
CREATE POLICY "select_daily_report_history" ON daily_report_history FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM daily_reports WHERE id = daily_report_history.daily_report_id AND can_read_daily_report(daily_reports.id))
  );

DROP POLICY IF EXISTS "insert_daily_report_history" ON daily_report_history;
CREATE POLICY "insert_daily_report_history" ON daily_report_history FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (
      SELECT 1 FROM daily_reports
      WHERE id = daily_report_history.daily_report_id
      AND organization_id = current_user_org_id()
    )
  );

-- ============================================================
-- 5. daily_report_comments
-- ============================================================
ALTER TABLE daily_report_comments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_daily_report_comments" ON daily_report_comments;
CREATE POLICY "select_daily_report_comments" ON daily_report_comments FOR SELECT
  TO authenticated USING (
    deleted_at IS NULL
    AND EXISTS (SELECT 1 FROM daily_reports WHERE id = daily_report_comments.daily_report_id AND can_read_daily_report(daily_reports.id))
  );

DROP POLICY IF EXISTS "insert_daily_report_comments" ON daily_report_comments;
CREATE POLICY "insert_daily_report_comments" ON daily_report_comments FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (
      SELECT 1 FROM daily_reports
      WHERE id = daily_report_comments.daily_report_id
      AND organization_id = current_user_org_id()
      AND can_read_daily_report(daily_reports.id)
    )
  );

DROP POLICY IF EXISTS "update_daily_report_comments" ON daily_report_comments;
CREATE POLICY "update_daily_report_comments" ON daily_report_comments FOR UPDATE
  TO authenticated USING (author_id = auth.uid()) WITH CHECK (author_id = auth.uid());

-- ============================================================
-- 6. management_follow_ups
-- ============================================================
ALTER TABLE management_follow_ups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_management_follow_ups" ON management_follow_ups;
CREATE POLICY "select_management_follow_ups" ON management_follow_ups FOR SELECT
  TO authenticated USING (can_read_follow_up(id));

DROP POLICY IF EXISTS "insert_management_follow_ups" ON management_follow_ups;
CREATE POLICY "insert_management_follow_ups" ON management_follow_ups FOR INSERT
  TO authenticated WITH CHECK (
    organization_id = current_user_org_id()
    AND current_user_has_permission('follow_up.create')
  );

DROP POLICY IF EXISTS "update_management_follow_ups" ON management_follow_ups;
CREATE POLICY "update_management_follow_ups" ON management_follow_ups FOR UPDATE
  TO authenticated USING (
    organization_id = current_user_org_id()
    AND (
      assigned_to = auth.uid()
      OR current_user_has_permission('follow_up.assign')
      OR current_user_has_permission('follow_up.resolve')
      OR current_user_has_permission('follow_up.close')
    )
  ) WITH CHECK (organization_id = current_user_org_id());

-- ============================================================
-- 7. management_report_snapshots — immutable, SELECT + INSERT only
-- ============================================================
ALTER TABLE management_report_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_management_report_snapshots" ON management_report_snapshots;
CREATE POLICY "select_management_report_snapshots" ON management_report_snapshots FOR SELECT
  TO authenticated USING (
    organization_id = current_user_org_id()
    AND current_user_has_permission('daily_report.view_consolidated')
  );

DROP POLICY IF EXISTS "insert_management_report_snapshots" ON management_report_snapshots;
CREATE POLICY "insert_management_report_snapshots" ON management_report_snapshots FOR INSERT
  TO authenticated WITH CHECK (
    organization_id = current_user_org_id()
    AND current_user_has_permission('daily_report.view_consolidated')
  );

-- ============================================================
-- 8. notification_preferences
-- ============================================================
ALTER TABLE notification_preferences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_notification_preferences" ON notification_preferences;
CREATE POLICY "select_notification_preferences" ON notification_preferences FOR SELECT
  TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS "insert_notification_preferences" ON notification_preferences;
CREATE POLICY "insert_notification_preferences" ON notification_preferences FOR INSERT
  TO authenticated WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "update_notification_preferences" ON notification_preferences;
CREATE POLICY "update_notification_preferences" ON notification_preferences FOR UPDATE
  TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- ============================================================
-- 9. notification_deliveries
-- ============================================================
ALTER TABLE notification_deliveries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_notification_deliveries" ON notification_deliveries;
CREATE POLICY "select_notification_deliveries" ON notification_deliveries FOR SELECT
  TO authenticated USING (
    current_user_has_permission('notification.view_delivery_logs')
    OR EXISTS (
      SELECT 1 FROM notifications
      WHERE id = notification_deliveries.notification_id
      AND recipient_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "update_notification_deliveries" ON notification_deliveries;
CREATE POLICY "update_notification_deliveries" ON notification_deliveries FOR UPDATE
  TO authenticated USING (
    current_user_has_permission('notification.view_delivery_logs')
  ) WITH CHECK (
    current_user_has_permission('notification.view_delivery_logs')
  );

-- ============================================================
-- 10. email_templates
-- ============================================================
ALTER TABLE email_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_email_templates" ON email_templates;
CREATE POLICY "select_email_templates" ON email_templates FOR SELECT
  TO authenticated USING (
    organization_id IS NULL OR organization_id = current_user_org_id()
  );

DROP POLICY IF EXISTS "insert_email_templates" ON email_templates;
CREATE POLICY "insert_email_templates" ON email_templates FOR INSERT
  TO authenticated WITH CHECK (
    (organization_id IS NULL OR organization_id = current_user_org_id())
    AND current_user_has_permission('notification.manage_templates')
  );

DROP POLICY IF EXISTS "update_email_templates" ON email_templates;
CREATE POLICY "update_email_templates" ON email_templates FOR UPDATE
  TO authenticated USING (
    (organization_id IS NULL OR organization_id = current_user_org_id())
    AND current_user_has_permission('notification.manage_templates')
  ) WITH CHECK (
    (organization_id IS NULL OR organization_id = current_user_org_id())
    AND current_user_has_permission('notification.manage_templates')
  );

DROP POLICY IF EXISTS "delete_email_templates" ON email_templates;
CREATE POLICY "delete_email_templates" ON email_templates FOR DELETE
  TO authenticated USING (
    (organization_id IS NULL OR organization_id = current_user_org_id())
    AND current_user_has_permission('notification.manage_templates')
  );

-- ============================================================
-- 11. announcements
-- ============================================================
ALTER TABLE announcements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_announcements" ON announcements;
CREATE POLICY "select_announcements" ON announcements FOR SELECT
  TO authenticated USING (
    organization_id = current_user_org_id()
    AND (
      target_scope = 'all'
      OR (target_scope = 'branch' AND branch_id = (
        SELECT e.branch_id FROM employees e WHERE e.user_id = auth.uid() AND e.is_active = true LIMIT 1
      ))
      OR (target_scope = 'department' AND department_id = (
        SELECT e.department_id FROM employees e WHERE e.user_id = auth.uid() AND e.is_active = true LIMIT 1
      ))
      OR (target_scope = 'role' AND role_code = (
        SELECT up.role FROM user_profiles up WHERE up.id = auth.uid()
      ))
      OR (target_scope = 'employee' AND employee_id = current_user_employee_id())
    )
  );

DROP POLICY IF EXISTS "insert_announcements" ON announcements;
CREATE POLICY "insert_announcements" ON announcements FOR INSERT
  TO authenticated WITH CHECK (
    organization_id = current_user_org_id()
    AND current_user_has_permission('announcement.create')
  );

DROP POLICY IF EXISTS "update_announcements" ON announcements;
CREATE POLICY "update_announcements" ON announcements FOR UPDATE
  TO authenticated USING (
    organization_id = current_user_org_id()
    AND (created_by = auth.uid() OR current_user_has_permission('announcement.edit_all'))
  ) WITH CHECK (organization_id = current_user_org_id());

-- ============================================================
-- 12. announcement_acknowledgements
-- ============================================================
ALTER TABLE announcement_acknowledgements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_announcement_acknowledgements" ON announcement_acknowledgements;
CREATE POLICY "select_announcement_acknowledgements" ON announcement_acknowledgements FOR SELECT
  TO authenticated USING (
    user_id = auth.uid()
    OR current_user_has_permission('announcement.view_acknowledgements')
  );

DROP POLICY IF EXISTS "insert_announcement_acknowledgements" ON announcement_acknowledgements;
CREATE POLICY "insert_announcement_acknowledgements" ON announcement_acknowledgements FOR INSERT
  TO authenticated WITH CHECK (user_id = auth.uid());

-- ============================================================
-- 13. export_jobs
-- ============================================================
ALTER TABLE export_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_export_jobs" ON export_jobs;
CREATE POLICY "select_export_jobs" ON export_jobs FOR SELECT
  TO authenticated USING (
    organization_id = current_user_org_id()
    AND (
      requested_by = auth.uid()
      OR current_user_has_permission('export.audit_read')
    )
  );

DROP POLICY IF EXISTS "insert_export_jobs" ON export_jobs;
CREATE POLICY "insert_export_jobs" ON export_jobs FOR INSERT
  TO authenticated WITH CHECK (
    organization_id = current_user_org_id()
    AND current_user_has_permission('export.request')
  );

DROP POLICY IF EXISTS "update_export_jobs" ON export_jobs;
CREATE POLICY "update_export_jobs" ON export_jobs FOR UPDATE
  TO authenticated USING (
    organization_id = current_user_org_id()
    AND current_user_has_permission('export.audit_read')
  ) WITH CHECK (
    organization_id = current_user_org_id()
  );
