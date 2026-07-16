/*
# Phase 4 — Monthly Leave Accrual Cron Job

## Purpose
Schedule a monthly cron job to run the leave-accrual edge function on the 1st of every month at 00:01 IST (18:31 UTC on the last day of the previous month).

## Cron Job
- Name: leave-accrual-monthly
- Schedule: '1 0 1 * *' (1st of every month at 00:01)
- Calls: leave-accrual edge function via pg_net
- Idempotent: safe to retry (idempotency keys prevent duplicate accrual)

## Security
- Uses pg_net to POST to the edge function
- No JWT required (the function uses service role internally)
- The edge function is verify_jwt=false (cron-only access)
*/

SELECT cron.schedule(
  'leave-accrual-monthly',
  '1 0 1 * *',
  $$
    SELECT net.http_post(
      url := '${SUPABASE_URL}/functions/v1/leave-accrual',
      headers := '{"Content-Type": "application/json"}'::jsonb,
      body := '{}'::jsonb
    );
  $$
);
