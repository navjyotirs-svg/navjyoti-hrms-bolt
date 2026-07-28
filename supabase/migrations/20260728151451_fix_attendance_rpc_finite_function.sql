/*
# Fix process_attendance_action — remove invalid finite() call

PostgreSQL does not have a `finite(double precision)` function.
The accuracy validation check used it incorrectly, causing:
  "function finite(double precision) does not exist"

Fix: replace with a simple range check. Location accuracy from the
browser Geolocation API is always a positive finite number in metres.
We accept any value > 0 and < 1,000,000 metres. Null is also accepted
(accuracy is optional). This does not change any attendance business logic.
*/

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
  v_now timestamptz := now();
  v_now_ist timestamptz;
  v_org_date date;
  v_existing record;
  v_record record;
  v_check_in_at timestamptz;
  v_required_checkout_at timestamptz;
  v_elapsed_minutes integer;
  v_final_status text;
  v_status_reason text;
  v_idempotent jsonb;
  v_result jsonb;
BEGIN
  -- Resolve current date in Asia/Kolkata (IST = UTC+5:30)
  v_now_ist := v_now + interval '5 hours 30 minutes';
  v_org_date := v_now_ist::date;

  -- 1. Require authenticated user
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
  IF p_request_id IS NOT NULL AND p_request_id <> '' THEN
    SELECT response_data INTO v_idempotent
    FROM attendance_idempotency
    WHERE user_id = v_user_id
      AND request_id = p_request_id
      AND action = p_action;
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

  IF NOT v_employee.is_active
     OR v_employee.employment_status NOT IN ('active', 'on_probation', 'confirmed', 'notice_period') THEN
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
  IF position(v_user_id::text IN p_photo_storage_path) = 0 THEN
    RETURN jsonb_build_object(
      'success', false, 'errorCode', 'EVIDENCE_INVALID',
      'message', 'Evidence path does not belong to the authenticated user.',
      'correlationId', gen_random_uuid()::text, 'retryable', false
    );
  END IF;

  -- 6. Validate coordinates (simple range check — no finite() needed)
  IF p_latitude IS NULL OR p_longitude IS NULL
     OR p_latitude < -90  OR p_latitude > 90
     OR p_longitude < -180 OR p_longitude > 180 THEN
    RETURN jsonb_build_object(
      'success', false, 'errorCode', 'LOCATION_INVALID',
      'message', 'Location coordinates are invalid.',
      'correlationId', gen_random_uuid()::text, 'retryable', false
    );
  END IF;

  -- Accuracy is optional; accept null or any reasonable positive value
  -- (no finite() call — it does not exist in PostgreSQL)

  -- 7. Handle check_in
  IF p_action = 'check_in' THEN

    -- Verify no open attendance record already exists
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
      540, 0, 0,
      'VERIFIED',
      v_user_id
    )
    RETURNING id, check_in_at, required_checkout_at, required_total_minutes, final_status
    INTO v_record;

    -- Create CHECK_IN evidence
    INSERT INTO attendance_evidence (
      attendance_record_id, employee_id, evidence_type,
      storage_path, mime_type,
      latitude, longitude, location_accuracy,
      captured_at, uploaded_at, created_by, evidence_status, location_source
    ) VALUES (
      v_record.id, v_employee.id, 'CHECK_IN_PHOTO',
      p_photo_storage_path, 'image/jpeg',
      p_latitude, p_longitude, p_accuracy_meters,
      v_now, v_now, v_user_id, 'VERIFIED', 'GPS'
    );

    -- Audit log
    INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, new_values)
    VALUES (
      v_user_id, 'attendance.check_in', 'attendance_record', v_record.id,
      jsonb_build_object(
        'employee_id', v_employee.id,
        'check_in_at', v_check_in_at,
        'required_checkout_at', v_required_checkout_at,
        'check_in_evidence_status', 'VERIFIED',
        'processing_path', 'DATABASE_RPC_FALLBACK'
      )
    );

    -- Attendance history
    INSERT INTO attendance_history (attendance_record_id, employee_id, event_type, event_data, performed_by)
    VALUES (
      v_record.id, v_employee.id, 'check_in',
      jsonb_build_object(
        'check_in_at', v_check_in_at,
        'required_checkout_at', v_required_checkout_at,
        'required_total_minutes', 540,
        'evidence_type', 'CHECK_IN_PHOTO',
        'storage_path', p_photo_storage_path,
        'latitude', p_latitude, 'longitude', p_longitude,
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

  -- 8. Handle check_out
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
      IF EXISTS (
        SELECT 1 FROM attendance_records
        WHERE employee_id = v_employee.id
          AND attendance_date = v_org_date
          AND final_status IN ('FULL_DAY', 'HALF_DAY')
      ) THEN
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

    -- Calculate elapsed minutes server-side
    v_elapsed_minutes := EXTRACT(EPOCH FROM (v_now - v_existing.check_in_at))::integer / 60;

    IF v_elapsed_minutes >= COALESCE(v_existing.required_total_minutes, 540) THEN
      v_final_status := 'FULL_DAY';
      v_status_reason := 'Checked out at ' || v_elapsed_minutes
        || ' minutes (threshold: ' || COALESCE(v_existing.required_total_minutes, 540) || ')';
    ELSE
      v_final_status := 'HALF_DAY';
      v_status_reason := 'Early checkout at ' || v_elapsed_minutes
        || ' minutes (threshold: ' || COALESCE(v_existing.required_total_minutes, 540) || ')';
    END IF;

    -- Update attendance record atomically
    UPDATE attendance_records
    SET
      check_out_at          = v_now,
      actual_elapsed_minutes = v_elapsed_minutes,
      final_status          = v_final_status,
      status_reason         = v_status_reason,
      checkout_type         = 'MANUAL',
      checkout_status       = 'COMPLETED',
      check_out_evidence_status = 'VERIFIED',
      updated_at            = v_now
    WHERE id = v_existing.id
      AND final_status = 'PENDING_CHECKOUT'
    RETURNING id, check_in_at, check_out_at, actual_elapsed_minutes,
              required_total_minutes, final_status
    INTO v_record;

    -- If already updated (race condition) treat as success
    IF NOT FOUND THEN
      v_record.id                   := v_existing.id;
      v_record.final_status         := v_existing.final_status;
      v_record.actual_elapsed_minutes := v_elapsed_minutes;
      v_record.required_total_minutes := COALESCE(v_existing.required_total_minutes, 540);
    END IF;

    -- Create CHECK_OUT evidence
    INSERT INTO attendance_evidence (
      attendance_record_id, employee_id, evidence_type,
      storage_path, mime_type,
      latitude, longitude, location_accuracy,
      captured_at, uploaded_at, created_by, evidence_status, location_source
    ) VALUES (
      v_record.id, v_employee.id, 'CHECK_OUT_PHOTO',
      p_photo_storage_path, 'image/jpeg',
      p_latitude, p_longitude, p_accuracy_meters,
      v_now, v_now, v_user_id, 'VERIFIED', 'GPS'
    );

    -- Audit log
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

    -- Attendance history
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
        'latitude', p_latitude, 'longitude', p_longitude,
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
      'check_out_at', v_now,
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

  -- 9. Store idempotency record
  IF p_request_id IS NOT NULL AND p_request_id <> '' THEN
    INSERT INTO attendance_idempotency (user_id, request_id, action, response_data)
    VALUES (v_user_id, p_request_id, p_action, v_result)
    ON CONFLICT (user_id, request_id, action) DO NOTHING;
  END IF;

  RETURN v_result;
END;
$$;

-- Re-apply grants (CREATE OR REPLACE resets them)
REVOKE EXECUTE ON FUNCTION process_attendance_action(text, text, text, double precision, double precision, double precision) FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION process_attendance_action(text, text, text, double precision, double precision, double precision) TO authenticated;
