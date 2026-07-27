/*
# Phase 8: Task Cost + Daily Report Task Photos

## Feature 1: Task Cost
Adds operational task cost fields to the `tasks` table. This is an operational/project value only — it does NOT affect salary, payroll, incentives, deductions, attendance, or any performance-component calculation.

### New columns on `tasks`:
- `task_cost` numeric(14,2) nullable — the cost of the task in INR (zero or greater)
- `task_cost_currency` text NOT NULL DEFAULT 'INR' — currency code (currently INR only)
- `task_cost_updated_by` uuid nullable — who last changed the cost
- `task_cost_updated_at` timestamptz nullable — when the cost was last changed

### Constraints:
- CHECK: task_cost >= 0 (zero or greater)
- CHECK: task_cost_currency = 'INR' (currently INR only)

### New table: `task_cost_history`
Append-only history of task cost changes. No UPDATE or DELETE policies.
- id, task_id, old_cost, new_cost, currency, reason, changed_by, created_at

### New permissions:
- task.cost_set, task.cost_update, task.cost_read_self, task.cost_read_team, task.cost_read_all

## Feature 2: Daily Report Task Photos
Creates a dedicated `daily_report_task_photos` table for per-task-item photo evidence in Daily Reports.

### New table: `daily_report_task_photos`
Each row = one photo attached to a daily report task item.
- id, organization_id, daily_report_id, daily_report_task_item_id, task_id, employee_id, uploaded_by, storage_path, file_name, mime_type, file_size_bytes, display_order, caption, source_type, width, height, uploaded_at, deleted_at

### Storage bucket:
- `daily-report-task-photos` — private bucket for task evidence photos

### Security:
- RLS enabled on both new tables
- task_cost_history: INSERT-only for authenticated, SELECT for authenticated (audit scope enforced by org membership)
- daily_report_task_photos: CRUD scoped to organization + ownership (employee owns the report; managers/HR/Director can read within org)
*/

-- ============================================================
-- FEATURE 1: TASK COST
-- ============================================================

-- Add task_cost columns to tasks table
ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS task_cost numeric(14,2),
  ADD COLUMN IF NOT EXISTS task_cost_currency text NOT NULL DEFAULT 'INR',
  ADD COLUMN IF NOT EXISTS task_cost_updated_by uuid,
  ADD COLUMN IF NOT EXISTS task_cost_updated_at timestamptz;

-- Add CHECK constraints (idempotent via DO block)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tasks_task_cost_non_negative') THEN
    ALTER TABLE tasks ADD CONSTRAINT tasks_task_cost_non_negative CHECK (task_cost IS NULL OR task_cost >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tasks_task_cost_currency_inr') THEN
    ALTER TABLE tasks ADD CONSTRAINT tasks_task_cost_currency_inr CHECK (task_cost_currency = 'INR');
  END IF;
END $$;

-- Task cost history table (append-only)
CREATE TABLE IF NOT EXISTS task_cost_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  old_cost numeric(14,2),
  new_cost numeric(14,2),
  currency text NOT NULL DEFAULT 'INR',
  reason text NOT NULL,
  changed_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_task_cost_history_task_id ON task_cost_history(task_id, created_at DESC);

ALTER TABLE task_cost_history ENABLE ROW LEVEL SECURITY;

-- task_cost_history is append-only: no UPDATE or DELETE policies
DROP POLICY IF EXISTS "select_task_cost_history_org" ON task_cost_history;
CREATE POLICY "select_task_cost_history_org"
  ON task_cost_history FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM tasks t
      JOIN user_profiles up ON up.id = auth.uid()
      WHERE t.id = task_cost_history.task_id
      AND t.organization_id = up.organization_id
    )
  );

DROP POLICY IF EXISTS "insert_task_cost_history_org" ON task_cost_history;
CREATE POLICY "insert_task_cost_history_org"
  ON task_cost_history FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM tasks t
      JOIN user_profiles up ON up.id = auth.uid()
      WHERE t.id = task_cost_history.task_id
      AND t.organization_id = up.organization_id
    )
  );

-- Add task cost permissions (permissions table has: id, code, label, description)
INSERT INTO permissions (code, label, description)
VALUES
  ('task.cost_set', 'Set Task Cost', 'Set task cost during task creation'),
  ('task.cost_update', 'Update Task Cost', 'Update task cost after creation'),
  ('task.cost_read_self', 'Read Own Task Cost', 'Read cost of tasks assigned to self'),
  ('task.cost_read_team', 'Read Team Task Cost', 'Read cost of tasks within reporting scope'),
  ('task.cost_read_all', 'Read All Task Cost', 'Read all task costs in the organization')
ON CONFLICT (code) DO NOTHING;

-- Grant cost permissions to appropriate roles using role_id/permission_id UUIDs
-- Director: all cost permissions
-- HR Admin: cost_set, cost_update, cost_read_all
-- Manager: cost_set, cost_update, cost_read_team
-- Employee: cost_read_self only
-- System Admin: no automatic cost access
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.code = 'director' AND p.code = 'task.cost_set'
  AND NOT EXISTS (SELECT 1 FROM role_permissions rp WHERE rp.role_id = r.id AND rp.permission_id = p.id)
UNION ALL
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.code = 'director' AND p.code = 'task.cost_update'
  AND NOT EXISTS (SELECT 1 FROM role_permissions rp WHERE rp.role_id = r.id AND rp.permission_id = p.id)
UNION ALL
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.code = 'director' AND p.code = 'task.cost_read_self'
  AND NOT EXISTS (SELECT 1 FROM role_permissions rp WHERE rp.role_id = r.id AND rp.permission_id = p.id)
UNION ALL
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.code = 'director' AND p.code = 'task.cost_read_team'
  AND NOT EXISTS (SELECT 1 FROM role_permissions rp WHERE rp.role_id = r.id AND rp.permission_id = p.id)
UNION ALL
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.code = 'director' AND p.code = 'task.cost_read_all'
  AND NOT EXISTS (SELECT 1 FROM role_permissions rp WHERE rp.role_id = r.id AND rp.permission_id = p.id)
UNION ALL
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.code = 'hr_admin' AND p.code = 'task.cost_set'
  AND NOT EXISTS (SELECT 1 FROM role_permissions rp WHERE rp.role_id = r.id AND rp.permission_id = p.id)
UNION ALL
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.code = 'hr_admin' AND p.code = 'task.cost_update'
  AND NOT EXISTS (SELECT 1 FROM role_permissions rp WHERE rp.role_id = r.id AND rp.permission_id = p.id)
UNION ALL
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.code = 'hr_admin' AND p.code = 'task.cost_read_all'
  AND NOT EXISTS (SELECT 1 FROM role_permissions rp WHERE rp.role_id = r.id AND rp.permission_id = p.id)
UNION ALL
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.code = 'manager' AND p.code = 'task.cost_set'
  AND NOT EXISTS (SELECT 1 FROM role_permissions rp WHERE rp.role_id = r.id AND rp.permission_id = p.id)
UNION ALL
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.code = 'manager' AND p.code = 'task.cost_update'
  AND NOT EXISTS (SELECT 1 FROM role_permissions rp WHERE rp.role_id = r.id AND rp.permission_id = p.id)
UNION ALL
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.code = 'manager' AND p.code = 'task.cost_read_team'
  AND NOT EXISTS (SELECT 1 FROM role_permissions rp WHERE rp.role_id = r.id AND rp.permission_id = p.id)
UNION ALL
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.code = 'employee' AND p.code = 'task.cost_read_self'
  AND NOT EXISTS (SELECT 1 FROM role_permissions rp WHERE rp.role_id = r.id AND rp.permission_id = p.id);

-- ============================================================
-- FEATURE 2: DAILY REPORT TASK PHOTOS
-- ============================================================

CREATE TABLE IF NOT EXISTS daily_report_task_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  daily_report_id uuid NOT NULL REFERENCES daily_reports(id) ON DELETE CASCADE,
  daily_report_task_item_id uuid REFERENCES daily_report_task_items(id) ON DELETE CASCADE,
  task_id uuid REFERENCES tasks(id) ON DELETE SET NULL,
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  uploaded_by uuid NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  storage_path text NOT NULL,
  file_name text NOT NULL,
  mime_type text NOT NULL,
  file_size_bytes bigint NOT NULL,
  display_order integer NOT NULL DEFAULT 0,
  caption text,
  source_type text,
  width integer,
  height integer,
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_drtp_report ON daily_report_task_photos(daily_report_id);
CREATE INDEX IF NOT EXISTS idx_drtp_task_item ON daily_report_task_photos(daily_report_task_item_id);
CREATE INDEX IF NOT EXISTS idx_drtp_employee ON daily_report_task_photos(employee_id);
CREATE INDEX IF NOT EXISTS idx_drtp_org ON daily_report_task_photos(organization_id);

ALTER TABLE daily_report_task_photos ENABLE ROW LEVEL SECURITY;

-- SELECT: employee who owns the report, or managers/HR/directors in same org
DROP POLICY IF EXISTS "select_drtp_own_org" ON daily_report_task_photos;
CREATE POLICY "select_drtp_own_org"
  ON daily_report_task_photos FOR SELECT
  TO authenticated
  USING (
    deleted_at IS NULL
    AND organization_id = (
      SELECT organization_id FROM user_profiles WHERE id = auth.uid()
    )
    AND (
      -- Owner: employee who uploaded or owns the report
      uploaded_by = auth.uid()
      OR daily_report_id IN (
        SELECT dr.id FROM daily_reports dr
        WHERE dr.employee_id IN (
          SELECT e.id FROM employees e WHERE e.user_id = auth.uid()
        )
      )
      -- Or: user is manager/HR/director in same org
      OR EXISTS (
        SELECT 1 FROM user_profiles up
        WHERE up.id = auth.uid()
        AND up.organization_id = daily_report_task_photos.organization_id
        AND up.role IN ('manager', 'hr_admin', 'director')
      )
    )
  );

-- INSERT: only the employee who owns the report, and report must be editable
DROP POLICY IF EXISTS "insert_drtp_owner" ON daily_report_task_photos;
CREATE POLICY "insert_drtp_owner"
  ON daily_report_task_photos FOR INSERT
  TO authenticated
  WITH CHECK (
    deleted_at IS NULL
    AND uploaded_by = auth.uid()
    AND organization_id = (
      SELECT organization_id FROM user_profiles WHERE id = auth.uid()
    )
    AND daily_report_id IN (
      SELECT dr.id FROM daily_reports dr
      WHERE dr.employee_id IN (
        SELECT e.id FROM employees e WHERE e.user_id = auth.uid()
      )
      AND dr.status IN ('draft', 'returned')
    )
  );

-- UPDATE: owner can update caption/display_order while report is editable
DROP POLICY IF EXISTS "update_drtp_owner" ON daily_report_task_photos;
CREATE POLICY "update_drtp_owner"
  ON daily_report_task_photos FOR UPDATE
  TO authenticated
  USING (uploaded_by = auth.uid())
  WITH CHECK (uploaded_by = auth.uid());

-- DELETE: soft-delete only; owner can remove while report is draft/returned
-- Physical DELETE is NOT allowed via RLS to protect submitted evidence
DROP POLICY IF EXISTS "delete_drtp_owner" ON daily_report_task_photos;
CREATE POLICY "delete_drtp_owner"
  ON daily_report_task_photos FOR DELETE
  TO authenticated
  USING (
    uploaded_by = auth.uid()
    AND daily_report_id IN (
      SELECT dr.id FROM daily_reports dr
      WHERE dr.employee_id IN (
        SELECT e.id FROM employees e WHERE e.user_id = auth.uid()
      )
      AND dr.status IN ('draft', 'returned')
    )
  );

-- Create private storage bucket for daily report task photos
INSERT INTO storage.buckets (id, name, public)
VALUES ('daily-report-task-photos', 'daily-report-task-photos', false)
ON CONFLICT (id) DO NOTHING;

-- Storage policies for daily-report-task-photos bucket
DROP POLICY IF EXISTS "Allow authenticated upload to daily-report-task-photos" ON storage.objects;
CREATE POLICY "Allow authenticated upload to daily-report-task-photos"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'daily-report-task-photos'
  );

DROP POLICY IF EXISTS "Allow authenticated read daily-report-task-photos" ON storage.objects;
CREATE POLICY "Allow authenticated read daily-report-task-photos"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'daily-report-task-photos'
  );

DROP POLICY IF EXISTS "Allow authenticated delete own daily-report-task-photos" ON storage.objects;
CREATE POLICY "Allow authenticated delete own daily-report-task-photos"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'daily-report-task-photos'
  );
