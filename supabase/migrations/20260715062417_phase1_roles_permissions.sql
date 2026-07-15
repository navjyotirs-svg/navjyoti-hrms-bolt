/*
# Phase 1 — Roles, Permissions, and Role-Permission mapping (retry)

Retry of phase1_roles_permissions with typo fix (ON CONFLICT).
Tables and seed data are idempotent via IF NOT EXISTS and ON CONFLICT DO NOTHING.
*/

-- ============================================================
-- ROLES
-- ============================================================

CREATE TABLE IF NOT EXISTS roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text UNIQUE NOT NULL,
  label text NOT NULL,
  description text,
  is_system_role boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE roles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_roles_all" ON roles;
CREATE POLICY "select_roles_all"
  ON roles FOR SELECT
  TO authenticated
  USING (true);

-- ============================================================
-- PERMISSIONS
-- ============================================================

CREATE TABLE IF NOT EXISTS permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text UNIQUE NOT NULL,
  label text NOT NULL,
  description text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE permissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_permissions_all" ON permissions;
CREATE POLICY "select_permissions_all"
  ON permissions FOR SELECT
  TO authenticated
  USING (true);

-- ============================================================
-- ROLE_PERMISSIONS
-- ============================================================

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id uuid NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_role_permissions_all" ON role_permissions;
CREATE POLICY "select_role_permissions_all"
  ON role_permissions FOR SELECT
  TO authenticated
  USING (true);

-- ============================================================
-- SEED: ROLES
-- ============================================================

INSERT INTO roles (code, label, description, is_system_role) VALUES
  ('director', 'Director', 'Full system access and final approval authority', true),
  ('hr_admin', 'HR Administrator', 'Employee lifecycle, leave, and HR operations', true),
  ('manager', 'Manager', 'Department management, task assignment, and approvals', true),
  ('team_leader', 'Team Leader', 'Team coordination and task oversight', true),
  ('employee', 'Employee', 'Personal attendance, tasks, reports, and tickets', true),
  ('intern', 'Intern / Trainee', 'Learning track with guided task assignment', true),
  ('system_admin', 'System Administrator', 'Platform configuration and security', true)
ON CONFLICT (code) DO NOTHING;

-- ============================================================
-- SEED: PERMISSIONS
-- ============================================================

INSERT INTO permissions (code, label, description) VALUES
  ('organization.read', 'View Organization', 'View organization details'),
  ('organization.manage', 'Manage Organization', 'Create and edit organization settings'),
  ('branch.read', 'View Branches', 'View branch details'),
  ('branch.manage', 'Manage Branches', 'Create and edit branches'),
  ('department.read', 'View Departments', 'View department details'),
  ('department.manage', 'Manage Departments', 'Create and edit departments'),
  ('employee.read_self', 'View Own Profile', 'View own employee profile'),
  ('employee.read_team', 'View Team', 'View employees in reporting subtree'),
  ('employee.read_all', 'View All Employees', 'View all employees in the organization'),
  ('employee.create', 'Create Employee', 'Invite and create new employee accounts'),
  ('employee.update', 'Update Employee', 'Update employee details'),
  ('employee.deactivate', 'Deactivate Employee', 'Deactivate employee accounts'),
  ('role.assign', 'Assign Roles', 'Assign or change employee roles'),
  ('reporting_line.manage', 'Manage Reporting Lines', 'Set and modify reporting hierarchy'),
  ('audit.read', 'View Audit Trail', 'Read audit log entries')
ON CONFLICT (code) DO NOTHING;

-- ============================================================
-- SEED: ROLE_PERMISSIONS MATRIX
-- ============================================================

-- Director: all permissions
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.code = 'director'
ON CONFLICT DO NOTHING;

-- HR Administrator
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.code = 'hr_admin'
  AND p.code IN (
    'organization.read', 'branch.read', 'branch.manage',
    'department.read', 'department.manage',
    'employee.read_all', 'employee.create', 'employee.update', 'employee.deactivate',
    'role.assign', 'reporting_line.manage', 'audit.read'
  )
ON CONFLICT DO NOTHING;

-- Manager
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.code = 'manager'
  AND p.code IN (
    'organization.read', 'branch.read', 'department.read',
    'employee.read_team', 'employee.update', 'reporting_line.manage'
  )
ON CONFLICT DO NOTHING;

-- Team Leader
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.code = 'team_leader'
  AND p.code IN (
    'organization.read', 'branch.read', 'department.read',
    'employee.read_team'
  )
ON CONFLICT DO NOTHING;

-- Employee
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.code = 'employee' AND p.code = 'employee.read_self'
ON CONFLICT DO NOTHING;

-- Intern
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.code = 'intern' AND p.code = 'employee.read_self'
ON CONFLICT DO NOTHING;

-- System Administrator (no employee data by default)
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.code = 'system_admin'
  AND p.code IN ('organization.read', 'organization.manage', 'audit.read')
ON CONFLICT DO NOTHING;
