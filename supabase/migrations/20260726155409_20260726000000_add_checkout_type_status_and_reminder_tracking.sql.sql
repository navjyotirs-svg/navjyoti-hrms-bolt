/*
# Add checkout type, checkout status, and checkout reminder tracking columns

1. Purpose
   - Fix the missed-checkout problem: employees who complete 9 hours but forget
     to manually check out are currently left in PENDING_CHECKOUT forever (or
     treated as incomplete/half-day in reports). The scheduler will now
     automatically close such records at check_in + 9 hours with:
       final_status = FULL_DAY (present), checkout_type = AUTO,
       checkout_status = MISSED_CHECKOUT.
   - Separate attendance status (FULL_DAY / HALF_DAY / PENDING_CHECKOUT) from
     checkout status (COMPLETED / MISSED_CHECKOUT / PENDING) and checkout type
     (MANUAL / AUTO) so the system can distinguish "manual checkout" from
     "missed/automatic checkout."
   - Track exactly three checkout reminders per record (30 min before, 10 min
     before, at expected checkout) with dedicated timestamp columns so the
     scheduler is idempotent and never sends duplicate notifications.

2. New Columns on attendance_records
   - checkout_type text NOT NULL DEFAULT 'MANUAL'
       CHECK (checkout_type IN ('MANUAL', 'AUTO'))
       MANUAL = employee clicked Check Out; AUTO = system closed the record.
   - checkout_status text NOT NULL DEFAULT 'PENDING'
       CHECK (checkout_status IN ('COMPLETED', 'MISSED_CHECKOUT', 'PENDING'))
       COMPLETED = manual checkout done; MISSED_CHECKOUT = system auto-closed;
       PENDING = record still open, no checkout yet.
   - checkout_reminder_30_sent_at timestamptz  — 30-min-before reminder sent
   - checkout_reminder_10_sent_at timestamptz  — 10-min-before reminder sent
   - checkout_due_notification_sent_at timestamptz — at-expected-checkout reminder sent

3. Backfill existing records
   - Records with a check_out_at already set → checkout_status = 'COMPLETED',
     checkout_type = 'MANUAL' (all historical checkouts were manual).
   - Records with final_status = 'FULL_DAY' but no check_out_at →
     checkout_status = 'COMPLETED' (treat as completed).
   - Records with final_status = 'HALF_DAY' but no check_out_at →
     checkout_status = 'COMPLETED' (treat as completed, historical).
   - Records still PENDING_CHECKOUT with no check_out_at →
     checkout_status = 'PENDING' (the default; scheduler will process them).

4. Notes
   - The old columns pre_checkout_reminder_sent_at and
     checkout_ready_reminder_sent_at are kept (no data loss) but the scheduler
     will use the new three-column tracking instead.
   - No payroll, leave, overtime, or salary columns are touched.
   - The final_status CHECK constraint is unchanged — FULL_DAY remains the
     "present for full day" status. The new checkout_status column carries
     the "missed checkout" distinction.
*/

ALTER TABLE attendance_records
  ADD COLUMN IF NOT EXISTS checkout_type text NOT NULL DEFAULT 'MANUAL'
    CHECK (checkout_type IN ('MANUAL', 'AUTO'));

ALTER TABLE attendance_records
  ADD COLUMN IF NOT EXISTS checkout_status text NOT NULL DEFAULT 'PENDING'
    CHECK (checkout_status IN ('COMPLETED', 'MISSED_CHECKOUT', 'PENDING'));

ALTER TABLE attendance_records
  ADD COLUMN IF NOT EXISTS checkout_reminder_30_sent_at timestamptz;

ALTER TABLE attendance_records
  ADD COLUMN IF NOT EXISTS checkout_reminder_10_sent_at timestamptz;

ALTER TABLE attendance_records
  ADD COLUMN IF NOT EXISTS checkout_due_notification_sent_at timestamptz;

-- Backfill: any record with a manual checkout is COMPLETED + MANUAL
UPDATE attendance_records
SET checkout_status = 'COMPLETED',
    checkout_type = 'MANUAL'
WHERE check_out_at IS NOT NULL
  AND checkout_status = 'PENDING';

-- Backfill: FULL_DAY or HALF_DAY records without checkout (historical edge
-- cases) are treated as completed so the scheduler does not reprocess them.
UPDATE attendance_records
SET checkout_status = 'COMPLETED'
WHERE check_out_at IS NULL
  AND final_status IN ('FULL_DAY', 'HALF_DAY')
  AND checkout_status = 'PENDING';

-- Index for scheduler: find open records needing reminders / auto-close
CREATE INDEX IF NOT EXISTS idx_attendance_open_checkout
  ON attendance_records (final_status)
  WHERE final_status = 'PENDING_CHECKOUT';
