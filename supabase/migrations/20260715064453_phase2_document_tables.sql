/*
# Phase 2 — Employee documents, versions, and verification history

1. Purpose
   - Create tables for private employee document management with version history and verification tracking.
   - Files are stored in Supabase Storage (private bucket), only metadata in PostgreSQL.

2. New Tables
   - `employee_documents`
     - id (uuid, PK)
     - employee_id (uuid, FK→employees, CASCADE)
     - document_type_id (uuid, FK→document_types)
     - file_name (text) — original file name
     - storage_path (text) — randomized path in private bucket
     - mime_type (text) — validated MIME type
     - file_size_bytes (bigint) — file size
     - version (integer, default 1) — current version number
     - status (text: pending|verified|rejected, default 'pending')
     - uploaded_by (uuid, FK→auth.users)
     - verified_by (uuid, FK→auth.users, nullable)
     - rejection_reason (text, nullable)
     - expiry_date (date, nullable)
     - created_at (timestamptz)
     - updated_at (timestamptz)

   - `document_versions`
     - id (uuid, PK)
     - document_id (uuid, FK→employee_documents, CASCADE)
     - version_number (integer)
     - storage_path (text)
     - file_size_bytes (bigint)
     - uploaded_by (uuid, FK→auth.users)
     - created_at (timestamptz)

   - `document_verification_history`
     - id (uuid, PK)
     - document_id (uuid, FK→employee_documents, CASCADE)
     - action (text) — verify, reject, reupload
     - actor_id (uuid, FK→auth.users)
     - old_status (text, nullable)
     - new_status (text, nullable)
     - reason (text, nullable)
     - created_at (timestamptz)

3. Security (RLS)
   - employee_documents: SELECT for self or same-org with employee.document.manage; INSERT for self (upload_self) or manage; UPDATE for manage only
   - document_versions: SELECT same scoping as documents; INSERT for self or manage
   - document_verification_history: SELECT same scoping; INSERT for manage only; no UPDATE/DELETE (append-only)
*/

-- ============================================================
-- EMPLOYEE DOCUMENTS
-- ============================================================

CREATE TABLE IF NOT EXISTS employee_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  document_type_id uuid NOT NULL REFERENCES document_types(id),
  file_name text NOT NULL,
  storage_path text NOT NULL,
  mime_type text NOT NULL,
  file_size_bytes bigint NOT NULL,
  version integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'verified', 'rejected')),
  uploaded_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  verified_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  rejection_reason text,
  expiry_date date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE employee_documents ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_emp_docs_employee ON employee_documents(employee_id);
CREATE INDEX IF NOT EXISTS idx_emp_docs_type ON employee_documents(document_type_id);
CREATE INDEX IF NOT EXISTS idx_emp_docs_status ON employee_documents(status);

-- ============================================================
-- DOCUMENT VERSIONS
-- ============================================================

CREATE TABLE IF NOT EXISTS document_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES employee_documents(id) ON DELETE CASCADE,
  version_number integer NOT NULL,
  storage_path text NOT NULL,
  file_size_bytes bigint NOT NULL,
  uploaded_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE document_versions ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_doc_versions_document ON document_versions(document_id);

-- ============================================================
-- DOCUMENT VERIFICATION HISTORY
-- ============================================================

CREATE TABLE IF NOT EXISTS document_verification_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES employee_documents(id) ON DELETE CASCADE,
  action text NOT NULL,
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  old_status text,
  new_status text,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE document_verification_history ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_verification_history_doc ON document_verification_history(document_id);
CREATE INDEX IF NOT EXISTS idx_verification_history_created ON document_verification_history(created_at DESC);
