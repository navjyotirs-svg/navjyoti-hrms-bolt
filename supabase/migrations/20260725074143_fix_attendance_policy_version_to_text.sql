-- Convert attendance_policy_version from integer to TEXT
-- The application sends string codes like 'POLICY_540_FULL_DAY' but the column was integer.
-- Historical numeric values (1) are converted to 'POLICY_540_FULL_DAY'.

-- Step 1: Add a temporary TEXT column
ALTER TABLE attendance_records
  ADD COLUMN IF NOT EXISTS attendance_policy_version_new text;

-- Step 2: Copy and convert values
UPDATE attendance_records
SET attendance_policy_version_new = CASE
  WHEN attendance_policy_version IS NULL THEN 'POLICY_540_FULL_DAY'
  WHEN attendance_policy_version = 1 THEN 'POLICY_540_FULL_DAY'
  ELSE 'POLICY_' || attendance_policy_version::text || '_FULL_DAY'
END;

-- Step 3: Drop old column
ALTER TABLE attendance_records
  DROP COLUMN attendance_policy_version;

-- Step 4: Rename new column
ALTER TABLE attendance_records
  RENAME COLUMN attendance_policy_version_new TO attendance_policy_version;

-- Step 5: Set NOT NULL, default, and CHECK constraint
ALTER TABLE attendance_records
  ALTER COLUMN attendance_policy_version SET NOT NULL;

ALTER TABLE attendance_records
  ALTER COLUMN attendance_policy_version SET DEFAULT 'POLICY_540_FULL_DAY';

ALTER TABLE attendance_records
  ADD CONSTRAINT attendance_policy_version_format
  CHECK (attendance_policy_version ~ '^POLICY_[0-9]+_FULL_DAY$');

-- Update table comment
COMMENT ON TABLE attendance_records IS
  'Attendance policy v2 (POLICY_540_FULL_DAY): FULL_DAY at >=540 elapsed minutes; HALF_DAY below 540; PENDING_CHECKOUT before checkout. No 480-minute threshold, no early checkout grace, no Late status, no payroll/salary data.';
