/*
# Add Sales role

1. New Roles
- Adds a new system role `sales` with label "Sales" and description "Sales team member with personal attendance, tasks, reports, and tickets".
- This role mirrors the `employee` role's permission set so Sales members get the same self-service access (attendance, tasks, daily reports, leave, tickets, payroll self-read, etc.).

2. Security
- No RLS changes — the role is inserted into the existing `roles` table which is already protected.
- Role permissions are cloned from the `employee` role so the Sales role has identical self-service permissions.

3. Important Notes
- The `sales` role is a system role (`is_system_role = true`).
- It is assignable via the Invite Employee flow (added to the frontend ROLES list and edge function VALID_ROLES).
- No existing data is modified or deleted.
*/

INSERT INTO public.roles (code, label, description, is_system_role)
VALUES ('sales', 'Sales', 'Sales team member with personal attendance, tasks, reports, and tickets', true)
ON CONFLICT (code) DO NOTHING;

DO $$
DECLARE
  sales_role_id uuid;
  employee_role_id uuid;
BEGIN
  SELECT id INTO sales_role_id FROM public.roles WHERE code = 'sales';
  SELECT id INTO employee_role_id FROM public.roles WHERE code = 'employee';

  IF sales_role_id IS NOT NULL AND employee_role_id IS NOT NULL THEN
    INSERT INTO public.role_permissions (role_id, permission_id)
    SELECT sales_role_id, rp.permission_id
    FROM public.role_permissions rp
    WHERE rp.role_id = employee_role_id
    ON CONFLICT DO NOTHING;
  END IF;
END $$;
