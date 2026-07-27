-- Tighten storage policies for daily-report-task-photos bucket
-- Previous policies allowed ANY authenticated user cross-org access.
-- New policies enforce same-organization ownership.

DROP POLICY IF EXISTS "Allow authenticated read daily-report-task-photos" ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated upload to daily-report-task-photos" ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated delete own daily-report-task-photos" ON storage.objects;

-- SELECT: same-org only (owner or manager/hr_admin/director in same org)
CREATE POLICY "read_daily_report_task_photos_org"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'daily-report-task-photos'
    AND EXISTS (
      SELECT 1 FROM user_profiles up
      WHERE up.id = auth.uid()
      AND (
        -- Owner: path starts with their user_id
        (storage.foldername(name))[1] = auth.uid()::text
        OR (
          up.role IN ('manager', 'hr_admin', 'director')
          AND up.organization_id = (
            SELECT dr.organization_id
            FROM daily_report_task_photos drtp
            JOIN daily_reports dr ON dr.id = drtp.daily_report_id
            WHERE drtp.storage_path = name
            LIMIT 1
          )
        )
      )
    )
  );

-- INSERT: owner only, path must start with their user_id
CREATE POLICY "insert_daily_report_task_photos_owner"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'daily-report-task-photos'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- DELETE: owner only, path must start with their user_id
CREATE POLICY "delete_daily_report_task_photos_owner"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'daily-report-task-photos'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );
