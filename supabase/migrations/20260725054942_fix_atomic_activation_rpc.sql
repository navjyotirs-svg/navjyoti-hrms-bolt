/*
# Atomic Employee Activation RPC

## Purpose
Fixes the critical production bug where employee activation was non-atomic,
leaving user_organization_memberships.is_active = false while user_profiles
was already active. This caused "Profile Error: organization membership not
active" on login.

## Changes
1. Creates `activate_employee_account()` SECURITY DEFINER RPC that atomically:
   - Resolves the authenticated user from auth.uid()
   - Finds matching user_profiles, employees, and user_organization_memberships rows
   - Verifies the account is not suspended/terminated/offboarded
   - Activates user_profiles (status='active', is_active=true)
   - Activates employees (employment_status='active' or 'on_probation', is_active=true)
   - Activates user_organization_memberships (is_active=true)
   - Inserts employee_status_history
   - Inserts audit_logs
   - All within a single transaction (DO $$ BEGIN ... END $$)
   - Returns success/failure with specific error codes

2. Creates `repair_employee_account(p_employee_id uuid)` SECURITY DEFINER RPC for
   admin repair of inconsistent accounts:
   - Requires employee.create or employee.status.manage permission
   - Checks and repairs all 4 records (profile, employee, membership, history)
   - Idempotent
   - Cannot activate suspended/terminated/offboarded accounts
   - Creates audit history

## Security
- Both functions are SECURITY DEFINER with safe search_path
- activate_employee_account uses auth.uid() — no client-supplied user ID
- repair_employee_account checks caller permissions via get_my_effective_permissions()
- Both write audit_logs
*/

-- ============================================================
-- 1. activate_employee_account() — called by employee after password setup
-- ============================================================
CREATE OR REPLACE FUNCTION public.activate_employee_account()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_profile record;
  v_employee record;
  v_membership record;
  v_prev_emp_status text;
  v_prev_profile_status text;
  v_new_emp_status text;
BEGIN
  -- No authenticated user
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authenticated', 'message', 'No authenticated user found.');
  END IF;

  -- Load profile
  SELECT * INTO v_profile FROM user_profiles WHERE id = v_user_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'profile_not_found', 'message', 'User profile not found.');
  END IF;

  -- Check profile is not in a blocked state
  IF v_profile.status IN ('suspended', 'disabled', 'terminated') THEN
    RETURN jsonb_build_object('success', false, 'error', 'account_blocked', 'message', 'Account is suspended or terminated. Contact your administrator.');
  END IF;

  v_prev_profile_status := v_profile.status;

  -- Load employee record
  SELECT * INTO v_employee FROM employees WHERE user_id = v_user_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'employee_not_found', 'message', 'Employee record not found.');
  END IF;

  -- Check employee is not in a blocked state
  IF v_employee.employment_status IN ('suspended', 'terminated', 'offboarded') THEN
    RETURN jsonb_build_object('success', false, 'error', 'employee_blocked', 'message', 'Employee record is suspended, terminated, or offboarded.');
  END IF;

  v_prev_emp_status := v_employee.employment_status;

  -- Determine new employment status: on_probation if probation_end_date is set and in future, else active
  IF v_employee.probation_end_date IS NOT NULL AND v_employee.probation_end_date > CURRENT_DATE THEN
    v_new_emp_status := 'on_probation';
  ELSE
    v_new_emp_status := 'active';
  END IF;

  -- Load membership
  SELECT * INTO v_membership FROM user_organization_memberships
    WHERE user_id = v_user_id AND organization_id = v_profile.organization_id;

  -- ============================================================
  -- ATOMIC TRANSACTION: all updates succeed or all roll back
  -- ============================================================
  BEGIN
    -- 1. Activate user_profiles
    UPDATE user_profiles
      SET status = 'active', is_active = true, updated_at = now()
      WHERE id = v_user_id;

    -- 2. Activate employees
    UPDATE employees
      SET employment_status = v_new_emp_status, is_active = true, updated_at = now()
      WHERE user_id = v_user_id;

    -- 3. Activate or create organization membership
    IF FOUND THEN
      UPDATE user_organization_memberships
        SET is_active = true
        WHERE user_id = v_user_id AND organization_id = v_profile.organization_id;
    ELSE
      INSERT INTO user_organization_memberships (user_id, organization_id, is_active)
        VALUES (v_user_id, v_profile.organization_id, true)
        ON CONFLICT DO NOTHING;
    END IF;

    -- 4. Write employee status history (if status changed)
    IF v_prev_emp_status IS DISTINCT FROM v_new_emp_status THEN
      INSERT INTO employee_status_history (employee_id, old_status, new_status, actor_id, effective_date, reason)
        VALUES (v_employee.id, v_prev_emp_status, v_new_emp_status, v_user_id, CURRENT_DATE, 'Account activated after password setup');
    END IF;

    -- 5. Write audit log
    INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, old_values, new_values)
      VALUES (
        v_user_id,
        'activate_account',
        'employee',
        v_employee.id,
        jsonb_build_object('profile_status', v_prev_profile_status, 'employment_status', v_prev_emp_status, 'membership_active', false),
        jsonb_build_object('profile_status', 'active', 'employment_status', v_new_emp_status, 'membership_active', true)
      );

    RETURN jsonb_build_object(
      'success', true,
      'message', 'Account activated successfully.',
      'employment_status', v_new_emp_status
    );

  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', 'transaction_failed', 'message', 'Activation transaction failed: ' || SQLERRM);
  END;
END;
$$;

-- Grant execute to authenticated only
REVOKE ALL ON FUNCTION public.activate_employee_account() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.activate_employee_account() TO authenticated;

-- ============================================================
-- 2. repair_employee_account() — admin repair of inconsistent accounts
-- ============================================================
CREATE OR REPLACE FUNCTION public.repair_employee_account(p_employee_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_caller_id uuid := auth.uid();
  v_perms text[];
  v_employee record;
  v_profile record;
  v_membership record;
  v_repaired text[] := '{}';
  v_prev_emp_status text;
  v_prev_profile_status text;
BEGIN
  IF v_caller_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authenticated');
  END IF;

  -- Check caller permissions
  SELECT * INTO v_perms FROM get_my_effective_permissions();
  IF NOT (v_perms @> ARRAY['employee.create']::text[] OR v_perms @> ARRAY['employee.status.manage']::text[]) THEN
    RETURN jsonb_build_object('success', false, 'error', 'forbidden', 'message', 'You do not have permission to repair accounts.');
  END IF;

  -- Load employee
  SELECT * INTO v_employee FROM employees WHERE id = p_employee_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'employee_not_found');
  END IF;

  -- Cannot repair blocked accounts
  IF v_employee.employment_status IN ('suspended', 'terminated', 'offboarded') THEN
    RETURN jsonb_build_object('success', false, 'error', 'account_blocked', 'message', 'Cannot repair a suspended, terminated, or offboarded account.');
  END IF;

  v_prev_emp_status := v_employee.employment_status;

  -- Load profile
  SELECT * INTO v_profile FROM user_profiles WHERE id = v_employee.user_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'profile_not_found');
  END IF;

  v_prev_profile_status := v_profile.status;

  -- Load membership
  SELECT * INTO v_membership FROM user_organization_memberships
    WHERE user_id = v_employee.user_id AND organization_id = v_employee.organization_id;

  -- ============================================================
  -- ATOMIC REPAIR TRANSACTION
  -- ============================================================
  BEGIN
    -- Repair profile if needed
    IF v_profile.status != 'active' OR v_profile.is_active != true THEN
      UPDATE user_profiles
        SET status = 'active', is_active = true, updated_at = now()
        WHERE id = v_employee.user_id;
      v_repaired := array_append(v_repaired, 'profile');
    END IF;

    -- Repair employee if needed
    IF v_employee.employment_status NOT IN ('active', 'on_probation', 'confirmed', 'notice_period') OR v_employee.is_active != true THEN
      UPDATE employees
        SET employment_status = 'active', is_active = true, updated_at = now()
        WHERE id = p_employee_id;
      v_repaired := array_append(v_repaired, 'employee');
    END IF;

    -- Repair membership if needed
    IF NOT FOUND OR v_membership.is_active != true THEN
      INSERT INTO user_organization_memberships (user_id, organization_id, is_active)
        VALUES (v_employee.user_id, v_employee.organization_id, true)
        ON CONFLICT (user_id, organization_id) DO UPDATE SET is_active = true;
      v_repaired := array_append(v_repaired, 'membership');
    END IF;

    -- Write status history if employment status changed
    IF v_prev_emp_status IS DISTINCT FROM 'active' THEN
      INSERT INTO employee_status_history (employee_id, old_status, new_status, actor_id, effective_date, reason)
        VALUES (p_employee_id, v_prev_emp_status, 'active', v_caller_id, CURRENT_DATE, 'Account activation repaired by administrator');
    END IF;

    -- Write audit log
    INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, old_values, new_values)
      VALUES (
        v_caller_id,
        'repair_account',
        'employee',
        p_employee_id,
        jsonb_build_object('profile_status', v_prev_profile_status, 'employment_status', v_prev_emp_status),
        jsonb_build_object('profile_status', 'active', 'employment_status', 'active', 'repaired', v_repaired)
      );

    RETURN jsonb_build_object(
      'success', true,
      'message', 'Account repaired successfully.',
      'repaired', v_repaired
    );

  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', 'transaction_failed', 'message', 'Repair transaction failed: ' || SQLERRM);
  END;
END;
$$;

REVOKE ALL ON FUNCTION public.repair_employee_account(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.repair_employee_account(uuid) TO authenticated;
