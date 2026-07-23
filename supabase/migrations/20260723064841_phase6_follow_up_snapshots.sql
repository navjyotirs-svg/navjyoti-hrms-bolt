/*
# Phase 6 — Follow-up and Snapshot Tables

## Summary
Creates 2 tables: management_follow_ups, management_report_snapshots.

### management_follow_ups
Tracks follow-up actions from daily reports (8 types, 6 statuses).

### management_report_snapshots
JSONB snapshots for official daily/weekly management summaries with checksum.
*/

CREATE TABLE IF NOT EXISTS management_follow_ups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  daily_report_id uuid REFERENCES daily_reports(id) ON DELETE SET NULL,
  task_id uuid REFERENCES tasks(id) ON DELETE SET NULL,
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  assigned_to uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  follow_up_type text NOT NULL CHECK (follow_up_type IN (
    'MANAGER_ACTION','HR_SUPPORT','DIRECTOR_ATTENTION','RESOURCE_REQUEST',
    'BLOCKER_RESOLUTION','CLIENT_FOLLOW_UP','TASK_ESCALATION','OTHER'
  )),
  subject text NOT NULL,
  description text NOT NULL DEFAULT '',
  priority text NOT NULL DEFAULT 'MEDIUM' CHECK (priority IN ('LOW','MEDIUM','HIGH','CRITICAL')),
  due_at timestamptz,
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN (
    'OPEN','ASSIGNED','IN_PROGRESS','RESOLVED','CLOSED','CANCELLED'
  )),
  resolution text,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_follow_ups_org ON management_follow_ups (organization_id);
CREATE INDEX IF NOT EXISTS idx_follow_ups_emp ON management_follow_ups (employee_id);
CREATE INDEX IF NOT EXISTS idx_follow_ups_assigned ON management_follow_ups (assigned_to);
CREATE INDEX IF NOT EXISTS idx_follow_ups_status ON management_follow_ups (status);
CREATE INDEX IF NOT EXISTS idx_follow_ups_report ON management_follow_ups (daily_report_id);

DROP TRIGGER IF EXISTS management_follow_ups_updated_at ON management_follow_ups;
CREATE TRIGGER management_follow_ups_updated_at BEFORE UPDATE ON management_follow_ups
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

-- ============================================================
CREATE TABLE IF NOT EXISTS management_report_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  report_type text NOT NULL CHECK (report_type IN ('DAILY_SUMMARY','WEEKLY_SUMMARY','DEPARTMENT_SUMMARY','BRANCH_SUMMARY')),
  report_date date NOT NULL,
  scope_type text NOT NULL CHECK (scope_type IN ('ORGANIZATION','BRANCH','DEPARTMENT','TEAM','EMPLOYEE')),
  scope_id uuid,
  generated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  generated_at timestamptz NOT NULL DEFAULT now(),
  data_snapshot jsonb NOT NULL DEFAULT '{}',
  version integer NOT NULL DEFAULT 1,
  checksum text NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_snapshots_org ON management_report_snapshots (organization_id, report_date);
CREATE INDEX IF NOT EXISTS idx_snapshots_type ON management_report_snapshots (report_type, report_date);
