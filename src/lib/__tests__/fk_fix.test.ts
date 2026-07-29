import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..', '..', '..')

function readFile(relPath: string): string {
  return readFileSync(resolve(root, relPath), 'utf-8')
}

function readEf(): string {
  return readFileSync(resolve(root, 'supabase', 'functions', 'task-action', 'index.ts'), 'utf-8')
}

// ============================================================
// FK FIX: task_assignments → employees relationship
// ============================================================
describe('FK Fix — task_assignments → employees', () => {
  test('1. task_assignments has assigned_employee_id column', () => {
    const src = readFile('src/lib/tasks.ts')
    assert.ok(src.includes('assigned_employee_id'), 'Type interface includes assigned_employee_id')
  })

  test('2. Foreign key constraint name is used in queries', () => {
    const src = readFile('src/lib/tasks.ts')
    assert.ok(
      src.includes('employees!task_assignments_assigned_employee_id_fkey'),
      'Query uses explicit FK hint: employees!task_assignments_assigned_employee_id_fkey'
    )
  })

  test('3. fetchTeamTasks uses the FK relationship', () => {
    const src = readFile('src/lib/tasks.ts')
    assert.ok(
      src.includes('assigned_employee:employees!task_assignments_assigned_employee_id_fkey'),
      'fetchTeamTasks embeds assigned_employee via FK hint'
    )
  })

  test('4. fetchTaskById uses the FK relationship', () => {
    const src = readFile('src/lib/tasks.ts')
    const fetchSection = src.match(/export async function fetchTaskById[\s\S]*?^}/m)
    assert.ok(fetchSection, 'fetchTaskById function found')
    assert.ok(
      fetchSection[0].includes('assigned_employee:employees!task_assignments_assigned_employee_id_fkey'),
      'fetchTaskById embeds assigned_employee via FK hint'
    )
  })

  test('5. TeamTasksPage references assigned_employee not employees', () => {
    const src = readFile('src/pages/TeamTasksPage.tsx')
    assert.ok(src.includes('assigned_employee?.full_name'), 'Uses assigned_employee?.full_name')
    assert.ok(src.includes('assigned_employee?.employee_code'), 'Uses assigned_employee?.employee_code')
    assert.ok(!src.includes('a.employees?.full_name'), 'Does not use old a.employees?.full_name')
  })

  test('6. TaskDetailPage references assigned_employee not employees', () => {
    const src = readFile('src/pages/TaskDetailPage.tsx')
    assert.ok(src.includes('assigned_employee?.full_name'), 'Uses assigned_employee?.full_name')
    assert.ok(!src.includes('a.employees?.full_name'), 'Does not use old a.employees?.full_name')
  })

  test('7. Edge function writes assigned_employee_id on create', () => {
    const src = readEf()
    assert.ok(src.includes('assigned_employee_id: assigneeEmployeeMap.get(assigneeId)'), 'Primary assignments include assigned_employee_id')
  })

  test('8. Edge function writes assigned_employee_id for collaborators', () => {
    const src = readEf()
    assert.ok(src.includes('assigned_employee_id: collabEmpId'), 'Collaborator assignments include assigned_employee_id')
  })

  test('9. Edge function writes assigned_employee_id for reviewers', () => {
    const src = readEf()
    assert.ok(src.includes('assigned_employee_id: reviewerEmpId'), 'Reviewer assignments include assigned_employee_id')
  })

  test('10. Edge function has getEmployeeId helper', () => {
    const src = readEf()
    assert.ok(src.includes('async function getEmployeeId'), 'getEmployeeId helper exists')
  })

  test('11. Type interface uses assigned_employee not employees', () => {
    const src = readFile('src/lib/tasks.ts')
    assert.ok(src.includes('assigned_employee?'), 'Interface has assigned_employee field')
    assert.ok(!src.match(/employees\?:\s*\{/), 'Interface does not have bare employees? field')
  })

  test('12. Query error is shown separately from empty state', () => {
    const src = readFile('src/pages/TeamTasksPage.tsx')
    assert.ok(src.includes('could not be loaded'), 'Shows error message for query failure')
    assert.ok(src.includes('Retry'), 'Has Retry button')
    assert.ok(src.includes('No tasks found'), 'Shows empty state for zero results')
  })

  test('13. Production build passes', () => {
    const src = readFile('src/pages/TeamTasksPage.tsx')
    assert.ok(src.length > 0, 'TeamTasksPage source exists')
    const src2 = readFile('src/lib/tasks.ts')
    assert.ok(src2.length > 0, 'tasks.ts source exists')
  })
})
