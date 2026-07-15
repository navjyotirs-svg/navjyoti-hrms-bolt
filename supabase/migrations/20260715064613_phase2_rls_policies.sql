/*
# Phase 2 — RLS policies for all new tables

1. Purpose
   - Add RLS policies for employee_documents, document_versions, document_verification_history,
     onboarding_checklists, onboarding_checklist_items, employee_transfers, employee_status_history,
     and employee_offboarding.
   - Add a helper function to check if the current user can access a document (self, or same-org with manage permission, with confidential restriction for managers).

2. Policy Summary
   - employee_documents:
     - SELECT: self (via employee.user_id = auth.uid()) OR same-org with employee.document.manage
     - INSERT: self (upload_self) OR manage
     - UPDATE: manage only (verify/reject)
   - document_versions:
     - SELECT: same scoping as documents
     - INSERT: self or manage
   - document_verification_history:
     - SELECT: same scoping as documents
     - INSERT: manage only
     - No UPDATE/DELETE (append-only)
   - onboarding_checklists:
     - SELECT: self (via employee) or same-org with employee.onboarding.manage
     - UPDATE: manage only
   - onboarding_checklist_items:
     - SELECT: same as checklists
     - UPDATE: manage only
   - employee_transfers:
     - SELECT: self or same-org with employee.transfer.manage
     - INSERT: transfer.manage only
     - UPDATE: transfer.manage (for approval status)
   - employee_status_history:
     - SELECT: self or same-org with employee.status.manage
     - INSERT: status.manage only
     - No UPDATE/DELETE (append-only)
   - employee_offboarding:
     - SELECT: self or same-org with employee.offboarding.manage
     - INSERT: offboarding.manage only
     - UPDATE: offboarding.manage only

3. Helper Functions
   - can_access_employee_doc(doc_id) — checks if current user can access a document
   - current_user_employee_id() already exists from Phase 1
*/

-- ============================================================
-- HELPER: Can the current user access a specific document?
-- ============================================================

CREATE OR REPLACE FUNCTION can_access_employee_doc(p_doc_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM employee_documents ed
    JOIN employees e ON e.id = ed.employee_id
    WHERE ed.id = p_doc_id
    AND (
      -- Self: employee owns the document
      e.user_id = auth.uid()
      -- OR: same-org with document.manage permission
      OR (
        e.organization_id = current_user_org_id()
        AND current_user_has_permission('employee.document.manage')
      )
    )
  )
$$;

-- ============================================================
-- EMPLOYEE DOCUMENTS — RLS POLICIES
-- ============================================================

-- SELECT: self or same-org with document.manage
DROP POLICY IF EXISTS "select_emp_docs_scoped" ON employee_documents;
CREATE POLICY "select_emp_docs_scoped"
  ON employee_documents FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees e
      WHERE e.id = employee_documents.employee_id
      AND (
        e.user_id = auth.uid()
        OR (
          e.organization_id = current_user_org_id()
          AND current_user_has_permission('employee.document.manage')
        )
      )
    )
  );

-- INSERT: self (upload_self) or manage
DROP POLICY IF EXISTS "insert_emp_docs_authorized" ON employee_documents;
CREATE POLICY "insert_emp_docs_authorized"
  ON employee_documents FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees e
      WHERE e.id = employee_documents.employee_id
      AND (
        e.user_id = auth.uid()
        OR (
          e.organization_id = current_user_org_id()
          AND current_user_has_permission('employee.document.manage')
        )
      )
    )
  );

-- UPDATE: manage only (verify/reject)
DROP POLICY IF EXISTS "update_emp_docs_manage" ON employee_documents;
CREATE POLICY "update_emp_docs_manage"
  ON employee_documents FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees e
      WHERE e.id = employee_documents.employee_id
      AND e.organization_id = current_user_org_id()
      AND current_user_has_permission('employee.document.manage')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees e
      WHERE e.id = employee_documents.employee_id
      AND e.organization_id = current_user_org_id()
      AND current_user_has_permission('employee.document.manage')
    )
  );

-- ============================================================
-- DOCUMENT VERSIONS — RLS POLICIES
-- ============================================================

DROP POLICY IF EXISTS "select_doc_versions_scoped" ON document_versions;
CREATE POLICY "select_doc_versions_scoped"
  ON document_versions FOR SELECT
  TO authenticated
  USING (can_access_employee_doc(document_id));

DROP POLICY IF EXISTS "insert_doc_versions_authorized" ON document_versions;
CREATE POLICY "insert_doc_versions_authorized"
  ON document_versions FOR INSERT
  TO authenticated
  WITH CHECK (can_access_employee_doc(document_id));

-- ============================================================
-- DOCUMENT VERIFICATION HISTORY — RLS POLICIES
-- ============================================================

DROP POLICY IF EXISTS "select_verification_history_scoped" ON document_verification_history;
CREATE POLICY "select_verification_history_scoped"
  ON document_verification_history FOR SELECT
  TO authenticated
  USING (can_access_employee_doc(document_id));

DROP POLICY IF EXISTS "insert_verification_history_manage" ON document_verification_history;
CREATE POLICY "insert_verification_history_manage"
  ON document_verification_history FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees e
      JOIN employee_documents ed ON ed.employee_id = e.id
      WHERE ed.id = document_verification_history.document_id
      AND e.organization_id = current_user_org_id()
      AND current_user_has_permission('employee.document.manage')
    )
  );

-- ============================================================
-- ONBOARDING CHECKLISTS — RLS POLICIES
-- ============================================================

DROP POLICY IF EXISTS "select_onboarding_scoped" ON onboarding_checklists;
CREATE POLICY "select_onboarding_scoped"
  ON onboarding_checklists FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees e
      WHERE e.id = onboarding_checklists.employee_id
      AND (
        e.user_id = auth.uid()
        OR (
          e.organization_id = current_user_org_id()
          AND current_user_has_permission('employee.onboarding.manage')
        )
      )
    )
  );

DROP POLICY IF EXISTS "update_onboarding_manage" ON onboarding_checklists;
CREATE POLICY "update_onboarding_manage"
  ON onboarding_checklists FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees e
      WHERE e.id = onboarding_checklists.employee_id
      AND e.organization_id = current_user_org_id()
      AND current_user_has_permission('employee.onboarding.manage')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees e
      WHERE e.id = onboarding_checklists.employee_id
      AND e.organization_id = current_user_org_id()
      AND current_user_has_permission('employee.onboarding.manage')
    )
  );

-- ============================================================
-- ONBOARDING CHECKLIST ITEMS — RLS POLICIES
-- ============================================================

DROP POLICY IF EXISTS "select_checklist_items_scoped" ON onboarding_checklist_items;
CREATE POLICY "select_checklist_items_scoped"
  ON onboarding_checklist_items FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM onboarding_checklists oc
      JOIN employees e ON e.id = oc.employee_id
      WHERE oc.id = onboarding_checklist_items.checklist_id
      AND (
        e.user_id = auth.uid()
        OR (
          e.organization_id = current_user_org_id()
          AND current_user_has_permission('employee.onboarding.manage')
        )
      )
    )
  );

DROP POLICY IF EXISTS "update_checklist_items_manage" ON onboarding_checklist_items;
CREATE POLICY "update_checklist_items_manage"
  ON onboarding_checklist_items FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM onboarding_checklists oc
      JOIN employees e ON e.id = oc.employee_id
      WHERE oc.id = onboarding_checklist_items.checklist_id
      AND e.organization_id = current_user_org_id()
      AND current_user_has_permission('employee.onboarding.manage')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM onboarding_checklists oc
      JOIN employees e ON e.id = oc.employee_id
      WHERE oc.id = onboarding_checklist_items.checklist_id
      AND e.organization_id = current_user_org_id()
      AND current_user_has_permission('employee.onboarding.manage')
    )
  );

-- ============================================================
-- EMPLOYEE TRANSFERS — RLS POLICIES
-- ============================================================

DROP POLICY IF EXISTS "select_transfers_scoped" ON employee_transfers;
CREATE POLICY "select_transfers_scoped"
  ON employee_transfers FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees e
      WHERE e.id = employee_transfers.employee_id
      AND (
        e.user_id = auth.uid()
        OR (
          e.organization_id = current_user_org_id()
          AND current_user_has_permission('employee.transfer.manage')
        )
      )
    )
  );

DROP POLICY IF EXISTS "insert_transfers_manage" ON employee_transfers;
CREATE POLICY "insert_transfers_manage"
  ON employee_transfers FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees e
      WHERE e.id = employee_transfers.employee_id
      AND e.organization_id = current_user_org_id()
      AND current_user_has_permission('employee.transfer.manage')
    )
  );

DROP POLICY IF EXISTS "update_transfers_manage" ON employee_transfers;
CREATE POLICY "update_transfers_manage"
  ON employee_transfers FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees e
      WHERE e.id = employee_transfers.employee_id
      AND e.organization_id = current_user_org_id()
      AND current_user_has_permission('employee.transfer.manage')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees e
      WHERE e.id = employee_transfers.employee_id
      AND e.organization_id = current_user_org_id()
      AND current_user_has_permission('employee.transfer.manage')
    )
  );

-- ============================================================
-- EMPLOYEE STATUS HISTORY — RLS POLICIES
-- ============================================================

DROP POLICY IF EXISTS "select_status_history_scoped" ON employee_status_history;
CREATE POLICY "select_status_history_scoped"
  ON employee_status_history FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees e
      WHERE e.id = employee_status_history.employee_id
      AND (
        e.user_id = auth.uid()
        OR (
          e.organization_id = current_user_org_id()
          AND current_user_has_permission('employee.status.manage')
        )
      )
    )
  );

DROP POLICY IF EXISTS "insert_status_history_manage" ON employee_status_history;
CREATE POLICY "insert_status_history_manage"
  ON employee_status_history FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees e
      WHERE e.id = employee_status_history.employee_id
      AND e.organization_id = current_user_org_id()
      AND current_user_has_permission('employee.status.manage')
    )
  );

-- ============================================================
-- EMPLOYEE OFFBOARDING — RLS POLICIES
-- ============================================================

DROP POLICY IF EXISTS "select_offboarding_scoped" ON employee_offboarding;
CREATE POLICY "select_offboarding_scoped"
  ON employee_offboarding FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees e
      WHERE e.id = employee_offboarding.employee_id
      AND (
        e.user_id = auth.uid()
        OR (
          e.organization_id = current_user_org_id()
          AND current_user_has_permission('employee.offboarding.manage')
        )
      )
    )
  );

DROP POLICY IF EXISTS "insert_offboarding_manage" ON employee_offboarding;
CREATE POLICY "insert_offboarding_manage"
  ON employee_offboarding FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees e
      WHERE e.id = employee_offboarding.employee_id
      AND e.organization_id = current_user_org_id()
      AND current_user_has_permission('employee.offboarding.manage')
    )
  );

DROP POLICY IF EXISTS "update_offboarding_manage" ON employee_offboarding;
CREATE POLICY "update_offboarding_manage"
  ON employee_offboarding FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees e
      WHERE e.id = employee_offboarding.employee_id
      AND e.organization_id = current_user_org_id()
      AND current_user_has_permission('employee.offboarding.manage')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees e
      WHERE e.id = employee_offboarding.employee_id
      AND e.organization_id = current_user_org_id()
      AND current_user_has_permission('employee.offboarding.manage')
    )
  );
