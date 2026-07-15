/*
# Phase 1 — Employee, reporting lines, and org memberships tables (no RLS yet)

1. Purpose
   - Create employees, employee_reporting_lines, and user_organization_memberships tables.
   - RLS policies will be added in a subsequent migration after helper functions are created.

2. New Tables
   - `employees` — the employee record linked to a user profile
   - `employee_reporting_lines` — maps employees to their managers
   - `user_organization_memberships` — maps users to organizations

3. Notes
   - RLS is enabled but no policies yet — tables are locked until policies are added.
*/

-- ============================================================
-- EMPLOYEES
-- ============================================================

CREATE TABLE IF NOT EXISTS employees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  branch_id uuid REFERENCES branches(id) ON DELETE SET NULL,
  department_id uuid REFERENCES departments(id) ON DELETE SET NULL,
  employee_code text NOT NULL,
  full_name text NOT NULL,
  designation text,
  work_email text NOT NULL,
  work_mode text NOT NULL DEFAULT 'Office' CHECK (work_mode IN ('Office', 'WFH', 'Hybrid')),
  employment_status text NOT NULL DEFAULT 'active' CHECK (employment_status IN ('active', 'on_leave', 'notice_period', 'inactive', 'terminated')),
  joining_date date NOT NULL DEFAULT CURRENT_DATE,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT employees_org_code_unique UNIQUE (organization_id, employee_code),
  CONSTRAINT employees_org_email_unique UNIQUE (organization_id, work_email)
);

ALTER TABLE employees ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_employees_user ON employees(user_id);
CREATE INDEX IF NOT EXISTS idx_employees_org ON employees(organization_id);
CREATE INDEX IF NOT EXISTS idx_employees_branch ON employees(branch_id);
CREATE INDEX IF NOT EXISTS idx_employees_dept ON employees(department_id);
CREATE INDEX IF NOT EXISTS idx_employees_active ON employees(is_active) WHERE is_active = true;

-- ============================================================
-- EMPLOYEE_REPORTING_LINES
-- ============================================================

CREATE TABLE IF NOT EXISTS employee_reporting_lines (
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  manager_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (employee_id, manager_id),
  CONSTRAINT no_self_reporting CHECK (employee_id <> manager_id)
);

ALTER TABLE employee_reporting_lines ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_reporting_manager ON employee_reporting_lines(manager_id);
CREATE INDEX IF NOT EXISTS idx_reporting_employee ON employee_reporting_lines(employee_id);

-- ============================================================
-- USER_ORGANIZATION_MEMBERSHIPS
-- ============================================================

CREATE TABLE IF NOT EXISTS user_organization_memberships (
  user_id uuid NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, organization_id)
);

ALTER TABLE user_organization_memberships ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_org_memberships_org ON user_organization_memberships(organization_id);
