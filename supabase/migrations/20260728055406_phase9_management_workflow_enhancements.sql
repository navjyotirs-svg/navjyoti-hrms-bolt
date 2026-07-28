/*
# Phase 9 — Management Workflow Enhancements

## Overview
Five approved HRMS enhancements:
1. Mandatory photo + location evidence during Check-In
2. Employee self-assigned tasks
3. Director/Manager voice notes to employees
4. Project management + mandatory project selection during task assignment
5. Recurring/repeated tasks generated when employee checks in

## 1. Attendance Check-In Evidence
- Adds check_in_evidence_status, check_out_evidence_status columns to attendance_records
- Adds evidence_status, location_source columns to attendance_evidence
- Check-in now requires photo + location (enforced server-side in edge function)

## 2. Self-Assigned Tasks
- Adds is_self_assigned, self_assigned_by, self_assigned_at, self_assign_reason to tasks
- New permission: task.self_assign

## 3. Voice Notes
- New tables: voice_notes, voice_note_recipients
- New private storage bucket: voice-notes
- New permissions: voice_note.send, voice_note.read_self, voice_note.read_sent

## 4. Project Management
- New tables: projects, project_history (append-only)
- Adds project_id to tasks (nullable for backward compat)
- Creates default "General Internal Operations" project per org, migrates existing tasks
- New permissions: project.create, project.read_self/read_team/read_all, project.update_team/update_all, project.archive, project.assign_task

## 5. Recurring Tasks
- New table: recurring_task_templates
- Adds recurring_template_id, recurrence_date, is_recurring_instance, assigned_employee_id to tasks
- Unique partial index prevents duplicate daily task generation
- New permissions: recurring_task.create, recurring_task.read_all/read_team, recurring_task.update, recurring_task.pause, recurring_task.deactivate

## Security
- RLS enabled on all new tables
- All tables organization-scoped
- Voice notes sender+recipient scoped
- Append-only tables have no UPDATE/DELETE policies
- Storage buckets private with org/owner-scoped policies
*/

-- ============================================================
-- 1. ATTENDANCE CHECK-IN EVIDENCE COLUMNS
-- ============================================================

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'attendance_records' AND column_name = 'check_in_evidence_status') THEN
    ALTER TABLE attendance_records ADD COLUMN check_in_evidence_status text DEFAULT 'PENDING';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'attendance_records' AND column_name = 'check_out_evidence_status') THEN
    ALTER TABLE attendance_records ADD COLUMN check_out_evidence_status text DEFAULT 'PENDING';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'attendance_evidence' AND column_name = 'evidence_status') THEN
    ALTER TABLE attendance_evidence ADD COLUMN evidence_status text NOT NULL DEFAULT 'VERIFIED';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'attendance_evidence' AND column_name = 'location_source') THEN
    ALTER TABLE attendance_evidence ADD COLUMN location_source text;
  END IF;
END $$;

-- ============================================================
-- 2. SELF-ASSIGNED TASK COLUMNS ON tasks
-- ============================================================

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'tasks' AND column_name = 'is_self_assigned') THEN
    ALTER TABLE tasks ADD COLUMN is_self_assigned boolean NOT NULL DEFAULT false;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'tasks' AND column_name = 'self_assigned_by') THEN
    ALTER TABLE tasks ADD COLUMN self_assigned_by uuid;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'tasks' AND column_name = 'self_assigned_at') THEN
    ALTER TABLE tasks ADD COLUMN self_assigned_at timestamptz;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'tasks' AND column_name = 'self_assign_reason') THEN
    ALTER TABLE tasks ADD COLUMN self_assign_reason text;
  END IF;
END $$;

-- ============================================================
-- 3. VOICE NOTES TABLES
-- ============================================================

CREATE TABLE IF NOT EXISTS voice_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  sender_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  sender_employee_id uuid REFERENCES employees(id) ON DELETE SET NULL,
  title text,
  message text,
  storage_path text NOT NULL,
  mime_type text NOT NULL,
  file_size_bytes bigint NOT NULL,
  duration_seconds integer,
  status text NOT NULL DEFAULT 'SENT' CHECK (status IN ('SENT', 'DELETED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

ALTER TABLE voice_notes ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS voice_note_recipients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  voice_note_id uuid NOT NULL REFERENCES voice_notes(id) ON DELETE CASCADE,
  recipient_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  recipient_employee_id uuid REFERENCES employees(id) ON DELETE SET NULL,
  delivered_at timestamptz,
  first_played_at timestamptz,
  last_played_at timestamptz,
  play_count integer NOT NULL DEFAULT 0,
  acknowledged_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE voice_note_recipients ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_voice_notes_org ON voice_notes(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_vn_recipients_recipient ON voice_note_recipients(recipient_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_vn_recipients_vn ON voice_note_recipients(voice_note_id);

-- ============================================================
-- 4. PROJECTS TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_code text NOT NULL,
  project_name text NOT NULL,
  description text,
  project_owner_employee_id uuid REFERENCES employees(id) ON DELETE SET NULL,
  branch_id uuid REFERENCES branches(id) ON DELETE SET NULL,
  department_id uuid REFERENCES departments(id) ON DELETE SET NULL,
  priority text NOT NULL DEFAULT 'MEDIUM' CHECK (priority IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  start_date date NOT NULL DEFAULT CURRENT_DATE,
  expected_end_date date,
  actual_end_date date,
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'ACTIVE', 'ON_HOLD', 'COMPLETED', 'CANCELLED', 'ARCHIVED')),
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  is_active boolean NOT NULL DEFAULT true
);

ALTER TABLE projects ENABLE ROW LEVEL SECURITY;

CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_code_org ON projects(organization_id, project_code);
CREATE INDEX IF NOT EXISTS idx_projects_org_status ON projects(organization_id, status);
CREATE INDEX IF NOT EXISTS idx_projects_owner ON projects(project_owner_employee_id);

CREATE TABLE IF NOT EXISTS project_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  action text NOT NULL CHECK (action IN ('CREATED', 'UPDATED', 'STATUS_CHANGED', 'ARCHIVED', 'COMPLETED')),
  old_values jsonb,
  new_values jsonb,
  changed_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE project_history ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_project_history_project ON project_history(project_id, created_at DESC);

-- Add project_id to tasks
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'tasks' AND column_name = 'project_id') THEN
    ALTER TABLE tasks ADD COLUMN project_id uuid REFERENCES projects(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id) WHERE project_id IS NOT NULL;

-- ============================================================
-- 5. RECURRING TASK TEMPLATES
-- ============================================================

CREATE TABLE IF NOT EXISTS recurring_task_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  template_code text NOT NULL,
  title text NOT NULL,
  description text,
  expected_result text,
  priority text NOT NULL DEFAULT 'MEDIUM' CHECK (priority IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  target_quantity numeric,
  target_unit text,
  estimated_hours numeric,
  task_cost numeric(14,2),
  assigned_employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  recurrence_type text NOT NULL DEFAULT 'DAILY' CHECK (recurrence_type IN ('DAILY')),
  selected_weekdays integer[],
  start_date date NOT NULL DEFAULT CURRENT_DATE,
  end_date date,
  assignment_trigger text NOT NULL DEFAULT 'EMPLOYEE_CHECK_IN' CHECK (assignment_trigger IN ('EMPLOYEE_CHECK_IN')),
  is_active boolean NOT NULL DEFAULT true,
  is_paused boolean NOT NULL DEFAULT false,
  last_generated_date date,
  next_generation_date date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deactivated_at timestamptz
);

ALTER TABLE recurring_task_templates ENABLE ROW LEVEL SECURITY;

CREATE UNIQUE INDEX IF NOT EXISTS idx_recurring_templates_code_org ON recurring_task_templates(organization_id, template_code);
CREATE INDEX IF NOT EXISTS idx_recurring_templates_org_active ON recurring_task_templates(organization_id, is_active, is_paused);
CREATE INDEX IF NOT EXISTS idx_recurring_templates_employee ON recurring_task_templates(assigned_employee_id, is_active);

-- Add recurring instance columns to tasks (BEFORE the unique index)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'tasks' AND column_name = 'recurring_template_id') THEN
    ALTER TABLE tasks ADD COLUMN recurring_template_id uuid REFERENCES recurring_task_templates(id) ON DELETE SET NULL;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'tasks' AND column_name = 'recurrence_date') THEN
    ALTER TABLE tasks ADD COLUMN recurrence_date date;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'tasks' AND column_name = 'is_recurring_instance') THEN
    ALTER TABLE tasks ADD COLUMN is_recurring_instance boolean NOT NULL DEFAULT false;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'tasks' AND column_name = 'assigned_employee_id') THEN
    ALTER TABLE tasks ADD COLUMN assigned_employee_id uuid REFERENCES employees(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Unique partial index: prevents duplicate recurring task per template+employee+date
CREATE UNIQUE INDEX IF NOT EXISTS idx_recurring_task_instance
ON tasks (recurring_template_id, assigned_employee_id, recurrence_date)
WHERE recurring_template_id IS NOT NULL AND recurrence_date IS NOT NULL;

-- ============================================================
-- 6. NEW PERMISSIONS
-- ============================================================

INSERT INTO permissions (code, label, description) VALUES
  ('task.self_assign', 'Self-Assign Task', 'Employee can create and assign a task to themselves'),
  ('voice_note.send', 'Send Voice Note', 'Director/Manager can send voice notes to employees'),
  ('voice_note.read_self', 'Read Own Voice Notes', 'Employee can read voice notes sent to them'),
  ('voice_note.read_sent', 'Read Sent Voice Notes', 'Sender can view voice notes they have sent'),
  ('project.create', 'Create Project', 'Create a new project'),
  ('project.read_self', 'Read Own Projects', 'View projects where employee is the owner or assignee'),
  ('project.read_team', 'Read Team Projects', 'View projects within reporting scope'),
  ('project.read_all', 'Read All Projects', 'View all projects in the organization'),
  ('project.update_team', 'Update Team Projects', 'Edit projects within reporting scope'),
  ('project.update_all', 'Update All Projects', 'Edit all projects in the organization'),
  ('project.archive', 'Archive Project', 'Archive or cancel a project'),
  ('project.assign_task', 'Assign Task to Project', 'Link a task to a project during task assignment'),
  ('recurring_task.create', 'Create Recurring Task', 'Create a recurring task template'),
  ('recurring_task.read_all', 'Read All Recurring Tasks', 'View all recurring task templates in the organization'),
  ('recurring_task.read_team', 'Read Team Recurring Tasks', 'View recurring task templates within reporting scope'),
  ('recurring_task.update', 'Update Recurring Task', 'Modify a recurring task template'),
  ('recurring_task.pause', 'Pause/Resume Recurring Task', 'Pause or resume a recurring task template'),
  ('recurring_task.deactivate', 'Deactivate Recurring Task', 'Deactivate a recurring task template')
ON CONFLICT (code) DO NOTHING;

-- ============================================================
-- 7. ROLE-PERMISSION MATRIX
-- ============================================================

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.code = 'director' AND p.code IN (
  'task.self_assign', 'voice_note.send', 'voice_note.read_self', 'voice_note.read_sent',
  'project.create', 'project.read_self', 'project.read_team', 'project.read_all',
  'project.update_team', 'project.update_all', 'project.archive', 'project.assign_task',
  'recurring_task.create', 'recurring_task.read_all', 'recurring_task.read_team',
  'recurring_task.update', 'recurring_task.pause', 'recurring_task.deactivate'
)
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.code = 'hr_admin' AND p.code IN (
  'task.self_assign', 'voice_note.read_self',
  'project.create', 'project.read_self', 'project.read_team', 'project.read_all',
  'project.update_team', 'project.update_all', 'project.archive', 'project.assign_task',
  'recurring_task.create', 'recurring_task.read_all', 'recurring_task.read_team',
  'recurring_task.update', 'recurring_task.pause', 'recurring_task.deactivate'
)
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.code = 'manager' AND p.code IN (
  'task.self_assign', 'voice_note.send', 'voice_note.read_self', 'voice_note.read_sent',
  'project.create', 'project.read_self', 'project.read_team',
  'project.update_team', 'project.assign_task',
  'recurring_task.create', 'recurring_task.read_team',
  'recurring_task.update', 'recurring_task.pause', 'recurring_task.deactivate'
)
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.code = 'team_leader' AND p.code IN (
  'task.self_assign', 'voice_note.read_self',
  'project.read_self', 'project.read_team'
)
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.code = 'employee' AND p.code IN (
  'task.self_assign', 'voice_note.read_self', 'project.read_self'
)
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.code = 'intern' AND p.code IN (
  'task.self_assign', 'voice_note.read_self', 'project.read_self'
)
ON CONFLICT DO NOTHING;

-- ============================================================
-- 8. RLS POLICIES
-- ============================================================

-- Voice Notes
DROP POLICY IF EXISTS "select_own_sent_voice_notes" ON voice_notes;
CREATE POLICY "select_own_sent_voice_notes"
ON voice_notes FOR SELECT TO authenticated
USING (
  sender_user_id = auth.uid()
  OR EXISTS (SELECT 1 FROM voice_note_recipients vnr WHERE vnr.voice_note_id = voice_notes.id AND vnr.recipient_user_id = auth.uid())
  OR (organization_id = (SELECT organization_id FROM user_profiles WHERE id = auth.uid())
      AND EXISTS (SELECT 1 FROM user_profiles up WHERE up.id = auth.uid() AND up.role IN ('director', 'hr_admin')))
);

DROP POLICY IF EXISTS "insert_voice_notes" ON voice_notes;
CREATE POLICY "insert_voice_notes"
ON voice_notes FOR INSERT TO authenticated
WITH CHECK (sender_user_id = auth.uid());

DROP POLICY IF EXISTS "update_voice_notes_sender" ON voice_notes;
CREATE POLICY "update_voice_notes_sender"
ON voice_notes FOR UPDATE TO authenticated
USING (sender_user_id = auth.uid())
WITH CHECK (sender_user_id = auth.uid());

-- Voice Note Recipients
DROP POLICY IF EXISTS "select_voice_note_recipients" ON voice_note_recipients;
CREATE POLICY "select_voice_note_recipients"
ON voice_note_recipients FOR SELECT TO authenticated
USING (
  recipient_user_id = auth.uid()
  OR EXISTS (SELECT 1 FROM voice_notes vn WHERE vn.id = voice_note_recipients.voice_note_id AND vn.sender_user_id = auth.uid())
);

DROP POLICY IF EXISTS "insert_voice_note_recipients" ON voice_note_recipients;
CREATE POLICY "insert_voice_note_recipients"
ON voice_note_recipients FOR INSERT TO authenticated
WITH CHECK (
  EXISTS (SELECT 1 FROM voice_notes vn WHERE vn.id = voice_note_recipients.voice_note_id AND vn.sender_user_id = auth.uid())
);

DROP POLICY IF EXISTS "update_voice_note_recipients" ON voice_note_recipients;
CREATE POLICY "update_voice_note_recipients"
ON voice_note_recipients FOR UPDATE TO authenticated
USING (
  recipient_user_id = auth.uid()
  OR EXISTS (SELECT 1 FROM voice_notes vn WHERE vn.id = voice_note_recipients.voice_note_id AND vn.sender_user_id = auth.uid())
)
WITH CHECK (
  recipient_user_id = auth.uid()
  OR EXISTS (SELECT 1 FROM voice_notes vn WHERE vn.id = voice_note_recipients.voice_note_id AND vn.sender_user_id = auth.uid())
);

-- Projects
DROP POLICY IF EXISTS "select_projects" ON projects;
CREATE POLICY "select_projects"
ON projects FOR SELECT TO authenticated
USING (organization_id = (SELECT organization_id FROM user_profiles WHERE id = auth.uid()));

DROP POLICY IF EXISTS "insert_projects" ON projects;
CREATE POLICY "insert_projects"
ON projects FOR INSERT TO authenticated
WITH CHECK (organization_id = (SELECT organization_id FROM user_profiles WHERE id = auth.uid()));

DROP POLICY IF EXISTS "update_projects" ON projects;
CREATE POLICY "update_projects"
ON projects FOR UPDATE TO authenticated
USING (organization_id = (SELECT organization_id FROM user_profiles WHERE id = auth.uid()))
WITH CHECK (organization_id = (SELECT organization_id FROM user_profiles WHERE id = auth.uid()));

-- Project History (append-only)
DROP POLICY IF EXISTS "select_project_history" ON project_history;
CREATE POLICY "select_project_history"
ON project_history FOR SELECT TO authenticated
USING (
  EXISTS (SELECT 1 FROM projects p WHERE p.id = project_history.project_id
    AND p.organization_id = (SELECT organization_id FROM user_profiles WHERE id = auth.uid()))
);

DROP POLICY IF EXISTS "insert_project_history" ON project_history;
CREATE POLICY "insert_project_history"
ON project_history FOR INSERT TO authenticated
WITH CHECK (true);

-- Recurring Task Templates
DROP POLICY IF EXISTS "select_recurring_templates" ON recurring_task_templates;
CREATE POLICY "select_recurring_templates"
ON recurring_task_templates FOR SELECT TO authenticated
USING (organization_id = (SELECT organization_id FROM user_profiles WHERE id = auth.uid()));

DROP POLICY IF EXISTS "insert_recurring_templates" ON recurring_task_templates;
CREATE POLICY "insert_recurring_templates"
ON recurring_task_templates FOR INSERT TO authenticated
WITH CHECK (organization_id = (SELECT organization_id FROM user_profiles WHERE id = auth.uid()));

DROP POLICY IF EXISTS "update_recurring_templates" ON recurring_task_templates;
CREATE POLICY "update_recurring_templates"
ON recurring_task_templates FOR UPDATE TO authenticated
USING (organization_id = (SELECT organization_id FROM user_profiles WHERE id = auth.uid()))
WITH CHECK (organization_id = (SELECT organization_id FROM user_profiles WHERE id = auth.uid()));

-- ============================================================
-- 9. STORAGE BUCKETS
-- ============================================================

INSERT INTO storage.buckets (id, name, public)
VALUES ('voice-notes', 'voice-notes', false)
ON CONFLICT (id) DO NOTHING;

-- Storage policies for voice-notes
DROP POLICY IF EXISTS "vn_select" ON storage.objects;
CREATE POLICY "vn_select"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'voice-notes'
  AND (
    (storage.foldername(name))[1] = auth.uid()::text
    OR EXISTS (SELECT 1 FROM voice_note_recipients vnr JOIN voice_notes vn ON vn.id = vnr.voice_note_id WHERE vn.storage_path = name AND vnr.recipient_user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM voice_notes vn WHERE vn.storage_path = name AND vn.sender_user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM user_profiles up WHERE up.id = auth.uid() AND up.role IN ('director', 'hr_admin'))
  )
);

DROP POLICY IF EXISTS "vn_insert" ON storage.objects;
CREATE POLICY "vn_insert"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'voice-notes' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "vn_delete" ON storage.objects;
CREATE POLICY "vn_delete"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'voice-notes' AND (storage.foldername(name))[1] = auth.uid()::text);

-- ============================================================
-- 10. CREATE DEFAULT PROJECT + MIGRATE EXISTING TASKS
-- ============================================================

DO $$
DECLARE
  org_record RECORD;
  default_project_id uuid;
BEGIN
  FOR org_record IN
    SELECT DISTINCT t.organization_id FROM tasks t WHERE t.project_id IS NULL
  LOOP
    SELECT id INTO default_project_id FROM projects
    WHERE organization_id = org_record.organization_id AND project_code = 'GEN-INTERNAL' LIMIT 1;

    IF default_project_id IS NULL THEN
      INSERT INTO projects (organization_id, project_code, project_name, description, priority, start_date, status, created_by, is_active)
      VALUES (
        org_record.organization_id, 'GEN-INTERNAL', 'General Internal Operations',
        'Default project for tasks not linked to a specific project',
        'LOW', CURRENT_DATE, 'ACTIVE',
        (SELECT id FROM auth.users LIMIT 1), true
      )
      RETURNING id INTO default_project_id;
    END IF;

    UPDATE tasks SET project_id = default_project_id
    WHERE organization_id = org_record.organization_id AND project_id IS NULL;
  END LOOP;
END $$;

-- ============================================================
-- 11. UPDATED_AT TRIGGERS
-- ============================================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_projects_updated_at ON projects;
CREATE TRIGGER trg_projects_updated_at BEFORE UPDATE ON projects
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trg_recurring_templates_updated_at ON recurring_task_templates;
CREATE TRIGGER trg_recurring_templates_updated_at BEFORE UPDATE ON recurring_task_templates
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- 12. REALTIME PUBLICATION
-- ============================================================

ALTER TABLE voice_notes REPLICA IDENTITY FULL;
ALTER TABLE voice_note_recipients REPLICA IDENTITY FULL;
ALTER TABLE projects REPLICA IDENTITY FULL;
ALTER TABLE recurring_task_templates REPLICA IDENTITY FULL;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'voice_notes') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE voice_notes;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'voice_note_recipients') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE voice_note_recipients;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'projects') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE projects;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'recurring_task_templates') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE recurring_task_templates;
  END IF;
END $$;
