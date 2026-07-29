-- Fix RLS policies on daily_report_task_photos to use uppercase status values
-- The CHECK constraint on daily_reports requires uppercase: DRAFT, RETURNED_FOR_CORRECTION
-- but the RLS policies were checking lowercase: draft, returned

-- Drop and recreate the insert policy
DROP POLICY IF EXISTS "insert_drtp_owner" ON daily_report_task_photos;

CREATE POLICY "insert_drtp_owner" ON daily_report_task_photos FOR INSERT
  TO authenticated
  WITH CHECK (
    deleted_at IS NULL
    AND uploaded_by = auth.uid()
    AND organization_id = (
      SELECT user_profiles.organization_id
      FROM user_profiles
      WHERE user_profiles.id = auth.uid()
    )
    AND daily_report_id IN (
      SELECT dr.id
      FROM daily_reports dr
      WHERE dr.employee_id IN (
        SELECT e.id
        FROM employees e
        WHERE e.user_id = auth.uid()
      )
      AND dr.status IN ('DRAFT', 'RETURNED_FOR_CORRECTION')
    )
  );

-- Drop and recreate the delete policy
DROP POLICY IF EXISTS "delete_drtp_owner" ON daily_report_task_photos;

CREATE POLICY "delete_drtp_owner" ON daily_report_task_photos FOR DELETE
  TO authenticated
  USING (
    uploaded_by = auth.uid()
    AND daily_report_id IN (
      SELECT dr.id
      FROM daily_reports dr
      WHERE dr.employee_id IN (
        SELECT e.id
        FROM employees e
        WHERE e.user_id = auth.uid()
      )
      AND dr.status IN ('DRAFT', 'RETURNED_FOR_CORRECTION')
    )
  );
