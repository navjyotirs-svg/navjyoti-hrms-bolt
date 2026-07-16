/*
# Add attendance check-in/check-out permissions to manager and team_leader

## Root Cause
The manager and team_leader roles were missing attendance.check_in_self and
attendance.check_out_self permissions, so the check-in/check-out buttons
did not appear on the dashboard or topbar for those roles.

## Fix
Grant both permissions to manager and team_leader roles.
*/

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.code IN ('manager', 'team_leader')
  AND p.code IN ('attendance.check_in_self', 'attendance.check_out_self')
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp
    WHERE rp.role_id = r.id AND rp.permission_id = p.id
  );
