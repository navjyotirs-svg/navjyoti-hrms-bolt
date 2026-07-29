/*
# Task Management Improvements — Multi-Assignee, Deadline Time, Drafts

## Summary
This migration implements four task management improvements:
1. Adds `deadline_at` (timestamptz) to tasks for deadline date+time
2. Enhances `task_assignments` with per-assignment status, progress, and submission tracking
3. Adds unique constraint on (task_id, assigned_to) to prevent duplicate assignments
4. Creates `task_drafts` and `task_draft_assignees` tables for form persistence

## Changes to `tasks` table
- Adds `deadline_at timestamptz` — canonical deadline timestamp with time (Asia/Kolkata stored as UTC)
- `original_deadline` and `current_deadline` (date) remain for backward compatibility
- Existing date-only records get `deadline_at` backfilled to deadline date at 6:00 PM IST (12:30 UTC)

## Changes to `task_assignments` table
- Adds `assignment_status text DEFAULT 'ACCEPTANCE_PENDING'` — per-assignee workflow status
- Adds `progress_percent integer DEFAULT 0` — per-assignee progress (0-100)
- Adds `submitted_at`, `reviewed_at`, `individual_outcome`, `rejection_reason`, `updated_at`
- Adds UNIQUE index on (task_id, assigned_to) WHERE is_current = true

## New table: `task_drafts`
Stores partially-filled task creation forms so data survives navigation.
RLS: only draft creator can CRUD their own drafts.

## New table: `task_draft_assignees`
Normalized draft assignee selections.
RLS: access scoped through parent draft ownership.
*/

-- ============================================================
-- 1. Add deadline_at to tasks
-- ============================================================
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS deadline_at timestamptz;

UPDATE tasks
SET deadline_at = (current_deadline::timestamptz + interval '12 hours 30 minutes')
WHERE deadline_at IS NULL
  AND current_deadline IS NOT NULL;

-- ============================================================
-- 2. Enhance task_assignments
-- ============================================================
ALTER TABLE task_assignments ADD COLUMN IF NOT EXISTS assignment_status text
  NOT NULL DEFAULT 'ACCEPTANCE_PENDING'
  CHECK (assignment_status IN (
    'ACCEPTANCE_PENDING','ACCEPTED','REJECTED','REASSIGNMENT_REQUESTED',
    'IN_PROGRESS','SUBMITTED','COMPLETED','CANCELLED'
  ));

ALTER TABLE task_assignments ADD COLUMN IF NOT EXISTS progress_percent integer
  NOT NULL DEFAULT 0
  CHECK (progress_percent >= 0 AND progress_percent <= 100);

ALTER TABLE task_assignments ADD COLUMN IF NOT EXISTS submitted_at timestamptz;
ALTER TABLE task_assignments ADD COLUMN IF NOT EXISTS reviewed_at timestamptz;
ALTER TABLE task_assignments ADD COLUMN IF NOT EXISTS individual_outcome text
  CHECK (individual_outcome IS NULL OR individual_outcome IN ('EARLY','ON_TIME','DELAYED'));
ALTER TABLE task_assignments ADD COLUMN IF NOT EXISTS rejection_reason text;
ALTER TABLE task_assignments ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE UNIQUE INDEX IF NOT EXISTS idx_task_assign_unique_current
  ON task_assignments (task_id, assigned_to) WHERE is_current = true;

DROP TRIGGER IF EXISTS task_assignments_updated_at ON task_assignments;
CREATE TRIGGER task_assignments_updated_at BEFORE UPDATE ON task_assignments
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

-- ============================================================
-- 3. task_drafts table
-- ============================================================
CREATE TABLE IF NOT EXISTS task_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id uuid REFERENCES projects(id) ON DELETE SET NULL,
  title text NOT NULL DEFAULT '',
  description text NOT NULL DEFAULT '',
  priority text NOT NULL DEFAULT 'MEDIUM' CHECK (priority IN ('LOW','MEDIUM','HIGH','CRITICAL')),
  expected_result text NOT NULL DEFAULT '',
  target_quantity numeric,
  target_unit text,
  estimated_hours numeric,
  task_cost numeric,
  task_cost_currency text NOT NULL DEFAULT 'INR',
  deadline_at timestamptz,
  start_date date NOT NULL DEFAULT CURRENT_DATE,
  task_type text NOT NULL DEFAULT 'GENERAL' CHECK (task_type IN ('GENERAL','PROJECT','COMPLIANCE','FIELD_ACTIVITY','REPORTING','TRAINING','ADMINISTRATIVE','OTHER')),
  acceptance_required boolean NOT NULL DEFAULT true,
  branch_id uuid,
  department_id uuid,
  last_saved_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '30 days'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_task_drafts_creator ON task_drafts (created_by);
CREATE INDEX IF NOT EXISTS idx_task_drafts_org ON task_drafts (organization_id);

ALTER TABLE task_drafts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_drafts" ON task_drafts;
CREATE POLICY "select_own_drafts" ON task_drafts FOR SELECT
  TO authenticated USING (created_by = auth.uid());

DROP POLICY IF EXISTS "insert_own_drafts" ON task_drafts;
CREATE POLICY "insert_own_drafts" ON task_drafts FOR INSERT
  TO authenticated WITH CHECK (created_by = auth.uid());

DROP POLICY IF EXISTS "update_own_drafts" ON task_drafts;
CREATE POLICY "update_own_drafts" ON task_drafts FOR UPDATE
  TO authenticated USING (created_by = auth.uid()) WITH CHECK (created_by = auth.uid());

DROP POLICY IF EXISTS "delete_own_drafts" ON task_drafts;
CREATE POLICY "delete_own_drafts" ON task_drafts FOR DELETE
  TO authenticated USING (created_by = auth.uid());

-- ============================================================
-- 4. task_draft_assignees table
-- ============================================================
CREATE TABLE IF NOT EXISTS task_draft_assignees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  draft_id uuid NOT NULL REFERENCES task_drafts(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (draft_id, employee_id)
);

CREATE INDEX IF NOT EXISTS idx_task_draft_assignees_draft ON task_draft_assignees (draft_id);

ALTER TABLE task_draft_assignees ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_draft_assignees" ON task_draft_assignees;
CREATE POLICY "select_own_draft_assignees" ON task_draft_assignees FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM task_drafts WHERE task_drafts.id = task_draft_assignees.draft_id AND task_drafts.created_by = auth.uid())
  );

DROP POLICY IF EXISTS "insert_own_draft_assignees" ON task_draft_assignees;
CREATE POLICY "insert_own_draft_assignees" ON task_draft_assignees FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM task_drafts WHERE task_drafts.id = task_draft_assignees.draft_id AND task_drafts.created_by = auth.uid())
  );

DROP POLICY IF EXISTS "delete_own_draft_assignees" ON task_draft_assignees;
CREATE POLICY "delete_own_draft_assignees" ON task_draft_assignees FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM task_drafts WHERE task_drafts.id = task_draft_assignees.draft_id AND task_drafts.created_by = auth.uid())
  );