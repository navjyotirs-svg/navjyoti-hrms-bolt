/*
# Central Business Notification System

## Purpose
Add missing columns to the notifications table to support a central server-side
business notification service that resolves recipients (manager, HR, directors)
for every meaningful employee business action.

## Changes to existing tables

### notifications (modified)
- `organization_id` (uuid, nullable) — org scope for cross-org filtering
- `related_entity_type` (text, nullable) — e.g. 'leave_request', 'task', 'ticket'
- `related_entity_id` (uuid, nullable) — id of the related business record
- `event_code` (text, nullable) — canonical event code from the catalogue
- `acknowledgement_required` (boolean, default false) — for HIGH/CRITICAL supervisory events
- `acknowledged_at` (timestamptz, nullable) — when the user acknowledged
- `idempotency_key` (text, nullable) — deduplication key (org_id + event_code + entity_id + recipient_id)

### notification_deliveries (no schema change needed)
- Already has notification_id, channel, status, idempotency_key columns

## Indexes
- Index on notifications(organization_id) for org-scoped queries
- Index on notifications(event_code) for event filtering
- Index on notifications(related_entity_type, related_entity_id) for record-linked lookups
- UNIQUE index on notifications(idempotency_key) WHERE idempotency_key IS NOT NULL

## Security
- No new tables — existing RLS on notifications remains (recipient-scoped)
- No policy changes needed
*/

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='notifications' AND column_name='organization_id') THEN
    ALTER TABLE notifications ADD COLUMN organization_id uuid;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='notifications' AND column_name='related_entity_type') THEN
    ALTER TABLE notifications ADD COLUMN related_entity_type text;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='notifications' AND column_name='related_entity_id') THEN
    ALTER TABLE notifications ADD COLUMN related_entity_id uuid;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='notifications' AND column_name='event_code') THEN
    ALTER TABLE notifications ADD COLUMN event_code text;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='notifications' AND column_name='acknowledgement_required') THEN
    ALTER TABLE notifications ADD COLUMN acknowledgement_required boolean NOT NULL DEFAULT false;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='notifications' AND column_name='acknowledged_at') THEN
    ALTER TABLE notifications ADD COLUMN acknowledged_at timestamptz;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='notifications' AND column_name='idempotency_key') THEN
    ALTER TABLE notifications ADD COLUMN idempotency_key text;
  END IF;
END $$;

-- Indexes for efficient filtering
CREATE INDEX IF NOT EXISTS idx_notifications_org_id ON notifications(organization_id);
CREATE INDEX IF NOT EXISTS idx_notifications_event_code ON notifications(event_code);
CREATE INDEX IF NOT EXISTS idx_notifications_related_entity ON notifications(related_entity_type, related_entity_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_idempotency_key ON notifications(idempotency_key) WHERE idempotency_key IS NOT NULL;
