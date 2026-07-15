/*
# Phase 2 — Document types table

1. Purpose
   - Create a document_types table with 15 supported document types.
   - Mark identity-proof and confidential documents for access control.

2. New Table
   - `document_types`
     - `id` (uuid, PK)
     - `code` (text, unique, not null) — stable code
     - `label` (text, not null) — display label
     - `is_identity_proof` (boolean, default false) — marks Aadhaar, PAN, etc.
     - `is_confidential` (boolean, default false) — restricts manager/team-leader access
     - `created_at` (timestamptz, default now())

3. Seed Data (15 types)
   - Aadhaar (identity + confidential)
   - PAN (identity + confidential)
   - Resume
   - Offer Letter (confidential)
   - Appointment Letter (confidential)
   - Education Certificate
   - Experience Letter
   - Address Proof (identity)
   - Identity Proof (identity)
   - Medical Certificate
   - Warning Letter (confidential)
   - Confirmation Letter (confidential)
   - Resignation Letter (confidential)
   - Relieving Letter (confidential)
   - Other

4. Security (RLS)
   - SELECT: all authenticated users can read document types (needed for UI)
   - No INSERT/UPDATE/DELETE (system-managed)
*/

CREATE TABLE IF NOT EXISTS document_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text UNIQUE NOT NULL,
  label text NOT NULL,
  is_identity_proof boolean NOT NULL DEFAULT false,
  is_confidential boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE document_types ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_document_types_all" ON document_types;
CREATE POLICY "select_document_types_all"
  ON document_types FOR SELECT
  TO authenticated
  USING (true);

-- ============================================================
-- SEED DOCUMENT TYPES
-- ============================================================

INSERT INTO document_types (code, label, is_identity_proof, is_confidential) VALUES
  ('aadhaar', 'Aadhaar', true, true),
  ('pan', 'PAN', true, true),
  ('resume', 'Resume', false, false),
  ('offer_letter', 'Offer Letter', false, true),
  ('appointment_letter', 'Appointment Letter', false, true),
  ('education_certificate', 'Education Certificate', false, false),
  ('experience_letter', 'Experience Letter', false, false),
  ('address_proof', 'Address Proof', true, false),
  ('identity_proof', 'Identity Proof', true, false),
  ('medical_certificate', 'Medical Certificate', false, false),
  ('warning_letter', 'Warning Letter', false, true),
  ('confirmation_letter', 'Confirmation Letter', false, true),
  ('resignation_letter', 'Resignation Letter', false, true),
  ('relieving_letter', 'Relieving Letter', false, true),
  ('other', 'Other', false, false)
ON CONFLICT (code) DO NOTHING;
