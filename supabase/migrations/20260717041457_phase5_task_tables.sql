/*
# Phase 5 — Task Tables

## Summary
Creates 10 new tables for the task management module:
tasks, task_assignments, task_status_history, task_action_requests,
task_deadline_history, task_progress_updates, task_submissions,
task_comments, task_attachments, task_dependencies.

## Tables

### 1. tasks
Main task record with code, title, description, priority, type, status,
deadline tracking, target metrics, acceptance requirement, and completion outcome.
Status CHECK enforces 14 states. Priority CHECK enforces 4 levels.
Task type CHECK enforces 8 types. Completion outcome CHECK enforces 3 values.

### 2. task_assignments
Tracks who is assigned to a task (PRIMARY, COLLABORATOR, REVIEWER, OBSERVER).
is_current flag marks active assignments. At least one PRIMARY required for active tasks.

### 3. task_status_history
Append-only log of status transitions. No UPDATE or DELETE policies.
Records old_status, new_status, changed_by, reason, metadata.

### 4. task_action_requests
Employee requests for clarification, revision, reassignment, rejection,
deadline extension, target correction, support. Status: PENDING/APPROVED/REJECTED/RETURNED_FOR_DETAILS/CANCELLED.

### 5. task_deadline_history
Append-only log of deadline changes. No UPDATE or DELETE.
Records old_deadline, new_deadline, changed_by, change_reason, optional request_id.

### 6. task_progress_updates
Employee progress updates with percentage (0-100 CHECK), work completed,
blockers, support required, optional hours spent.

### 7. task_submissions
Task submissions with result summary, review status
(PENDING_REVIEW/APPROVED/REVISION_REQUIRED/REJECTED), reviewer feedback.

### 8. task_comments
Task comments with soft deletion (deleted_at). is_internal flag for internal notes.
Comments are never physically deleted.

### 9. task_attachments
File attachments with category (ASSIGNMENT_REFERENCE, PROGRESS_EVIDENCE,
SUBMISSION_EVIDENCE, REVIEW_EVIDENCE, OTHER). Private storage paths.

### 10. task_dependencies
Task dependencies with type (BLOCKS_START, BLOCKS_COMPLETION, INFORMATIONAL).
Circular dependency prevention via application-level check.
*/

-- ============================================================
-- 1. tasks
-- ============================================================
CREATE TABLE IF NOT EXISTS tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  branch_id uuid REFERENCES branches(id) ON DELETE SET NULL,
  department_id uuid REFERENCES departments(id) ON DELETE SET NULL,
  task_code text NOT NULL,
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  priority text NOT NULL DEFAULT 'MEDIUM' CHECK (priority IN ('LOW','MEDIUM','HIGH','CRITICAL')),
  task_type text NOT NULL DEFAULT 'GENERAL' CHECK (task_type IN ('GENERAL','PROJECT','COMPLIANCE','FIELD_ACTIVITY','REPORTING','TRAINING','ADMINISTRATIVE','OTHER')),
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  start_date date NOT NULL DEFAULT CURRENT_DATE,
  original_deadline date NOT NULL,
  current_deadline date NOT NULL,
  expected_result text NOT NULL DEFAULT '',
  target_quantity numeric,
  target_unit text,
  estimated_hours numeric,
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN (
    'DRAFT','ASSIGNED','ACCEPTANCE_PENDING','REVISION_REQUESTED','REASSIGNMENT_REQUESTED',
    'ACCEPTED','IN_PROGRESS','ON_HOLD','SUBMITTED','REVIEW_REQUIRED',
    'REVISION_REQUIRED','COMPLETED','CANCELLED','REJECTED'
  )),
  acceptance_required boolean NOT NULL DEFAULT true,
  completion_outcome text CHECK (completion_outcome IN ('EARLY','ON_TIME','DELAYED')),
  completed_at timestamptz,
  cancelled_at timestamptz,
  cancellation_reason text,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_code_org ON tasks (organization_id, task_code);
CREATE INDEX IF NOT EXISTS idx_tasks_owner ON tasks (owner_id);
CREATE INDEX IF NOT EXISTS idx_tasks_created_by ON tasks (created_by);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks (status);
CREATE INDEX IF NOT EXISTS idx_tasks_org ON tasks (organization_id);
CREATE INDEX IF NOT EXISTS idx_tasks_deadline ON tasks (current_deadline);

-- ============================================================
-- 2. task_assignments
-- ============================================================
CREATE TABLE IF NOT EXISTS task_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  assigned_to uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  assigned_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  assignment_type text NOT NULL DEFAULT 'PRIMARY' CHECK (assignment_type IN ('PRIMARY','COLLABORATOR','REVIEWER','OBSERVER')),
  assigned_at timestamptz NOT NULL DEFAULT now(),
  accepted_at timestamptz,
  rejected_at timestamptz,
  ended_at timestamptz,
  is_current boolean NOT NULL DEFAULT true,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_task_assign_task ON task_assignments (task_id);
CREATE INDEX IF NOT EXISTS idx_task_assign_to ON task_assignments (assigned_to);
CREATE INDEX IF NOT EXISTS idx_task_assign_current ON task_assignments (task_id, is_current) WHERE is_current = true;

-- ============================================================
-- 3. task_status_history (append-only)
-- ============================================================
CREATE TABLE IF NOT EXISTS task_status_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  old_status text,
  new_status text NOT NULL,
  changed_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reason text,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_task_status_hist ON task_status_history (task_id, created_at);

-- ============================================================
-- 4. task_action_requests
-- ============================================================
CREATE TABLE IF NOT EXISTS task_action_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  request_type text NOT NULL CHECK (request_type IN (
    'CLARIFICATION','REVISION','REASSIGNMENT','REJECTION',
    'DEADLINE_EXTENSION','TARGET_CORRECTION','SUPPORT_REQUEST'
  )),
  current_workload text,
  reason text NOT NULL,
  assigned_target text,
  assigned_deadline date,
  proposed_target text,
  proposed_deadline date,
  support_required text,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN (
    'PENDING','APPROVED','REJECTED','RETURNED_FOR_DETAILS','CANCELLED'
  )),
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewer_remarks text,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_task_req_task ON task_action_requests (task_id);
CREATE INDEX IF NOT EXISTS idx_task_req_emp ON task_action_requests (employee_id);
CREATE INDEX IF NOT EXISTS idx_task_req_status ON task_action_requests (status);

-- ============================================================
-- 5. task_deadline_history (append-only)
-- ============================================================
CREATE TABLE IF NOT EXISTS task_deadline_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  old_deadline date,
  new_deadline date NOT NULL,
  changed_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  change_reason text NOT NULL,
  request_id uuid REFERENCES task_action_requests(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_task_deadline_hist ON task_deadline_history (task_id, created_at);

-- ============================================================
-- 6. task_progress_updates
-- ============================================================
CREATE TABLE IF NOT EXISTS task_progress_updates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  progress_percent integer NOT NULL DEFAULT 0 CHECK (progress_percent >= 0 AND progress_percent <= 100),
  work_completed text NOT NULL DEFAULT '',
  result_so_far text NOT NULL DEFAULT '',
  blocker text,
  support_required text,
  hours_spent numeric,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_task_prog_task ON task_progress_updates (task_id, created_at);

-- ============================================================
-- 7. task_submissions
-- ============================================================
CREATE TABLE IF NOT EXISTS task_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  submitted_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  submission_note text NOT NULL DEFAULT '',
  result_summary text NOT NULL DEFAULT '',
  submitted_at timestamptz NOT NULL DEFAULT now(),
  review_status text NOT NULL DEFAULT 'PENDING_REVIEW' CHECK (review_status IN (
    'PENDING_REVIEW','APPROVED','REVISION_REQUIRED','REJECTED'
  )),
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  reviewer_feedback text,
  version integer NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_task_sub_task ON task_submissions (task_id, submitted_at);

-- ============================================================
-- 8. task_comments (soft delete only)
-- ============================================================
CREATE TABLE IF NOT EXISTS task_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  comment_text text NOT NULL,
  is_internal boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  edited_at timestamptz,
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_task_comments_task ON task_comments (task_id, created_at);

-- ============================================================
-- 9. task_attachments
-- ============================================================
CREATE TABLE IF NOT EXISTS task_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  uploaded_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  attachment_category text NOT NULL DEFAULT 'OTHER' CHECK (attachment_category IN (
    'ASSIGNMENT_REFERENCE','PROGRESS_EVIDENCE','SUBMISSION_EVIDENCE','REVIEW_EVIDENCE','OTHER'
  )),
  storage_path text NOT NULL,
  file_name text NOT NULL,
  mime_type text,
  file_size_bytes bigint,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_task_attach_task ON task_attachments (task_id);

-- ============================================================
-- 10. task_dependencies
-- ============================================================
CREATE TABLE IF NOT EXISTS task_dependencies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  depends_on_task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  dependency_type text NOT NULL DEFAULT 'BLOCKS_START' CHECK (dependency_type IN (
    'BLOCKS_START','BLOCKS_COMPLETION','INFORMATIONAL'
  )),
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_task_dep_unique ON task_dependencies (task_id, depends_on_task_id);
CREATE INDEX IF NOT EXISTS idx_task_dep_task ON task_dependencies (task_id);
CREATE INDEX IF NOT EXISTS idx_task_dep_on ON task_dependencies (depends_on_task_id);

-- Prevent self-dependency
ALTER TABLE task_dependencies ADD CONSTRAINT chk_no_self_dependency
  CHECK (task_id <> depends_on_task_id);

-- ============================================================
-- updated_at triggers for mutable tables
-- ============================================================
CREATE OR REPLACE FUNCTION trg_set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tasks_updated_at ON tasks;
CREATE TRIGGER tasks_updated_at BEFORE UPDATE ON tasks
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

DROP TRIGGER IF EXISTS task_action_requests_updated_at ON task_action_requests;
CREATE TRIGGER task_action_requests_updated_at BEFORE UPDATE ON task_action_requests
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();
