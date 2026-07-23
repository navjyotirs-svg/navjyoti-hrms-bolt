/*
# Phase 6 — Cron Jobs for Schedulers

## Summary
Schedules 3 cron jobs using pg_cron + pg_net:

1. report-scheduler-daily — Runs at 18:30 UTC (00:00 IST) daily
   Calls report-scheduler edge function to:
   - Send daily report due reminders before cutoff
   - Send missing report reminders after cutoff
   - Auto-submit DRAFT reports as late
   - Generate daily summary snapshots

2. notification-worker-every-minute — Runs every minute
   Calls notification-worker edge function to:
   - Process queued notification deliveries
   - Send emails via email adapter
   - Retry failed deliveries with exponential backoff

3. export-cleanup-hourly — Runs every hour
   Calls export-handler edge function to:
   - Mark expired export jobs as EXPIRED
   - Delete expired export files from storage

## Idempotency
All cron jobs use dedup_key patterns in notifications to prevent duplicates.
Edge functions are verify_jwt=false (cron-only access via service role key).
*/

-- ============================================================
-- 1. Report scheduler — daily at 18:30 UTC (00:00 IST)
-- ============================================================
SELECT cron.schedule(
  'report-scheduler-daily',
  '30 18 * * *',
  $$
    SELECT net.http_post(
      url := current_setting('app.functions_url', true) || '/report-scheduler',
      headers := '{"Content-Type": "application/json", "Authorization": "Bearer ' || current_setting('app.service_role_key', true) || '"}'::jsonb,
      body := '{}'::jsonb
    );
  $$
);

-- ============================================================
-- 2. Notification worker — every minute
-- ============================================================
SELECT cron.schedule(
  'notification-worker-every-minute',
  '* * * * *',
  $$
    SELECT net.http_post(
      url := current_setting('app.functions_url', true) || '/notification-worker',
      headers := '{"Content-Type": "application/json", "Authorization": "Bearer ' || current_setting('app.service_role_key', true) || '"}'::jsonb,
      body := '{}'::jsonb
    );
  $$
);

-- ============================================================
-- 3. Export cleanup — every hour
-- ============================================================
SELECT cron.schedule(
  'export-cleanup-hourly',
  '0 * * * *',
  $$
    SELECT net.http_post(
      url := current_setting('app.functions_url', true) || '/export-handler',
      headers := '{"Content-Type": "application/json", "Authorization": "Bearer ' || current_setting('app.service_role_key', true) || '"}'::jsonb,
      body := '{"action":"cleanup"}'::jsonb
    );
  $$
);
