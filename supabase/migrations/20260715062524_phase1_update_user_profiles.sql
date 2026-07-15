/*
# Phase 1 — Update user_profiles: role codes, status fields, RLS policies, trigger

1. Purpose
   - Align user_profiles.role values with the new roles table codes.
   - Add organization_id, status, is_active columns.
   - Update RLS policies to use helper functions for org-scoped access.
   - Add trigger to prevent self-modification of role, org, or status.

2. Changes
   - Migrate old role codes to new: hr_administrator→hr_admin, intern_trainee→intern, system_administrator→system_admin
   - Add organization_id (uuid, nullable, FK→organizations)
   - Add status (text: active|pending_activation|disabled, default 'active')
   - Add is_active (boolean, default true)
   - Update role CHECK constraint
   - Add trigger: prevent_self_role_org_change
   - Replace Phase 0 RLS policies with org-scoped policies
*/

-- ============================================================
-- Migrate role codes
-- ============================================================

UPDATE user_profiles SET role = 'hr_admin' WHERE role = 'hr_administrator';
UPDATE user_profiles SET role = 'intern' WHERE role = 'intern_trainee';
UPDATE user_profiles SET role = 'system_admin' WHERE role = 'system_administrator';

-- ============================================================
-- Update role CHECK constraint
-- ============================================================

ALTER TABLE user_profiles DROP CONSTRAINT IF EXISTS user_profiles_role_check;
ALTER TABLE user_profiles ADD CONSTRAINT user_profiles_role_check
  CHECK (role IN (
    'director', 'hr_admin', 'manager', 'team_leader',
    'employee', 'intern', 'system_admin'
  ));

-- ============================================================
-- Add new columns
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name = 'user_profiles' AND column_name = 'organization_id') THEN
    ALTER TABLE user_profiles ADD COLUMN organization_id uuid REFERENCES organizations(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name = 'user_profiles' AND column_name = 'status') THEN
    ALTER TABLE user_profiles ADD COLUMN status text NOT NULL DEFAULT 'active';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name = 'user_profiles' AND column_name = 'is_active') THEN
    ALTER TABLE user_profiles ADD COLUMN is_active boolean NOT NULL DEFAULT true;
  END IF;
END $$;

-- Status check constraint
ALTER TABLE user_profiles DROP CONSTRAINT IF EXISTS user_profiles_status_check;
ALTER TABLE user_profiles ADD CONSTRAINT user_profiles_status_check
  CHECK (status IN ('active', 'pending_activation', 'disabled'));

-- Sync is_active with status
UPDATE user_profiles SET is_active = false WHERE status = 'disabled';

-- ============================================================
-- Trigger: prevent self-modification of role, org, or status
-- ============================================================

CREATE OR REPLACE FUNCTION prevent_self_role_org_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NEW.id = auth.uid() THEN
    IF NEW.role IS DISTINCT FROM OLD.role THEN
      RAISE EXCEPTION 'You cannot change your own role';
    END IF;
    IF NEW.organization_id IS DISTINCT FROM OLD.organization_id THEN
      RAISE EXCEPTION 'You cannot change your own organization';
    END IF;
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      RAISE EXCEPTION 'You cannot change your own account status';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_self_role_org_change ON user_profiles;
CREATE TRIGGER trg_prevent_self_role_org_change
  BEFORE UPDATE ON user_profiles
  FOR EACH ROW
  EXECUTE FUNCTION prevent_self_role_org_change();

-- ============================================================
-- RLS Policies for user_profiles
-- ============================================================

DROP POLICY IF EXISTS "select_own_profile" ON user_profiles;
DROP POLICY IF EXISTS "insert_own_profile" ON user_profiles;
DROP POLICY IF EXISTS "update_own_profile" ON user_profiles;
DROP POLICY IF EXISTS "delete_own_profile" ON user_profiles;

-- SELECT: own profile, or same-org with read permissions
DROP POLICY IF EXISTS "select_profiles_scoped" ON user_profiles;
CREATE POLICY "select_profiles_scoped"
  ON user_profiles FOR SELECT
  TO authenticated
  USING (
    id = auth.uid()
    OR (
      organization_id = current_user_org_id()
      AND (
        current_user_has_permission('employee.read_all')
        OR current_user_has_permission('employee.read_team')
      )
    )
  );

-- INSERT: self-insert only (for first login after invite)
DROP POLICY IF EXISTS "insert_profiles_self" ON user_profiles;
CREATE POLICY "insert_profiles_self"
  ON user_profiles FOR INSERT
  TO authenticated
  WITH CHECK (id = auth.uid());

-- UPDATE: own profile (trigger blocks role/org/status), or same-org with employee.update
DROP POLICY IF EXISTS "update_profiles_scoped" ON user_profiles;
CREATE POLICY "update_profiles_scoped"
  ON user_profiles FOR UPDATE
  TO authenticated
  USING (
    id = auth.uid()
    OR (
      organization_id = current_user_org_id()
      AND current_user_has_permission('employee.update')
    )
  )
  WITH CHECK (
    id = auth.uid()
    OR (
      organization_id = current_user_org_id()
      AND current_user_has_permission('employee.update')
    )
  );

-- DELETE: only org.manage permission (director, system_admin)
DROP POLICY IF EXISTS "delete_profiles_admin" ON user_profiles;
CREATE POLICY "delete_profiles_admin"
  ON user_profiles FOR DELETE
  TO authenticated
  USING (
    current_user_has_permission('organization.manage')
  );

-- Indexes
CREATE INDEX IF NOT EXISTS idx_user_profiles_org ON user_profiles(organization_id);
CREATE INDEX IF NOT EXISTS idx_user_profiles_status ON user_profiles(status);
