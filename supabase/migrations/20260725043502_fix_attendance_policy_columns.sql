/*
# Fix attendance policy columns

1. New Columns on attendance_records
- `required_work_minutes` (existing, default 480) — minutes of actual work required for FULL_DAY
- `displayed_shift_minutes` (new, default 540) — the standard 9-hour shift shown in the portal
- `daily_early_checkout_grace` (new, default 60) — daily permission-to-leave-early minutes (not accumulated, not deducted, not a penalty)
- `full_day_eligible_at` (new) — check_in_at + required_work_minutes; the time at which the employee qualifies for Full Day
- `required_checkout_at` (existing) — check_in_at + displayed_shift_minutes; the standard checkout time always shown
- `actual_elapsed_minutes` (existing) — elapsed minutes at checkout
- `attendance_policy_version` (new, default 1) — version of the policy in effect for this record

2. Policy change
- FULL_DAY when actual_elapsed_minutes >= required_work_minutes (480)
- HALF_DAY when actual_elapsed_minutes < required_work_minutes (480)
- displayed_shift_minutes (540) is the displayed standard checkout, NOT the full-day threshold
- daily_early_checkout_grace (60) is informational permission, not stored as penalty

3. Notes
- No salary/payroll columns added
- Existing records: full_day_eligible_at backfilled from check_in_at + required_work_minutes where null
- The CHECK constraint on final_status remains PENDING_CHECKOUT / FULL_DAY / HALF_DAY
*/

ALTER TABLE attendance_records
  ADD COLUMN IF NOT EXISTS displayed_shift_minutes integer NOT NULL DEFAULT 540,
  ADD COLUMN IF NOT EXISTS daily_early_checkout_grace integer NOT NULL DEFAULT 60,
  ADD COLUMN IF NOT EXISTS full_day_eligible_at timestamptz,
  ADD COLUMN IF NOT EXISTS attendance_policy_version integer NOT NULL DEFAULT 1;

-- Backfill full_day_eligible_at for existing records that have a check_in_at
UPDATE attendance_records
SET full_day_eligible_at = check_in_at + (required_work_minutes || ' minutes')::interval
WHERE full_day_eligible_at IS NULL AND check_in_at IS NOT NULL;

-- Add a comment documenting the policy
COMMENT ON TABLE attendance_records IS
  'Attendance policy v1: FULL_DAY at >=480 elapsed minutes; displayed_shift_minutes=540 is the standard checkout time shown; daily_early_checkout_grace=60 is a non-accumulating daily permission to leave early. No payroll/salary data.';
