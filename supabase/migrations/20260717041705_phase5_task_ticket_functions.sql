/*
# Phase 5 — Server Functions for Task and Ticket Management

## Summary
Creates SECURITY DEFINER PL/pgSQL functions for:
1. generate_task_code(p_org_id) — Generates unique TASK-YYYY-NNNNNN codes
2. generate_ticket_code(p_org_id) — Generates unique TKT-YYYY-NNNNNN codes
3. check_circular_dependency(p_task_id, p_depends_on_id) — Prevents circular dependencies
4. calculate_completion_outcome(p_completed_at, p_deadline) — Returns EARLY/ON_TIME/DELAYED

## Security
- All functions are SECURITY DEFINER with fixed search_path
- Code generators use a per-organization sequence stored in a helper table
- Circular dependency check uses recursive CTE
- Completion outcome compares completed_at date to deadline date
*/

-- ============================================================
-- Helper table for per-org sequences
-- ============================================================
CREATE TABLE IF NOT EXISTS org_code_sequences (
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  code_type text NOT NULL,
  year integer NOT NULL,
  last_seq integer NOT NULL DEFAULT 0,
  PRIMARY KEY (organization_id, code_type, year)
);

ALTER TABLE org_code_sequences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_org_code_sequences" ON org_code_sequences;
CREATE POLICY "select_org_code_sequences" ON org_code_sequences FOR SELECT
  TO authenticated USING (organization_id = current_user_org_id());

-- ============================================================
-- generate_task_code(p_org_id)
-- ============================================================
CREATE OR REPLACE FUNCTION generate_task_code(p_org_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, auth AS $$
DECLARE
  v_year integer := EXTRACT(YEAR FROM now())::integer;
  v_seq integer;
  v_code text;
BEGIN
  INSERT INTO org_code_sequences (organization_id, code_type, year, last_seq)
  VALUES (p_org_id, 'TASK', v_year, 1)
  ON CONFLICT (organization_id, code_type, year)
  DO UPDATE SET last_seq = org_code_sequences.last_seq + 1
  RETURNING last_seq INTO v_seq;

  v_code := 'TASK-' || v_year || '-' || lpad(v_seq::text, 6, '0');
  RETURN v_code;
END;
$$;

-- ============================================================
-- generate_ticket_code(p_org_id)
-- ============================================================
CREATE OR REPLACE FUNCTION generate_ticket_code(p_org_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, auth AS $$
DECLARE
  v_year integer := EXTRACT(YEAR FROM now())::integer;
  v_seq integer;
  v_code text;
BEGIN
  INSERT INTO org_code_sequences (organization_id, code_type, year, last_seq)
  VALUES (p_org_id, 'TICKET', v_year, 1)
  ON CONFLICT (organization_id, code_type, year)
  DO UPDATE SET last_seq = org_code_sequences.last_seq + 1
  RETURNING last_seq INTO v_seq;

  v_code := 'TKT-' || v_year || '-' || lpad(v_seq::text, 6, '0');
  RETURN v_code;
END;
$$;

-- ============================================================
-- check_circular_dependency(p_task_id, p_depends_on_id)
-- Returns true if adding dependency p_task_id -> p_depends_on_id
-- would create a circular dependency.
-- ============================================================
CREATE OR REPLACE FUNCTION check_circular_dependency(
  p_task_id uuid,
  p_depends_on_id uuid
)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, auth AS $$
DECLARE
  v_count integer;
BEGIN
  -- Check if p_depends_on_id already (transitively) depends on p_task_id
  -- If so, adding p_task_id -> p_depends_on_id would create a cycle.
  WITH RECURSIVE dep_chain AS (
    -- Start from p_depends_on_id and follow its dependencies
    SELECT depends_on_task_id AS dep_id
    FROM task_dependencies
    WHERE task_id = p_depends_on_id

    UNION ALL

    SELECT td.depends_on_task_id
    FROM task_dependencies td
    JOIN dep_chain dc ON td.task_id = dc.dep_id
  )
  SELECT COUNT(*) INTO v_count
  FROM dep_chain
  WHERE dep_id = p_task_id;

  RETURN v_count > 0;
END;
$$;

-- ============================================================
-- calculate_completion_outcome(p_completed_at, p_deadline)
-- Returns EARLY, ON_TIME, or DELAYED based on date comparison.
-- EARLY: completed before deadline date
-- ON_TIME: completed on deadline date
-- DELAYED: completed after deadline date
-- ============================================================
CREATE OR REPLACE FUNCTION calculate_completion_outcome(
  p_completed_at timestamptz,
  p_deadline date
)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, auth AS $$
DECLARE
  v_completed_date date;
BEGIN
  v_completed_date := p_completed_at::date;

  IF v_completed_date < p_deadline THEN
    RETURN 'EARLY';
  ELSIF v_completed_date = p_deadline THEN
    RETURN 'ON_TIME';
  ELSE
    RETURN 'DELAYED';
  END IF;
END;
$$;

-- Grant execute to authenticated
GRANT EXECUTE ON FUNCTION generate_task_code(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION generate_ticket_code(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION check_circular_dependency(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION calculate_completion_outcome(timestamptz, date) TO authenticated;
