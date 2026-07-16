/*
# Phase 1-3 Integration Fix — get_my_effective_permissions() function

## Root cause
The frontend used client-side multi-table joins (roles → role_permissions → permissions)
to load effective permissions. Even though RLS SELECT policies existed on all three
RBAC tables, the Supabase JS client's nested join (`permissions!inner(code)`) was
silently returning zero rows at runtime — likely because PostgREST's embedded join
applies RLS on each joined table independently, and the join detection or policy
evaluation produced an empty result set.

## Fix
Replace the fragile 3-query client-side join with a single SECURITY DEFINER function
that runs entirely in the database, bypassing per-table RLS for the RBAC metadata
read. The function:
1. Uses auth.uid() — accepts no client-supplied user ID
2. Resolves the user's active role from user_profiles
3. Verifies active organization membership
4. Returns an array of permission code strings
5. Has a fixed safe search_path
6. Grants execute only to authenticated users
*/

CREATE OR REPLACE FUNCTION get_my_effective_permissions()
RETURNS text[]
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, auth
AS $$
DECLARE
  v_role_code text;
  v_role_id uuid;
  v_org_id uuid;
  v_is_active boolean;
  v_perm_codes text[];
BEGIN
  -- 1. Resolve the current user's profile
  SELECT role, organization_id, is_active
  INTO v_role_code, v_org_id, v_is_active
  FROM user_profiles
  WHERE id = auth.uid();

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
  WHERE user_id = auth.uid()
    AND organization_id = v_org_id
    AND is_active = true;

  IF NOT FOUND THEN
    RETURN ARRAY[]::text[];
  END IF;

  -- 3. Resolve the role UUID from the role code (not the friendly label)
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
$$;

-- Grant execute only to authenticated users (not anon)
REVOKE EXECUTE ON FUNCTION get_my_effective_permissions() FROM anon;
GRANT EXECUTE ON FUNCTION get_my_effective_permissions() TO authenticated;
