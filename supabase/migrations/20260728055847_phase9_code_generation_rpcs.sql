/*
# Phase 9 — Code generation RPCs for projects and recurring task templates

Creates two SECURITY DEFINER functions:
1. generate_project_code(p_org_id) — generates PRJ-YYYY-NNNNNN
2. generate_recurring_template_code(p_org_id) — generates RCT-YYYY-NNNNNN

Uses the existing org_code_sequences table.
*/

CREATE OR REPLACE FUNCTION public.generate_project_code(p_org_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_year int;
  v_seq int;
  v_code text;
BEGIN
  v_year := extract(year from now())::int;
  
  INSERT INTO org_code_sequences (organization_id, code_type, year, last_seq)
  VALUES (p_org_id, 'project', v_year, 1)
  ON CONFLICT (organization_id, code_type, year)
  DO UPDATE SET last_seq = org_code_sequences.last_seq + 1
  RETURNING last_seq INTO v_seq;
  
  v_code := 'PRJ-' || v_year || '-' || lpad(v_seq::text, 6, '0');
  RETURN v_code;
END;
$$;

CREATE OR REPLACE FUNCTION public.generate_recurring_template_code(p_org_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_year int;
  v_seq int;
  v_code text;
BEGIN
  v_year := extract(year from now())::int;
  
  INSERT INTO org_code_sequences (organization_id, code_type, year, last_seq)
  VALUES (p_org_id, 'recurring_template', v_year, 1)
  ON CONFLICT (organization_id, code_type, year)
  DO UPDATE SET last_seq = org_code_sequences.last_seq + 1
  RETURNING last_seq INTO v_seq;
  
  v_code := 'RCT-' || v_year || '-' || lpad(v_seq::text, 6, '0');
  RETURN v_code;
END;
$$;

GRANT EXECUTE ON FUNCTION public.generate_project_code(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.generate_recurring_template_code(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.generate_project_code(uuid) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.generate_recurring_template_code(uuid) FROM anon, PUBLIC;
