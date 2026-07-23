/*
# Phase 6 — Daily Report Tables

## Summary
Creates 5 tables: daily_reports, daily_report_task_items, daily_report_attachments,
daily_report_history, daily_report_comments.
Also adds org config columns to organizations for daily report settings.

## Tables

### 1. daily_reports
Main EOD report with 7-state status, unique (employee_id, report_date).
Fields answer: planned, completed, result, pending, blockers, support, follow-up, tomorrow plan.

### 2. daily_report_task_items
Links report to Phase 5 tasks with per-task progress, work done, result, blocker.

### 3. daily_report_attachments
Private file storage for report evidence (5 attachment types).

### 4. daily_report_history
Append-only action log (9 actions). No UPDATE/DELETE.

### 5. daily_report_comments
Comments with 5 types (employee note, manager feedback, HR note, director note, follow-up).
Soft delete via deleted_at.
*/

-- ============================================================
-- 1. daily_reports
-- ============================================================
CREATE TABLE IF NOT EXISTS daily_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  branch_id uuid REFERENCES branches(id) ON DELETE SET NULL,
  department_id uuid REFERENCES departments(id) ON DELETE SET NULL,
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  report_date date NOT NULL,
  overall_summary text NOT NULL DEFAULT '',
  work_planned text NOT NULL DEFAULT '',
  work_completed text NOT NULL DEFAULT '',
  overall_result text NOT NULL DEFAULT '',
  pending_work text NOT NULL DEFAULT '',
  blockers text NOT NULL DEFAULT '',
  support_required text NOT NULL DEFAULT '',
  follow_up_required text NOT NULL DEFAULT '',
  tomorrow_plan text NOT NULL DEFAULT '',
  total_hours_reported numeric,
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN (
    'DRAFT','SUBMITTED','UNDER_REVIEW','REVIEWED','RETURNED_FOR_CORRECTION','REOPENED','LOCKED'
  )),
  submitted_at timestamptz,
  reviewed_at timestamptz,
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  manager_comments text,
  reopened_at timestamptz,
  reopened_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_daily_reports_emp_date ON daily_reports (employee_id, report_date);
CREATE INDEX IF NOT EXISTS idx_daily_reports_org ON daily_reports (organization_id);
CREATE INDEX IF NOT EXISTS idx_daily_reports_status ON daily_reports (status);
CREATE INDEX IF NOT EXISTS idx_daily_reports_date ON daily_reports (report_date);

-- ============================================================
-- 2. daily_report_task_items
-- ============================================================
CREATE TABLE IF NOT EXISTS daily_report_task_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  daily_report_id uuid NOT NULL REFERENCES daily_reports(id) ON DELETE CASCADE,
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  progress_before integer,
  progress_after integer CHECK (progress_after IS NULL OR (progress_after >= 0 AND progress_after <= 100)),
  work_done text NOT NULL DEFAULT '',
  result_achieved text NOT NULL DEFAULT '',
  pending_item text,
  blocker text,
  support_required text,
  follow_up text,
  hours_spent numeric,
  evidence_required boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dr_task_items_report ON daily_report_task_items (daily_report_id);
CREATE INDEX IF NOT EXISTS idx_dr_task_items_task ON daily_report_task_items (task_id);

-- ============================================================
-- 3. daily_report_attachments
-- ============================================================
CREATE TABLE IF NOT EXISTS daily_report_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  daily_report_id uuid NOT NULL REFERENCES daily_reports(id) ON DELETE CASCADE,
  task_id uuid REFERENCES tasks(id) ON DELETE SET NULL,
  uploaded_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  storage_path text NOT NULL,
  file_name text NOT NULL,
  mime_type text,
  file_size_bytes bigint,
  attachment_type text NOT NULL DEFAULT 'OTHER' CHECK (attachment_type IN (
    'WORK_EVIDENCE','RESULT_EVIDENCE','SUPPORTING_DOCUMENT','SCREENSHOT','OTHER'
  )),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dr_attach_report ON daily_report_attachments (daily_report_id);

-- ============================================================
-- 4. daily_report_history (append-only)
-- ============================================================
CREATE TABLE IF NOT EXISTS daily_report_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  daily_report_id uuid NOT NULL REFERENCES daily_reports(id) ON DELETE CASCADE,
  action text NOT NULL CHECK (action IN (
    'CREATED','UPDATED','SUBMITTED','REVIEW_STARTED','REVIEWED',
    'RETURNED_FOR_CORRECTION','RESUBMITTED','REOPENED','LOCKED'
  )),
  old_status text,
  new_status text,
  actor_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reason text,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dr_history_report ON daily_report_history (daily_report_id, created_at);

-- ============================================================
-- 5. daily_report_comments
-- ============================================================
CREATE TABLE IF NOT EXISTS daily_report_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  daily_report_id uuid NOT NULL REFERENCES daily_reports(id) ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  comment_text text NOT NULL,
  comment_type text NOT NULL DEFAULT 'EMPLOYEE_NOTE' CHECK (comment_type IN (
    'EMPLOYEE_NOTE','MANAGER_FEEDBACK','HR_NOTE','DIRECTOR_NOTE','FOLLOW_UP'
  )),
  created_at timestamptz NOT NULL DEFAULT now(),
  edited_at timestamptz,
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_dr_comments_report ON daily_report_comments (daily_report_id, created_at);

-- ============================================================
-- Triggers
-- ============================================================
DROP TRIGGER IF EXISTS daily_reports_updated_at ON daily_reports;
CREATE TRIGGER daily_reports_updated_at BEFORE UPDATE ON daily_reports
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

DROP TRIGGER IF EXISTS daily_report_task_items_updated_at ON daily_report_task_items;
CREATE TRIGGER daily_report_task_items_updated_at BEFORE UPDATE ON daily_report_task_items
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

-- ============================================================
-- Organization config columns for daily reports
-- ============================================================
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS require_daily_report boolean NOT NULL DEFAULT true;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS checkout_report_warning_enabled boolean NOT NULL DEFAULT true;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS missing_report_reminder_enabled boolean NOT NULL DEFAULT true;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS report_submission_cutoff_time time NOT NULL DEFAULT '18:00';
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS late_report_allowed boolean NOT NULL DEFAULT true;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS manager_review_required boolean NOT NULL DEFAULT true;
