/*
# Phase 4 — Leave & Calendar Permissions

## Purpose
Add 20 new permissions for leave management and calendar features, and assign them to roles.

## New Permissions (20)
### Leave Permissions (14)
1. leave.request_self — Employee can submit own leave requests
2. leave.read_self — Employee can read own leave requests and balances
3. leave.read_team — Manager can read team leave requests
4. leave.read_all — HR/Director can read all organization leave requests
5. leave.review_manager — Manager can approve/reject leave at manager stage
6. leave.approve_hr — HR can approve/reject leave at HR stage
7. leave.override_director — Director can override any leave decision
8. leave.cancel_self — Employee can cancel own leave requests
9. leave.cancel_manage — HR/Director can manage cancellations
10. leave.balance_read_self — Employee can read own leave balances
11. leave.balance_read_all — HR/Director can read all leave balances
12. leave.balance_adjust — HR can manually adjust leave balances
13. leave.policy_manage — HR/Director can manage leave types and policies
14. leave.document_upload_self — Employee can upload own supporting documents
15. leave.document_read_manage — HR/Director can read supporting documents

### Calendar Permissions (6)
16. calendar.read — All roles can view calendar
17. calendar.event_create — Authorized roles can create calendar events
18. calendar.event_update — Authorized roles can update calendar events
19. calendar.event_delete — Authorized roles can delete calendar events
20. calendar.holiday_manage — HR/Director can manage holiday calendars
21. calendar.branch_manage — HR/Director can manage branch-specific calendars

## Role Assignment Matrix
- director: all 21 new permissions
- hr_administrator: 18 new (all except leave.review_manager, leave.override_director, calendar.branch_manage optional)
- manager: 5 new (leave.read_team, leave.review_manager, leave.read_self, leave.request_self, leave.cancel_self, leave.balance_read_self, leave.document_upload_self, calendar.read)
- team_leader: 4 new (leave.read_team, leave.read_self, leave.request_self, leave.cancel_self, leave.balance_read_self, leave.document_upload_self, calendar.read)
- employee: 6 new (leave.request_self, leave.read_self, leave.cancel_self, leave.balance_read_self, leave.document_upload_self, calendar.read)
- intern_trainee: 6 new (same as employee)
- system_administrator: 1 new (calendar.read only — no leave or document access)

## Security
- No payroll/salary permissions added
- System Administrator gets no leave/document access by default
- Medical document access restricted to HR/Director only
*/

-- Insert new permissions (idempotent)
INSERT INTO permissions (code, label, description)
SELECT * FROM (VALUES
  ('leave.request_self', 'Request Own Leave', 'Submit own leave requests'),
  ('leave.read_self', 'Read Own Leave', 'View own leave requests and history'),
  ('leave.read_team', 'Read Team Leave', 'View leave requests of reporting team members'),
  ('leave.read_all', 'Read All Leave', 'View all organization leave requests'),
  ('leave.review_manager', 'Review as Manager', 'Approve or reject leave at manager review stage'),
  ('leave.approve_hr', 'Approve as HR', 'Final approval or rejection of leave requests'),
  ('leave.override_director', 'Director Override', 'Override any leave decision organization-wide'),
  ('leave.cancel_self', 'Cancel Own Leave', 'Cancel own submitted leave requests'),
  ('leave.cancel_manage', 'Manage Cancellations', 'Manage leave cancellations for employees'),
  ('leave.balance_read_self', 'Read Own Balances', 'View own leave balances and ledger'),
  ('leave.balance_read_all', 'Read All Balances', 'View all employee leave balances'),
  ('leave.balance_adjust', 'Adjust Balances', 'Manually adjust employee leave balances'),
  ('leave.policy_manage', 'Manage Leave Policy', 'Manage leave types, policies, and accrual rules'),
  ('leave.document_upload_self', 'Upload Leave Documents', 'Upload own leave supporting documents'),
  ('leave.document_read_manage', 'Read Leave Documents', 'Read employee leave supporting documents'),
  ('calendar.read', 'View Calendar', 'View company calendar and holidays'),
  ('calendar.event_create', 'Create Calendar Events', 'Create calendar events and announcements'),
  ('calendar.event_update', 'Update Calendar Events', 'Update existing calendar events'),
  ('calendar.event_delete', 'Delete Calendar Events', 'Delete calendar events'),
  ('calendar.holiday_manage', 'Manage Holidays', 'Manage holiday calendars and dates'),
  ('calendar.branch_manage', 'Manage Branch Calendars', 'Manage branch-specific calendar overrides')
) AS t(code, label, description)
WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE code = t.code);

-- Assign permissions to roles
-- Director: all 21 new permissions
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.code = 'director'
  AND p.code IN (
    'leave.request_self', 'leave.read_self', 'leave.read_team', 'leave.read_all',
    'leave.review_manager', 'leave.approve_hr', 'leave.override_director',
    'leave.cancel_self', 'leave.cancel_manage', 'leave.balance_read_self',
    'leave.balance_read_all', 'leave.balance_adjust', 'leave.policy_manage',
    'leave.document_upload_self', 'leave.document_read_manage',
    'calendar.read', 'calendar.event_create', 'calendar.event_update',
    'calendar.event_delete', 'calendar.holiday_manage', 'calendar.branch_manage'
  )
  AND NOT EXISTS (SELECT 1 FROM role_permissions rp WHERE rp.role_id = r.id AND rp.permission_id = p.id);

-- HR Administrator: 18 new permissions (no manager review, no director override)
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.code = 'hr_administrator'
  AND p.code IN (
    'leave.request_self', 'leave.read_self', 'leave.read_all',
    'leave.approve_hr', 'leave.cancel_self', 'leave.cancel_manage',
    'leave.balance_read_self', 'leave.balance_read_all', 'leave.balance_adjust',
    'leave.policy_manage', 'leave.document_upload_self', 'leave.document_read_manage',
    'calendar.read', 'calendar.event_create', 'calendar.event_update',
    'calendar.event_delete', 'calendar.holiday_manage', 'calendar.branch_manage'
  )
  AND NOT EXISTS (SELECT 1 FROM role_permissions rp WHERE rp.role_id = r.id AND rp.permission_id = p.id);

-- Manager: 8 new permissions
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.code = 'manager'
  AND p.code IN (
    'leave.request_self', 'leave.read_self', 'leave.read_team',
    'leave.review_manager', 'leave.cancel_self', 'leave.balance_read_self',
    'leave.document_upload_self', 'calendar.read'
  )
  AND NOT EXISTS (SELECT 1 FROM role_permissions rp WHERE rp.role_id = r.id AND rp.permission_id = p.id);

-- Team Leader: 7 new permissions
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.code = 'team_leader'
  AND p.code IN (
    'leave.request_self', 'leave.read_self', 'leave.read_team',
    'leave.cancel_self', 'leave.balance_read_self',
    'leave.document_upload_self', 'calendar.read'
  )
  AND NOT EXISTS (SELECT 1 FROM role_permissions rp WHERE rp.role_id = r.id AND rp.permission_id = p.id);

-- Employee: 6 new permissions
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.code = 'employee'
  AND p.code IN (
    'leave.request_self', 'leave.read_self', 'leave.cancel_self',
    'leave.balance_read_self', 'leave.document_upload_self', 'calendar.read'
  )
  AND NOT EXISTS (SELECT 1 FROM role_permissions rp WHERE rp.role_id = r.id AND rp.permission_id = p.id);

-- Intern/Trainee: 6 new permissions (same as employee)
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.code = 'intern_trainee'
  AND p.code IN (
    'leave.request_self', 'leave.read_self', 'leave.cancel_self',
    'leave.balance_read_self', 'leave.document_upload_self', 'calendar.read'
  )
  AND NOT EXISTS (SELECT 1 FROM role_permissions rp WHERE rp.role_id = r.id AND rp.permission_id = p.id);

-- System Administrator: calendar.read only (no leave/document access)
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.code = 'system_administrator'
  AND p.code IN ('calendar.read')
  AND NOT EXISTS (SELECT 1 FROM role_permissions rp WHERE rp.role_id = r.id AND rp.permission_id = p.id);
