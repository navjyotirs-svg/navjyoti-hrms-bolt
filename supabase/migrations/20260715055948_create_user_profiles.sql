/*
# Create user_profiles table — Auth Foundation (Phase 0)

1. Purpose
   - Stores the HRMS profile for each authenticated user: full name, email, and system role.
   - This is the foundational table for RBAC. Phase 1 will add organizations, branches,
     departments, and reporting hierarchy that reference this table.

2. New Tables
   - `user_profiles`
     - `id` (uuid, primary key) — matches the auth.users id (1:1 relationship)
     - `email` (text, not null) — the user's login email, synced from auth
     - `full_name` (text, nullable) — display name
     - `role` (text, nullable) — one of: director, hr_administrator, manager,
       team_leader, employee, intern_trainee, system_administrator
     - `created_at` (timestamptz) — record creation time
     - `updated_at` (timestamptz) — last modification time

3. Constraints
   - `user_profiles_role_check` — ensures role is one of the 7 valid values
   - Foreign key to auth.users(id) with CASCADE delete

4. Security (RLS)
   - Enable RLS on `user_profiles`.
   - SELECT: authenticated users can read their own profile.
   - INSERT: authenticated users can insert their own profile (id must match auth.uid()).
   - UPDATE: authenticated users can update their own profile.
   - DELETE: authenticated users can delete their own profile.
   - All policies use `auth.uid()` for ownership checks.

5. Notes
   - The `id` column has DEFAULT auth.uid() so inserts from the client that omit id
     still satisfy the INSERT policy's WITH CHECK constraint.
   - This table is intentionally minimal for Phase 0. Phase 1 will add organization_id,
     branch_id, department_id, and manager_id columns.
*/

CREATE TABLE IF NOT EXISTS user_profiles (
  id uuid PRIMARY KEY DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL,
  full_name text,
  role text CHECK (
    role IN (
      'director',
      'hr_administrator',
      'manager',
      'team_leader',
      'employee',
      'intern_trainee',
      'system_administrator'
    )
  ),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

-- SELECT: users can read their own profile
DROP POLICY IF EXISTS "select_own_profile" ON user_profiles;
CREATE POLICY "select_own_profile"
  ON user_profiles FOR SELECT
  TO authenticated
  USING (auth.uid() = id);

-- INSERT: users can insert their own profile
DROP POLICY IF EXISTS "insert_own_profile" ON user_profiles;
CREATE POLICY "insert_own_profile"
  ON user_profiles FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = id);

-- UPDATE: users can update their own profile
DROP POLICY IF EXISTS "update_own_profile" ON user_profiles;
CREATE POLICY "update_own_profile"
  ON user_profiles FOR UPDATE
  TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- DELETE: users can delete their own profile
DROP POLICY IF EXISTS "delete_own_profile" ON user_profiles;
CREATE POLICY "delete_own_profile"
  ON user_profiles FOR DELETE
  TO authenticated
  USING (auth.uid() = id);

-- Index for lookups by email
CREATE INDEX IF NOT EXISTS idx_user_profiles_email ON user_profiles (email);
