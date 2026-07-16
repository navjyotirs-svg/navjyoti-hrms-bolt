/*
# Phase 3 — Storage bucket for attendance evidence

1. Purpose
   - Create a private storage bucket 'attendance-evidence' for checkout photos.
   - Add RLS policies on storage.objects scoped to this bucket.
   - Employees can upload only to their own path (user_id prefix).
   - Employees can read only their own evidence.
   - HR/Director (with evidence_read_all) can read org-scoped evidence.
   - Managers do NOT get evidence access by default.
   - System Admin does NOT get evidence access.

2. Path Format
   - {user_id}/{random_uuid}.{ext}
   - Approved formats: jpg, jpeg, png, webp
   - Max size enforced in frontend and edge function (10MB)

3. Policies
   - SELECT: self (folder = auth.uid()) OR same-org with evidence_read_all
   - INSERT: self only (folder = auth.uid())
   - No UPDATE/DELETE (immutable evidence)
*/

-- Create the private bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('attendance-evidence', 'attendance-evidence', false)
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- STORAGE POLICIES FOR attendance-evidence BUCKET
-- ============================================================

-- SELECT: allow download if path starts with own user_id, or has evidence_read_all and path belongs to org employee
DROP POLICY IF EXISTS "select_attendance_evidence_storage" ON storage.objects;
CREATE POLICY "select_attendance_evidence_storage"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'attendance-evidence'
    AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR (
        current_user_has_permission('attendance.evidence_read_all')
        AND EXISTS (
          SELECT 1 FROM attendance_evidence ae
          JOIN employees e ON e.id = ae.employee_id
          WHERE ae.storage_path = name
          AND e.organization_id = current_user_org_id()
        )
      )
    )
  );

-- INSERT: allow upload to own path only
DROP POLICY IF EXISTS "insert_attendance_evidence_storage" ON storage.objects;
CREATE POLICY "insert_attendance_evidence_storage"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'attendance-evidence'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- No UPDATE or DELETE policies — evidence is immutable
