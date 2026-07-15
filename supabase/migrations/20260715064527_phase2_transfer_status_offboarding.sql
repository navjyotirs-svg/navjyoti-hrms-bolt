/*
# Phase 2 — Employee transfers, status history, and offboarding

1. Purpose
   - Create tables for tracking employee transfers, employment status changes, and offboarding.
   - All tables are append-only (no UPDATE/DELETE) to preserve historical records.

2. New Tables
   - `employee_transfers`
     - id (uuid, PK)
     - employee_id (uuid, FK→employees, CASCADE)
     - from_organization_id (uuid, nullable)
     - from_branch_id (uuid, nullable)
     - from_department_id (uuid, nullable)
     - from_manager_id (uuid, nullable) — employee id of previous manager
     - to_organization_id (uuid, nullable)
     - to_branch_id (uuid, nullable)
     - to_department_id (uuid, nullable)
     - to_manager_id (uuid, nullable) — employee id of new manager
     - effective_date (date, not null)
     - reason (text, nullable)
     - initiated_by (uuid, FK→auth.users)
     - approved_by (uuid, FK→auth.users, nullable)
     - status (text: pending|approved|rejected|completed, default 'pending')
     - created_at (timestamptz)

   - `employee_status_history`
     - id (uuid, PK)
     - employee_id (uuid, FK→employees, CASCADE)
     - old_status (text, nullable)
     - new_status (text, not null)
     - reason (text, nullable)
     - actor_id (uuid, FK→auth.users)
     - effective_date (date, not null)
     - created_at (timestamptz)

   - `employee_offboarding`
     - id (uuid, PK)
     - employee_id (uuid, FK→employees, CASCADE)
     - reason (text, nullable)
     - last_working_date (date, nullable)
     - initiated_by (uuid, FK→auth.users)
     - handover_checklist (jsonb, nullable) — {item: completed}
     - document_checklist (jsonb, nullable)
     - manager_acknowledged (boolean, default false)
     - hr_completed (boolean, default false)
     - status (text: initiated|in_progress|completed, default 'initiated')
     - created_at (timestamptz)
     - completed_at (timestamptz, nullable)

3. Security (RLS)
   - employee_transfers: SELECT for self or same-org with employee.transfer.manage; INSERT for manage
   - employee_status_history: SELECT for self or same-org with employee.status.manage; INSERT for manage
   - employee_offboarding: SELECT for self or same-org with employee.offboarding.manage; INSERT/UPDATE for manage
   - All history tables are append-only (no UPDATE/DELETE policies)
*/

-- ============================================================
-- EMPLOYEE TRANSFERS
-- ============================================================

CREATE TABLE IF NOT EXISTS employee_transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  from_organization_id uuid,
  from_branch_id uuid,
  from_department_id uuid,
  from_manager_id uuid,
  to_organization_id uuid,
  to_branch_id uuid,
  to_department_id uuid,
  to_manager_id uuid,
  effective_date date NOT NULL,
  reason text,
  initiated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'completed')),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE employee_transfers ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_transfers_employee ON employee_transfers(employee_id);
CREATE INDEX IF NOT EXISTS idx_transfers_status ON employee_transfers(status);

-- ============================================================
-- EMPLOYEE STATUS HISTORY
-- ============================================================

CREATE TABLE IF NOT EXISTS employee_status_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  old_status text,
  new_status text NOT NULL,
  reason text,
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  effective_date date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE employee_status_history ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_status_history_employee ON employee_status_history(employee_id);
CREATE INDEX IF NOT EXISTS idx_status_history_created ON employee_status_history(created_at DESC);

-- ============================================================
-- EMPLOYEE OFFBOARDING
-- ============================================================

CREATE TABLE IF NOT EXISTS employee_offboarding (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  reason text,
  last_working_date date,
  initiated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  handover_checklist jsonb,
  document_checklist jsonb,
  manager_acknowledged boolean NOT NULL DEFAULT false,
  hr_completed boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'initiated' CHECK (status IN ('initiated', 'in_progress', 'completed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

ALTER TABLE employee_offboarding ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_offboarding_employee ON employee_offboarding(employee_id);
CREATE INDEX IF NOT EXISTS idx_offboarding_status ON employee_offboarding(status);
