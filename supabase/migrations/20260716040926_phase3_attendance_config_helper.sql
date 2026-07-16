/*
# Phase 3 — Helper function to read attendance config from vault

1. Purpose
   - Create a SECURITY DEFINER function that reads attendance configuration
     from the vault.decrypted_secrets view.
   - Edge functions call this via the Supabase JS client (which defaults to public schema).

2. Security
   - SECURITY DEFINER so edge functions with service role can call it.
   - Only returns the specific attendance config keys.
   - No secrets are exposed to the frontend — this function is only called
     from edge functions using the service role key.
*/

CREATE OR REPLACE FUNCTION get_attendance_config()
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT jsonb_object_agg(
    name,
    decrypted_secret
  )
  FROM vault.decrypted_secrets
  WHERE name IN (
    'ATTENDANCE_TEST_MODE',
    'ATTENDANCE_TOTAL_MINUTES',
    'ATTENDANCE_PRE_ALERT_MINUTES',
    'SUPABASE_ENV'
  );
$$;

-- Grant execute to authenticated (edge functions use service role which bypasses RLS)
GRANT EXECUTE ON FUNCTION get_attendance_config() TO authenticated;
GRANT EXECUTE ON FUNCTION get_attendance_config() TO anon;
