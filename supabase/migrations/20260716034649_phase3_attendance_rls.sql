/*
# Phase 3 — RLS policies for attendance tables

1. Purpose
   - Add RLS policies for attendance_records, attendance_evidence,
     attendance_corrections, and attendance_history.
   - All policies use existing helper functions for org-scoped access and permission checks.

2. Policy Summary
   - attendance_records:
     - SELECT: self (via employee.user_id = auth.uid()) OR same-org with read_all OR same-org with read_team + reporting subtree
     - INSERT: self only (check_in_self permission, employee_id = own employee_id)
     - UPDATE: correct_manage (same-org) — for corrections/recalculation
   - attendance_evidence:
     - SELECT: self (own evidence) OR same-org with evidence_read_all
     - INSERT: self only (evidence_upload_self)
     - No UPDATE/DELETE (immutable evidence)
   - attendance_corrections:
     - SELECT: self (own corrections) OR same-org with correct_manage
     - INSERT: self only (correct_request_self)
     - UPDATE: correct_manage (same-org) — for approval/rejection
   - attendance_history:
     - SELECT: self OR same-org with read_all OR same-org with read_team + subtree
     - INSERT: server functions (service role bypasses RLS); also allow authenticated for self-records
     - No UPDATE/DELETE (append-only)

3. Helper Functions
   - Uses existing: current_user_org_id(), current_user_has_permission(),
     current_user_employee_id(), is_in_reporting_subtree()
*/

-- ============================================================
-- ATTENDANCE_RECORDS — RLS POLICIES
-- ============================================================

-- SELECT: self, or same-org with read_all, or same-org with read_team + subtree
DROP POLICY IF EXISTS "select_attendance_scoped" ON attendance_records;
CREATE POLICY "select_attendance_scoped"
  ON attendance_records FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees e
      WHERE e.id = attendance_records.employee_id
      AND (
        e.user_id = auth.uid()
        OR (
          e.organization_id = current_user_org_id()
          AND current_user_has_permission('attendance.read_all')
        )
        OR (
          e.organization_id = current_user_org_id()
          AND current_user_has_permission('attendance.read_team')
          AND is_in_reporting_subtree(current_user_employee_id(), e.id)
        )
      )
    )
  );

-- INSERT: self only (check_in_self or check_out_self permission, own employee record)
DROP POLICY IF EXISTS "insert_attendance_self" ON attendance_records;
CREATE POLICY "insert_attendance_self"
  ON attendance_records FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees e
      WHERE e.id = attendance_records.employee_id
      AND e.user_id = auth.uid()
      AND (
        current_user_has_permission('attendance.check_in_self')
        OR current_user_has_permission('attendance.check_out_self')
      )
    )
  );

-- UPDATE: correct_manage (same-org) for corrections/recalculation
DROP POLICY IF EXISTS "update_attendance_manage" ON attendance_records;
CREATE POLICY "update_attendance_manage"
  ON attendance_records FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees e
      WHERE e.id = attendance_records.employee_id
      AND e.organization_id = current_user_org_id()
      AND current_user_has_permission('attendance.correct_manage')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees e
      WHERE e.id = attendance_records.employee_id
      AND e.organization_id = current_user_org_id()
      AND current_user_has_permission('attendance.correct_manage')
    )
  );

-- ============================================================
-- ATTENDANCE_EVIDENCE — RLS POLICIES
-- ============================================================

-- SELECT: self (own evidence) or same-org with evidence_read_all
DROP POLICY IF EXISTS "select_evidence_scoped" ON attendance_evidence;
CREATE POLICY "select_evidence_scoped"
  ON attendance_evidence FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees e
      WHERE e.id = attendance_evidence.employee_id
      AND (
        e.user_id = auth.uid()
        OR (
          e.organization_id = current_user_org_id()
          AND current_user_has_permission('attendance.evidence_read_all')
        )
      )
    )
  );

-- INSERT: self only (evidence_upload_self)
DROP POLICY IF EXISTS "insert_evidence_self" ON attendance_evidence;
CREATE POLICY "insert_evidence_self"
  ON attendance_evidence FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees e
      WHERE e.id = attendance_evidence.employee_id
      AND e.user_id = auth.uid()
      AND current_user_has_permission('attendance.evidence_upload_self')
    )
  );

-- No UPDATE or DELETE policies — evidence is immutable

-- ============================================================
-- ATTENDANCE_CORRECTIONS — RLS POLICIES
-- ============================================================

-- SELECT: self (own corrections) or same-org with correct_manage
DROP POLICY IF EXISTS "select_corrections_scoped" ON attendance_corrections;
CREATE POLICY "select_corrections_scoped"
  ON attendance_corrections FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees e
      WHERE e.id = attendance_corrections.employee_id
      AND (
        e.user_id = auth.uid()
        OR (
          e.organization_id = current_user_org_id()
          AND current_user_has_permission('attendance.correct_manage')
        )
      )
    )
  );

-- INSERT: self only (correct_request_self)
DROP POLICY IF EXISTS "insert_corrections_self" ON attendance_corrections;
CREATE POLICY "insert_corrections_self"
  ON attendance_corrections FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees e
      WHERE e.id = attendance_corrections.employee_id
      AND e.user_id = auth.uid()
      AND current_user_has_permission('attendance.correct_request_self')
    )
  );

-- UPDATE: correct_manage (same-org) for approval/rejection
DROP POLICY IF EXISTS "update_corrections_manage" ON attendance_corrections;
CREATE POLICY "update_corrections_manage"
  ON attendance_corrections FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees e
      WHERE e.id = attendance_corrections.employee_id
      AND e.organization_id = current_user_org_id()
      AND current_user_has_permission('attendance.correct_manage')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees e
      WHERE e.id = attendance_corrections.employee_id
      AND e.organization_id = current_user_org_id()
      AND current_user_has_permission('attendance.correct_manage')
    )
  );

-- ============================================================
-- ATTENDANCE_HISTORY — RLS POLICIES (append-only)
-- ============================================================

-- SELECT: self, or same-org with read_all, or same-org with read_team + subtree
DROP POLICY IF EXISTS "select_history_scoped" ON attendance_history;
CREATE POLICY "select_history_scoped"
  ON attendance_history FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees e
      WHERE e.id = attendance_history.employee_id
      AND (
        e.user_id = auth.uid()
        OR (
          e.organization_id = current_user_org_id()
          AND current_user_has_permission('attendance.read_all')
        )
        OR (
          e.organization_id = current_user_org_id()
          AND current_user_has_permission('attendance.read_team')
          AND is_in_reporting_subtree(current_user_employee_id(), e.id)
        )
      )
    )
  );

-- INSERT: server functions (service role bypasses RLS)
-- Also allow authenticated users for self-records (edge function uses service role anyway)
DROP POLICY IF EXISTS "insert_history_authorized" ON attendance_history;
CREATE POLICY "insert_history_authorized"
  ON attendance_history FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees e
      WHERE e.id = attendance_history.employee_id
      AND (
        e.user_id = auth.uid()
        OR (
          e.organization_id = current_user_org_id()
          AND (
            current_user_has_permission('attendance.read_all')
            OR current_user_has_permission('attendance.correct_manage')
          )
        )
      )
    )
  );

-- No UPDATE or DELETE policies — append-only
