
CREATE TABLE IF NOT EXISTS attendance_idempotency (
  request_id TEXT NOT NULL,
  action TEXT NOT NULL,
  response_data JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT attendance_idempotency_pkey PRIMARY KEY (request_id, action)
);

ALTER TABLE attendance_idempotency ENABLE ROW LEVEL SECURITY;

-- No policies: this table is only accessed via the service role key in edge functions.
-- RLS with no policies = blocked for anon/authenticated, allowed for service role.
