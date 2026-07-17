/*
# Phase 5 — Ticket Tables

## Summary
Creates 5 new tables for the ticket/escalation module:
tickets, ticket_history, ticket_comments, ticket_attachments, ticket_escalations.

## Tables

### 1. tickets
Main ticket record with code, category, subject, description, priority,
related task link, SLA tracking, assignment, and status.
Category CHECK enforces 10 categories. Status CHECK enforces 10 states.

### 2. ticket_history
Append-only log of ticket status changes and actions. No UPDATE or DELETE.

### 3. ticket_comments
Ticket conversation comments. Soft deletion not needed — comments are preserved.

### 4. ticket_attachments
Private file storage for ticket evidence. Scoped to ticket and organization.

### 5. ticket_escalations
Records each escalation event with level, from/to, and reason.
*/

-- ============================================================
-- 1. tickets
-- ============================================================
CREATE TABLE IF NOT EXISTS tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  branch_id uuid REFERENCES branches(id) ON DELETE SET NULL,
  ticket_code text NOT NULL,
  raised_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  related_task_id uuid REFERENCES tasks(id) ON DELETE SET NULL,
  category text NOT NULL CHECK (category IN (
    'TASK_REASSIGNMENT','UNREALISTIC_DEADLINE','TARGET_CORRECTION',
    'TECHNICAL_ISSUE','ACCESS_REQUEST','RESOURCE_REQUEST',
    'ATTENDANCE_CORRECTION','LEAVE_ISSUE','HR_GRIEVANCE','OTHER'
  )),
  subject text NOT NULL,
  description text NOT NULL DEFAULT '',
  priority text NOT NULL DEFAULT 'MEDIUM' CHECK (priority IN ('LOW','MEDIUM','HIGH','CRITICAL')),
  assigned_department_id uuid REFERENCES departments(id) ON DELETE SET NULL,
  assigned_to uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN (
    'OPEN','ASSIGNED','IN_PROGRESS','WAITING_FOR_EMPLOYEE',
    'WAITING_FOR_MANAGEMENT','RESOLVED','CLOSED','REOPENED','ESCALATED','CANCELLED'
  )),
  sla_due_at timestamptz,
  resolved_at timestamptz,
  resolution_summary text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_tickets_code_org ON tickets (organization_id, ticket_code);
CREATE INDEX IF NOT EXISTS idx_tickets_raised_by ON tickets (raised_by);
CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets (status);
CREATE INDEX IF NOT EXISTS idx_tickets_org ON tickets (organization_id);
CREATE INDEX IF NOT EXISTS idx_tickets_assigned_to ON tickets (assigned_to);
CREATE INDEX IF NOT EXISTS idx_tickets_sla ON tickets (sla_due_at) WHERE status NOT IN ('RESOLVED','CLOSED','CANCELLED');

-- ============================================================
-- 2. ticket_history (append-only)
-- ============================================================
CREATE TABLE IF NOT EXISTS ticket_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  old_status text,
  new_status text NOT NULL,
  changed_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reason text,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ticket_hist ON ticket_history (ticket_id, created_at);

-- ============================================================
-- 3. ticket_comments
-- ============================================================
CREATE TABLE IF NOT EXISTS ticket_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  comment_text text NOT NULL,
  is_internal boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  edited_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_ticket_comments ON ticket_comments (ticket_id, created_at);

-- ============================================================
-- 4. ticket_attachments
-- ============================================================
CREATE TABLE IF NOT EXISTS ticket_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  uploaded_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  storage_path text NOT NULL,
  file_name text NOT NULL,
  mime_type text,
  file_size_bytes bigint,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ticket_attach ON ticket_attachments (ticket_id);

-- ============================================================
-- 5. ticket_escalations
-- ============================================================
CREATE TABLE IF NOT EXISTS ticket_escalations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  escalation_level integer NOT NULL DEFAULT 1,
  escalated_from uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  escalated_to uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ticket_esc ON ticket_escalations (ticket_id, created_at);

-- ============================================================
-- updated_at trigger for tickets
-- ============================================================
DROP TRIGGER IF EXISTS tickets_updated_at ON tickets;
CREATE TRIGGER tickets_updated_at BEFORE UPDATE ON tickets
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();
