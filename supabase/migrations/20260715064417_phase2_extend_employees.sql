/*
# Phase 2 — Extend employees table with detailed profile columns

1. Purpose
   - Add 16 new columns to the employees table for detailed employee profiles.
   - Update the employment_status CHECK constraint to include 12 lifecycle states.
   - Add a trigger to prevent employees from changing their own employment_status.

2. New Columns (16)
   - preferred_name (text, nullable)
   - personal_email (text, nullable)
   - mobile_number (text, nullable)
   - alternate_mobile_number (text, nullable)
   - date_of_birth (date, nullable)
   - gender (text, nullable, CHECK in male/female/other/prefer_not_to_say)
   - current_address (text, nullable)
   - permanent_address (text, nullable)
   - emergency_contact_name (text, nullable)
   - emergency_contact_relation (text, nullable)
   - emergency_contact_phone (text, nullable)
   - employment_type (text, nullable, CHECK in full_time/part_time/contract/intern/consultant)
   - probation_end_date (date, nullable)
   - confirmation_date (date, nullable)
   - profile_photo_reference (text, nullable) — storage path reference
   - reporting_manager_id (uuid, nullable) — denormalized from employee_reporting_lines for convenience

3. Updated Constraints
   - employment_status CHECK updated to include: invited, pending_activation, active, on_probation,
     confirmed, transferred, suspended, notice_period, resigned, terminated, inactive, offboarded

4. Security
   - Trigger prevents employees from changing their own employment_status column.
   - RLS policies (added in a later migration) restrict sensitive field visibility.
*/

-- ============================================================
-- ADD NEW COLUMNS
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name = 'employees' AND column_name = 'preferred_name') THEN
    ALTER TABLE employees ADD COLUMN preferred_name text;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name = 'employees' AND column_name = 'personal_email') THEN
    ALTER TABLE employees ADD COLUMN personal_email text;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name = 'employees' AND column_name = 'mobile_number') THEN
    ALTER TABLE employees ADD COLUMN mobile_number text;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name = 'employees' AND column_name = 'alternate_mobile_number') THEN
    ALTER TABLE employees ADD COLUMN alternate_mobile_number text;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name = 'employees' AND column_name = 'date_of_birth') THEN
    ALTER TABLE employees ADD COLUMN date_of_birth date;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name = 'employees' AND column_name = 'gender') THEN
    ALTER TABLE employees ADD COLUMN gender text CHECK (gender IN ('male', 'female', 'other', 'prefer_not_to_say'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name = 'employees' AND column_name = 'current_address') THEN
    ALTER TABLE employees ADD COLUMN current_address text;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name = 'employees' AND column_name = 'permanent_address') THEN
    ALTER TABLE employees ADD COLUMN permanent_address text;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name = 'employees' AND column_name = 'emergency_contact_name') THEN
    ALTER TABLE employees ADD COLUMN emergency_contact_name text;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name = 'employees' AND column_name = 'emergency_contact_relation') THEN
    ALTER TABLE employees ADD COLUMN emergency_contact_relation text;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name = 'employees' AND column_name = 'emergency_contact_phone') THEN
    ALTER TABLE employees ADD COLUMN emergency_contact_phone text;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name = 'employees' AND column_name = 'employment_type') THEN
    ALTER TABLE employees ADD COLUMN employment_type text CHECK (employment_type IN ('full_time', 'part_time', 'contract', 'intern', 'consultant'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name = 'employees' AND column_name = 'probation_end_date') THEN
    ALTER TABLE employees ADD COLUMN probation_end_date date;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name = 'employees' AND column_name = 'confirmation_date') THEN
    ALTER TABLE employees ADD COLUMN confirmation_date date;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name = 'employees' AND column_name = 'profile_photo_reference') THEN
    ALTER TABLE employees ADD COLUMN profile_photo_reference text;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name = 'employees' AND column_name = 'reporting_manager_id') THEN
    ALTER TABLE employees ADD COLUMN reporting_manager_id uuid;
  END IF;
END $$;

-- ============================================================
-- UPDATE EMPLOYMENT_STATUS CHECK CONSTRAINT
-- ============================================================

ALTER TABLE employees DROP CONSTRAINT IF EXISTS employees_employment_status_check;
ALTER TABLE employees ADD CONSTRAINT employees_employment_status_check
  CHECK (employment_status IN (
    'invited', 'pending_activation', 'active', 'on_probation', 'confirmed',
    'transferred', 'suspended', 'notice_period', 'resigned',
    'terminated', 'inactive', 'offboarded'
  ));

-- ============================================================
-- TRIGGER: Prevent self-modification of employment_status
-- ============================================================

CREATE OR REPLACE FUNCTION prevent_self_employment_status_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NEW.user_id = auth.uid() THEN
    IF NEW.employment_status IS DISTINCT FROM OLD.employment_status THEN
      RAISE EXCEPTION 'You cannot change your own employment status';
    END IF;
    IF NEW.organization_id IS DISTINCT FROM OLD.organization_id THEN
      RAISE EXCEPTION 'You cannot change your own organization';
    END IF;
    IF NEW.employee_code IS DISTINCT FROM OLD.employee_code THEN
      RAISE EXCEPTION 'You cannot change your own employee code';
    END IF;
    IF NEW.branch_id IS DISTINCT FROM OLD.branch_id THEN
      RAISE EXCEPTION 'You cannot change your own branch';
    END IF;
    IF NEW.department_id IS DISTINCT FROM OLD.department_id THEN
      RAISE EXCEPTION 'You cannot change your own department';
    END IF;
    IF NEW.reporting_manager_id IS DISTINCT FROM OLD.reporting_manager_id THEN
      RAISE EXCEPTION 'You cannot change your own reporting manager';
    END IF;
    IF NEW.joining_date IS DISTINCT FROM OLD.joining_date THEN
      RAISE EXCEPTION 'You cannot change your own joining date';
    END IF;
    IF NEW.designation IS DISTINCT FROM OLD.designation THEN
      RAISE EXCEPTION 'You cannot change your own designation';
    END IF;
    IF NEW.employment_type IS DISTINCT FROM OLD.employment_type THEN
      RAISE EXCEPTION 'You cannot change your own employment type';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_self_employment_status_change ON employees;
CREATE TRIGGER trg_prevent_self_employment_status_change
  BEFORE UPDATE ON employees
  FOR EACH ROW
  EXECUTE FUNCTION prevent_self_employment_status_change();

-- ============================================================
-- INDEXES
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_employees_manager ON employees(reporting_manager_id);
CREATE INDEX IF NOT EXISTS idx_employees_status ON employees(employment_status);
CREATE INDEX IF NOT EXISTS idx_employees_employment_type ON employees(employment_type);
