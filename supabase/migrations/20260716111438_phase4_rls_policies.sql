/*
# Phase 4 — RLS Policies for Leave & Calendar Tables (retry with fixed syntax)

Fix: CREATE POLICY does not support IF EXISTS. Use DROP POLICY IF EXISTS before CREATE.
*/

-- ============ leave_types ============
DROP POLICY IF EXISTS "select_leave_types" ON leave_types;
CREATE POLICY "select_leave_types" ON leave_types FOR SELECT
  TO authenticated USING (organization_id = current_user_org_id());

DROP POLICY IF EXISTS "insert_leave_types" ON leave_types;
CREATE POLICY "insert_leave_types" ON leave_types FOR INSERT
  TO authenticated WITH CHECK (
    organization_id = current_user_org_id()
    AND current_user_has_permission('leave.policy_manage')
  );

DROP POLICY IF EXISTS "update_leave_types" ON leave_types;
CREATE POLICY "update_leave_types" ON leave_types FOR UPDATE
  TO authenticated
  USING (organization_id = current_user_org_id() AND current_user_has_permission('leave.policy_manage'))
  WITH CHECK (organization_id = current_user_org_id() AND current_user_has_permission('leave.policy_manage'));

DROP POLICY IF EXISTS "delete_leave_types" ON leave_types;
CREATE POLICY "delete_leave_types" ON leave_types FOR DELETE
  TO authenticated USING (
    organization_id = current_user_org_id() AND current_user_has_permission('leave.policy_manage')
  );

-- ============ leave_balances ============
DROP POLICY IF EXISTS "select_leave_balances" ON leave_balances;
CREATE POLICY "select_leave_balances" ON leave_balances FOR SELECT
  TO authenticated USING (
    organization_id = current_user_org_id()
    AND (
      employee_id IN (SELECT current_user_employee_id())
      OR current_user_has_permission('leave.balance_read_all')
      OR current_user_has_permission('leave.read_all')
      OR (
        current_user_has_permission('leave.read_team')
        AND is_in_reporting_subtree(current_user_employee_id(), employee_id)
      )
    )
  );

DROP POLICY IF EXISTS "insert_leave_balances" ON leave_balances;
CREATE POLICY "insert_leave_balances" ON leave_balances FOR INSERT
  TO authenticated WITH CHECK (
    organization_id = current_user_org_id()
    AND current_user_has_permission('leave.balance_adjust')
  );

DROP POLICY IF EXISTS "update_leave_balances" ON leave_balances;
CREATE POLICY "update_leave_balances" ON leave_balances FOR UPDATE
  TO authenticated
  USING (organization_id = current_user_org_id() AND current_user_has_permission('leave.balance_adjust'))
  WITH CHECK (organization_id = current_user_org_id() AND current_user_has_permission('leave.balance_adjust'));

-- ============ leave_ledger (append-only: SELECT + INSERT only) ============
DROP POLICY IF EXISTS "select_leave_ledger" ON leave_ledger;
CREATE POLICY "select_leave_ledger" ON leave_ledger FOR SELECT
  TO authenticated USING (
    organization_id = current_user_org_id()
    AND (
      employee_id IN (SELECT current_user_employee_id())
      OR current_user_has_permission('leave.balance_read_all')
      OR current_user_has_permission('leave.read_all')
      OR (
        current_user_has_permission('leave.read_team')
        AND is_in_reporting_subtree(current_user_employee_id(), employee_id)
      )
    )
  );

DROP POLICY IF EXISTS "insert_leave_ledger" ON leave_ledger;
CREATE POLICY "insert_leave_ledger" ON leave_ledger FOR INSERT
  TO authenticated WITH CHECK (organization_id = current_user_org_id());

-- ============ leave_requests ============
DROP POLICY IF EXISTS "select_leave_requests" ON leave_requests;
CREATE POLICY "select_leave_requests" ON leave_requests FOR SELECT
  TO authenticated USING (
    organization_id = current_user_org_id()
    AND (
      employee_id IN (SELECT current_user_employee_id())
      OR current_user_has_permission('leave.read_all')
      OR current_user_has_permission('leave.override_director')
      OR (
        current_user_has_permission('leave.read_team')
        AND is_in_reporting_subtree(current_user_employee_id(), employee_id)
      )
    )
  );

DROP POLICY IF EXISTS "insert_leave_requests" ON leave_requests;
CREATE POLICY "insert_leave_requests" ON leave_requests FOR INSERT
  TO authenticated WITH CHECK (
    organization_id = current_user_org_id()
    AND employee_id IN (SELECT current_user_employee_id())
    AND current_user_has_permission('leave.request_self')
  );

DROP POLICY IF EXISTS "update_leave_requests" ON leave_requests;
CREATE POLICY "update_leave_requests" ON leave_requests FOR UPDATE
  TO authenticated
  USING (
    organization_id = current_user_org_id()
    AND (
      employee_id IN (SELECT current_user_employee_id())
      OR current_user_has_permission('leave.review_manager')
      OR current_user_has_permission('leave.approve_hr')
      OR current_user_has_permission('leave.override_director')
      OR current_user_has_permission('leave.cancel_manage')
    )
  )
  WITH CHECK (
    organization_id = current_user_org_id()
    AND (
      employee_id IN (SELECT current_user_employee_id())
      OR current_user_has_permission('leave.review_manager')
      OR current_user_has_permission('leave.approve_hr')
      OR current_user_has_permission('leave.override_director')
      OR current_user_has_permission('leave.cancel_manage')
    )
  );

-- ============ leave_request_history (append-only: SELECT + INSERT only) ============
DROP POLICY IF EXISTS "select_leave_request_history" ON leave_request_history;
CREATE POLICY "select_leave_request_history" ON leave_request_history FOR SELECT
  TO authenticated USING (
    EXISTS (
      SELECT 1 FROM leave_requests lr
      WHERE lr.id = leave_request_history.leave_request_id
      AND lr.organization_id = current_user_org_id()
      AND (
        lr.employee_id IN (SELECT current_user_employee_id())
        OR current_user_has_permission('leave.read_all')
        OR current_user_has_permission('leave.override_director')
        OR (
          current_user_has_permission('leave.read_team')
          AND is_in_reporting_subtree(current_user_employee_id(), lr.employee_id)
        )
      )
    )
  );

DROP POLICY IF EXISTS "insert_leave_request_history" ON leave_request_history;
CREATE POLICY "insert_leave_request_history" ON leave_request_history FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (
      SELECT 1 FROM leave_requests lr
      WHERE lr.id = leave_request_history.leave_request_id
      AND lr.organization_id = current_user_org_id()
    )
  );

-- ============ calendar_events ============
DROP POLICY IF EXISTS "select_calendar_events" ON calendar_events;
CREATE POLICY "select_calendar_events" ON calendar_events FOR SELECT
  TO authenticated USING (
    organization_id = current_user_org_id()
    AND current_user_has_permission('calendar.read')
  );

DROP POLICY IF EXISTS "insert_calendar_events" ON calendar_events;
CREATE POLICY "insert_calendar_events" ON calendar_events FOR INSERT
  TO authenticated WITH CHECK (
    organization_id = current_user_org_id()
    AND current_user_has_permission('calendar.event_create')
  );

DROP POLICY IF EXISTS "update_calendar_events" ON calendar_events;
CREATE POLICY "update_calendar_events" ON calendar_events FOR UPDATE
  TO authenticated
  USING (organization_id = current_user_org_id() AND current_user_has_permission('calendar.event_update'))
  WITH CHECK (organization_id = current_user_org_id() AND current_user_has_permission('calendar.event_update'));

DROP POLICY IF EXISTS "delete_calendar_events" ON calendar_events;
CREATE POLICY "delete_calendar_events" ON calendar_events FOR DELETE
  TO authenticated USING (
    organization_id = current_user_org_id() AND current_user_has_permission('calendar.event_delete')
  );

-- ============ holiday_calendars ============
DROP POLICY IF EXISTS "select_holiday_calendars" ON holiday_calendars;
CREATE POLICY "select_holiday_calendars" ON holiday_calendars FOR SELECT
  TO authenticated USING (
    organization_id = current_user_org_id()
    AND current_user_has_permission('calendar.read')
  );

DROP POLICY IF EXISTS "insert_holiday_calendars" ON holiday_calendars;
CREATE POLICY "insert_holiday_calendars" ON holiday_calendars FOR INSERT
  TO authenticated WITH CHECK (
    organization_id = current_user_org_id()
    AND current_user_has_permission('calendar.holiday_manage')
  );

DROP POLICY IF EXISTS "update_holiday_calendars" ON holiday_calendars;
CREATE POLICY "update_holiday_calendars" ON holiday_calendars FOR UPDATE
  TO authenticated
  USING (organization_id = current_user_org_id() AND current_user_has_permission('calendar.holiday_manage'))
  WITH CHECK (organization_id = current_user_org_id() AND current_user_has_permission('calendar.holiday_manage'));

DROP POLICY IF EXISTS "delete_holiday_calendars" ON holiday_calendars;
CREATE POLICY "delete_holiday_calendars" ON holiday_calendars FOR DELETE
  TO authenticated USING (
    organization_id = current_user_org_id() AND current_user_has_permission('calendar.holiday_manage')
  );

-- ============ holiday_calendar_dates ============
DROP POLICY IF EXISTS "select_holiday_calendar_dates" ON holiday_calendar_dates;
CREATE POLICY "select_holiday_calendar_dates" ON holiday_calendar_dates FOR SELECT
  TO authenticated USING (
    EXISTS (
      SELECT 1 FROM holiday_calendars hc
      WHERE hc.id = holiday_calendar_dates.holiday_calendar_id
      AND hc.organization_id = current_user_org_id()
      AND current_user_has_permission('calendar.read')
    )
  );

DROP POLICY IF EXISTS "insert_holiday_calendar_dates" ON holiday_calendar_dates;
CREATE POLICY "insert_holiday_calendar_dates" ON holiday_calendar_dates FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (
      SELECT 1 FROM holiday_calendars hc
      WHERE hc.id = holiday_calendar_dates.holiday_calendar_id
      AND hc.organization_id = current_user_org_id()
      AND current_user_has_permission('calendar.holiday_manage')
    )
  );

DROP POLICY IF EXISTS "update_holiday_calendar_dates" ON holiday_calendar_dates;
CREATE POLICY "update_holiday_calendar_dates" ON holiday_calendar_dates FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM holiday_calendars hc
      WHERE hc.id = holiday_calendar_dates.holiday_calendar_id
      AND hc.organization_id = current_user_org_id()
      AND current_user_has_permission('calendar.holiday_manage')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM holiday_calendars hc
      WHERE hc.id = holiday_calendar_dates.holiday_calendar_id
      AND hc.organization_id = current_user_org_id()
      AND current_user_has_permission('calendar.holiday_manage')
    )
  );

DROP POLICY IF EXISTS "delete_holiday_calendar_dates" ON holiday_calendar_dates;
CREATE POLICY "delete_holiday_calendar_dates" ON holiday_calendar_dates FOR DELETE
  TO authenticated USING (
    EXISTS (
      SELECT 1 FROM holiday_calendars hc
      WHERE hc.id = holiday_calendar_dates.holiday_calendar_id
      AND hc.organization_id = current_user_org_id()
      AND current_user_has_permission('calendar.holiday_manage')
    )
  );
