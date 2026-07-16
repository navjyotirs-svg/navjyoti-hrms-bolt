/*
# Phase 4 — Leave Documents Storage Bucket

## Purpose
Create a private storage bucket for leave supporting documents (medical certificates, etc.).

## Storage Bucket
- Name: leave-documents
- Public: false (private — access via signed URLs only)
- Paths: {user_id}/{random_uuid}.{ext}

## Storage Policies
1. SELECT: self path (folder = auth.uid()) or org-scoped with leave.document_read_manage
2. INSERT: self path only (leave.document_upload_self)
3. UPDATE: blocked (immutable — no policy)
4. DELETE: blocked (immutable — no policy)

## Security
- Medical documents are private — never public
- System Administrator has no access by default (no leave.document_read_manage permission)
- Signed URLs (short-lived) for authorized viewing
*/

INSERT INTO storage.buckets (id, name, public)
VALUES ('leave-documents', 'leave-documents', false)
ON CONFLICT (id) DO NOTHING;

-- SELECT policy: self or org-scoped manage
DROP POLICY IF EXISTS "select_leave_documents" ON storage.objects;
CREATE POLICY "select_leave_documents" ON storage.objects FOR SELECT
  TO authenticated USING (
    bucket_id = 'leave-documents'
    AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR current_user_has_permission('leave.document_read_manage')
    )
  );

-- INSERT policy: self only
DROP POLICY IF EXISTS "insert_leave_documents" ON storage.objects;
CREATE POLICY "insert_leave_documents" ON storage.objects FOR INSERT
  TO authenticated WITH CHECK (
    bucket_id = 'leave-documents'
    AND (storage.foldername(name))[1] = auth.uid()::text
    AND current_user_has_permission('leave.document_upload_self')
  );

-- No UPDATE or DELETE policies — documents are immutable once uploaded
