/*
# Phase 6 — Permissions: Daily Reports, Follow-ups, Notifications, Announcements, Exports

## Summary
Adds 40 new permissions across 5 categories and assigns them to roles.

## New Permissions (40)

### Daily Report (14)
daily_report.create_self, daily_report.read_self, daily_report.read_team, daily_report.read_all,
daily_report.update_self, daily_report.submit_self, daily_report.review, daily_report.return,
daily_report.reopen, daily_report.lock, daily_report.comment, daily_report.attachment_upload,
daily_report.attachment_read, daily_report.report_read

### Follow-up (7)
follow_up.create, follow_up.read_self, follow_up.read_team, follow_up.read_all,
follow_up.assign, follow_up.update, follow_up.resolve

### Notification (6)
notification.read_self, notification.mark_read_self, notification.manage_preferences_self,
notification.broadcast, notification.manage_templates, notification.view_delivery_logs

### Announcement (5)
announcement.create, announcement.update, announcement.delete, announcement.read,
announcement.acknowledge

### Export (5)
export.self, export.team, export.organization, export.sensitive, export.audit_read

## Role Assignments
- director: all 40
- hr_admin: daily_report.read_all/review/return/reopen/lock/comment/attachment_read/report_read,
  follow_up.read_all/assign/update/resolve, notification.read_self/mark_read_self/manage_preferences_self/broadcast/view_delivery_logs,
  announcement.create/update/delete/read, export.organization/sensitive/audit_read
- manager: daily_report.read_team/review/return/comment/attachment_read/report_read,
  follow_up.create/read_team/assign/update/resolve, notification.read_self/mark_read_self/manage_preferences_self,
  export.team
- team_leader: daily_report.read_team/review/comment, follow_up.read_team,
  notification.read_self/mark_read_self/manage_preferences_self, export.self
- employee: daily_report.create_self/read_self/update_self/submit_self/comment/attachment_upload/attachment_read,
  follow_up.read_self, notification.read_self/mark_read_self/manage_preferences_self, export.self
- intern: same as employee
- system_admin: notification.view_delivery_logs, export.audit_read (no private report content)
*/

DO $$
BEGIN
  -- Daily Report permissions
  INSERT INTO permissions (code, label, description) VALUES
    ('daily_report.create_self', 'Create Daily Report', 'Create own daily report'),
    ('daily_report.read_self', 'Read Own Daily Reports', 'Read own daily reports'),
    ('daily_report.read_team', 'Read Team Daily Reports', 'Read team daily reports'),
    ('daily_report.read_all', 'Read All Daily Reports', 'Read all daily reports in organization'),
    ('daily_report.update_self', 'Update Own Daily Report', 'Update own draft/returned report'),
    ('daily_report.submit_self', 'Submit Daily Report', 'Submit own daily report'),
    ('daily_report.review', 'Review Daily Report', 'Review submitted daily reports'),
    ('daily_report.return', 'Return Daily Report', 'Return report for correction'),
    ('daily_report.reopen', 'Reopen Daily Report', 'Reopen a reviewed/locked report'),
    ('daily_report.lock', 'Lock Daily Report', 'Lock a daily report'),
    ('daily_report.comment', 'Comment on Daily Report', 'Add comments to daily reports'),
    ('daily_report.attachment_upload', 'Upload Report Attachment', 'Upload daily report evidence'),
    ('daily_report.attachment_read', 'Read Report Attachment', 'Read daily report attachments'),
    ('daily_report.report_read', 'Read Daily Report Summary', 'Read daily report summaries and consolidated reports')
  ON CONFLICT (code) DO NOTHING;

  -- Follow-up permissions
  INSERT INTO permissions (code, label, description) VALUES
    ('follow_up.create', 'Create Follow-up', 'Create a follow-up action'),
    ('follow_up.read_self', 'Read Own Follow-ups', 'Read follow-ups assigned to self'),
    ('follow_up.read_team', 'Read Team Follow-ups', 'Read team follow-ups'),
    ('follow_up.read_all', 'Read All Follow-ups', 'Read all follow-ups in organization'),
    ('follow_up.assign', 'Assign Follow-up', 'Assign follow-up to someone'),
    ('follow_up.update', 'Update Follow-up', 'Update follow-up status'),
    ('follow_up.resolve', 'Resolve Follow-up', 'Resolve a follow-up action')
  ON CONFLICT (code) DO NOTHING;

  -- Notification permissions
  INSERT INTO permissions (code, label, description) VALUES
    ('notification.read_self', 'Read Own Notifications', 'Read own notifications'),
    ('notification.mark_read_self', 'Mark Notifications Read', 'Mark own notifications as read'),
    ('notification.manage_preferences_self', 'Manage Notification Preferences', 'Manage own notification preferences'),
    ('notification.broadcast', 'Broadcast Notifications', 'Send broadcast notifications'),
    ('notification.manage_templates', 'Manage Email Templates', 'Manage email templates'),
    ('notification.view_delivery_logs', 'View Delivery Logs', 'View notification delivery logs')
  ON CONFLICT (code) DO NOTHING;

  -- Announcement permissions
  INSERT INTO permissions (code, label, description) VALUES
    ('announcement.create', 'Create Announcement', 'Create organization announcements'),
    ('announcement.update', 'Update Announcement', 'Update announcements'),
    ('announcement.delete', 'Delete Announcement', 'Delete announcements'),
    ('announcement.read', 'Read Announcements', 'Read announcements'),
    ('announcement.acknowledge', 'Acknowledge Announcement', 'Acknowledge announcements')
  ON CONFLICT (code) DO NOTHING;

  -- Export permissions
  INSERT INTO permissions (code, label, description) VALUES
    ('export.self', 'Export Own Data', 'Export own data'),
    ('export.team', 'Export Team Data', 'Export team data'),
    ('export.organization', 'Export Organization Data', 'Export organization-wide data'),
    ('export.sensitive', 'Export Sensitive Data', 'Export sensitive/protected data'),
    ('export.audit_read', 'Read Export Audit', 'Read export audit logs')
  ON CONFLICT (code) DO NOTHING;
END $$;

-- Assign to roles
DO $$
DECLARE
  v_director uuid; v_hr uuid; v_manager uuid; v_tl uuid; v_emp uuid; v_intern uuid; v_sysadmin uuid;
BEGIN
  SELECT id INTO v_director FROM roles WHERE code = 'director';
  SELECT id INTO v_hr FROM roles WHERE code = 'hr_admin';
  SELECT id INTO v_manager FROM roles WHERE code = 'manager';
  SELECT id INTO v_tl FROM roles WHERE code = 'team_leader';
  SELECT id INTO v_emp FROM roles WHERE code = 'employee';
  SELECT id INTO v_intern FROM roles WHERE code = 'intern';
  SELECT id INTO v_sysadmin FROM roles WHERE code = 'system_admin';

  -- Director: all 40
  INSERT INTO role_permissions (role_id, permission_id)
  SELECT v_director, p.id FROM permissions p
  WHERE p.code LIKE 'daily_report.%' OR p.code LIKE 'follow_up.%'
    OR p.code LIKE 'notification.%' OR p.code LIKE 'announcement.%' OR p.code LIKE 'export.%'
  ON CONFLICT DO NOTHING;

  -- HR Admin
  INSERT INTO role_permissions (role_id, permission_id)
  SELECT v_hr, p.id FROM permissions p
  WHERE p.code IN (
    'daily_report.read_all','daily_report.review','daily_report.return','daily_report.reopen',
    'daily_report.lock','daily_report.comment','daily_report.attachment_read','daily_report.report_read',
    'follow_up.read_all','follow_up.assign','follow_up.update','follow_up.resolve',
    'notification.read_self','notification.mark_read_self','notification.manage_preferences_self',
    'notification.broadcast','notification.view_delivery_logs',
    'announcement.create','announcement.update','announcement.delete','announcement.read',
    'export.organization','export.sensitive','export.audit_read'
  ) ON CONFLICT DO NOTHING;

  -- Manager
  INSERT INTO role_permissions (role_id, permission_id)
  SELECT v_manager, p.id FROM permissions p
  WHERE p.code IN (
    'daily_report.read_team','daily_report.review','daily_report.return','daily_report.comment',
    'daily_report.attachment_read','daily_report.report_read',
    'follow_up.create','follow_up.read_team','follow_up.assign','follow_up.update','follow_up.resolve',
    'notification.read_self','notification.mark_read_self','notification.manage_preferences_self',
    'export.team'
  ) ON CONFLICT DO NOTHING;

  -- Team Leader
  INSERT INTO role_permissions (role_id, permission_id)
  SELECT v_tl, p.id FROM permissions p
  WHERE p.code IN (
    'daily_report.read_team','daily_report.review','daily_report.comment',
    'follow_up.read_team',
    'notification.read_self','notification.mark_read_self','notification.manage_preferences_self',
    'export.self'
  ) ON CONFLICT DO NOTHING;

  -- Employee
  INSERT INTO role_permissions (role_id, permission_id)
  SELECT v_emp, p.id FROM permissions p
  WHERE p.code IN (
    'daily_report.create_self','daily_report.read_self','daily_report.update_self',
    'daily_report.submit_self','daily_report.comment','daily_report.attachment_upload','daily_report.attachment_read',
    'follow_up.read_self',
    'notification.read_self','notification.mark_read_self','notification.manage_preferences_self',
    'export.self'
  ) ON CONFLICT DO NOTHING;

  -- Intern: same as employee
  INSERT INTO role_permissions (role_id, permission_id)
  SELECT v_intern, p.id FROM permissions p
  WHERE p.code IN (
    'daily_report.create_self','daily_report.read_self','daily_report.update_self',
    'daily_report.submit_self','daily_report.comment','daily_report.attachment_upload','daily_report.attachment_read',
    'follow_up.read_self',
    'notification.read_self','notification.mark_read_self','notification.manage_preferences_self',
    'export.self'
  ) ON CONFLICT DO NOTHING;

  -- System Admin: delivery logs + export audit only
  INSERT INTO role_permissions (role_id, permission_id)
  SELECT v_sysadmin, p.id FROM permissions p
  WHERE p.code IN ('notification.view_delivery_logs','export.audit_read')
  ON CONFLICT DO NOTHING;
END $$;
