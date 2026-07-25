import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

describe('Invitation and Activation JWT safety', () => {

  it('1. invite-employee edge function uses Bearer token from Authorization header, not VAPID', () => {
    const code = readFileSync(join(process.cwd(), 'supabase/functions/invite-employee/index.ts'), 'utf-8')
    assert(code.includes('Authorization'), 'Should read Authorization header')
    assert(code.includes("Bearer "), 'Should extract Bearer token')
    assert(code.includes('supabaseAccessToken'), 'Should name the token supabaseAccessToken')
    // Must NOT import or use web-push library in the invite function
    assert(!code.includes('web-push'), 'invite-employee must not import web-push')
    assert(!code.includes('webpush'), 'invite-employee must not import webpush')
    // Must NOT contain VAPID key references (secrets, headers, etc)
    assert(!code.includes('VAPID_PUBLIC_KEY'), 'invite-employee must not reference VAPID_PUBLIC_KEY')
    assert(!code.includes('VAPID_PRIVATE_KEY'), 'invite-employee must not reference VAPID_PRIVATE_KEY')
    assert(!code.includes('vapid t='), 'invite-employee must not contain VAPID Authorization format')
  })

  it('2. invite-employee resolves caller via supabase.auth.getUser()', () => {
    const code = readFileSync(join(process.cwd(), 'supabase/functions/invite-employee/index.ts'), 'utf-8')
    assert(code.includes('auth.getUser'), 'Should resolve caller via auth.getUser()')
  })

  it('3. invite-employee uses service-role admin client for invitation operations', () => {
    const code = readFileSync(join(process.cwd(), 'supabase/functions/invite-employee/index.ts'), 'utf-8')
    assert(code.includes('SUPABASE_SERVICE_ROLE_KEY'), 'Should use service role key for admin client')
    assert(code.includes('generateLink'), 'Should use generateLink for invitations')
  })

  it('4. invite-employee redirectTo uses /set-password', () => {
    const code = readFileSync(join(process.cwd(), 'supabase/functions/invite-employee/index.ts'), 'utf-8')
    assert(code.includes('/set-password'), 'Redirect URL should include /set-password')
  })

  it('5. invite-employee PROD_APP_URL is hrms.ngspl.com, not bolt.host', () => {
    const code = readFileSync(join(process.cwd(), 'supabase/functions/invite-employee/index.ts'), 'utf-8')
    assert(code.includes('https://hrms.ngspl.com'), 'Should use production domain')
    assert(!code.includes('bolt.host'), 'Should NOT reference bolt.host')
  })

  it('6. invite-employee resend creates fresh generateLink, not reuses old link', () => {
    const code = readFileSync(join(process.cwd(), 'supabase/functions/invite-employee/index.ts'), 'utf-8')
    assert(code.includes('resend_invitation'), 'Should handle resend_invitation action')
    assert(code.includes('generateLink'), 'Should generate a fresh link via generateLink')
  })

  it('7. invite-employee checks caller permissions for resend', () => {
    const code = readFileSync(join(process.cwd(), 'supabase/functions/invite-employee/index.ts'), 'utf-8')
    assert(code.includes('employee.create'), 'Should check employee.create permission')
  })

  it('8. invite-employee denies cross-organization resend', () => {
    const code = readFileSync(join(process.cwd(), 'supabase/functions/invite-employee/index.ts'), 'utf-8')
    assert(code.includes('Cross-organization'), 'Should deny cross-org access')
  })

  it('9. invite-employee activate_account does NOT require employee.create permission', () => {
    const code = readFileSync(join(process.cwd(), "supabase/functions/invite-employee/index.ts"), "utf-8")
    // The activate_account path should be reachable without employee.create
    assert(code.includes("activate_account"), 'Should handle activate_account action')
    // The permission check for employee.create should come AFTER the activate_account check
    const activateIdx = code.indexOf("activate_account")
    const permCheckIdx = code.indexOf("employee.create")
    assert(activateIdx > -1 && permCheckIdx > -1, 'Both sections should exist')
    assert(activateIdx < permCheckIdx, 'activate_account should be checked BEFORE employee.create permission')
  })

  it('10. invite-employee creates audit log for invite and resend', () => {
    const code = readFileSync(join(process.cwd(), 'supabase/functions/invite-employee/index.ts'), 'utf-8')
    assert(code.includes('audit_logs'), 'Should create audit logs')
    assert(code.includes('employee.invite'), 'Should log employee.invite action')
    assert(code.includes('employee.invite_resend'), 'Should log employee.invite_resend action')
  })

  it('11. SetPasswordPage detects otp_expired error code', () => {
    const code = readFileSync(join(process.cwd(), 'src/auth/SetPasswordPage.tsx'), 'utf-8')
    assert(code.includes('otp_expired'), 'Should detect otp_expired error code')
    assert(code.includes('expired'), 'Should have an expired state')
  })

  it('12. SetPasswordPage shows dedicated expired-link screen, not generic error', () => {
    const code = readFileSync(join(process.cwd(), 'src/auth/SetPasswordPage.tsx'), 'utf-8')
    assert(code.includes('Invitation Link Expired'), 'Should show dedicated expired-link screen')
    assert(code.includes('ask HR to send a new invitation'), 'Should instruct user to ask HR for new invitation')
  })

  it('13. SetPasswordPage refreshes session before activation call', () => {
    const code = readFileSync(join(process.cwd(), 'src/auth/SetPasswordPage.tsx'), 'utf-8')
    assert(code.includes('refreshSession'), 'Should refresh session before activation')
    assert(code.includes('activate_employee_account'), 'Should call atomic activation RPC')
  })

  it('14. SetPasswordPage calls RPC directly, not edge function for activation', () => {
    const code = readFileSync(join(process.cwd(), 'src/auth/SetPasswordPage.tsx'), 'utf-8')
    assert(code.includes('supabase.rpc'), 'Should use supabase.rpc() for activation')
    assert(!code.includes('invite-employee'), 'Should NOT call invite-employee edge function for activation')
  })

  it('15. EmployeeDirectoryPage handleResend refreshes session before API call', () => {
    const code = readFileSync(join(process.cwd(), 'src/pages/EmployeeDirectoryPage.tsx'), 'utf-8')
    const resendSection = code.substring(code.indexOf('async function handleResend'))
    assert(resendSection.includes('refreshSession'), 'Should refresh session before resend')
    assert(resendSection.includes('access_token'), 'Should use access_token from refreshed session')
  })

  it('16. EmployeeDirectoryPage handleRepairActivation refreshes session', () => {
    const code = readFileSync(join(process.cwd(), 'src/pages/EmployeeDirectoryPage.tsx'), 'utf-8')
    const repairSection = code.substring(code.indexOf('async function handleRepairActivation'))
    assert(repairSection.includes('refreshSession'), 'Should refresh session before repair')
  })

  it('17. AddEmployeePage refreshes session before invite call', () => {
    const code = readFileSync(join(process.cwd(), 'src/pages/AddEmployeePage.tsx'), 'utf-8')
    assert(code.includes('refreshSession'), 'Should refresh session before invite call')
    assert(code.includes('access_token'), 'Should use access_token from session')
  })

  it('18. No VAPID JWT variables in invitation or auth frontend files', () => {
    const files = [
      'src/auth/SetPasswordPage.tsx',
      'src/pages/EmployeeDirectoryPage.tsx',
      'src/pages/AddEmployeePage.tsx',
    ]
    for (const f of files) {
      const code = readFileSync(join(process.cwd(), f), 'utf-8')
      assert(!code.includes('vapidJwt'), `${f} should not reference vapidJwt`)
      assert(!code.includes('vapid_token'), `${f} should not reference vapid_token`)
      assert(!code.includes('VAPID_PRIVATE'), `${f} should not reference VAPID_PRIVATE`)
    }
  })

  it('19. webPush.ts does not set global Authorization headers', () => {
    const code = readFileSync(join(process.cwd(), 'src/lib/webPush.ts'), 'utf-8')
    // webPush should only set Authorization in its own fetch calls, not globally
    assert(!code.includes('defaultHeaders'), 'webPush should not set default headers globally')
    // VAPID Authorization (vapid t=...) is only in edge functions, not frontend
    assert(!code.includes('vapid t='), 'Frontend should not contain VAPID Authorization header format')
  })

  it('20. Service-role key is absent from all frontend source', () => {
    const frontendFiles = [
      'src/lib/supabase.ts',
      'src/lib/webPush.ts',
      'src/auth/SetPasswordPage.tsx',
      'src/pages/EmployeeDirectoryPage.tsx',
      'src/pages/AddEmployeePage.tsx',
    ]
    for (const f of frontendFiles) {
      if (!existsSync(join(process.cwd(), f))) continue
      const code = readFileSync(join(process.cwd(), f), 'utf-8')
      assert(!code.includes('SERVICE_ROLE'), `${f} should not reference SERVICE_ROLE`)
      assert(!code.includes('service_role'), `${f} should not reference service_role`)
    }
  })

  it('21. invite-employee uses callerClient for activate_account RPC (auth.uid())', () => {
    const code = readFileSync(join(process.cwd(), "supabase/functions/invite-employee/index.ts"), "utf-8")
    // The activate_account path should use callerClient.rpc, not admin.rpc
    const activateIdx = code.indexOf('body.action === "activate_account"')
    assert(activateIdx > -1, 'Should have activate_account action check')
    const activateSection = code.substring(activateIdx, activateIdx + 500)
    assert(activateSection.includes("callerClient.rpc"), 'Should use callerClient for activation RPC')
    assert(activateSection.includes("activate_employee_account"), 'Should call activate_employee_account RPC')
  })

  it('22. invite-employee resend rate-limits to 1 minute', () => {
    const code = readFileSync(join(process.cwd(), 'supabase/functions/invite-employee/index.ts'), 'utf-8')
    assert(code.includes('60000') || code.includes('60 * 1000'), 'Should rate-limit resends to 1 minute')
  })

  it('23. invite-employee returns correlationId in all responses', () => {
    const code = readFileSync(join(process.cwd(), 'supabase/functions/invite-employee/index.ts'), 'utf-8')
    assert(code.includes('correlationId'), 'Should include correlationId in responses')
  })
})
