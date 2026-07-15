/*
# Phase 2 — Storage bucket policies for employee-documents

1. Purpose
   - Add RLS policies on storage.objects for the employee-documents bucket.
   - Employees can only upload/download their own documents.
   - HR/Director (with employee.document.manage) can download any org document.
   - System admin gets no document access.

2. Policies
   - SELECT (download): user owns the object path (path starts with their user_id) OR has document.manage permission and the path belongs to their org
   - INSERT (upload): user can upload to their own path (path starts with their user_id) OR has document.manage
   - UPDATE/DELETE: document.manage only
   - All paths are randomized UUIDs under a user_id prefix for self-scoping

3. Notes
   - Storage objects use the path format: {user_id}/{random_uuid}.{ext}
   - The bucket is private (not public)
   - Signed URLs with 60-second expiry are generated server-side for downloads
*/

-- ============================================================
-- STORAGE POLICIES FOR employee-documents BUCKET
-- ============================================================

-- SELECT: allow download if the path starts with the user's own ID, or if they have document.manage
-- and the path belongs to an employee in their org
DROP POLICY IF EXISTS "select_emp_docs_storage" ON storage.objects;
CREATE POLICY "select_emp_docs_storage"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'employee-documents'
    AND (
      -- Self: path starts with own user_id
      (storage.foldername(name))[1] = auth.uid()::text
      -- OR: has document.manage and the path belongs to an employee in their org
      OR (
        current_user_has_permission('employee.document.manage')
        AND EXISTS (
          SELECT 1 FROM employee_documents ed
          JOIN employees e ON e.id = ed.employee_id
          WHERE ed.storage_path = name
          AND e.organization_id = current_user_org_id()
        )
      )
    )
  );

-- INSERT: allow upload to own path or with document.manage
DROP POLICY IF EXISTS "insert_emp_docs_storage" ON storage.objects;
CREATE POLICY "insert_emp_docs_storage"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'employee-documents'
    AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR current_user_has_permission('employee.document.manage')
    )
  );

-- UPDATE: document.manage only
DROP POLICY IF EXISTS "update_emp_docs_storage" ON storage.objects;
CREATE POLICY "update_emp_docs_storage"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'employee-documents'
    AND current_user_has_permission('employee.document.manage')
  )
  WITH CHECK (
    bucket_id = 'employee-documents'
    AND current_user_has_permission('employee.document.manage')
  );

-- DELETE: document.manage only
DROP POLICY IF EXISTS "delete_emp_docs_storage" ON storage.objects;
CREATE POLICY "delete_emp_docs_storage"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'employee-documents'
    AND current_user_has_permission('employee.document.manage')
  );
