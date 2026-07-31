-- Allow managers to fill and view their own daily reports
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.code = 'manager'
  AND p.code IN ('daily_report.read_self', 'daily_report.submit_self', 'daily_report.update_self', 'daily_report.attachment_upload')
ON CONFLICT (role_id, permission_id) DO NOTHING;
