/*
# Add full-day and standard-shift reminder columns to attendance_records

1. New Columns
- `full_day_reminder_sent_at` (timestamptz, nullable) — timestamp when the 480-minute "Full Day Qualified" reminder was sent
- `standard_shift_reminder_sent_at` (timestamptz, nullable) — timestamp when the 540-minute "Standard Shift Completed" reminder was sent

2. Notes
- These columns support the new attendance policy v1 reminders
- The existing pre_checkout_reminder_sent_at and checkout_ready_reminder_sent_at columns remain
- No payroll/salary columns
*/

ALTER TABLE attendance_records
  ADD COLUMN IF NOT EXISTS full_day_reminder_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS standard_shift_reminder_sent_at timestamptz;
