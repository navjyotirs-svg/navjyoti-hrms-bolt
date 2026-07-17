/*
# Phase 5 — Task Deadline Reminder Cron Job

## Summary
Schedules a cron job to run every hour, checking for tasks approaching
their deadlines and creating idempotent reminder notifications.

## Reminder Rules
- 3 days before deadline: first reminder
- 1 day before deadline: second reminder
- On deadline day: final reminder
- Overdue: daily reminder after deadline

## Idempotency
Uses dedup_key pattern: task_reminder:{task_id}:{reminder_type}:{date}
The notifications table UNIQUE constraint on dedup_key prevents duplicates.

## Cron Schedule
Runs every hour at minute 0: `0 * * * *`
Uses pg_net to POST to the task-scheduler edge function.
*/

-- Insert cron job
SELECT cron.schedule(
  'task-deadline-reminders-hourly',
  '0 * * * *',
  $$
    SELECT net.http_post(
      url := current_setting('app.functions_url', true) || '/task-scheduler',
      headers := '{"Content-Type": "application/json", "Authorization": "Bearer ' || current_setting('app.service_role_key', true) || '"}'::jsonb,
      body := '{}'::jsonb
    );
  $$
);

-- Also schedule via pg_net directly if the above approach doesn't work
-- The edge function handles the actual reminder logic
