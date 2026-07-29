-- Grant system_admin all permissions that employee role has,
-- so system admins can check in/out, manage their own tasks, leave, reports, etc.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r_admin.id, rp.permission_id
FROM roles r_emp
JOIN role_permissions rp ON rp.role_id = r_emp.id
JOIN roles r_admin ON r_admin.code = 'system_admin'
WHERE r_emp.code = 'employee'
ON CONFLICT (role_id, permission_id) DO NOTHING;