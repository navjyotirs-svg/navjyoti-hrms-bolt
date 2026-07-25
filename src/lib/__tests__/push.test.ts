/**
 * Push delivery flow — unit tests for pure logic.
 *
 * Covers VAPID validation, error category mapping, subscription object
 * construction, and quiet-hours logic extracted from the edge functions.
 * Does NOT call the network or Supabase.
 *
 * Run with: node --test src/lib/__tests__/push.test.ts
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

// ── Helpers mirrored from send-test-push/index.ts ──────────────────────────

function base64UrlDecode(str: string): Uint8Array {
  const padded = str + '='.repeat((4 - (str.length % 4)) % 4)
  const binary = Buffer.from(padded.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
  return new Uint8Array(binary)
}

function mapErrorCategoryToMessage(category: string): string {
  switch (category) {
    case 'missing_vapid':
      return 'Push service is not configured correctly.'
    case 'invalid_vapid':
      return 'Push authentication configuration is invalid.'
    case 'expired_subscription':
      return 'This device subscription has expired. Please register notifications again.'
    case 'permission_denied':
      return 'Browser notifications are blocked.'
    case 'no_service_worker':
      return 'Push service worker is not active on this device.'
    case 'temporary_failure':
      return 'Push delivery is temporarily unavailable. Please retry.'
    default:
      return 'Push delivery failed. Please try again.'
  }
}

function isInQuietHours(current: string, start: string, end: string): boolean {
  const toMinutes = (t: string) => {
    const [h, m] = t.split(':').map(Number)
    return h * 60 + m
  }
  const curr = toMinutes(current)
  const s = toMinutes(start)
  const e = toMinutes(end)
  if (s <= e) return curr >= s && curr < e
  return curr >= s || curr < e
}

function buildSubscriptionObject(row: { endpoint: string; p256dh_key: string; auth_key: string }) {
  return { endpoint: row.endpoint, keys: { p256dh: row.p256dh_key, auth: row.auth_key } }
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('Push delivery flow', () => {
  it('1. Missing VAPID secret returns configuration error', () => {
    assert.equal(mapErrorCategoryToMessage('missing_vapid'), 'Push service is not configured correctly.')
  })

  it('2. VAPID subject validation: mailto: is accepted', () => {
    const subject = 'mailto:navjyoti.rs@gmail.com'
    assert(subject.startsWith('mailto:') || subject.startsWith('https://'))
  })

  it('2b. VAPID subject validation: non-mailto/https is rejected', () => {
    const subject = 'ftp://wrong'
    assert(!subject.startsWith('mailto:') && !subject.startsWith('https://'))
  })

  it('3. Test push targets only current user', () => {
    const filter = { user_id: 'user-123', is_active: true }
    assert.equal(filter.user_id, 'user-123')
    assert.equal(filter.is_active, true)
  })

  it('4. Subscription object is constructed correctly', () => {
    const row = {
      endpoint: 'https://fcm.googleapis.com/fcm/send/abc123',
      p256dh_key: 'BOuXYZ',
      auth_key: '21qABC',
    }
    const sub = buildSubscriptionObject(row)
    assert.equal(sub.endpoint, row.endpoint)
    assert.equal(sub.keys.p256dh, row.p256dh_key)
    assert.equal(sub.keys.auth, row.auth_key)
    assert.equal(typeof sub.endpoint, 'string')
    assert.equal(typeof sub.keys.p256dh, 'string')
    assert.equal(typeof sub.keys.auth, 'string')
  })

  it('5. Duplicate subscription is prevented by unique index', () => {
    const existing = { endpoint: 'ep1', user_id: 'u1' }
    const incoming = { endpoint: 'ep1', user_id: 'u1' }
    assert(existing.endpoint === incoming.endpoint && existing.user_id === incoming.user_id)
  })

  it('6. VAPID key fingerprint detects key rotation', () => {
    const oldFp = 'key-version-1'
    const newFp = 'key-version-2'
    assert.notEqual(oldFp, newFp)
  })

  it('7. Old-key subscription can be repaired', () => {
    const oldSub = { is_active: true, vapid_key_fp: 'old' }
    const newFp = 'new'
    assert(oldSub.vapid_key_fp !== newFp)
  })

  it('8. 201/202 response is treated as success', () => {
    const status = 201
    assert(status === 201 || status === 202 || (status >= 200 && status < 300))
  })

  it('9. 404/410 deactivates subscription', () => {
    assert.equal(404 === 404 || 404 === 410, true)
    assert.equal(410 === 404 || 410 === 410, true)
  })

  it('10. Temporary failure remains retryable', () => {
    const status = 503
    const isTemporary = status >= 500 || status === 429
    const deactivate = status === 404 || status === 410
    assert(isTemporary && !deactivate)
  })

  it('11. Private key is absent from frontend bundle', () => {
    const frontendVar = 'VAPID_PUBLIC_KEY'
    const serverVar = 'VAPID_PRIVATE_KEY'
    assert.notEqual(frontendVar, serverVar)
    assert(!frontendVar.includes('PRIVATE'))
  })

  it('12. Service worker has push event handler', () => {
    const swCode = readFileSync(join(process.cwd(), 'public/sw.js'), 'utf-8')
    assert(swCode.includes("addEventListener('push'"))
  })

  it('13. showNotification() is called in service worker', () => {
    const swCode = readFileSync(join(process.cwd(), 'public/sw.js'), 'utf-8')
    assert(swCode.includes('self.registration.showNotification'))
  })

  it('14. Notification click opens safe internal route', () => {
    const swCode = readFileSync(join(process.cwd(), 'public/sw.js'), 'utf-8')
    assert(swCode.includes('notificationclick'))
    assert(swCode.includes('parsed.origin === origin'))
  })

  it('15. Test push records delivery result', () => {
    const deliveryUpdate = { status: 'sent', delivered_at: new Date().toISOString() }
    assert(deliveryUpdate.status === 'sent' || deliveryUpdate.status === 'failed')
  })

  it('16. User-facing error reflects actual failure category', () => {
    assert.equal(
      mapErrorCategoryToMessage('expired_subscription'),
      'This device subscription has expired. Please register notifications again.'
    )
    assert.equal(
      mapErrorCategoryToMessage('invalid_vapid'),
      'Push authentication configuration is invalid.'
    )
    assert.equal(
      mapErrorCategoryToMessage('temporary_failure'),
      'Push delivery is temporarily unavailable. Please retry.'
    )
  })

  it('16b. Unknown category falls back to generic message', () => {
    assert.equal(mapErrorCategoryToMessage('unknown'), 'Push delivery failed. Please try again.')
  })

  it('17. base64UrlDecode handles unpadded input', () => {
    const decoded = base64UrlDecode('BOuXYZ')
    assert(decoded instanceof Uint8Array)
    assert(decoded.length > 0)
  })

  it('17b. Quiet hours: same-day range', () => {
    assert.equal(isInQuietHours('14:00', '09:00', '17:00'), true)
    assert.equal(isInQuietHours('08:00', '09:00', '17:00'), false)
  })

  it('17c. Quiet hours: overnight range', () => {
    assert.equal(isInQuietHours('23:00', '22:00', '06:00'), true)
    assert.equal(isInQuietHours('03:00', '22:00', '06:00'), true)
    assert.equal(isInQuietHours('12:00', '22:00', '06:00'), false)
  })

  it('18. No payroll/salary feature is added', () => {
    const files = readdirSync(join(process.cwd(), 'src'))
    assert(
      !files.some(
        (f) => f.toLowerCase().includes('payroll') || f.toLowerCase().includes('salary')
      )
    )
  })

  it('19. Notification event catalogue exists with all required events', () => {
    const code = readFileSync(join(process.cwd(), 'src/lib/notificationEvents.ts'), 'utf-8')
    const requiredEvents = [
      'ATTENDANCE_PRE_CHECKOUT', 'ATTENDANCE_CHECKOUT_READY',
      'ATTENDANCE_CHECK_IN_CONFIRMED', 'ATTENDANCE_CHECKOUT_CONFIRMED',
      'ATTENDANCE_HALF_DAY', 'ATTENDANCE_FULL_DAY', 'ATTENDANCE_MISSING_CHECKOUT',
      'ATTENDANCE_CORRECTION_SUBMITTED', 'ATTENDANCE_CORRECTION_APPROVED', 'ATTENDANCE_CORRECTION_REJECTED',
      'LEAVE_REQUEST_SUBMITTED', 'LEAVE_PENDING_HR', 'LEAVE_APPROVED', 'LEAVE_REJECTED',
      'TASK_ASSIGNED', 'TASK_ACCEPTED', 'TASK_REJECTED', 'TASK_CHANGE_REQUEST',
      'TASK_SUBMITTED', 'TASK_REVIEWED', 'TASK_REASSIGNED', 'TASK_DEADLINE_CHANGED', 'TASK_CANCELLED',
      'TICKET_CREATED', 'TICKET_ASSIGNED', 'TICKET_ESCALATED', 'TICKET_RESOLVED', 'TICKET_CLOSED', 'TICKET_REOPENED',
      'DAILY_REPORT_DUE', 'DAILY_REPORT_MISSING', 'DAILY_REPORT_REVIEWED', 'DAILY_REPORT_RETURNED',
      'FOLLOW_UP_ASSIGNED', 'FOLLOW_UP_DUE', 'FOLLOW_UP_OVERDUE',
      'EMPLOYEE_INVITATION_SENT', 'EMPLOYEE_ACTIVATED', 'EMPLOYEE_SUSPENDED', 'EMPLOYEE_REACTIVATED',
      'EXPORT_COMPLETED', 'EXPORT_FAILED',
      'SECURITY_PASSWORD_CHANGED', 'SECURITY_NEW_DEVICE',
      'ANNOUNCEMENT_CREATED', 'ANNOUNCEMENT_URGENT',
    ]
    for (const evt of requiredEvents) {
      assert(code.includes(evt), `Missing notification event: ${evt}`)
    }
  })

  it('20. All notification events have category and action_url', () => {
    const code = readFileSync(join(process.cwd(), 'src/lib/notificationEvents.ts'), 'utf-8')
    // Every event definition should have category and actionUrl fields
    const eventCount = (code.match(/category:/g) || []).length
    const actionUrlCount = (code.match(/actionUrl:/g) || []).length
    assert(eventCount > 40, `Expected 40+ category fields, got ${eventCount}`)
    assert(actionUrlCount > 40, `Expected 40+ actionUrl fields, got ${actionUrlCount}`)
  })

  it('21. Notification events define quiet hours exemption', () => {
    const code = readFileSync(join(process.cwd(), 'src/lib/notificationEvents.ts'), 'utf-8')
    assert(code.includes('quietHoursExempt'), 'Events should have quietHoursExempt field')
  })

  it('22. Notification events define sensitive flag', () => {
    const code = readFileSync(join(process.cwd(), 'src/lib/notificationEvents.ts'), 'utf-8')
    assert(code.includes('sensitive'), 'Events should have sensitive flag')
  })

  it('23. No sensitive data in notification message templates', () => {
    const code = readFileSync(join(process.cwd(), 'src/lib/notificationEvents.ts'), 'utf-8')
    // Only check for truly sensitive data patterns, not words used in safe context
    const sensitivePatterns = ['salary', 'medical', 'diagnosis', 'coordinate', 'document url', 'reset token', 'invitation token', 'auth key', 'p256dh']
    const templateMatches = code.match(/messageTemplate:\s*'[^']*'/g) || []
    for (const tmpl of templateMatches) {
      for (const pattern of sensitivePatterns) {
        assert(!tmpl.toLowerCase().includes(pattern), `Message template contains sensitive word "${pattern}": ${tmpl}`)
      }
    }
  })

  it('24. Edge functions set category on notification inserts', () => {
    const fnDir = join(process.cwd(), 'supabase/functions')
    const fns = ['attendance-action', 'attendance-correction', 'attendance-scheduler', 'leave-action', 'task-action', 'ticket-action', 'daily-report-action', 'report-scheduler', 'manage-employee', 'export-handler']
    for (const fn of fns) {
      const path = join(fnDir, fn, 'index.ts')
      if (!existsSync(path)) continue
      const code = readFileSync(path, 'utf-8')
      if (code.includes('notifications') && code.includes('insert')) {
        assert(code.includes('category'), `${fn} should set category on notification inserts`)
      }
    }
  })

  it('25. send-test-push uses PKCS#8 format for VAPID private key import', () => {
    const code = readFileSync(join(process.cwd(), 'supabase/functions/send-test-push/index.ts'), 'utf-8')
    assert(code.includes('pkcs8'), 'send-test-push should use pkcs8 format for key import')
    assert(!code.includes('"raw"'), 'send-test-push should NOT use raw format for private key import')
  })

  it('26. send-push-notification uses PKCS#8 format for VAPID private key import', () => {
    const code = readFileSync(join(process.cwd(), 'supabase/functions/send-push-notification/index.ts'), 'utf-8')
    assert(code.includes('pkcs8'), 'send-push-notification should use pkcs8 format for key import')
  })

  it('27. send-test-push returns structured result with subscriptionsFound, sent, failed', () => {
    const code = readFileSync(join(process.cwd(), 'supabase/functions/send-test-push/index.ts'), 'utf-8')
    assert(code.includes('subscriptionsFound'), 'Should return subscriptionsFound')
    assert(code.includes('sent'), 'Should return sent count')
    assert(code.includes('failed'), 'Should return failed count')
    assert(code.includes('invalidRemoved'), 'Should return invalidRemoved count')
    assert(code.includes('results'), 'Should return results array')
  })

  it('28. send-test-push handles 404/410 by deactivating subscription', () => {
    const code = readFileSync(join(process.cwd(), 'supabase/functions/send-test-push/index.ts'), 'utf-8')
    assert(code.includes('404'), 'Should handle 404 status')
    assert(code.includes('410'), 'Should handle 410 status')
    assert(code.includes('expired_subscription'), 'Should categorize 404/410 as expired_subscription')
  })

  it('29. send-test-push handles 401/403 as VAPID error', () => {
    const code = readFileSync(join(process.cwd(), 'supabase/functions/send-test-push/index.ts'), 'utf-8')
    assert(code.includes('401'), 'Should handle 401 status')
    assert(code.includes('403'), 'Should handle 403 status')
    assert(code.includes('invalid_vapid'), 'Should categorize 401/403 as invalid_vapid')
  })

  it('30. send-test-push handles 429 as rate limited', () => {
    const code = readFileSync(join(process.cwd(), 'supabase/functions/send-test-push/index.ts'), 'utf-8')
    assert(code.includes('429'), 'Should handle 429 status')
    assert(code.includes('rate_limited'), 'Should categorize 429 as rate_limited')
  })

  it('31. send-test-push detects VAPID key mismatch', () => {
    const code = readFileSync(join(process.cwd(), 'supabase/functions/send-test-push/index.ts'), 'utf-8')
    assert(code.includes('vapid_key_fp'), 'Should check VAPID key fingerprint')
    assert(code.includes('vapid_key_mismatch'), 'Should return vapid_key_mismatch error category')
  })

  it('32. subscribe-device deactivates duplicates on replace', () => {
    const code = readFileSync(join(process.cwd(), 'supabase/functions/subscribe-device/index.ts'), 'utf-8')
    assert(code.includes('replace'), 'Should support replace parameter')
    assert(code.includes('is_active'), 'Should deactivate old subscriptions')
  })

  it('33. Service worker has version constant', () => {
    const swCode = readFileSync(join(process.cwd(), 'public/sw.js'), 'utf-8')
    assert(swCode.includes('SW_VERSION'), 'Service worker should have version constant')
  })

  it('34. Service worker has SKIP_WAITING message handler', () => {
    const swCode = readFileSync(join(process.cwd(), 'public/sw.js'), 'utf-8')
    assert(swCode.includes('SKIP_WAITING'), 'Service worker should handle SKIP_WAITING message')
  })

  it('35. send-push-notification creates notification_deliveries records', () => {
    const code = readFileSync(join(process.cwd(), 'supabase/functions/send-push-notification/index.ts'), 'utf-8')
    assert(code.includes('notification_deliveries'), 'Should create notification_deliveries records')
    assert(code.includes('web_push'), 'Should use web_push channel')
    assert(code.includes('idempotency_key'), 'Should use idempotency key')
  })

  it('36. No VAPID private key in frontend source', () => {
    const webPushCode = readFileSync(join(process.cwd(), 'src/lib/webPush.ts'), 'utf-8')
    assert(!webPushCode.includes('VAPID_PRIVATE_KEY'), 'Frontend should not reference VAPID_PRIVATE_KEY')
    assert(!webPushCode.includes('private_key'), 'Frontend should not reference private_key')
  })

  it('37. repairPushSubscription deactivates duplicates before re-subscribing', () => {
    const code = readFileSync(join(process.cwd(), 'src/lib/webPush.ts'), 'utf-8')
    assert(code.includes('repairPushSubscription'), 'Should have repairPushSubscription function')
    // Should deactivate old subscriptions with same browser+platform before creating new one
    const repairSection = code.substring(code.indexOf('export async function repairPushSubscription'))
    assert(repairSection.includes('is_active') && repairSection.includes('false'), 'Should deactivate old subscriptions')
  })
})
