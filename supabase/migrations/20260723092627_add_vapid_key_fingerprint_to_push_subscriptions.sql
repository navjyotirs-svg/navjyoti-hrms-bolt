-- Add VAPID key fingerprint column to detect key rotations.
-- Stores a short hash of the VAPID public key used when the subscription was created.
-- When the server's VAPID key changes, old subscriptions with a different fingerprint
-- can be detected and marked inactive, prompting users to re-register.

ALTER TABLE push_subscriptions
  ADD COLUMN IF NOT EXISTS vapid_key_fp text;

-- Backfill existing active subscriptions with NULL fingerprint (unknown key version).
-- They will be treated as legacy and checked on next push attempt.

CREATE INDEX IF NOT EXISTS idx_push_sub_vapid_fp
  ON push_subscriptions (vapid_key_fp)
  WHERE is_active = true;
