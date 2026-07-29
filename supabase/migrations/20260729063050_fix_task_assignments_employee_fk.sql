/*
# Fix task_assignments → employees foreign key for PostgREST relationship

## Problem
The `task_assignments.assigned_to` column stores `auth.users.id` (confirmed: every
value matches both `auth.users.id` and `employees.user_id`). However, there is NO
foreign key constraint on `assigned_to` to any table. PostgREST cannot detect a
relationship between `task_assignments` and `employees`, so the embedded join
`task_assignments ( employees (...) )` fails with:
  "Could not find a relationship between 'task_assignments' and 'employees'"

## Solution
1. Add `assigned_employee_id uuid` column to `task_assignments` — stores `employees.id`
2. Backfill from existing data: join `employees` on `user_id = assigned_to`
3. Add FK constraint `task_assignments_assigned_employee_id_fkey` → `employees(id)`
4. Make the column NOT NULL after backfill (all 19 rows match)
5. Reload PostgREST schema cache via `NOTIFY pgrst, 'reload schema'`

## Data Safety
- All 19 existing assignment rows have a matching employee (0 orphans, 0 duplicates)
- No data is deleted or modified beyond the backfill
- `assigned_to` column is preserved for backward compatibility (still stores auth.users.id)
- The new `assigned_employee_id` is the canonical FK for PostgREST joins

## RLS
No RLS changes — existing policies on `task_assignments` remain unchanged.
The new column inherits existing RLS policies automatically.
*/

-- Step 1: Add the column (nullable initially for safe backfill)
ALTER TABLE task_assignments ADD COLUMN IF NOT EXISTS assigned_employee_id uuid;

-- Step 2: Backfill from existing data
UPDATE task_assignments ta
SET assigned_employee_id = e.id
FROM employees e
WHERE e.user_id = ta.assigned_to
  AND ta.assigned_employee_id IS NULL;

-- Step 3: Verify no orphans remain (all rows should have assigned_employee_id)
DO $$
DECLARE
  orphan_count integer;
BEGIN
  SELECT count(*) INTO orphan_count
  FROM task_assignments
  WHERE assigned_employee_id IS NULL;

  IF orphan_count > 0 THEN
    RAISE EXCEPTION 'Backfill incomplete: % assignments have no matching employee', orphan_count;
  END IF;
END $$;

-- Step 4: Make NOT NULL (safe — all rows backfilled)
ALTER TABLE task_assignments ALTER COLUMN assigned_employee_id SET NOT NULL;

-- Step 5: Add the foreign key constraint
ALTER TABLE task_assignments
  DROP CONSTRAINT IF EXISTS task_assignments_assigned_employee_id_fkey;

ALTER TABLE task_assignments
  ADD CONSTRAINT task_assignments_assigned_employee_id_fkey
  FOREIGN KEY (assigned_employee_id)
  REFERENCES employees(id)
  ON DELETE RESTRICT;

-- Step 6: Add index for query performance
CREATE INDEX IF NOT EXISTS idx_task_assignments_employee
  ON task_assignments (assigned_employee_id);

-- Step 7: Reload PostgREST schema cache so the new FK is detected
NOTIFY pgrst, 'reload schema';
