/*
# Phase 5 — Private Storage Buckets for Task and Ticket Attachments

## Summary
Creates two private storage buckets:
1. `task-attachments` — for task evidence, references, and review files
2. `ticket-attachments` — for ticket evidence and support files

## Security
- Both buckets are private (public = false)
- No public URLs — access via signed URLs only
- SELECT: scoped by user folder path OR org-level attachment_read permission
- INSERT: scoped by user folder path only
- No UPDATE or DELETE — attachments are immutable
- Paths use randomized object names: {user_id}/{random_uuid}.{ext}
- Approved types: PDF, JPG, JPEG, PNG, DOCX, XLSX, CSV
- Max file size: 10MB (enforced at application level)
*/

-- Insert bucket records (idempotent)
INSERT INTO storage.buckets (id, name, public)
VALUES ('task-attachments', 'task-attachments', false)
ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets (id, name, public)
VALUES ('ticket-attachments', 'ticket-attachments', false)
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- task-attachments storage policies
-- ============================================================
DROP POLICY IF EXISTS "select_task_attachments_storage" ON storage.objects;
CREATE POLICY "select_task_attachments_storage" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'task-attachments'
    AND (
      -- Owner can read their own uploads
      (storage.foldername(name))[1] = auth.uid()::text
      OR current_user_has_permission('task.attachment_read')
    )
  );

DROP POLICY IF EXISTS "insert_task_attachments_storage" ON storage.objects;
CREATE POLICY "insert_task_attachments_storage" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'task-attachments'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- ============================================================
-- ticket-attachments storage policies
-- ============================================================
DROP POLICY IF EXISTS "select_ticket_attachments_storage" ON storage.objects;
CREATE POLICY "select_ticket_attachments_storage" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'ticket-attachments'
    AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR current_user_has_permission('ticket.attachment_read')
    )
  );

DROP POLICY IF EXISTS "insert_ticket_attachments_storage" ON storage.objects;
CREATE POLICY "insert_ticket_attachments_storage" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'ticket-attachments'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );
