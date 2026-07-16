/*
# Phase 3 — Set up pg_cron to call attendance-scheduler every minute

1. Purpose
   - Enable pg_cron extension
   - Create a cron job that calls the attendance-scheduler edge function every minute
   - The scheduler checks for pending checkout records and sends reminders

2. Notes
   - pg_cron uses pg_net to make HTTP requests to the edge function
   - The edge function URL is constructed from the project URL
   - The cron job is idempotent — duplicates are prevented by dedup_key in notifications
*/

-- Enable pg_cron
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Grant permissions
GRANT USAGE ON SCHEMA cron TO postgres;
GRANT USAGE ON SCHEMA net TO postgres;

-- Create the cron job to call the scheduler every minute
-- The scheduler edge function URL
SELECT cron.schedule(
  'attendance-scheduler-every-minute',
  '* * * * *',
  $$
    SELECT net.http_request(
      url := 'https://ghxwezrurrfkdncnrcln.supabase.co/functions/v1/attendance-scheduler',
      method := 'POST',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('request.jwt.claim.sub', true)
      ),
      body := '{}'::jsonb
    );
  $$
);
