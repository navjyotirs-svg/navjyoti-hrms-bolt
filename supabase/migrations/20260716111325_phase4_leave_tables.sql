/*
# Phase 4 — Leave Tables

## Purpose
Create all leave management tables: leave_types, leave_balances, leave_ledger,
leave_requests, and leave_request_history.

## New Tables (5)

### 1. leave_types
Organization-scoped leave type definitions. Seeded with CASUAL_LEAVE and SICK_LEAVE.
- id (uuid PK)
- organization_id (uuid FK -> organizations)
- code (text, unique per org) — e.g. CASUAL_LEAVE, SICK_LEAVE
- name (text) — display name
- description (text, nullable)
- is_paid (boolean, default true)
- monthly_credit (numeric, default 1) — days credited per month
- carry_forward_enabled (boolean, default true)
- maximum_carry_forward (numeric, nullable) — null = no cap
- allow_half_day (boolean, default true)
- requires_document (boolean, default false)
- minimum_notice_days (integer, default 0)
- is_active (boolean, default true)
- created_at, updated_at (timestamptz)

### 2. leave_balances
Per-employee, per-leave-type, per-year balance tracking.
- id (uuid PK)
- employee_id (uuid FK -> employees)
- organization_id (uuid FK -> organizations)
- leave_type_id (uuid FK -> leave_types)
- opening_balance (numeric, default 0)
- accrued (numeric, default 0)
- used (numeric, default 0)
- adjusted (numeric, default 0)
- cancelled_restored (numeric, default 0)
- closing_balance (numeric, default 0) — computed: opening + accrued - used + adjusted + cancelled_restored
- balance_year (integer) — e.g. 2026
- version (integer, default 0) — optimistic locking
- created_at, updated_at (timestamptz)
- UNIQUE (employee_id, leave_type_id, balance_year)

### 3. leave_ledger
Append-only ledger for all leave balance transactions.
- id (uuid PK)
- employee_id (uuid FK -> employees)
- organization_id (uuid FK -> organizations)
- leave_type_id (uuid FK -> leave_types)
- transaction_type (text CHECK) — OPENING_BALANCE, MONTHLY_ACCRUAL, LEAVE_RESERVED,
  LEAVE_USED, LEAVE_CANCELLED_RESTORED, MANUAL_ADJUSTMENT, CARRY_FORWARD, EXPIRY, REVERSAL
- quantity (numeric) — positive for credits, negative for debits
- balance_before (numeric)
- balance_after (numeric)
- reference_type (text, nullable) — e.g. leave_request, monthly_accrual, manual_adjustment
- reference_id (uuid, nullable)
- description (text, nullable)
- effective_date (date)
- created_by (uuid FK -> user_profiles)
- created_at (timestamptz)
- idempotency_key (text UNIQUE) — prevents duplicate transactions

### 4. leave_requests
Leave application records with multi-stage approval workflow.
- id (uuid PK)
- employee_id (uuid FK -> employees)
- organization_id (uuid FK -> organizations)
- branch_id (uuid FK -> branches, nullable)
- leave_type_id (uuid FK -> leave_types)
- from_date (date)
- to_date (date)
- requested_days (numeric) — server-calculated, not browser-submitted
- half_day_type (text CHECK, nullable) — FIRST_HALF, SECOND_HALF (null = full day)
- reason (text)
- supporting_document_path (text, nullable) — private storage path
- status (text CHECK) — DRAFT, PENDING_MANAGER, PENDING_HR, APPROVED, REJECTED, CANCELLED, WITHDRAWN
- current_approver_id (uuid, nullable)
- manager_decision (text CHECK, nullable) — APPROVED, REJECTED, RETURNED
- manager_remarks (text, nullable)
- hr_decision (text CHECK, nullable) — APPROVED, REJECTED
- hr_remarks (text, nullable)
- approved_by (uuid, nullable)
- approved_at (timestamptz, nullable)
- rejected_by (uuid, nullable)
- rejected_at (timestamptz, nullable)
- cancelled_by (uuid, nullable)
- cancelled_at (timestamptz, nullable)
- cancellation_reason (text, nullable)
- created_at, updated_at (timestamptz)
- version (integer, default 0)

### 5. leave_request_history
Append-only history of all leave request state changes.
- id (uuid PK)
- leave_request_id (uuid FK -> leave_requests)
- action (text CHECK) — CREATED, SUBMITTED, MANAGER_APPROVED, MANAGER_REJECTED,
  HR_APPROVED, HR_REJECTED, CANCELLED, WITHDRAWN, DATE_MODIFIED, DOCUMENT_UPLOADED,
  BALANCE_RESERVED, BALANCE_RESTORED, RETURNED_FOR_CLARIFICATION
- performed_by (uuid FK -> user_profiles)
- remarks (text, nullable)
- old_values (jsonb, nullable)
- new_values (jsonb, nullable)
- created_at (timestamptz)

## Security
- RLS enabled on all tables (policies in separate migration)
- leave_ledger and leave_request_history are append-only (no UPDATE/DELETE policies)
- No payroll/salary columns

## Notes
1. Leave types are seeded with CASUAL_LEAVE and SICK_LEAVE defaults
2. Leave balances have a unique constraint on (employee_id, leave_type_id, balance_year)
3. Ledger idempotency_key prevents duplicate monthly accrual or double-deduction
4. requested_days is server-calculated — the browser cannot submit a false day count
5. updated_at triggers added to leave_balances and leave_requests
*/

-- ============ leave_types ============
CREATE TABLE IF NOT EXISTS leave_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  description text,
  is_paid boolean NOT NULL DEFAULT true,
  monthly_credit numeric NOT NULL DEFAULT 1,
  carry_forward_enabled boolean NOT NULL DEFAULT true,
  maximum_carry_forward numeric,
  allow_half_day boolean NOT NULL DEFAULT true,
  requires_document boolean NOT NULL DEFAULT false,
  minimum_notice_days integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, code)
);

ALTER TABLE leave_types ENABLE ROW LEVEL SECURITY;

-- ============ leave_balances ============
CREATE TABLE IF NOT EXISTS leave_balances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  leave_type_id uuid NOT NULL REFERENCES leave_types(id) ON DELETE CASCADE,
  opening_balance numeric NOT NULL DEFAULT 0,
  accrued numeric NOT NULL DEFAULT 0,
  used numeric NOT NULL DEFAULT 0,
  adjusted numeric NOT NULL DEFAULT 0,
  cancelled_restored numeric NOT NULL DEFAULT 0,
  closing_balance numeric NOT NULL DEFAULT 0,
  balance_year integer NOT NULL DEFAULT EXTRACT(year FROM now())::integer,
  version integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (employee_id, leave_type_id, balance_year)
);

ALTER TABLE leave_balances ENABLE ROW LEVEL SECURITY;

-- ============ leave_ledger ============
CREATE TABLE IF NOT EXISTS leave_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  leave_type_id uuid NOT NULL REFERENCES leave_types(id) ON DELETE CASCADE,
  transaction_type text NOT NULL CHECK (transaction_type IN (
    'OPENING_BALANCE', 'MONTHLY_ACCRUAL', 'LEAVE_RESERVED',
    'LEAVE_USED', 'LEAVE_CANCELLED_RESTORED', 'MANUAL_ADJUSTMENT',
    'CARRY_FORWARD', 'EXPIRY', 'REVERSAL'
  )),
  quantity numeric NOT NULL,
  balance_before numeric NOT NULL DEFAULT 0,
  balance_after numeric NOT NULL DEFAULT 0,
  reference_type text,
  reference_id uuid,
  description text,
  effective_date date NOT NULL DEFAULT CURRENT_DATE,
  created_by uuid REFERENCES user_profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  idempotency_key text UNIQUE NOT NULL
);

ALTER TABLE leave_ledger ENABLE ROW LEVEL SECURITY;

-- ============ leave_requests ============
CREATE TABLE IF NOT EXISTS leave_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  branch_id uuid REFERENCES branches(id),
  leave_type_id uuid NOT NULL REFERENCES leave_types(id) ON DELETE CASCADE,
  from_date date NOT NULL,
  to_date date NOT NULL,
  requested_days numeric NOT NULL DEFAULT 0,
  half_day_type text CHECK (half_day_type IN ('FIRST_HALF', 'SECOND_HALF')),
  reason text NOT NULL DEFAULT '',
  supporting_document_path text,
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN (
    'DRAFT', 'PENDING_MANAGER', 'PENDING_HR', 'APPROVED',
    'REJECTED', 'CANCELLED', 'WITHDRAWN'
  )),
  current_approver_id uuid,
  manager_decision text CHECK (manager_decision IN ('APPROVED', 'REJECTED', 'RETURNED')),
  manager_remarks text,
  hr_decision text CHECK (hr_decision IN ('APPROVED', 'REJECTED')),
  hr_remarks text,
  approved_by uuid,
  approved_at timestamptz,
  rejected_by uuid,
  rejected_at timestamptz,
  cancelled_by uuid,
  cancelled_at timestamptz,
  cancellation_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 0
);

ALTER TABLE leave_requests ENABLE ROW LEVEL SECURITY;

-- ============ leave_request_history ============
CREATE TABLE IF NOT EXISTS leave_request_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  leave_request_id uuid NOT NULL REFERENCES leave_requests(id) ON DELETE CASCADE,
  action text NOT NULL CHECK (action IN (
    'CREATED', 'SUBMITTED', 'MANAGER_APPROVED', 'MANAGER_REJECTED',
    'HR_APPROVED', 'HR_REJECTED', 'CANCELLED', 'WITHDRAWN',
    'DATE_MODIFIED', 'DOCUMENT_UPLOADED',
    'BALANCE_RESERVED', 'BALANCE_RESTORED', 'RETURNED_FOR_CLARIFICATION'
  )),
  performed_by uuid REFERENCES user_profiles(id),
  remarks text,
  old_values jsonb,
  new_values jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE leave_request_history ENABLE ROW LEVEL SECURITY;

-- ============ Indexes ============
CREATE INDEX IF NOT EXISTS idx_leave_balances_employee ON leave_balances(employee_id);
CREATE INDEX IF NOT EXISTS idx_leave_balances_org ON leave_balances(organization_id);
CREATE INDEX IF NOT EXISTS idx_leave_ledger_employee ON leave_ledger(employee_id);
CREATE INDEX IF NOT EXISTS idx_leave_ledger_org ON leave_ledger(organization_id);
CREATE INDEX IF NOT EXISTS idx_leave_ledger_idempotency ON leave_ledger(idempotency_key);
CREATE INDEX IF NOT EXISTS idx_leave_requests_employee ON leave_requests(employee_id);
CREATE INDEX IF NOT EXISTS idx_leave_requests_org ON leave_requests(organization_id);
CREATE INDEX IF NOT EXISTS idx_leave_requests_status ON leave_requests(status);
CREATE INDEX IF NOT EXISTS idx_leave_request_history_request ON leave_request_history(leave_request_id);

-- ============ updated_at triggers ============
CREATE OR REPLACE FUNCTION trg_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS leave_balances_updated_at ON leave_balances;
CREATE TRIGGER leave_balances_updated_at BEFORE UPDATE ON leave_balances
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

DROP TRIGGER IF EXISTS leave_requests_updated_at ON leave_requests;
CREATE TRIGGER leave_requests_updated_at BEFORE UPDATE ON leave_requests
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

DROP TRIGGER IF EXISTS leave_types_updated_at ON leave_types;
CREATE TRIGGER leave_types_updated_at BEFORE UPDATE ON leave_types
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

-- ============ Seed leave types for existing organizations ============
-- Only seeds if no leave types exist yet for the org
INSERT INTO leave_types (organization_id, code, name, description, is_paid, monthly_credit, carry_forward_enabled, maximum_carry_forward, allow_half_day, requires_document, minimum_notice_days)
SELECT o.id, 'CASUAL_LEAVE', 'Casual Leave', 'Monthly paid casual leave', true, 1, true, null, true, false, 0
FROM organizations o
WHERE NOT EXISTS (
  SELECT 1 FROM leave_types lt WHERE lt.organization_id = o.id AND lt.code = 'CASUAL_LEAVE'
);

INSERT INTO leave_types (organization_id, code, name, description, is_paid, monthly_credit, carry_forward_enabled, maximum_carry_forward, allow_half_day, requires_document, minimum_notice_days)
SELECT o.id, 'SICK_LEAVE', 'Sick Leave', 'Monthly paid sick leave', true, 1, true, null, true, false, 0
FROM organizations o
WHERE NOT EXISTS (
  SELECT 1 FROM leave_types lt WHERE lt.organization_id = o.id AND lt.code = 'SICK_LEAVE'
);
