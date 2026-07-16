/*
# Phase 4 — Leave Balance Atomic Update Function (fixed parameter order)

Fix: Parameters with defaults must come after parameters without defaults.
Moved p_idempotency_key and p_created_by before parameters with defaults.
*/

CREATE OR REPLACE FUNCTION apply_leave_transaction(
  p_employee_id uuid,
  p_leave_type_id uuid,
  p_organization_id uuid,
  p_transaction_type text,
  p_quantity numeric,
  p_idempotency_key text,
  p_created_by uuid DEFAULT NULL,
  p_reference_type text DEFAULT NULL,
  p_reference_id uuid DEFAULT NULL,
  p_description text DEFAULT NULL,
  p_effective_date date DEFAULT CURRENT_DATE
)
RETURNS TABLE(success boolean, balance_before numeric, balance_after numeric, message text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_balance_id uuid;
  v_balance_before numeric;
  v_balance_after numeric;
  v_accrued numeric;
  v_used numeric;
  v_adjusted numeric;
  v_cancelled_restored numeric;
  v_balance_year integer;
  v_existing_ledger_id uuid;
BEGIN
  -- Check idempotency
  SELECT id INTO v_existing_ledger_id FROM leave_ledger WHERE idempotency_key = p_idempotency_key LIMIT 1;
  IF v_existing_ledger_id IS NOT NULL THEN
    RETURN QUERY SELECT true, 0::numeric, 0::numeric, 'Duplicate transaction skipped (idempotency)'::text;
    RETURN;
  END IF;

  v_balance_year := EXTRACT(year FROM p_effective_date)::integer;

  -- Get or create balance
  SELECT id, closing_balance, accrued, used, adjusted, cancelled_restored, version
  INTO v_balance_id, v_balance_before, v_accrued, v_used, v_adjusted, v_cancelled_restored
  FROM leave_balances
  WHERE employee_id = p_employee_id
    AND leave_type_id = p_leave_type_id
    AND balance_year = v_balance_year
  FOR UPDATE;

  IF v_balance_id IS NULL THEN
    v_balance_before := 0;
    INSERT INTO leave_balances (
      employee_id, organization_id, leave_type_id,
      opening_balance, accrued, used, adjusted, cancelled_restored,
      closing_balance, balance_year, version
    ) VALUES (
      p_employee_id, p_organization_id, p_leave_type_id,
      0, 0, 0, 0, 0, 0, v_balance_year, 0
    )
    RETURNING id INTO v_balance_id;
  END IF;

  v_balance_after := v_balance_before + p_quantity;

  IF p_transaction_type IN ('MONTHLY_ACCRUAL', 'OPENING_BALANCE', 'CARRY_FORWARD') THEN
    v_accrued := v_accrued + p_quantity;
  ELSIF p_transaction_type IN ('LEAVE_USED', 'LEAVE_RESERVED') THEN
    v_used := v_used + p_quantity;
  ELSIF p_transaction_type = 'MANUAL_ADJUSTMENT' THEN
    v_adjusted := v_adjusted + p_quantity;
  ELSIF p_transaction_type IN ('LEAVE_CANCELLED_RESTORED', 'REVERSAL') THEN
    v_cancelled_restored := v_cancelled_restored + p_quantity;
  END IF;

  UPDATE leave_balances
  SET accrued = v_accrued,
      used = v_used,
      adjusted = v_adjusted,
      cancelled_restored = v_cancelled_restored,
      closing_balance = v_balance_after,
      version = version + 1,
      updated_at = now()
  WHERE id = v_balance_id;

  INSERT INTO leave_ledger (
    employee_id, organization_id, leave_type_id,
    transaction_type, quantity, balance_before, balance_after,
    reference_type, reference_id, description,
    effective_date, created_by, idempotency_key
  ) VALUES (
    p_employee_id, p_organization_id, p_leave_type_id,
    p_transaction_type, p_quantity, v_balance_before, v_balance_after,
    p_reference_type, p_reference_id, p_description,
    p_effective_date, p_created_by, p_idempotency_key
  );

  RETURN QUERY SELECT true, v_balance_before, v_balance_after, 'Transaction applied'::text;
END;
$$;

REVOKE ALL ON FUNCTION apply_leave_transaction FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION apply_leave_transaction TO authenticated;
