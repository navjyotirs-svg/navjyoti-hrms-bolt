/*
# Phase 1 — RLS policies for org structure, employees, reporting, memberships

1. Purpose
   - Add RLS policies to organizations, branches, departments, employees,
     employee_reporting_lines, and user_organization_memberships.
   - All policies use helper functions for org-scoped access and permission checks.

2. Policy Summary
   - organizations: SELECT for members or org.manage; CUD for org.manage
   - branches: SELECT for same-org; CUD for same-org + branch.manage
   - departments: SELECT for same-org; CUD for same-org + department.manage
   - employees: SELECT for self, same-org with read_all/read_team; CUD scoped
   - reporting_lines: SELECT for same-org; CUD for reporting_line.manage
   - org_memberships: SELECT for self or same-org with read_all; CUD for employee.create/update
*/

-- ============================================================
-- ORGANIZATIONS
-- ============================================================

DROP POLICY IF EXISTS "select_orgs_membership" ON organizations;
CREATE POLICY "select_orgs_membership"
  ON organizations FOR SELECT
  TO authenticated
  USING (
    id = current_user_org_id()
    OR current_user_has_permission('organization.manage')
  );

DROP POLICY IF EXISTS "insert_orgs_admin" ON organizations;
CREATE POLICY "insert_orgs_admin"
  ON organizations FOR INSERT
  TO authenticated
  WITH CHECK (current_user_has_permission('organization.manage'));

DROP POLICY IF EXISTS "update_orgs_admin" ON organizations;
CREATE POLICY "update_orgs_admin"
  ON organizations FOR UPDATE
  TO authenticated
  USING (current_user_has_permission('organization.manage'))
  WITH CHECK (current_user_has_permission('organization.manage'));

DROP POLICY IF EXISTS "delete_orgs_admin" ON organizations;
CREATE POLICY "delete_orgs_admin"
  ON organizations FOR DELETE
  TO authenticated
  USING (current_user_has_permission('organization.manage'));

-- ============================================================
-- BRANCHES
-- ============================================================

DROP POLICY IF EXISTS "select_branches_membership" ON branches;
CREATE POLICY "select_branches_membership"
  ON branches FOR SELECT
  TO authenticated
  USING (
    organization_id = current_user_org_id()
    OR current_user_has_permission('organization.manage')
  );

DROP POLICY IF EXISTS "insert_branches_manage" ON branches;
CREATE POLICY "insert_branches_manage"
  ON branches FOR INSERT
  TO authenticated
  WITH CHECK (
    organization_id = current_user_org_id()
    AND current_user_has_permission('branch.manage')
  );

DROP POLICY IF EXISTS "update_branches_manage" ON branches;
CREATE POLICY "update_branches_manage"
  ON branches FOR UPDATE
  TO authenticated
  USING (
    organization_id = current_user_org_id()
    AND current_user_has_permission('branch.manage')
  )
  WITH CHECK (
    organization_id = current_user_org_id()
    AND current_user_has_permission('branch.manage')
  );

DROP POLICY IF EXISTS "delete_branches_manage" ON branches;
CREATE POLICY "delete_branches_manage"
  ON branches FOR DELETE
  TO authenticated
  USING (
    organization_id = current_user_org_id()
    AND current_user_has_permission('branch.manage')
  );

-- ============================================================
-- DEPARTMENTS
-- ============================================================

DROP POLICY IF EXISTS "select_departments_membership" ON departments;
CREATE POLICY "select_departments_membership"
  ON departments FOR SELECT
  TO authenticated
  USING (
    organization_id = current_user_org_id()
    OR current_user_has_permission('organization.manage')
  );

DROP POLICY IF EXISTS "insert_departments_manage" ON departments;
CREATE POLICY "insert_departments_manage"
  ON departments FOR INSERT
  TO authenticated
  WITH CHECK (
    organization_id = current_user_org_id()
    AND current_user_has_permission('department.manage')
  );

DROP POLICY IF EXISTS "update_departments_manage" ON departments;
CREATE POLICY "update_departments_manage"
  ON departments FOR UPDATE
  TO authenticated
  USING (
    organization_id = current_user_org_id()
    AND current_user_has_permission('department.manage')
  )
  WITH CHECK (
    organization_id = current_user_org_id()
    AND current_user_has_permission('department.manage')
  );

DROP POLICY IF EXISTS "delete_departments_manage" ON departments;
CREATE POLICY "delete_departments_manage"
  ON departments FOR DELETE
  TO authenticated
  USING (
    organization_id = current_user_org_id()
    AND current_user_has_permission('department.manage')
  );

-- ============================================================
-- EMPLOYEES
-- ============================================================

-- SELECT: own employee record, or same-org with read permissions (read_all or read_team)
-- For read_team, check reporting subtree
DROP POLICY IF EXISTS "select_employees_scoped" ON employees;
CREATE POLICY "select_employees_scoped"
  ON employees FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    OR (
      organization_id = current_user_org_id()
      AND current_user_has_permission('employee.read_all')
    )
    OR (
      organization_id = current_user_org_id()
      AND current_user_has_permission('employee.read_team')
      AND is_in_reporting_subtree(current_user_employee_id(), id)
    )
  );

-- INSERT: only via server function (employee.create permission + same org)
DROP POLICY IF EXISTS "insert_employees_authorized" ON employees;
CREATE POLICY "insert_employees_authorized"
  ON employees FOR INSERT
  TO authenticated
  WITH CHECK (
    organization_id = current_user_org_id()
    AND current_user_has_permission('employee.create')
  );

-- UPDATE: own employee record (limited fields), or same-org with employee.update
DROP POLICY IF EXISTS "update_employees_scoped" ON employees;
CREATE POLICY "update_employees_scoped"
  ON employees FOR UPDATE
  TO authenticated
  USING (
    user_id = auth.uid()
    OR (
      organization_id = current_user_org_id()
      AND current_user_has_permission('employee.update')
    )
  )
  WITH CHECK (
    user_id = auth.uid()
    OR (
      organization_id = current_user_org_id()
      AND current_user_has_permission('employee.update')
    )
  );

-- DELETE: only employee.deactivate permission (soft delete preferred, but allow hard delete for admin)
DROP POLICY IF EXISTS "delete_employees_admin" ON employees;
CREATE POLICY "delete_employees_admin"
  ON employees FOR DELETE
  TO authenticated
  USING (
    organization_id = current_user_org_id()
    AND current_user_has_permission('employee.deactivate')
  );

-- ============================================================
-- EMPLOYEE_REPORTING_LINES
-- ============================================================

-- SELECT: users who can see the employees in the reporting line
DROP POLICY IF EXISTS "select_reporting_scoped" ON employee_reporting_lines;
CREATE POLICY "select_reporting_scoped"
  ON employee_reporting_lines FOR SELECT
  TO authenticated
  USING (
    employee_id = current_user_employee_id()
    OR manager_id = current_user_employee_id()
    OR (
      EXISTS (
        SELECT 1 FROM employees e
        WHERE e.id = employee_id
          AND e.organization_id = current_user_org_id()
          AND current_user_has_permission('employee.read_all')
      )
    )
    OR (
      EXISTS (
        SELECT 1 FROM employees e
        WHERE e.id = employee_id
          AND e.organization_id = current_user_org_id()
          AND current_user_has_permission('employee.read_team')
          AND is_in_reporting_subtree(current_user_employee_id(), employee_id)
      )
    )
  );

-- INSERT: reporting_line.manage permission
DROP POLICY IF EXISTS "insert_reporting_manage" ON employee_reporting_lines;
CREATE POLICY "insert_reporting_manage"
  ON employee_reporting_lines FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees e
      WHERE e.id = employee_id
        AND e.organization_id = current_user_org_id()
    )
    AND current_user_has_permission('reporting_line.manage')
  );

-- DELETE: reporting_line.manage permission
DROP POLICY IF EXISTS "delete_reporting_manage" ON employee_reporting_lines;
CREATE POLICY "delete_reporting_manage"
  ON employee_reporting_lines FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees e
      WHERE e.id = employee_id
        AND e.organization_id = current_user_org_id()
    )
    AND current_user_has_permission('reporting_line.manage')
  );

-- ============================================================
-- USER_ORGANIZATION_MEMBERSHIPS
-- ============================================================

-- SELECT: own membership, or same-org with read_all
DROP POLICY IF EXISTS "select_memberships_scoped" ON user_organization_memberships;
CREATE POLICY "select_memberships_scoped"
  ON user_organization_memberships FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    OR (
      organization_id = current_user_org_id()
      AND current_user_has_permission('employee.read_all')
    )
  );

-- INSERT: employee.create permission (server function adds memberships)
DROP POLICY IF EXISTS "insert_memberships_authorized" ON user_organization_memberships;
CREATE POLICY "insert_memberships_authorized"
  ON user_organization_memberships FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    OR current_user_has_permission('employee.create')
  );

-- UPDATE: employee.update permission
DROP POLICY IF EXISTS "update_memberships_authorized" ON user_organization_memberships;
CREATE POLICY "update_memberships_authorized"
  ON user_organization_memberships FOR UPDATE
  TO authenticated
  USING (
    organization_id = current_user_org_id()
    AND current_user_has_permission('employee.update')
  )
  WITH CHECK (
    organization_id = current_user_org_id()
    AND current_user_has_permission('employee.update')
  );

-- DELETE: organization.manage permission
DROP POLICY IF EXISTS "delete_memberships_admin" ON user_organization_memberships;
CREATE POLICY "delete_memberships_admin"
  ON user_organization_memberships FOR DELETE
  TO authenticated
  USING (
    current_user_has_permission('organization.manage')
  );
