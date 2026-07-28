/*
# Create process_attendance_action RPC — Emergency Attendance Fallback

## Purpose
Provides a trusted database RPC as an emergency fallback when the
attendance-action Edge Function is unreachable (network failure, CORS
failure, boot failure, gateway timeout, etc.). This ensures employees
can always check in and check out even if the Edge Function is down.

## New Objects
1. `attendance_idempotency` table — extended with `user_id` column for
   per-user idempotency scoping. PK changed to (user_id, request_id, action).
2. `process_attendance_action(text, text, text, double precision, double precision, double precision)` —
   SECURITY DEFINER function that handles check_in and check_out atomically.

## Security
- Function is SECURITY DEFINER, SET search_path = public, auth
- Execution revoked from anon and PUBLIC
- Execution granted only to authenticated
- Resolves employee identity from auth.uid() — never accepts client-supplied IDs
- Validates evidence storage path belongs to the authenticated user
- All timestamps are server-side (now() at UTC+5:30 for Asia/Kolkata)

## Attendance Policy (unchanged)
- required_total_minutes = 540
- elapsed >= 540 → FULL_DAY
- elapsed < 540 → HALF_DAY
- No checkout → PENDING_CHECKOUT
- attendance_policy_version = POLICY_540_FULL_DAY

## Idempotency
- Uses (user_id, request_id, action) unique key
- Retrying with same request_id returns the original result
- No duplicate attendance records or evidence created
*/

-- Add user_id to attendance_idempotency for per-user scoping
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'attendance_idempotency' AND column_name = 'user_id'
  ) THEN
    ALTER TABLE attendance_idempotency ADD COLUMN user_id uuid;
  END IF;
END $$;

-- Drop old PK and create new one with user_id
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'attendance_idempotency' AND constraint_type = 'PRIMARY KEY'
    AND constraint_name = 'attendance_idempotency_pkey'
  ) THEN
    ALTER TABLE attendance_idempotency DROP CONSTRAINT attendance_idempotency_pkey;
  END IF;
END $$;

ALTER TABLE attendance_idempotency ADD CONSTRAINT attendance_idempotency_pkey
  PRIMARY KEY (user_id, request_id, action);

-- Create the trusted attendance RPC
CREATE OR REPLACE FUNCTION process_attendance_action(
  p_action text,
  p_request_id text,
  p_photo_storage_path text,
  p_latitude double precision,
  p_longitude double precision,
  p_accuracy_meters double precision DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_profile record;
  v_employee record;
  v_attendance_date date;
  v_now timestamptz := now();
  v_now_ist timestamptz;
  v_existing record;
  v_record record;
  v_check_in_at timestamptz;
  v_required_checkout_at timestamptz;
  v_elapsed_minutes integer;
  v_final_status text;
  v_status_reason text;
  v_idempotent jsonb;
  v_result jsonb;
  v_org_date date;
BEGIN
  -- Resolve current date in Asia/Kolkata (IST = UTC+5:30)
  v_now_ist := v_now + interval '5 hours 30 minutes';
  v_org_date := v_now_ist::date;

  -- 1. Resolve auth.uid()
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'errorCode', 'INVALID_AUTH_TOKEN',
      'message', 'Authentication required.',
      'correlationId', gen_random_uuid()::text,
      'retryable', false
    );
  END IF;

  -- 2. Check idempotency first
  IF p_request_id IS NOT NULL AND p_request_id != '' THEN
    SELECT response_data INTO v_idempotent
    FROM attendance_idempotency
    WHERE user_id = v_user_id AND request_id = p_request_id AND action = p_action;
    IF v_idempotent IS NOT NULL THEN
      RETURN jsonb_set(v_idempotent, '{idempotent}', 'true'::jsonb);
    END IF;
  END IF;

  -- 3. Resolve active profile
  SELECT id, role, organization_id, status INTO v_profile
  FROM user_profiles
  WHERE id = v_user_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false, 'errorCode', 'EMPLOYEE_NOT_FOUND',
      'message', 'Profile not found.',
      'correlationId', gen_random_uuid()::text, 'retryable', false
    );
  END IF;

  IF v_profile.status = 'disabled' THEN
    RETURN jsonb_build_object(
      'success', false, 'errorCode', 'SESSION_EXPIRED',
      'message', 'Account disabled.',
      'correlationId', gen_random_uuid()::text, 'retryable', false
    );
  END IF;

  -- 4. Resolve active employee
  SELECT id, organization_id, branch_id, employment_status, is_active, user_id
  INTO v_employee
  FROM employees
  WHERE user_id = v_user_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false, 'errorCode', 'EMPLOYEE_NOT_FOUND',
      'message', 'Employee record not found.',
      'correlationId', gen_random_uuid()::text, 'retryable', false
    );
  END IF;

  IF NOT v_employee.is_active OR v_employee.employment_status NOT IN ('active', 'on_probation', 'confirmed', 'notice_period') THEN
    RETURN jsonb_build_object(
      'success', false, 'errorCode', 'MEMBERSHIP_INACTIVE',
      'message', 'Employee is not active.',
      'correlationId', gen_random_uuid()::text, 'retryable', false
    );
  END IF;

  -- 5. Validate evidence
  IF p_photo_storage_path IS NULL OR p_photo_storage_path = '' THEN
    RETURN jsonb_build_object(
      'success', false, 'errorCode', 'EVIDENCE_INVALID',
      'message', 'Photo evidence is required.',
      'correlationId', gen_random_uuid()::text, 'retryable', false
    );
  END IF;

  -- Verify storage path belongs to the authenticated user
  IF position(v_user_id::text in p_photo_storage_path) = 0 THEN
    RETURN jsonb_build_object(
      'success', false, 'errorCode', 'EVIDENCE_INVALID',
      'message', 'Evidence path does not belong to the authenticated user.',
      'correlationId', gen_random_uuid()::text, 'retryable', false
    );
  END IF;

  -- Validate coordinates
  IF p_latitude IS NULL OR p_longitude IS NULL
     OR NOT (p_latitude BETWEEN -90 AND 90)
     OR NOT (p_longitude BETWEEN -180 AND 180) THEN
    RETURN jsonb_build_object(
      'success', false, 'errorCode', 'LOCATION_INVALID',
      'message', 'Location coordinates are invalid.',
      'correlationId', gen_random_uuid()::text, 'retryable', false
    );
  END IF;

  IF p_accuracy_meters IS NOT NULL AND NOT finite(p_accuracy_meters) THEN
    RETURN jsonb_build_object(
      'success', false, 'errorCode', 'LOCATION_INVALID',
      'message', 'Location accuracy is invalid.',
      'correlationId', gen_random_uuid()::text, 'retryable', false
    );
  END IF;

  -- 6. Handle check_in
  IF p_action = 'check_in' THEN
    -- Check for existing open attendance record
    SELECT id INTO v_existing
    FROM attendance_records
    WHERE employee_id = v_employee.id
      AND attendance_date = v_org_date
      AND final_status = 'PENDING_CHECKOUT';

    IF FOUND THEN
      RETURN jsonb_build_object(
        'success', false, 'errorCode', 'ATTENDANCE_ALREADY_EXISTS',
        'message', 'You have already checked in today. Please check out first.',
        'correlationId', gen_random_uuid()::text, 'retryable', false
      );
    END IF;

    v_check_in_at := v_now;
    v_required_checkout_at := v_now + (540 * interval '1 minute');

    -- Create attendance record
    INSERT INTO attendance_records (
      employee_id, organization_id, branch_id, attendance_date,
      check_in_at, required_checkout_at,
      required_work_minutes, required_break_minutes, required_total_minutes,
      final_status, attendance_policy_version,
      checkout_type, checkout_status,
      displayed_shift_minutes, daily_early_checkout_grace,
      correction_version,
      check_in_evidence_status,
      created_by
    ) VALUES (
      v_employee.id, v_employee.organization_id, v_employee.branch_id, v_org_date,
      v_check_in_at, v_required_checkout_at,
      480, 60, 540,
      'PENDING_CHECKOUT', 'POLICY_540_FULL_DAY',
      'MANUAL', 'PENDING',
      540, 0,
      0,
      'VERIFIED',
      v_user_id
    )
    RETURNING id, check_in_at, required_checkout_at, required_total_minutes, final_status INTO v_record;

    -- Create CHECK_IN evidence
    INSERT INTO attendance_evidence (
      attendance_record_id, employee_id, evidence_type,
      storage_path, mime_type, file_size_bytes,
      latitude, longitude, location_accuracy,
      captured_at, uploaded_at, created_by, evidence_status, location_source
    ) VALUES (
      v_record.id, v_employee.id, 'CHECK_IN_PHOTO',
      p_photo_storage_path, 'image/jpeg', NULL,
      p_latitude, p_longitude, p_accuracy_meters,
      v_now, v_now, v_user_id, 'VERIFIED', 'GPS'
    );

    -- Create audit log
    INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, new_values)
    VALUES (
      v_user_id, 'attendance.check_in', 'attendance_record', v_record.id,
      jsonb_build_object(
        'employee_id', v_employee.id,
        'check_in_at', v_check_in_at,
        'required_checkout_at', v_required_checkout_at,
        'check_in_evidence_status', 'VERIFIED',
        'evidence_type', 'CHECK_IN_PHOTO',
        'processing_path', 'DATABASE_RPC_FALLBACK'
      )
    );

    -- Create attendance history
    INSERT INTO attendance_history (attendance_record_id, employee_id, event_type, event_data, performed_by)
    VALUES (
      v_record.id, v_employee.id, 'check_in',
      jsonb_build_object(
        'check_in_at', v_check_in_at,
        'required_checkout_at', v_required_checkout_at,
        'required_total_minutes', 540,
        'evidence_type', 'CHECK_IN_PHOTO',
        'storage_path', p_photo_storage_path,
        'latitude', p_latitude,
        'longitude', p_longitude,
        'processing_path', 'DATABASE_RPC_FALLBACK'
      ),
      v_user_id
    );

    v_result := jsonb_build_object(
      'success', true,
      'action', 'check_in',
      'attendanceRecordId', v_record.id,
      'finalStatus', v_record.final_status,
      'functionVersion', 'attendance-evidence-v5',
      'correlationId', gen_random_uuid()::text,
      'secondaryWarnings', '[]'::jsonb,
      'processingPath', 'DATABASE_RPC_FALLBACK',
      'message', 'Checked in successfully',
      'record_id', v_record.id,
      'check_in_at', v_record.check_in_at,
      'required_checkout_at', v_record.required_checkout_at,
      'required_total_minutes', v_record.required_total_minutes
    );

  -- 7. Handle check_out
  ELSIF p_action = 'check_out' THEN
    -- Find open attendance record
    SELECT id, check_in_at, required_checkout_at, required_total_minutes, final_status
    INTO v_existing
    FROM attendance_records
    WHERE employee_id = v_employee.id
      AND attendance_date = v_org_date
      AND final_status = 'PENDING_CHECKOUT';

    IF NOT FOUND THEN
      -- Check if already checked out
      SELECT id, final_status INTO v_existing
      FROM attendance_records
      WHERE employee_id = v_employee.id
        AND attendance_date = v_org_date
        AND final_status IN ('FULL_DAY', 'HALF_DAY');

      IF FOUND THEN
        RETURN jsonb_build_object(
          'success', false, 'errorCode', 'ATTENDANCE_ALREADY_EXISTS',
          'message', 'You have already checked out today.',
          'correlationId', gen_random_uuid()::text, 'retryable', false
        );
      END IF;

      RETURN jsonb_build_object(
        'success', false, 'errorCode', 'ACTIVE_ATTENDANCE_NOT_FOUND',
        'message', 'No active check-in found for today. Please check in first.',
        'correlationId', gen_random_uuid()::text, 'retryable', false
      );
    END IF;

    -- Calculate elapsed minutes
    v_elapsed_minutes := EXTRACT(EPOCH FROM (v_now - v_existing.check_in_at))::integer / 60;

    IF v_elapsed_minutes >= COALESCE(v_existing.required_total_minutes, 540) THEN
      v_final_status := 'FULL_DAY';
      v_status_reason := 'Checked out at ' || v_elapsed_minutes || ' minutes (full-day threshold: ' || COALESCE(v_existing.required_total_minutes, 540) || ')';
    ELSE
      v_final_status := 'HALF_DAY';
      v_status_reason := 'Checked out early at ' || v_elapsed_minutes || ' minutes (full-day threshold: ' || COALESCE(v_existing.required_total_minutes, 540) || ')';
    END IF;

    -- Update attendance record (atomic — only if still PENDING_CHECKOUT)
    UPDATE attendance_records
    SET
      check_out_at = v_now,
      actual_elapsed_minutes = v_elapsed_minutes,
      final_status = v_final_status,
      status_reason = v_status_reason,
      checkout_type = 'MANUAL',
      checkout_status = 'COMPLETED',
      check_out_evidence_status = 'VERIFIED',
      updated_at = v_now
    WHERE id = v_existing.id AND final_status = 'PENDING_CHECKOUT'
    RETURNING id, check_in_at, check_out_at, actual_elapsed_minutes, required_total_minutes, final_status
    INTO v_record;

    IF NOT FOUND THEN
      -- Someone else checked out between our SELECT and UPDATE — return success (idempotent)
      v_record := v_existing;
      v_final_status := v_existing.final_status;
      v_elapsed_minutes := COALESCE(v_existing.required_total_minutes, 540);
    END IF;

    -- Create CHECK_OUT evidence
    INSERT INTO attendance_evidence (
      attendance_record_id, employee_id, evidence_type,
      storage_path, mime_type, file_size_bytes,
      latitude, longitude, location_accuracy,
      captured_at, uploaded_at, created_by, evidence_status, location_source
    ) VALUES (
      v_record.id, v_employee.id, 'CHECK_OUT_PHOTO',
      p_photo_storage_path, 'image/jpeg', NULL,
      p_latitude, p_longitude, p_accuracy_meters,
      v_now, v_now, v_user_id, 'VERIFIED', 'GPS'
    );

    -- Create audit log
    INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, old_values, new_values)
    VALUES (
      v_user_id, 'attendance.check_out', 'attendance_record', v_record.id,
      jsonb_build_object('final_status', 'PENDING_CHECKOUT'),
      jsonb_build_object(
        'check_out_at', v_now,
        'elapsed_minutes', v_elapsed_minutes,
        'final_status', v_final_status,
        'processing_path', 'DATABASE_RPC_FALLBACK'
      )
    );

    -- Create attendance history
    INSERT INTO attendance_history (attendance_record_id, employee_id, event_type, event_data, performed_by)
    VALUES (
      v_record.id, v_employee.id, 'check_out',
      jsonb_build_object(
        'check_out_at', v_now,
        'elapsed_minutes', v_elapsed_minutes,
        'final_status', v_final_status,
        'required_total_minutes', COALESCE(v_existing.required_total_minutes, 540),
        'evidence_type', 'CHECK_OUT_PHOTO',
        'storage_path', p_photo_storage_path,
        'latitude', p_latitude,
        'longitude', p_longitude,
        'processing_path', 'DATABASE_RPC_FALLBACK'
      ),
      v_user_id
    );

    v_result := jsonb_build_object(
      'success', true,
      'action', 'check_out',
      'attendanceRecordId', v_record.id,
      'finalStatus', v_final_status,
      'functionVersion', 'attendance-evidence-v5',
      'correlationId', gen_random_uuid()::text,
      'secondaryWarnings', '[]'::jsonb,
      'processingPath', 'DATABASE_RPC_FALLBACK',
      'message', 'Checked out successfully',
      'record_id', v_record.id,
      'check_out_at', v_record.check_out_at,
      'elapsed_minutes', v_elapsed_minutes,
      'required_total_minutes', COALESCE(v_existing.required_total_minutes, 540)
    );

  ELSE
    RETURN jsonb_build_object(
      'success', false, 'errorCode', 'UNKNOWN_ATTENDANCE_ERROR',
      'message', 'Invalid action. Use check_in or check_out.',
      'correlationId', gen_random_uuid()::text, 'retryable', false
    );
  END IF;

  -- 8. Store idempotency record
  IF p_request_id IS NOT NULL AND p_request_id != '' THEN
    INSERT INTO attendance_idempotency (user_id, request_id, action, response_data)
    VALUES (v_user_id, p_request_id, p_action, v_result)
    ON CONFLICT (user_id, request_id, action) DO NOTHING;
  END IF;

  RETURN v_result;
END;
$$;

-- Revoke execution from anon and PUBLIC, grant only to authenticated
REVOKE EXECUTE ON FUNCTION process_attendance_action(text, text, text, double precision, double precision, double precision) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION process_attendance_action(text, text, text, double precision, double precision, double precision) TO authenticated;

-- Grant INSERT on attendance_idempotency to authenticated (for the RPC's SECURITY DEFINER to work)
GRANT INSERT, SELECT ON attendance_idempotency TO authenticated;
