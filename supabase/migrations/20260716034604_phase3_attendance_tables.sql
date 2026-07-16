/*
# Phase 3 — Attendance tables

1. Purpose
   - Create attendance_records, attendance_evidence, attendance_corrections, and attendance_history tables.
   - RLS enabled on all tables; policies added in a subsequent migration.

2. Tables
   - attendance_records: main check-in/checkout record with 540-minute rule
   - attendance_evidence: photo + location evidence for checkout
   - attendance_corrections: correction requests with approval workflow
   - attendance_history: append-only history of all attendance events

3. Status Model
   - PENDING_CHECKOUT: checked in, not yet checked out
   - FULL_DAY: checkout at or after 540 elapsed minutes
   - HALF_DAY: checkout before 540 elapsed minutes
   - No LATE, ABSENT, or SHORT_ATTENDANCE for employees with check-in records.

4. Constraints
   - Unique partial index on (employee_id, attendance_date) for active records (prevents duplicate check-in)
   - CHECK constraints on final_status, evidence_type, correction_type, correction_status
   - attendance_history is append-only (no UPDATE/DELETE policies)
*/

-- ============================================================
-- ATTENDANCE_RECORDS
-- ============================================================

CREATE TABLE IF NOT EXISTS attendance_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  branch_id uuid REFERENCES branches(id) ON DELETE SET NULL,
  attendance_date date NOT NULL,
  check_in_at timestamptz NOT NULL,
  required_checkout_at timestamptz NOT NULL,
  check_out_at timestamptz,
  required_work_minutes int NOT NULL DEFAULT 480,
  required_break_minutes int NOT NULL DEFAULT 60,
  required_total_minutes int NOT NULL DEFAULT 540,
  actual_elapsed_minutes int,
  final_status text NOT NULL DEFAULT 'PENDING_CHECKOUT'
    CHECK (final_status IN ('PENDING_CHECKOUT', 'FULL_DAY', 'HALF_DAY')),
  status_reason text,
  pre_checkout_reminder_sent_at timestamptz,
  checkout_ready_reminder_sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  corrected_at timestamptz,
  corrected_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  correction_version int NOT NULL DEFAULT 0
);

ALTER TABLE attendance_records ENABLE ROW LEVEL SECURITY;

-- Prevent more than one active (PENDING_CHECKOUT) attendance record per employee per date
CREATE UNIQUE INDEX IF NOT EXISTS idx_attendance_unique_active
  ON attendance_records (employee_id, attendance_date)
  WHERE final_status = 'PENDING_CHECKOUT';

CREATE INDEX IF NOT EXISTS idx_attendance_employee ON attendance_records(employee_id);
CREATE INDEX IF NOT EXISTS idx_attendance_org ON attendance_records(organization_id);
CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance_records(attendance_date);
CREATE INDEX IF NOT EXISTS idx_attendance_status ON attendance_records(final_status);
CREATE INDEX IF NOT EXISTS idx_attendance_check_in ON attendance_records(check_in_at);

-- ============================================================
-- ATTENDANCE_EVIDENCE
-- ============================================================

CREATE TABLE IF NOT EXISTS attendance_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attendance_record_id uuid NOT NULL REFERENCES attendance_records(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  evidence_type text NOT NULL CHECK (evidence_type IN ('CHECK_IN_PHOTO', 'CHECK_OUT_PHOTO')),
  storage_path text NOT NULL,
  mime_type text,
  file_size_bytes bigint,
  latitude double precision,
  longitude double precision,
  location_accuracy double precision,
  captured_at timestamptz NOT NULL DEFAULT now(),
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

ALTER TABLE attendance_evidence ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_evidence_record ON attendance_evidence(attendance_record_id);
CREATE INDEX IF NOT EXISTS idx_evidence_employee ON attendance_evidence(employee_id);

-- ============================================================
-- ATTENDANCE_CORRECTIONS
-- ============================================================

CREATE TABLE IF NOT EXISTS attendance_corrections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attendance_record_id uuid NOT NULL REFERENCES attendance_records(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  requested_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  correction_type text NOT NULL CHECK (correction_type IN (
    'missed_check_in', 'missed_checkout', 'technical_problem',
    'camera_problem', 'location_problem', 'official_field_duty', 'other'
  )),
  requested_check_in_at timestamptz,
  requested_check_out_at timestamptz,
  reason text NOT NULL,
  supporting_document_path text,
  status text NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED')),
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewer_remarks text,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE attendance_corrections ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_corrections_record ON attendance_corrections(attendance_record_id);
CREATE INDEX IF NOT EXISTS idx_corrections_employee ON attendance_corrections(employee_id);
CREATE INDEX IF NOT EXISTS idx_corrections_status ON attendance_corrections(status);

-- ============================================================
-- ATTENDANCE_HISTORY (append-only)
-- ============================================================

CREATE TABLE IF NOT EXISTS attendance_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attendance_record_id uuid NOT NULL REFERENCES attendance_records(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  event_type text NOT NULL CHECK (event_type IN (
    'check_in', 'check_out', 'evidence_upload', 'status_calculated',
    'correction_request', 'correction_approved', 'correction_rejected',
    'record_recalculated'
  )),
  event_data jsonb,
  performed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE attendance_history ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_history_record ON attendance_history(attendance_record_id);
CREATE INDEX IF NOT EXISTS idx_history_employee ON attendance_history(employee_id);
CREATE INDEX IF NOT EXISTS idx_history_event ON attendance_history(event_type);

-- ============================================================
-- UPDATED_AT TRIGGER for attendance_records
-- ============================================================

CREATE OR REPLACE FUNCTION update_attendance_records_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_attendance_records_updated_at ON attendance_records;
CREATE TRIGGER trg_attendance_records_updated_at
  BEFORE UPDATE ON attendance_records
  FOR EACH ROW
  EXECUTE FUNCTION update_attendance_records_updated_at();

-- ============================================================
-- UPDATED_AT TRIGGER for attendance_corrections
-- ============================================================

CREATE OR REPLACE FUNCTION update_attendance_corrections_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_attendance_corrections_updated_at ON attendance_corrections;
CREATE TRIGGER trg_attendance_corrections_updated_at
  BEFORE UPDATE ON attendance_corrections
  FOR EACH ROW
  EXECUTE FUNCTION update_attendance_corrections_updated_at();
