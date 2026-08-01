-- Add Calls Activity fields to daily_reports
ALTER TABLE daily_reports
  ADD COLUMN IF NOT EXISTS has_call_activity boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS total_calls_made integer,
  ADD COLUMN IF NOT EXISTS calls_picked_up integer,
  ADD COLUMN IF NOT EXISTS calls_not_picked_up integer,
  ADD COLUMN IF NOT EXISTS leads_generated integer;

-- CHECK constraints: all numeric values must be >= 0
ALTER TABLE daily_reports ADD CONSTRAINT chk_calls_made_nonneg
  CHECK (total_calls_made IS NULL OR total_calls_made >= 0);
ALTER TABLE daily_reports ADD CONSTRAINT chk_calls_picked_nonneg
  CHECK (calls_picked_up IS NULL OR calls_picked_up >= 0);
ALTER TABLE daily_reports ADD CONSTRAINT chk_calls_notpicked_nonneg
  CHECK (calls_not_picked_up IS NULL OR calls_not_picked_up >= 0);
ALTER TABLE daily_reports ADD CONSTRAINT chk_leads_nonneg
  CHECK (leads_generated IS NULL OR leads_generated >= 0);

-- picked_up + not_picked_up = total_calls_made when has_call_activity = true
ALTER TABLE daily_reports ADD CONSTRAINT chk_calls_sum_match
  CHECK (
    has_call_activity = false
    OR (
      total_calls_made IS NOT NULL
      AND calls_picked_up IS NOT NULL
      AND calls_not_picked_up IS NOT NULL
      AND calls_picked_up + calls_not_picked_up = total_calls_made
    )
  );

-- leads_generated <= calls_picked_up when has_call_activity = true
ALTER TABLE daily_reports ADD CONSTRAINT chk_leads_le_picked
  CHECK (
    has_call_activity = false
    OR leads_generated IS NULL
    OR calls_picked_up IS NULL
    OR leads_generated <= calls_picked_up
  );
