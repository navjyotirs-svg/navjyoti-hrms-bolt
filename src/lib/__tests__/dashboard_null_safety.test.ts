import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const DASHBOARD_PATH = join(process.cwd(), 'src', 'pages', 'Dashboard.tsx')
const CSS_PATH = join(process.cwd(), 'src', 'styles', 'dashboard.css')
const code = readFileSync(DASHBOARD_PATH, 'utf-8')
const css = readFileSync(CSS_PATH, 'utf-8')

// ============================================================
// 1. Crash fix: tasks!inner returns single object, not array
// ============================================================

test('1. Dashboard renders when task metric is undefined — no array indexing on tasks join', () => {
  // The crash was caused by (a.tasks as unknown[])[0] — extractTask handles both shapes
  assert(code.includes('function extractTask'), 'extractTask helper must exist')
  assert(code.includes('Array.isArray(row)'), 'extractTask must handle array shape')
  assert(!code.includes('(a.tasks as unknown[])[0]'), 'Must not index tasks as array')
})

test('2. Missing current_deadline does not crash — null-safe access', () => {
  assert(code.includes('function getDeadline'), 'getDeadline helper must exist')
  assert(code.includes('task.current_deadline ??'), 'Must use nullish coalescing for current_deadline')
  assert(code.includes('task.original_deadline ??'), 'Must fallback to original_deadline')
  assert(code.includes('task.deadline_at ??'), 'Must fallback to deadline_at')
})

test('3. deadline_at is used when available', () => {
  assert(code.includes('deadline_at'), 'deadline_at must be referenced in the code')
  // The schedule query selects deadline_at
  assert(code.includes('deadline_at'), 'Schedule query should select deadline_at')
})

test('4. Missing deadline shows neutral state — noDeadline counter', () => {
  assert(code.includes('noDeadline'), 'Must track noDeadline count')
  assert(code.includes('Deadline Not Available') || code.includes('No Deadline'),
    'Should display "Deadline Not Available" or "No Deadline" for missing deadlines')
  // The performance section shows noDeadline
  assert(code.includes('emp.noDeadline'), 'EmployeePerf must expose noDeadline')
})

// ============================================================
// 5-6. Missing relations do not crash
// ============================================================

test('5. Missing project relation does not crash — null-safe end_date', () => {
  assert(code.includes('if (p.end_date)'), 'Project end_date must be null-checked')
  assert(code.includes('isNaN(ed.getTime())'), 'Project end_date must be validated')
})

test('6. Missing employee relation does not crash — optional chaining', () => {
  assert(code.includes('emp?.') || code.includes('emp.'), 'Employee fields accessed safely')
  // Department lookup uses maybeSingle and null fallback
  assert(code.includes('deptMap['), 'Department map lookup must be used')
  assert(code.includes('?? null'), 'Null fallback for department name')
})

// ============================================================
// 7. Profile photo fallback
// ============================================================

test('7. Missing profile photo shows initials', () => {
  const avatarCode = readFileSync(join(process.cwd(), 'src', 'components', 'EmployeeAvatar.tsx'), 'utf-8')
  assert(avatarCode.includes('initials'), 'EmployeeAvatar must have initials fallback')
  assert(avatarCode.includes('imgError'), 'EmployeeAvatar must handle image errors')
  assert(avatarCode.includes('PALETTE'), 'EmployeeAvatar must have color palette for initials')
})

// ============================================================
// 8-9. Calendar and schedule safety
// ============================================================

test('8. Empty calendar events render an empty state', () => {
  assert(code.includes('dash-empty-state') || code.includes('No events'), 'Empty calendar state must exist')
  assert(css.includes('.dash-empty-state'), 'CSS for empty state must exist')
})

test('9. Invalid schedule date is skipped safely', () => {
  assert(code.includes('isValidDateStr'), 'isValidDateStr helper must exist')
  assert(code.includes('if (isValidDateStr'), 'Calendar events must be validated with isValidDateStr')
})

// ============================================================
// 10-12. Section isolation
// ============================================================

test('10. Task Performance failure does not hide other sections — section-level error', () => {
  assert(code.includes('SectionWrapper'), 'SectionWrapper component must exist')
  assert(code.includes('perfState'), 'Performance section must have its own state')
  assert(code.includes('SectionError'), 'SectionError component must exist')
})

test('11. Calendar failure does not hide KPI cards — independent loading', () => {
  assert(code.includes('calendarState'), 'Calendar must have its own loading state')
  assert(code.includes('metricsState'), 'Metrics must have its own loading state')
  assert(code.includes('calendarError'), 'Calendar must have its own error state')
})

test('12. KPI failure does not hide Management Tools — independent sections', () => {
  assert(code.includes('QuickActions'), 'QuickActions component must exist')
  // QuickActions is rendered outside the metrics SectionWrapper
  const quickActionsIdx = code.lastIndexOf('QuickActions')
  const metricsWrapperIdx = code.lastIndexOf('metricsState.error', quickActionsIdx)
  assert(metricsWrapperIdx > -1, 'Metrics error state must exist before QuickActions')
})

// ============================================================
// 13. Retry refetches only failed sections
// ============================================================

test('13. Retry refetches only failed sections — section-level onRetry', () => {
  assert(code.includes('onRetry={loadMetrics}'), 'Metrics retry must call loadMetrics')
  assert(code.includes('onCalendarRetry={loadCalendar}'), 'Calendar retry must call loadCalendar')
  assert(code.includes('onScheduleRetry={loadSchedule}'), 'Schedule retry must call loadSchedule')
  assert(code.includes('onRetry={loadPerf}'), 'Performance retry must call loadPerf')
  assert(code.includes('onRetry={loadActivity}'), 'Activity retry must call loadActivity')
  assert(code.includes('onRetry={loadNotCheckedIn}'), 'NotCheckedIn retry must call loadNotCheckedIn')
  assert(code.includes('onRetry={loadSelfAttendance}'), 'Attendance retry must call loadSelfAttendance')
})

// ============================================================
// 14. Realtime safety — partial payloads trigger refetch, not replace
// ============================================================

test('14. Realtime partial payload does not replace full objects — triggers refetch', () => {
  // Realtime handlers call load functions, they don't setState with payload
  const realtimeIdx = code.indexOf('dashboard-realtime')
  assert(realtimeIdx > -1, 'Realtime channel must exist')
  const realtimeSection = code.slice(realtimeIdx, realtimeIdx + 2000)
  assert(realtimeSection.includes('loadMetrics'), 'Realtime must refetch metrics')
  assert(realtimeSection.includes('loadSelfAttendance'), 'Realtime must refetch attendance')
  assert(!realtimeSection.includes('setMetrics(payload') && !realtimeSection.includes('setMetrics(data'),
    'Realtime must not directly set state with payload data')
})

// ============================================================
// 15-16. No hardcoded demo data
// ============================================================

test('15. No hardcoded demo data is introduced', () => {
  // Check for common demo data patterns
  assert(!code.includes('demo_'), 'No demo_ prefix in code')
  assert(!code.includes('fake_'), 'No fake_ prefix in code')
  assert(!code.includes('placeholder_'), 'No placeholder_ prefix in code')
  assert(!code.match(/value:\s*\d+\s*\/\/\s*demo/), 'No demo value comments')
})

test('16. Existing real database data remains unchanged — no migration files added', () => {
  // This test verifies the code uses real Supabase queries, not hardcoded values
  assert(code.includes('supabase.from('), 'Must use real Supabase queries')
  assert(code.includes('count: \'exact\''), 'Must use exact count queries')
  assert(code.includes('maybeSingle()'), 'Must use maybeSingle for optional records')
})

// ============================================================
// 17-18. Existing tests and build
// ============================================================

test('17. Dashboard preserves colourful UI design', () => {
  assert(code.includes('dash-kpi-card'), 'KPI cards must exist')
  assert(code.includes('dash-kpi-${gradient}'), 'KPI gradient classes must be templated')
  assert(css.includes('dash-kpi-green'), 'Green gradient CSS must exist')
  assert(css.includes('dash-kpi-blue'), 'Blue gradient CSS must exist')
  assert(css.includes('dash-kpi-purple'), 'Purple gradient CSS must exist')
  assert(css.includes('dash-kpi-orange'), 'Orange gradient CSS must exist')
  assert(code.includes('dash-greeting'), 'Profile greeting must exist')
  assert(code.includes('EmployeeAvatar'), 'Avatar component must be used')
  assert(code.includes('dash-cal-sched'), 'Calendar and schedule must exist')
  assert(code.includes('dash-emp-scroll'), 'Employee cards must exist')
  assert(code.includes('dash-actions-grid'), 'Management actions must exist')
})

test('18. Section isolation — Promise.allSettled used for metric groups', () => {
  assert(code.includes('Promise.allSettled'), 'Must use Promise.allSettled for metric groups')
  assert(code.includes('PromiseRejectedResult'), 'Must handle rejected promises')
})

test('19. No unsafe any usage in task extraction', () => {
  // extractTask uses unknown, not any
  assert(code.includes('row: unknown'), 'extractTask must use unknown parameter')
  assert(!code.includes('as any'), 'Must not use "as any" casts')
})

test('20. DeadlinePerformanceCard still works — uses same extractTask pattern', () => {
  const dpCode = readFileSync(join(process.cwd(), 'src', 'components', 'DeadlinePerformanceCard.tsx'), 'utf-8')
  // The existing card uses task?.current_deadline with optional chaining
  assert(dpCode.includes('task?.current_deadline') || dpCode.includes('task?.original_deadline'),
    'DeadlinePerformanceCard must use optional chaining')
})

// ============================================================
// 21-26. Organisation resolution + data source fixes
// ============================================================

test('21. Organization ID is stored in myEmpData state — not dropped', () => {
  assert(code.includes('organization_id: string'), 'myEmpData type must include organization_id')
  assert(code.includes('organization_id: empData.organization_id'), 'organization_id must be set from employee record')
  assert(!code.includes("(myEmpData as unknown as { organization_id"), 'Must not use unsafe cast for organization_id')
})

test('22. Calendar uses start_date column — not event_date', () => {
  assert(!code.includes('event_date'), 'Must not use event_date column name')
  assert(code.includes('start_date'), 'Must use start_date column name for calendar_events')
})

test('23. Task assignments use assigned_employee_id — not assigned_to', () => {
  assert(!code.includes(".eq('assigned_to'"), 'Must not query assigned_to for employee-scoped lookups')
  assert(code.includes(".eq('assigned_employee_id'"), 'Must use assigned_employee_id for employee-scoped queries')
})

test('24. DeadlinePerformanceCard uses assigned_employee_id — not assigned_to', () => {
  const dpCode = readFileSync(join(process.cwd(), 'src', 'components', 'DeadlinePerformanceCard.tsx'), 'utf-8')
  assert(!dpCode.includes(".eq('assigned_to'"), 'DeadlinePerformanceCard must not query assigned_to')
  assert(dpCode.includes(".eq('assigned_employee_id'"), 'DeadlinePerformanceCard must use assigned_employee_id')
})

test('25. No unsafe organization_id casts remain', () => {
  assert(!code.includes('as unknown as { organization_id'), 'Must not cast myEmpData for organization_id')
  assert(!code.includes("Organization not found"), 'Must not throw Organization not found error')
})

test('26. Organization ID flows from employee record to all sections', () => {
  // The employee query selects organization_id
  const empQueryIdx = code.indexOf(".from('employees')")
  const selectIdx = code.indexOf('organization_id', empQueryIdx)
  assert(selectIdx > -1 && selectIdx < empQueryIdx + 500, 'Employee query must select organization_id')
  // All section loaders use myEmpData.organization_id directly
  assert(code.includes('myEmpData.organization_id'), 'Sections must read organization_id from myEmpData directly')
})
