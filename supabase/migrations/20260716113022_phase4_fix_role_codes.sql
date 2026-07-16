/*
# Phase 4 — Fix permission assignments for correct role codes

## Root Cause
The Phase 4 permissions migration used role codes 'hr_administrator', 'intern_trainee', and 'system_administrator'
but the actual role codes in the database are 'hr_admin', 'intern', and 'system_admin'.

## Fix
Re-assign all Phase 4 permissions to the correct role codes.
*/

-- HR Administrator (actual code: hr_admin) — 18 new permissions
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.code = 'hr_admin'
  AND p.code IN (
    'leave.request_self', 'leave.read_self', 'leave.read_all',
    'leave.approve_hr', 'leave.cancel_self', 'leave.cancel_manage',
    'leave.balance_read_self', 'leave.balance_read_all', 'leave.balance_adjust',
    'leave.policy_manage', 'leave.document_upload_self', 'leave.document_read_manage',
    'calendar.read', 'calendar.event_create', 'calendar.event_update',
    'calendar.event_delete', 'calendar.holiday_manage', 'calendar.branch_manage'
  )
  AND NOT EXISTS (SELECT 1 FROM role_permissions rp WHERE rp.role_id = r.id AND rp.permission_id = p.id);

-- Team Leader (code: team_leader) — 7 new permissions
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.code = 'team_leader'
  AND p.code IN (
    'leave.request_self', 'leave.read_self', 'leave.read_team',
    'leave.cancel_self', 'leave.balance_read_self',
    'leave.document_upload_self', 'calendar.read'
  )
  AND NOT EXISTS (SELECT 1 FROM role_permissions rp WHERE rp.role_id = r.id AND rp.permission_id = p.id);

-- Intern/Trainee (actual code: intern) — 6 new permissions
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.code = 'intern'
  AND p.code IN (
    'leave.request_self', 'leave.read_self', 'leave.cancel_self',
    'leave.balance_read_self', 'leave.document_upload_self', 'calendar.read'
  )
  AND NOT EXISTS (SELECT 1 FROM role_permissions rp WHERE rp.role_id = r.id AND rp.permission_id = p.id);

-- System Administrator (actual code: system_admin) — calendar.read only
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.code = 'system_admin'
  AND p.code IN ('calendar.read')
  AND NOT EXISTS (SELECT 1 FROM role_permissions rp WHERE rp.role_id = r.id AND rp.permission_id = p.id);
