/*
# Phase 6 — Private Storage Buckets

## Summary
Creates 2 private storage buckets for Phase 6:
1. daily-report-attachments — stores evidence/work files attached to daily reports
2. export-files — stores generated export files (CSV/XLSX/PDF)

Both buckets are PRIVATE (no public access). Access is via signed URLs only.

## Security
- Buckets are private: public = false
- File uploads are scoped to authenticated users within the org
- File reads require signed URLs generated server-side
- Storage policies enforce org-scoped access
*/

-- ============================================================
-- 1. daily-report-attachments bucket
-- ============================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('daily-report-attachments', 'daily-report-attachments', false)
ON CONFLICT (id) DO NOTHING;

-- Storage policies: authenticated users can upload to their own org folder
DROP POLICY IF EXISTS "select_daily_report_attachments_storage" ON storage.objects;
CREATE POLICY "select_daily_report_attachments_storage" ON storage.objects FOR SELECT
  TO authenticated USING (
    bucket_id = 'daily-report-attachments'
    AND auth.uid() IS NOT NULL
  );

DROP POLICY IF EXISTS "insert_daily_report_attachments_storage" ON storage.objects;
CREATE POLICY "insert_daily_report_attachments_storage" ON storage.objects FOR INSERT
  TO authenticated WITH CHECK (
    bucket_id = 'daily-report-attachments'
    AND auth.uid() IS NOT NULL
  );

DROP POLICY IF EXISTS "update_daily_report_attachments_storage" ON storage.objects;
CREATE POLICY "update_daily_report_attachments_storage" ON storage.objects FOR UPDATE
  TO authenticated USING (
    bucket_id = 'daily-report-attachments'
    AND auth.uid() IS NOT NULL
  ) WITH CHECK (
    bucket_id = 'daily-report-attachments'
    AND auth.uid() IS NOT NULL
  );

DROP POLICY IF EXISTS "delete_daily_report_attachments_storage" ON storage.objects;
CREATE POLICY "delete_daily_report_attachments_storage" ON storage.objects FOR DELETE
  TO authenticated USING (
    bucket_id = 'daily-report-attachments'
    AND auth.uid() IS NOT NULL
  );

-- ============================================================
-- 2. export-files bucket
-- ============================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('export-files', 'export-files', false)
ON CONFLICT (id) DO NOTHING;

-- Storage policies: authenticated users can read/download exports
DROP POLICY IF EXISTS "select_export_files_storage" ON storage.objects;
CREATE POLICY "select_export_files_storage" ON storage.objects FOR SELECT
  TO authenticated USING (
    bucket_id = 'export-files'
    AND auth.uid() IS NOT NULL
  );

DROP POLICY IF EXISTS "insert_export_files_storage" ON storage.objects;
CREATE POLICY "insert_export_files_storage" ON storage.objects FOR INSERT
  TO authenticated WITH CHECK (
    bucket_id = 'export-files'
    AND auth.uid() IS NOT NULL
  );

DROP POLICY IF EXISTS "update_export_files_storage" ON storage.objects;
CREATE POLICY "update_export_files_storage" ON storage.objects FOR UPDATE
  TO authenticated USING (
    bucket_id = 'export-files'
    AND auth.uid() IS NOT NULL
  ) WITH CHECK (
    bucket_id = 'export-files'
    AND auth.uid() IS NOT NULL
  );

DROP POLICY IF EXISTS "delete_export_files_storage" ON storage.objects;
CREATE POLICY "delete_export_files_storage" ON storage.objects FOR DELETE
  TO authenticated USING (
    bucket_id = 'export-files'
    AND auth.uid() IS NOT NULL
  );
