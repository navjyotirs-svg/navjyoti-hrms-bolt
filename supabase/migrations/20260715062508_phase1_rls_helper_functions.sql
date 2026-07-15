/*
# Phase 1 — RLS helper functions

1. Purpose
   - Create SECURITY DEFINER helper functions used by RLS policies across all tables.
   - These functions provide: current user's org, role code, permission check,
     reporting subtree check, and current user's employee_id.

2. Functions
   - current_user_org_id() — returns the user's active org from user_organization_memberships
   - current_user_role_code() — returns the user's role from user_profiles
   - current_user_has_permission(perm_code) — checks if user's role has the given permission
   - is_in_reporting_subtree(manager_id, employee_id) — recursive CTE check
   - current_user_employee_id() — returns the user's active employee record id

3. Security
   - All functions are SECURITY DEFINER so they can read from tables regardless of RLS.
   - They are STABLE (read-only) where applicable.
   - is_in_reporting_subtree uses a recursive CTE with cycle protection.
*/

-- Get the current user's organization_id
CREATE OR REPLACE FUNCTION current_user_org_id()
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT organization_id
  FROM user_organization_memberships
  WHERE user_id = auth.uid() AND is_active = true
  LIMIT 1
$$;

-- Get the current user's role code
CREATE OR REPLACE FUNCTION current_user_role_code()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT role
  FROM user_profiles
  WHERE id = auth.uid()
  LIMIT 1
$$;

-- Check if current user has a specific permission
CREATE OR REPLACE FUNCTION current_user_has_permission(perm_code text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM role_permissions rp
    JOIN permissions p ON p.id = rp.permission_id
    JOIN roles r ON r.id = rp.role_id
    JOIN user_profiles up ON up.role = r.code
    WHERE up.id = auth.uid()
      AND p.code = perm_code
  )
$$;

-- Get the current user's employee_id
CREATE OR REPLACE FUNCTION current_user_employee_id()
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT id FROM employees WHERE user_id = auth.uid() AND is_active = true LIMIT 1
$$;

-- Check if an employee is in the reporting subtree of a manager
-- Uses recursive CTE with cycle protection
CREATE OR REPLACE FUNCTION is_in_reporting_subtree(p_manager_id uuid, p_employee_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
DECLARE
  found_count integer;
BEGIN
  IF p_manager_id = p_employee_id THEN
    RETURN true;
  END IF;

  WITH RECURSIVE subtree AS (
    SELECT e.id AS emp_id
    FROM employees e
    JOIN employee_reporting_lines erl ON erl.employee_id = e.id
    WHERE erl.manager_id = p_manager_id

    UNION

    SELECT e.id AS emp_id
    FROM employees e
    JOIN employee_reporting_lines erl ON erl.employee_id = e.id
    JOIN subtree s ON s.emp_id = erl.manager_id
  )
  SELECT COUNT(*) INTO found_count
  FROM subtree
  WHERE emp_id = p_employee_id;

  RETURN found_count > 0;
END;
$$;
