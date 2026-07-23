-- Create a parameterized version of get_my_effective_permissions
-- that accepts a user_id explicitly. This is needed because edge functions
-- create a Supabase client with the service role key, which causes auth.uid()
-- to return NULL. The original get_my_effective_permissions() (no params)
-- still works for frontend calls that use the anon key + user JWT.

CREATE OR REPLACE FUNCTION public.get_effective_permissions(p_user_id uuid)
RETURNS text[]
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_role_code text;
  v_role_id uuid;
  v_org_id uuid;
  v_is_active boolean;
  v_perm_codes text[];
BEGIN
  -- 1. Resolve the user's profile
  SELECT role, organization_id, is_active
  INTO v_role_code, v_org_id, v_is_active
  FROM user_profiles
  WHERE id = p_user_id;

  IF v_role_code IS NULL THEN
    RETURN ARRAY[]::text[];
  END IF;

  IF v_org_id IS NULL THEN
    RETURN ARRAY[]::text[];
  END IF;

  IF NOT COALESCE(v_is_active, false) THEN
    RETURN ARRAY[]::text[];
  END IF;

  -- 2. Verify active organization membership
  PERFORM 1
  FROM user_organization_memberships
  WHERE user_id = p_user_id
  AND organization_id = v_org_id
  AND is_active = true;

  IF NOT FOUND THEN
    RETURN ARRAY[]::text[];
  END IF;

  -- 3. Resolve the role UUID from the role code
  SELECT id INTO v_role_id FROM roles WHERE code = v_role_code;

  IF v_role_id IS NULL THEN
    RETURN ARRAY[]::text[];
  END IF;

  -- 4. Return all permission codes for this role
  SELECT array_agg(p.code ORDER BY p.code)
  INTO v_perm_codes
  FROM role_permissions rp
  JOIN permissions p ON p.id = rp.permission_id
  WHERE rp.role_id = v_role_id;

  RETURN COALESCE(v_perm_codes, ARRAY[]::text[]);
END;
$function$;

-- Grant execute to authenticated and anon (edge functions use service role which bypasses checks)
GRANT EXECUTE ON FUNCTION public.get_effective_permissions(uuid) TO authenticated, anon;
