/*
# Phase 3 — Attendance permissions and role_permissions matrix

1. Purpose
   - Add 11 new permissions for attendance check-in/checkout, evidence, corrections, and reporting.
   - Update the role_permissions matrix to grant these new permissions to appropriate roles.

2. New Permissions (11)
   - attendance.check_in_self — Check in for self
   - attendance.check_out_self — Check out for self
   - attendance.read_self — Read own attendance records
   - attendance.read_team — Read attendance for reporting subtree
   - attendance.read_all — Read all org attendance records
   - attendance.correct_request_self — Request correction for own attendance
   - attendance.correct_manage — Approve/reject attendance corrections
   - attendance.evidence_upload_self — Upload own attendance evidence
   - attendance.evidence_read_self — Read own attendance evidence
   - attendance.evidence_read_all — Read all org attendance evidence (HR/Director)
   - attendance.report_read — Read attendance reports

3. Role Permission Updates
   - director: all 11 new permissions
   - hr_admin: all 11 new permissions
   - manager: attendance.read_team, attendance.read_self, attendance.correct_manage, attendance.report_read (NO evidence access)
   - team_leader: attendance.read_self, attendance.read_team
   - employee: attendance.check_in_self, attendance.check_out_self, attendance.read_self, attendance.correct_request_self, attendance.evidence_upload_self, attendance.evidence_read_self
   - intern: same as employee
   - system_admin: none (no attendance evidence access)
*/

-- ============================================================
-- INSERT NEW PERMISSIONS
-- ============================================================

INSERT INTO permissions (code, label, description) VALUES
  ('attendance.check_in_self', 'Check In Self', 'Record own check-in attendance'),
  ('attendance.check_out_self', 'Check Out Self', 'Record own checkout attendance'),
  ('attendance.read_self', 'Read Own Attendance', 'View own attendance records'),
  ('attendance.read_team', 'Read Team Attendance', 'View attendance for reporting subtree'),
  ('attendance.read_all', 'Read All Attendance', 'View all organization attendance records'),
  ('attendance.correct_request_self', 'Request Attendance Correction', 'Request correction for own attendance'),
  ('attendance.correct_manage', 'Manage Attendance Corrections', 'Approve or reject attendance correction requests'),
  ('attendance.evidence_upload_self', 'Upload Attendance Evidence', 'Upload own attendance evidence (photo/location)'),
  ('attendance.evidence_read_self', 'Read Own Attendance Evidence', 'View own attendance evidence'),
  ('attendance.evidence_read_all', 'Read All Attendance Evidence', 'View all organization attendance evidence (HR/Director)'),
  ('attendance.report_read', 'Read Attendance Reports', 'View attendance summary reports')
ON CONFLICT (code) DO NOTHING;

-- ============================================================
-- UPDATE ROLE_PERMISSIONS MATRIX
-- ============================================================

-- Director: all new permissions
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.code = 'director'
  AND p.code IN (
    'attendance.check_in_self', 'attendance.check_out_self',
    'attendance.read_self', 'attendance.read_team', 'attendance.read_all',
    'attendance.correct_request_self', 'attendance.correct_manage',
    'attendance.evidence_upload_self', 'attendance.evidence_read_self', 'attendance.evidence_read_all',
    'attendance.report_read'
  )
ON CONFLICT DO NOTHING;

-- HR Admin: all new permissions
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.code = 'hr_admin'
  AND p.code IN (
    'attendance.check_in_self', 'attendance.check_out_self',
    'attendance.read_self', 'attendance.read_team', 'attendance.read_all',
    'attendance.correct_request_self', 'attendance.correct_manage',
    'attendance.evidence_upload_self', 'attendance.evidence_read_self', 'attendance.evidence_read_all',
    'attendance.report_read'
  )
ON CONFLICT DO NOTHING;

-- Manager: read_team, read_self, correct_manage, report_read (NO evidence access)
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.code = 'manager'
  AND p.code IN (
    'attendance.read_team', 'attendance.read_self',
    'attendance.correct_manage', 'attendance.report_read'
  )
ON CONFLICT DO NOTHING;

-- Team Leader: read_self, read_team
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.code = 'team_leader'
  AND p.code IN (
    'attendance.read_self', 'attendance.read_team'
  )
ON CONFLICT DO NOTHING;

-- Employee: self-service attendance
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.code = 'employee'
  AND p.code IN (
    'attendance.check_in_self', 'attendance.check_out_self',
    'attendance.read_self', 'attendance.correct_request_self',
    'attendance.evidence_upload_self', 'attendance.evidence_read_self'
  )
ON CONFLICT DO NOTHING;

-- Intern: same as employee
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.code = 'intern'
  AND p.code IN (
    'attendance.check_in_self', 'attendance.check_out_self',
    'attendance.read_self', 'attendance.correct_request_self',
    'attendance.evidence_upload_self', 'attendance.evidence_read_self'
  )
ON CONFLICT DO NOTHING;

-- System Admin: no attendance permissions (no attendance evidence access)
