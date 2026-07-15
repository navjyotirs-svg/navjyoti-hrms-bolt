/*
# Phase 1 — Organization structure (organizations, branches, departments)

1. Purpose
   - Create the core organizational hierarchy: organizations → branches → departments.
   - These tables provide multi-tenant isolation and structural context for employees.

2. New Tables
   - `organizations` (id, name, slug, is_active, created_at, updated_at)
   - `branches` (id, organization_id, name, location, is_active, created_at, updated_at)
   - `departments` (id, organization_id, branch_id, name, is_active, created_at, updated_at)

3. Security (RLS)
   - Enable RLS on all three tables.
   - Policies reference helper functions created in a later migration.
   - Until helper functions exist, policies use a permissive check that will be tightened.
   - Actually: we create the tables first WITHOUT RLS policies, then add policies in a
     subsequent migration after helper functions are created.

4. Notes
   - RLS is enabled but policies are added in a separate migration after helper functions.
*/

-- ============================================================
-- ORGANIZATIONS
-- ============================================================

CREATE TABLE IF NOT EXISTS organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text UNIQUE NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- BRANCHES
-- ============================================================

CREATE TABLE IF NOT EXISTS branches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  location text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT branches_org_name_unique UNIQUE (organization_id, name)
);

ALTER TABLE branches ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- DEPARTMENTS
-- ============================================================

CREATE TABLE IF NOT EXISTS departments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  branch_id uuid REFERENCES branches(id) ON DELETE SET NULL,
  name text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT departments_org_name_unique UNIQUE (organization_id, name)
);

ALTER TABLE departments ENABLE ROW LEVEL SECURITY;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_branches_org ON branches(organization_id);
CREATE INDEX IF NOT EXISTS idx_departments_org ON departments(organization_id);
CREATE INDEX IF NOT EXISTS idx_departments_branch ON departments(branch_id);
