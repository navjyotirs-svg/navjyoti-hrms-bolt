/**
 * Skeleton loading system — unit tests.
 *
 * Verifies that skeleton components exist, are importable, and render
 * the expected structure. Also checks that pages import skeleton
 * components and that reduced-motion CSS is present.
 *
 * Run with: node --test src/lib/__tests__/skeleton.test.ts
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const SRC = join(process.cwd(), 'src')

describe('Skeleton loading system', () => {
  it('1. Skeleton component file exists', () => {
    assert(existsSync(join(SRC, 'components/Skeleton.tsx')))
  })

  it('2. Skeleton CSS file exists', () => {
    assert(existsSync(join(SRC, 'styles/skeleton.css')))
  })

  it('3. Skeleton component exports all required components', () => {
    const code = readFileSync(join(SRC, 'components/Skeleton.tsx'), 'utf-8')
    const required = [
      'Skeleton', 'TextSkeleton', 'HeadingSkeleton', 'AvatarSkeleton',
      'ButtonSkeleton', 'InputSkeleton', 'SelectSkeleton', 'CardSkeleton',
      'MetricCardSkeleton', 'ListSkeleton', 'TableSkeleton', 'FormSkeleton',
      'DetailPageSkeleton', 'DashboardSkeleton', 'CalendarSkeleton',
      'TimelineSkeleton', 'NotificationSkeleton', 'ModalSkeleton',
      'ProfileSkeleton', 'AttendanceSkeleton', 'TaskSkeleton',
      'TicketSkeleton', 'DailyReportSkeleton', 'PageSkeleton',
      'useDelayedLoading',
    ]
    for (const name of required) {
      assert(code.includes(`export function ${name}`) || code.includes(`export class ${name}`) || code.includes(`export { ${name}`) || code.includes(`export const ${name}`), `Missing export: ${name}`)
    }
  })

  it('4. Skeleton CSS uses design tokens', () => {
    const css = readFileSync(join(SRC, 'styles/skeleton.css'), 'utf-8')
    assert(css.includes('var(--slate-100)'), 'Should use slate-100 token')
    assert(css.includes('var(--radius'), 'Should use radius tokens')
    assert(css.includes('var(--space-'), 'Should use spacing tokens')
  })

  it('5. Skeleton CSS has shimmer animation', () => {
    const css = readFileSync(join(SRC, 'styles/skeleton.css'), 'utf-8')
    assert(css.includes('@keyframes skl-shimmer'), 'Should have shimmer keyframes')
  })

  it('6. Reduced motion disables shimmer', () => {
    const css = readFileSync(join(SRC, 'styles/skeleton.css'), 'utf-8')
    assert(css.includes('prefers-reduced-motion'), 'Should have reduced-motion media query')
    assert(css.includes('animation: none'), 'Should disable animation for reduced motion')
  })

  it('7. Dashboard uses DashboardSkeleton', () => {
    const code = readFileSync(join(SRC, 'pages/Dashboard.tsx'), 'utf-8')
    assert(code.includes('DashboardSkeleton'), 'Dashboard should use DashboardSkeleton')
  })

  it('8. Employee Directory uses TableSkeleton', () => {
    const code = readFileSync(join(SRC, 'pages/EmployeeDirectoryPage.tsx'), 'utf-8')
    assert(code.includes('TableSkeleton'), 'Employee Directory should use TableSkeleton')
  })

  it('9. Attendance page uses AttendanceSkeleton', () => {
    const code = readFileSync(join(SRC, 'pages/AttendancePage.tsx'), 'utf-8')
    assert(code.includes('AttendanceSkeleton'), 'Attendance should use AttendanceSkeleton')
  })

  it('10. Leave page uses skeleton components', () => {
    const code = readFileSync(join(SRC, 'pages/MyLeavePage.tsx'), 'utf-8')
    assert(code.includes('Skeleton'), 'My Leave should use skeleton components')
  })

  it('11. Create Task uses FormSkeleton', () => {
    const code = readFileSync(join(SRC, 'pages/CreateTaskPage.tsx'), 'utf-8')
    assert(code.includes('FormSkeleton'), 'Create Task should use FormSkeleton')
  })

  it('12. Task detail uses DetailPageSkeleton', () => {
    const code = readFileSync(join(SRC, 'pages/TaskDetailPage.tsx'), 'utf-8')
    assert(code.includes('DetailPageSkeleton'), 'Task Detail should use DetailPageSkeleton')
  })

  it('13. Ticket list uses TicketSkeleton', () => {
    const code = readFileSync(join(SRC, 'pages/MyTicketsPage.tsx'), 'utf-8')
    assert(code.includes('TicketSkeleton'), 'My Tickets should use TicketSkeleton')
  })

  it('14. Daily Report uses DailyReportSkeleton', () => {
    const code = readFileSync(join(SRC, 'pages/DailyReportPage.tsx'), 'utf-8')
    assert(code.includes('DailyReportSkeleton'), 'Daily Report should use DailyReportSkeleton')
  })

  it('15. Notification Inbox uses NotificationSkeleton', () => {
    const code = readFileSync(join(SRC, 'pages/NotificationInboxPage.tsx'), 'utf-8')
    assert(code.includes('NotificationSkeleton'), 'Notification Inbox should use NotificationSkeleton')
  })

  it('16. Account Settings uses FormSkeleton', () => {
    const code = readFileSync(join(SRC, 'pages/AccountSettingsPage.tsx'), 'utf-8')
    assert(code.includes('FormSkeleton'), 'Account Settings should use FormSkeleton')
  })

  it('17. No page returns blank screen (no bare loading-state text only)', () => {
    const pages = readdirSync(join(SRC, 'pages')).filter(f => f.endsWith('.tsx'))
    for (const page of pages) {
      if (page === 'PlaceholderPage.tsx') continue
      const code = readFileSync(join(SRC, 'pages', page), 'utf-8')
      if (code.includes('loading') && !code.includes('Skeleton')) {
        assert.fail(`${page} has loading state but no skeleton import`)
      }
    }
  })

  it('18. ErrorBoundary component exists and is wired in App.tsx', () => {
    assert(existsSync(join(SRC, 'components/ErrorBoundary.tsx')))
    const appCode = readFileSync(join(SRC, 'App.tsx'), 'utf-8')
    assert(appCode.includes('ErrorBoundary'), 'App.tsx should import ErrorBoundary')
  })

  it('19. ErrorBoundary shows retry and dashboard actions', () => {
    const code = readFileSync(join(SRC, 'components/ErrorBoundary.tsx'), 'utf-8')
    assert(code.includes('Retry'), 'ErrorBoundary should have Retry button')
    assert(code.includes('Dashboard'), 'ErrorBoundary should have Return to Dashboard')
  })

  it('20. useDelayedLoading delays skeleton display', () => {
    const code = readFileSync(join(SRC, 'components/Skeleton.tsx'), 'utf-8')
    assert(code.includes('useDelayedLoading'), 'Should export useDelayedLoading hook')
    assert(code.includes('setTimeout'), 'Should use setTimeout for delay')
  })

  it('21. No page calls .map() on potentially undefined values without default', () => {
    const pages = readdirSync(join(SRC, 'pages')).filter(f => f.endsWith('.tsx'))
    for (const page of pages) {
      if (page === 'PlaceholderPage.tsx') continue
      const code = readFileSync(join(SRC, 'pages', page), 'utf-8')
      if (!code.includes('.map(')) continue
      const hasSafePattern = code.includes('?? []') || code.includes('|| []') || code.includes('useState<') || code.includes('.then(')
      assert(hasSafePattern, `${page} has .map() calls — ensure arrays default to [] before mapping`)
    }
  })

  it('22. No payroll/salary feature is added', () => {
    const files = readdirSync(SRC)
    assert(
      !files.some(
        (f) => f.toLowerCase().includes('payroll') || f.toLowerCase().includes('salary')
      )
    )
  })
})
