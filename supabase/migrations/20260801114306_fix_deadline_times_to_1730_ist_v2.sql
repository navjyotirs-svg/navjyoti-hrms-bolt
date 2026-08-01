-- Fix all date-only deadlines (stored as midnight UTC = 05:30 AM IST) to 17:30 IST (12:00 UTC)
-- This corrects the display so deadlines show as 05:30 PM IST instead of 05:30 AM

-- Update original_deadline: shift from date-only to 12:00 UTC = 17:30 IST
UPDATE tasks
SET original_deadline = (original_deadline::date + INTERVAL '12 hours')::timestamptz
WHERE original_deadline IS NOT NULL
  AND EXTRACT(hour FROM original_deadline AT TIME ZONE 'UTC') = 0
  AND EXTRACT(minute FROM original_deadline AT TIME ZONE 'UTC') = 0;

-- Update current_deadline: same shift
UPDATE tasks
SET current_deadline = (current_deadline::date + INTERVAL '12 hours')::timestamptz
WHERE current_deadline IS NOT NULL
  AND EXTRACT(hour FROM current_deadline AT TIME ZONE 'UTC') = 0
  AND EXTRACT(minute FROM current_deadline AT TIME ZONE 'UTC') = 0;

-- Recalculate completion_outcome for completed tasks now that deadlines are corrected
-- Valid values: EARLY, ON_TIME, DELAYED
UPDATE tasks
SET completion_outcome = CASE
  WHEN completed_at <= current_deadline THEN 'ON_TIME'
  ELSE 'DELAYED'
END
WHERE status = 'COMPLETED'
  AND current_deadline IS NOT NULL
  AND completed_at IS NOT NULL;
