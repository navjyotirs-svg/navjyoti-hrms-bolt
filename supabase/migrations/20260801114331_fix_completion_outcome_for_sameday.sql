-- Fix completion_outcome for tasks completed on the same day as their deadline
-- The deadline is date-only, completed_at has a timestamp.
-- If completed_at is on the same calendar date (in IST) as the deadline, it's ON_TIME.
UPDATE tasks
SET completion_outcome = 'ON_TIME'
WHERE status = 'COMPLETED'
  AND current_deadline IS NOT NULL
  AND completed_at IS NOT NULL
  AND (completed_at AT TIME ZONE 'Asia/Kolkata')::date = current_deadline::date;
