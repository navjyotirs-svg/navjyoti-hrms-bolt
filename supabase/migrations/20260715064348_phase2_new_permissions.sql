/*
# Phase 2 — Add new permissions and update role_permissions matrix

1. Purpose
   - Add 13 new permissions for employee lifecycle, documents, onboarding, transfers, status, and offboarding.
   - Update the role_permissions matrix to grant these new permissions to appropriate roles.

2. New Permissions (13)
   - employee.profile.read_self — View own extended profile
   - employee.profile.read_team — View team extended profiles
   - employee.profile.read_all — View all org employee profiles
   - employee.profile.update_self — Update own allowed profile fields
   - employee.profile.update_all — Update any employee's profile (HR/Director)
   - employee.document.upload_self — Upload own documents
   - employee.document.read_self — Read own documents
   - employee.document.manage — Manage (verify/reject/download) org documents
   - employee.onboarding.manage — Manage onboarding checklists
   - employee.transfer.manage — Initiate/approve transfers
   - employee.status.manage — Change employee employment status
   - employee.offboarding.manage — Manage offboarding workflow
   - employee.profile.view_sensitive — View sensitive fields (DOB, personal email, address, emergency contact)

3. Role Permission Updates
   - director: all 13 new permissions
   - hr_admin: all 13 new permissions (HR manages full lifecycle)
   - manager: employee.profile.read_team, employee.profile.read_self, employee.profile.update_self (no sensitive fields, no document access)
   - team_leader: employee.profile.read_team, employee.profile.read_self, employee.profile.update_self
   - employee: employee.profile.read_self, employee.profile.update_self, employee.document.upload_self, employee.document.read_self
   - intern: employee.profile.read_self, employee.profile.update_self, employee.document.upload_self, employee.document.read_self
   - system_admin: none of the new employee permissions (no HR data access)

4. Notes
   - The old Phase 1 permissions remain unchanged.
   - employee.profile.view_sensitive is granted only to director and hr_admin by default.
   - Managers and team leaders do NOT get employee.document.manage or employee.profile.view_sensitive.
*/

-- ============================================================
-- INSERT NEW PERMISSIONS
-- ============================================================

INSERT INTO permissions (code, label, description) VALUES
  ('employee.profile.read_self', 'View Own Profile', 'View own extended employee profile'),
  ('employee.profile.read_team', 'View Team Profiles', 'View extended profiles of reporting team'),
  ('employee.profile.read_all', 'View All Profiles', 'View all employee profiles in organization'),
  ('employee.profile.update_self', 'Update Own Profile', 'Update own allowed profile fields'),
  ('employee.profile.update_all', 'Update Employee Profiles', 'Update any employee profile (HR/Director)'),
  ('employee.document.upload_self', 'Upload Own Documents', 'Upload own employee documents'),
  ('employee.document.read_self', 'Read Own Documents', 'Read own uploaded documents'),
  ('employee.document.manage', 'Manage Documents', 'Verify, reject, and download organization documents'),
  ('employee.onboarding.manage', 'Manage Onboarding', 'Manage employee onboarding checklists'),
  ('employee.transfer.manage', 'Manage Transfers', 'Initiate and approve employee transfers'),
  ('employee.status.manage', 'Manage Employment Status', 'Change employee employment status'),
  ('employee.offboarding.manage', 'Manage Offboarding', 'Manage employee offboarding workflow'),
  ('employee.profile.view_sensitive', 'View Sensitive Fields', 'View sensitive profile fields (DOB, personal email, address, emergency contact)')
ON CONFLICT (code) DO NOTHING;

-- ============================================================
-- UPDATE ROLE_PERMISSIONS MATRIX
-- ============================================================

-- Director: all new permissions
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.code = 'director'
  AND p.code IN (
    'employee.profile.read_self', 'employee.profile.read_team', 'employee.profile.read_all',
    'employee.profile.update_self', 'employee.profile.update_all',
    'employee.document.upload_self', 'employee.document.read_self', 'employee.document.manage',
    'employee.onboarding.manage', 'employee.transfer.manage', 'employee.status.manage',
    'employee.offboarding.manage', 'employee.profile.view_sensitive'
  )
ON CONFLICT DO NOTHING;

-- HR Admin: all new permissions
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.code = 'hr_admin'
  AND p.code IN (
    'employee.profile.read_self', 'employee.profile.read_team', 'employee.profile.read_all',
    'employee.profile.update_self', 'employee.profile.update_all',
    'employee.document.upload_self', 'employee.document.read_self', 'employee.document.manage',
    'employee.onboarding.manage', 'employee.transfer.manage', 'employee.status.manage',
    'employee.offboarding.manage', 'employee.profile.view_sensitive'
  )
ON CONFLICT DO NOTHING;

-- Manager: team profile read, self read, self update (no sensitive, no document manage)
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.code = 'manager'
  AND p.code IN (
    'employee.profile.read_self', 'employee.profile.read_team', 'employee.profile.update_self'
  )
ON CONFLICT DO NOTHING;

-- Team Leader: team profile read, self read, self update
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.code = 'team_leader'
  AND p.code IN (
    'employee.profile.read_self', 'employee.profile.read_team', 'employee.profile.update_self'
  )
ON CONFLICT DO NOTHING;

-- Employee: self profile read, self update, document upload/read
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.code = 'employee'
  AND p.code IN (
    'employee.profile.read_self', 'employee.profile.update_self',
    'employee.document.upload_self', 'employee.document.read_self'
  )
ON CONFLICT DO NOTHING;

-- Intern: same as employee
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.code = 'intern'
  AND p.code IN (
    'employee.profile.read_self', 'employee.profile.update_self',
    'employee.document.upload_self', 'employee.document.read_self'
  )
ON CONFLICT DO NOTHING;

-- System Admin: no new employee permissions (no HR data access)
