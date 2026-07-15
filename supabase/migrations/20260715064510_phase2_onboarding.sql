/*
# Phase 2 — Onboarding checklists

1. Purpose
   - Create onboarding checklist tables for tracking employee onboarding progress.
   - Each new employee gets a checklist with 10 standard items.

2. New Tables
   - `onboarding_checklists`
     - id (uuid, PK)
     - employee_id (uuid, FK→employees, unique, CASCADE)
     - status (text: not_started|in_progress|completed, default 'not_started')
     - created_at (timestamptz)
     - completed_at (timestamptz, nullable)

   - `onboarding_checklist_items`
     - id (uuid, PK)
     - checklist_id (uuid, FK→onboarding_checklists, CASCADE)
     - item_key (text) — stable key
     - label (text) — display label
     - status (text: not_started|pending_employee|pending_hr|verified|rejected|not_applicable, default 'not_started')
     - assigned_to (text: employee|hr|manager, nullable)
     - verified_by (uuid, FK→auth.users, nullable)
     - notes (text, nullable)
     - updated_at (timestamptz)

3. Security (RLS)
   - onboarding_checklists: SELECT for self or same-org with employee.onboarding.manage; UPDATE for manage only
   - onboarding_checklist_items: SELECT same scoping; UPDATE for manage only; INSERT via trigger
*/

-- ============================================================
-- ONBOARDING CHECKLISTS
-- ============================================================

CREATE TABLE IF NOT EXISTS onboarding_checklists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'not_started' CHECK (status IN ('not_started', 'in_progress', 'completed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT onboarding_employee_unique UNIQUE (employee_id)
);

ALTER TABLE onboarding_checklists ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- ONBOARDING CHECKLIST ITEMS
-- ============================================================

CREATE TABLE IF NOT EXISTS onboarding_checklist_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  checklist_id uuid NOT NULL REFERENCES onboarding_checklists(id) ON DELETE CASCADE,
  item_key text NOT NULL,
  label text NOT NULL,
  status text NOT NULL DEFAULT 'not_started' CHECK (status IN ('not_started', 'pending_employee', 'pending_hr', 'verified', 'rejected', 'not_applicable')),
  assigned_to text CHECK (assigned_to IN ('employee', 'hr', 'manager')),
  verified_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  notes text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE onboarding_checklist_items ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_checklist_items_checklist ON onboarding_checklist_items(checklist_id);

-- ============================================================
-- TRIGGER: Auto-create onboarding checklist when employee is created
-- ============================================================

CREATE OR REPLACE FUNCTION create_onboarding_checklist()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  checklist_id uuid;
BEGIN
  INSERT INTO onboarding_checklists (employee_id, status)
  VALUES (NEW.id, 'not_started')
  RETURNING id INTO checklist_id;

  -- Insert 10 standard checklist items
  INSERT INTO onboarding_checklist_items (checklist_id, item_key, label, status, assigned_to)
  VALUES
    (checklist_id, 'identity_proof', 'Identity Proof', 'pending_employee', 'employee'),
    (checklist_id, 'address_proof', 'Address Proof', 'pending_employee', 'employee'),
    (checklist_id, 'education_certificates', 'Educational Certificates', 'pending_employee', 'employee'),
    (checklist_id, 'experience_documents', 'Experience Documents', 'pending_employee', 'employee'),
    (checklist_id, 'profile_photo', 'Profile Photo', 'pending_employee', 'employee'),
    (checklist_id, 'emergency_contact', 'Emergency Contact Details', 'pending_employee', 'employee'),
    (checklist_id, 'policy_acknowledgement', 'Policy Acknowledgement', 'pending_employee', 'employee'),
    (checklist_id, 'it_access_confirmation', 'IT Access Confirmation', 'pending_hr', 'hr'),
    (checklist_id, 'manager_confirmation', 'Manager Confirmation', 'pending_hr', 'manager'),
    (checklist_id, 'hr_verification', 'HR Verification', 'pending_hr', 'hr');

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_create_onboarding_checklist ON employees;
CREATE TRIGGER trg_create_onboarding_checklist
  AFTER INSERT ON employees
  FOR EACH ROW
  EXECUTE FUNCTION create_onboarding_checklist();
