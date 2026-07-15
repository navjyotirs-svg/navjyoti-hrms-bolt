/*
# Phase 1 — Audit logs table

1. Purpose
   - Create an append-only audit log table that records all sensitive actions.
   - Records: actor, action, entity_type, entity_id, old_values, new_values, server timestamp.

2. New Table
   - `audit_logs`
     - `id` (uuid, PK)
     - `actor_id` (uuid, FK→auth.users, nullable for system actions)
     - `action` (text, not null) — e.g. 'employee.invite', 'role.assign', 'employee.deactivate'
     - `entity_type` (text, not null) — e.g. 'employee', 'organization', 'role'
     - `entity_id` (uuid, nullable)
     - `old_values` (jsonb, nullable)
     - `new_values` (jsonb, nullable)
     - `created_at` (timestamptz, default now)

3. Security (RLS)
   - SELECT: only users with audit.read permission
   - INSERT: all authenticated users can insert (for audit logging), but typically done via server function
   - UPDATE/DELETE: no policies (append-only, no modifications allowed)

4. Notes
   - The table is append-only: no UPDATE or DELETE policies are defined.
   - RLS blocks UPDATE and DELETE by default when no matching policy exists.
*/

CREATE TABLE IF NOT EXISTS audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  old_values jsonb,
  new_values jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- SELECT: only users with audit.read permission
DROP POLICY IF EXISTS "select_audit_authorized" ON audit_logs;
CREATE POLICY "select_audit_authorized"
  ON audit_logs FOR SELECT
  TO authenticated
  USING (current_user_has_permission('audit.read'));

-- INSERT: all authenticated users (audit entries are typically written by server functions)
DROP POLICY IF EXISTS "insert_audit_any" ON audit_logs;
CREATE POLICY "insert_audit_any"
  ON audit_logs FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- No UPDATE or DELETE policies — table is append-only

CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_logs(actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at DESC);
