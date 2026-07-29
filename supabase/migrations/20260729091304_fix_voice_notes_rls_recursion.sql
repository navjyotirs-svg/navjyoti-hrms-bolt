/*
# Fix Voice Notes RLS recursion + granular permissions + route access

## Problem 1: Infinite RLS recursion
- voice_notes SELECT policy queries voice_note_recipients (is recipient?)
- voice_note_recipients SELECT policy queries voice_notes (is sender?)
- Postgres repeatedly evaluates both → "infinite recursion detected in policy"

## Fix: SECURITY DEFINER helper functions that bypass RLS
*/

-- ============================================================
-- Step 1: Create SECURITY DEFINER helper functions
-- ============================================================

CREATE OR REPLACE FUNCTION get_caller_org_id()
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT organization_id FROM user_profiles WHERE id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION get_caller_employee_id()
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT id FROM employees WHERE user_id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION can_read_voice_note(p_voice_note_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_sender uuid;
  v_is_recipient boolean;
BEGIN
  SELECT sender_user_id INTO v_sender
  FROM voice_notes
  WHERE id = p_voice_note_id AND deleted_at IS NULL;

  IF v_sender = auth.uid() THEN
    RETURN true;
  END IF;

  SELECT EXISTS(
    SELECT 1 FROM voice_note_recipients
    WHERE voice_note_id = p_voice_note_id
    AND recipient_user_id = auth.uid()
  ) INTO v_is_recipient;

  RETURN v_is_recipient;
END;
$$;

CREATE OR REPLACE FUNCTION can_manage_voice_note(p_voice_note_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_sender uuid;
BEGIN
  SELECT sender_user_id INTO v_sender
  FROM voice_notes
  WHERE id = p_voice_note_id AND deleted_at IS NULL;

  RETURN v_sender = auth.uid();
END;
$$;

CREATE OR REPLACE FUNCTION is_voice_note_recipient(p_voice_note_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  RETURN EXISTS(
    SELECT 1 FROM voice_note_recipients
    WHERE voice_note_id = p_voice_note_id
    AND recipient_user_id = auth.uid()
  );
END;
$$;

CREATE OR REPLACE FUNCTION can_send_voice_note_to_employee(p_employee_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_caller_org uuid;
  v_caller_role text;
  v_caller_emp_id uuid;
  v_recipient_org uuid;
  v_recipient_active boolean;
  v_in_subtree boolean;
BEGIN
  SELECT organization_id, role INTO v_caller_org, v_caller_role
  FROM user_profiles WHERE id = auth.uid();

  IF v_caller_org IS NULL THEN RETURN false; END IF;

  SELECT organization_id, is_active INTO v_recipient_org, v_recipient_active
  FROM employees WHERE id = p_employee_id;

  IF v_recipient_org IS NULL OR v_recipient_active = false THEN RETURN false; END IF;

  IF v_recipient_org <> v_caller_org THEN RETURN false; END IF;

  IF v_caller_role = 'director' THEN RETURN true; END IF;

  IF v_caller_role = 'manager' THEN
    SELECT id INTO v_caller_emp_id FROM employees WHERE user_id = auth.uid();
    IF v_caller_emp_id IS NULL THEN RETURN false; END IF;

    SELECT COALESCE(
      (SELECT is_in_reporting_subtree(p_manager_id := v_caller_emp_id, p_employee_id := p_employee_id)),
      false
    ) INTO v_in_subtree;
    RETURN v_in_subtree;
  END IF;

  RETURN false;
END;
$$;

-- Revoke from anon/PUBLIC, grant only to authenticated
REVOKE EXECUTE ON FUNCTION can_read_voice_note(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION can_manage_voice_note(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION is_voice_note_recipient(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION can_send_voice_note_to_employee(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION get_caller_org_id() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION get_caller_employee_id() FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION can_read_voice_note(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION can_manage_voice_note(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION is_voice_note_recipient(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION can_send_voice_note_to_employee(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION get_caller_org_id() TO authenticated;
GRANT EXECUTE ON FUNCTION get_caller_employee_id() TO authenticated;

-- ============================================================
-- Step 2: Drop ALL existing recursive RLS policies
-- ============================================================

DROP POLICY IF EXISTS select_own_sent_voice_notes ON voice_notes;
DROP POLICY IF EXISTS insert_voice_notes ON voice_notes;
DROP POLICY IF EXISTS update_voice_notes_sender ON voice_notes;

DROP POLICY IF EXISTS select_voice_note_recipients ON voice_note_recipients;
DROP POLICY IF EXISTS insert_voice_note_recipients ON voice_note_recipients;
DROP POLICY IF EXISTS update_voice_note_recipients ON voice_note_recipients;

DROP POLICY IF EXISTS vn_select ON storage.objects;
DROP POLICY IF EXISTS vn_insert ON storage.objects;
DROP POLICY IF EXISTS vn_delete ON storage.objects;

-- ============================================================
-- Step 3: Create non-recursive RLS policies
-- ============================================================

CREATE POLICY "vn_select_policy" ON voice_notes
  FOR SELECT TO authenticated
  USING (can_read_voice_note(id));

CREATE POLICY "vn_insert_policy" ON voice_notes
  FOR INSERT TO authenticated
  WITH CHECK (sender_user_id = auth.uid() AND organization_id = get_caller_org_id());

CREATE POLICY "vn_update_policy" ON voice_notes
  FOR UPDATE TO authenticated
  USING (can_manage_voice_note(id))
  WITH CHECK (can_manage_voice_note(id));

CREATE POLICY "vnr_select_policy" ON voice_note_recipients
  FOR SELECT TO authenticated
  USING (
    recipient_user_id = auth.uid()
    OR can_manage_voice_note(voice_note_id)
  );

CREATE POLICY "vnr_insert_policy" ON voice_note_recipients
  FOR INSERT TO authenticated
  WITH CHECK (can_manage_voice_note(voice_note_id));

CREATE POLICY "vnr_update_policy" ON voice_note_recipients
  FOR UPDATE TO authenticated
  USING (recipient_user_id = auth.uid())
  WITH CHECK (recipient_user_id = auth.uid());

-- ============================================================
-- Step 4: Non-recursive storage policies for voice-notes bucket
-- ============================================================

CREATE POLICY "vn_storage_select" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'voice-notes'
    AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR EXISTS (
        SELECT 1 FROM voice_notes vn
        WHERE vn.storage_path = storage.objects.name
        AND vn.sender_user_id = auth.uid()
        AND vn.deleted_at IS NULL
      )
      OR is_voice_note_recipient(
        (SELECT id FROM voice_notes WHERE storage_path = storage.objects.name AND deleted_at IS NULL LIMIT 1)
      )
    )
  );

CREATE POLICY "vn_storage_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'voice-notes'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "vn_storage_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'voice-notes'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- ============================================================
-- Step 5: Add granular permissions
-- ============================================================

INSERT INTO permissions (id, code, label, description) VALUES
  ('a1b2c3d4-0001-4000-8000-000000000001', 'voice_note.send_team', 'Send Voice Note (Team)', 'Manager can send voice notes to reporting subtree'),
  ('a1b2c3d4-0002-4000-8000-000000000002', 'voice_note.send_all', 'Send Voice Note (All)', 'Director can send voice notes to all org employees'),
  ('a1b2c3d4-0003-4000-8000-000000000003', 'voice_note.read_own', 'Read Own Voice Notes', 'Employee can read voice notes sent to them'),
  ('a1b2c3d4-0004-4000-8000-000000000004', 'voice_note.play_own', 'Play Own Voice Notes', 'Employee can play voice notes sent to them'),
  ('a1b2c3d4-0005-4000-8000-000000000005', 'voice_note.acknowledge_own', 'Acknowledge Own Voice Notes', 'Employee can acknowledge voice notes sent to them')
ON CONFLICT (code) DO NOTHING;

-- ============================================================
-- Step 6: Assign granular permissions to roles
-- ============================================================

DO $$
DECLARE
  v_director uuid; v_manager uuid; v_employee uuid; v_hr_admin uuid; v_system_admin uuid;
  v_intern uuid; v_team_leader uuid;
  v_send_team uuid; v_send_all uuid; v_read_sent uuid; v_read_own uuid; v_play_own uuid; v_ack_own uuid;
BEGIN
  SELECT id INTO v_director FROM roles WHERE code = 'director';
  SELECT id INTO v_manager FROM roles WHERE code = 'manager';
  SELECT id INTO v_employee FROM roles WHERE code = 'employee';
  SELECT id INTO v_hr_admin FROM roles WHERE code = 'hr_admin';
  SELECT id INTO v_system_admin FROM roles WHERE code = 'system_admin';
  SELECT id INTO v_intern FROM roles WHERE code = 'intern';
  SELECT id INTO v_team_leader FROM roles WHERE code = 'team_leader';

  SELECT id INTO v_send_team FROM permissions WHERE code = 'voice_note.send_team';
  SELECT id INTO v_send_all FROM permissions WHERE code = 'voice_note.send_all';
  SELECT id INTO v_read_sent FROM permissions WHERE code = 'voice_note.read_sent';
  SELECT id INTO v_read_own FROM permissions WHERE code = 'voice_note.read_own';
  SELECT id INTO v_play_own FROM permissions WHERE code = 'voice_note.play_own';
  SELECT id INTO v_ack_own FROM permissions WHERE code = 'voice_note.acknowledge_own';

  -- Director: send_all + read_sent + read_own + play_own + ack_own
  INSERT INTO role_permissions (role_id, permission_id) VALUES
    (v_director, v_send_all), (v_director, v_read_sent), (v_director, v_read_own), (v_director, v_play_own), (v_director, v_ack_own)
  ON CONFLICT DO NOTHING;

  -- Manager: send_team + read_sent + read_own + play_own + ack_own
  INSERT INTO role_permissions (role_id, permission_id) VALUES
    (v_manager, v_send_team), (v_manager, v_read_sent), (v_manager, v_read_own), (v_manager, v_play_own), (v_manager, v_ack_own)
  ON CONFLICT DO NOTHING;

  -- Employee: read_own + play_own + acknowledge_own
  INSERT INTO role_permissions (role_id, permission_id) VALUES
    (v_employee, v_read_own), (v_employee, v_play_own), (v_employee, v_ack_own)
  ON CONFLICT DO NOTHING;

  -- HR Admin: read_own + play_own + acknowledge_own
  INSERT INTO role_permissions (role_id, permission_id) VALUES
    (v_hr_admin, v_read_own), (v_hr_admin, v_play_own), (v_hr_admin, v_ack_own)
  ON CONFLICT DO NOTHING;

  -- System Admin: read_own only (no automatic access to audio content)
  INSERT INTO role_permissions (role_id, permission_id) VALUES
    (v_system_admin, v_read_own)
  ON CONFLICT DO NOTHING;

  -- Intern: read_own + play_own + acknowledge_own
  INSERT INTO role_permissions (role_id, permission_id) VALUES
    (v_intern, v_read_own), (v_intern, v_play_own), (v_intern, v_ack_own)
  ON CONFLICT DO NOTHING;

  -- Team Leader: read_own + play_own + acknowledge_own
  INSERT INTO role_permissions (role_id, permission_id) VALUES
    (v_team_leader, v_read_own), (v_team_leader, v_play_own), (v_team_leader, v_ack_own)
  ON CONFLICT DO NOTHING;
END $$;

-- ============================================================
-- Step 7: Reload PostgREST schema cache
-- ============================================================
NOTIFY pgrst, 'reload schema';
