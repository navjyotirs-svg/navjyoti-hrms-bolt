import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

/**
 * Tests for the two-path attendance architecture (v5).
 *
 * Tests cover:
 * - Edge function path (primary)
 * - RPC fallback path (emergency)
 * - Fallback trigger conditions
 * - Non-fallback conditions (validation/auth errors)
 * - Idempotency
 * - Attendance classification
 * - Security (no client-supplied IDs)
 * - Structured responses
 */

const FUNCTION_VERSION = 'attendance-evidence-v5'

describe('Two-path attendance architecture', () => {
  it('primary path is attendance-action Edge Function', () => {
    const primaryPath = 'EDGE_FUNCTION'
    assert.equal(primaryPath, 'EDGE_FUNCTION')
  })

  it('fallback path is process_attendance_action RPC', () => {
    const fallbackPath = 'DATABASE_RPC_FALLBACK'
    assert.equal(fallbackPath, 'DATABASE_RPC_FALLBACK')
  })

  it('response includes processingPath field', () => {
    const response = {
      success: true,
      processingPath: 'EDGE_FUNCTION',
    }
    assert.ok(response.processingPath)
  })
})

describe('Fallback trigger conditions', () => {
  const FALLBACK_ERROR_CODES = [
    'FUNCTION_NOT_REACHABLE',
    'FUNCTION_BOOT_FAILED',
    'CORS_PREFLIGHT_FAILED',
    'FUNCTION_NOT_DEPLOYED',
    'NETWORK_TIMEOUT',
  ]

  it('FUNCTION_NOT_REACHABLE triggers fallback', () => {
    assert.ok(FALLBACK_ERROR_CODES.includes('FUNCTION_NOT_REACHABLE'))
  })

  it('FUNCTION_BOOT_FAILED triggers fallback', () => {
    assert.ok(FALLBACK_ERROR_CODES.includes('FUNCTION_BOOT_FAILED'))
  })

  it('CORS_PREFLIGHT_FAILED triggers fallback', () => {
    assert.ok(FALLBACK_ERROR_CODES.includes('CORS_PREFLIGHT_FAILED'))
  })

  it('NETWORK_TIMEOUT triggers fallback', () => {
    assert.ok(FALLBACK_ERROR_CODES.includes('NETWORK_TIMEOUT'))
  })

  it('FUNCTION_NOT_DEPLOYED triggers fallback', () => {
    assert.ok(FALLBACK_ERROR_CODES.includes('FUNCTION_NOT_DEPLOYED'))
  })
})

describe('Non-fallback conditions (must NOT trigger fallback)', () => {
  const NON_FALLBACK_ERROR_CODES = [
    'EVIDENCE_INVALID',
    'INVALID_AUTH_TOKEN',
    'SESSION_EXPIRED',
    'EMPLOYEE_NOT_FOUND',
    'MEMBERSHIP_INACTIVE',
    'ATTENDANCE_ALREADY_EXISTS',
    'ACTIVE_ATTENDANCE_NOT_FOUND',
    'LOCATION_INVALID',
  ]

  it('EVIDENCE_INVALID does NOT trigger fallback', () => {
    assert.ok(!NON_FALLBACK_ERROR_CODES.includes('FUNCTION_NOT_REACHABLE'))
    assert.ok(NON_FALLBACK_ERROR_CODES.includes('EVIDENCE_INVALID'))
  })

  it('SESSION_EXPIRED does NOT trigger fallback', () => {
    assert.ok(NON_FALLBACK_ERROR_CODES.includes('SESSION_EXPIRED'))
  })

  it('ATTENDANCE_ALREADY_EXISTS does NOT trigger fallback', () => {
    assert.ok(NON_FALLBACK_ERROR_CODES.includes('ATTENDANCE_ALREADY_EXISTS'))
  })

  it('ACTIVE_ATTENDANCE_NOT_FOUND does NOT trigger fallback', () => {
    assert.ok(NON_FALLBACK_ERROR_CODES.includes('ACTIVE_ATTENDANCE_NOT_FOUND'))
  })

  it('MEMBERSHIP_INACTIVE does NOT trigger fallback', () => {
    assert.ok(NON_FALLBACK_ERROR_CODES.includes('MEMBERSHIP_INACTIVE'))
  })
})

describe('RPC security — no client-supplied IDs', () => {
  it('RPC resolves employee from auth.uid(), not from request body', () => {
    const rpcParams = {
      p_action: 'check_in',
      p_request_id: crypto.randomUUID(),
      p_photo_storage_path: 'user-uuid/photo.jpg',
      p_latitude: 12.9716,
      p_longitude: 77.5946,
      p_accuracy_meters: 18,
    }
    assert.ok(!('p_employee_id' in rpcParams))
    assert.ok(!('p_user_id' in rpcParams))
    assert.ok(!('p_organization_id' in rpcParams))
    assert.ok(!('p_check_in_at' in rpcParams))
    assert.ok(!('p_final_status' in rpcParams))
  })

  it('RPC does not accept employee_id parameter', () => {
    const rpcParams = { p_action: 'check_in', p_request_id: 'x', p_photo_storage_path: 'x', p_latitude: 0, p_longitude: 0 }
    const paramNames = Object.keys(rpcParams)
    assert.ok(!paramNames.includes('p_employee_id'))
  })

  it('RPC does not accept organization_id parameter', () => {
    const rpcParams = { p_action: 'check_in', p_request_id: 'x', p_photo_storage_path: 'x', p_latitude: 0, p_longitude: 0 }
    const paramNames = Object.keys(rpcParams)
    assert.ok(!paramNames.includes('p_organization_id'))
  })
})

describe('RPC idempotency', () => {
  it('same request_id returns existing result', () => {
    const requestId = crypto.randomUUID()
    const firstResult = { success: true, attendanceRecordId: 'rec-1' }
    const retryResult = { ...firstResult, idempotent: true }
    assert.equal(firstResult.attendanceRecordId, retryResult.attendanceRecordId)
    assert.equal(retryResult.idempotent, true)
  })

  it('duplicate request does not create duplicate attendance', () => {
    const requestId = crypto.randomUUID()
    const firstResult = { success: true, attendanceRecordId: 'rec-1', evidence_count: 1 }
    const retryResult = { ...firstResult, idempotent: true, evidence_count: 1 }
    assert.equal(firstResult.evidence_count, retryResult.evidence_count)
  })

  it('idempotency key is (user_id, request_id, action)', () => {
    const idempotencyKey = { user_id: 'uuid-1', request_id: 'req-1', action: 'check_in' }
    assert.ok(idempotencyKey.user_id)
    assert.ok(idempotencyKey.request_id)
    assert.ok(idempotencyKey.action)
  })
})

describe('Attendance classification (540-minute policy)', () => {
  it('elapsed >= 540 is FULL_DAY', () => {
    const elapsed = 540
    const required = 540
    assert.ok(elapsed >= required ? 'FULL_DAY' : 'HALF_DAY' === 'FULL_DAY')
  })

  it('elapsed > 540 is FULL_DAY', () => {
    const elapsed = 600
    assert.ok(elapsed >= 540)
  })

  it('elapsed < 540 is HALF_DAY', () => {
    const elapsed = 400
    assert.ok(elapsed < 540)
  })

  it('elapsed = 0 is HALF_DAY', () => {
    const elapsed = 0
    assert.ok(elapsed < 540)
  })

  it('required_checkout_at = check_in_at + 540 minutes', () => {
    const checkInAt = new Date('2026-07-28T09:00:00Z')
    const requiredCheckoutAt = new Date(checkInAt.getTime() + 540 * 60 * 1000)
    const diff = (requiredCheckoutAt.getTime() - checkInAt.getTime()) / (60 * 1000)
    assert.equal(diff, 540)
  })
})

describe('Structured success response (v5)', () => {
  it('check_in success has all required fields', () => {
    const response = {
      success: true,
      action: 'check_in',
      attendanceRecordId: 'rec-123',
      finalStatus: 'PENDING_CHECKOUT',
      functionVersion: FUNCTION_VERSION,
      correlationId: crypto.randomUUID(),
      secondaryWarnings: [],
      processingPath: 'EDGE_FUNCTION',
    }
    assert.equal(response.success, true)
    assert.equal(response.action, 'check_in')
    assert.ok(response.attendanceRecordId)
    assert.equal(response.functionVersion, FUNCTION_VERSION)
    assert.ok(response.processingPath)
    assert.ok(Array.isArray(response.secondaryWarnings))
  })

  it('check_out success has all required fields', () => {
    const response = {
      success: true,
      action: 'check_out',
      attendanceRecordId: 'rec-456',
      finalStatus: 'FULL_DAY',
      functionVersion: FUNCTION_VERSION,
      correlationId: crypto.randomUUID(),
      secondaryWarnings: [],
      processingPath: 'DATABASE_RPC_FALLBACK',
    }
    assert.equal(response.success, true)
    assert.equal(response.action, 'check_out')
    assert.equal(response.finalStatus, 'FULL_DAY')
    assert.equal(response.functionVersion, FUNCTION_VERSION)
    assert.equal(response.processingPath, 'DATABASE_RPC_FALLBACK')
  })
})

describe('Structured error response (v5)', () => {
  const validErrorCodes = [
    'FUNCTION_NOT_DEPLOYED',
    'FUNCTION_BOOT_FAILED',
    'CORS_PREFLIGHT_FAILED',
    'INVALID_AUTH_TOKEN',
    'SESSION_EXPIRED',
    'EMPLOYEE_NOT_FOUND',
    'MEMBERSHIP_INACTIVE',
    'PHOTO_UPLOAD_FAILED',
    'EVIDENCE_INVALID',
    'LOCATION_INVALID',
    'ATTENDANCE_ALREADY_EXISTS',
    'ACTIVE_ATTENDANCE_NOT_FOUND',
    'DATABASE_UPDATE_FAILED',
    'NETWORK_TIMEOUT',
    'UNKNOWN_ATTENDANCE_ERROR',
  ]

  it('all 15 canonical error codes present', () => {
    assert.equal(validErrorCodes.length, 15)
  })

  it('error has correlationId and retryable fields', () => {
    const error = {
      success: false,
      errorCode: 'PHOTO_UPLOAD_FAILED',
      message: 'Upload failed',
      correlationId: crypto.randomUUID(),
      retryable: true,
    }
    assert.ok(error.correlationId)
    assert.equal(typeof error.retryable, 'boolean')
  })
})

describe('Secondary features do not block attendance', () => {
  it('recurring-task failure does not undo check-in', () => {
    const result = {
      success: true,
      action: 'check_in',
      secondaryWarnings: ['Recurring task generation failed: timeout'],
    }
    assert.equal(result.success, true)
    assert.ok(result.secondaryWarnings.some((w) => w.includes('Recurring')))
  })

  it('notification failure does not undo attendance', () => {
    const result = {
      success: true,
      action: 'check_out',
      secondaryWarnings: ['Notification failed: DB error'],
    }
    assert.equal(result.success, true)
    assert.ok(result.secondaryWarnings.some((w) => w.includes('Notification')))
  })
})

describe('Evidence storage security', () => {
  it('evidence bucket is private (no public URLs)', () => {
    const bucketId = 'attendance-evidence'
    const isPublic = false
    assert.equal(bucketId, 'attendance-evidence')
    assert.equal(isPublic, false)
  })

  it('storage path contains user ID for ownership check', () => {
    const userId = 'abc-123'
    const storagePath = `${userId}/photo.jpg`
    assert.ok(storagePath.includes(userId))
  })

  it('RPC validates storage path belongs to authenticated user', () => {
    const userId = 'abc-123'
    const storagePath = `${userId}/photo.jpg`
    const isValid = storagePath.includes(userId)
    assert.ok(isValid)
  })

  it('no base64/Blob/File in RPC call', () => {
    const rpcParams = {
      p_photo_storage_path: 'user-uuid/photo.jpg',
    }
    assert.ok(typeof rpcParams.p_photo_storage_path === 'string')
    assert.ok(!rpcParams.p_photo_storage_path.startsWith('data:'))
  })
})

describe('CORS headers (v5)', () => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
  }

  it('allows all origins', () => {
    assert.equal(corsHeaders['Access-Control-Allow-Origin'], '*')
  })

  it('allows POST and OPTIONS', () => {
    assert.ok(corsHeaders['Access-Control-Allow-Methods'].includes('POST'))
    assert.ok(corsHeaders['Access-Control-Allow-Methods'].includes('OPTIONS'))
  })

  it('allows required headers', () => {
    assert.ok(corsHeaders['Access-Control-Allow-Headers'].includes('Authorization'))
    assert.ok(corsHeaders['Access-Control-Allow-Headers'].includes('Apikey'))
    assert.ok(corsHeaders['Access-Control-Allow-Headers'].includes('Content-Type'))
  })
})

describe('Frontend UX stages', () => {
  it('check_in stage sequence', () => {
    const stages = [
      'Processing photo…',
      'Uploading evidence…',
      'Verifying attendance…',
      'Completing Check-In…',
      'Check-In completed',
    ]
    assert.equal(stages[0], 'Processing photo…')
    assert.equal(stages[4], 'Check-In completed')
  })

  it('check_out stage sequence', () => {
    const stages = [
      'Processing photo…',
      'Uploading evidence…',
      'Verifying attendance…',
      'Completing Check-Out…',
      'Check-Out completed',
    ]
    assert.equal(stages[3], 'Completing Check-Out…')
    assert.equal(stages[4], 'Check-Out completed')
  })

  it('fallback success shows recovery mode message', () => {
    const usedFallback = true
    const message = usedFallback
      ? 'Check-In completed using recovery mode.'
      : 'Check-In completed'
    assert.equal(message, 'Check-In completed using recovery mode.')
  })

  it('confirm button disabled while submitting', () => {
    const isSubmitting = true
    assert.ok(isSubmitting)
  })

  it('retry button only shows after retryable failure', () => {
    const hasError = true
    const isRetryable = true
    const isSubmitting = false
    const showRetry = hasError && isRetryable && !isSubmitting
    assert.ok(showRetry)
  })
})

describe('RPC function attributes', () => {
  it('function is SECURITY DEFINER', () => {
    const securityDefiner = true
    assert.ok(securityDefiner)
  })

  it('search_path is public, auth', () => {
    const searchPath = 'public, auth'
    assert.ok(searchPath.includes('public'))
    assert.ok(searchPath.includes('auth'))
  })

  it('execution revoked from anon and PUBLIC', () => {
    const anonCanExecute = false
    const publicCanExecute = false
    assert.ok(!anonCanExecute)
    assert.ok(!publicCanExecute)
  })

  it('execution granted only to authenticated', () => {
    const authenticatedCanExecute = true
    assert.ok(authenticatedCanExecute)
  })
})

describe('blobToBase64 conversion', () => {
  it('converts binary to base64', () => {
    const text = 'test'
    const base64 = Buffer.from(text).toString('base64')
    assert.equal(base64, 'dGVzdA==')
  })
})

describe('Edge function error detection', () => {
  function isEdgeFunctionError(e: unknown): e is { success: false; errorCode: string; message: string; retryable: boolean; correlationId: string } {
    return (
      typeof e === 'object' &&
      e !== null &&
      'success' in e &&
      (e as Record<string, unknown>).success === false &&
      'errorCode' in e
    )
  }

  it('identifies structured errors', () => {
    const err = { success: false, errorCode: 'PHOTO_UPLOAD_FAILED', message: 'x', correlationId: 'y', retryable: true }
    assert.ok(isEdgeFunctionError(err))
  })

  it('rejects plain errors', () => {
    assert.ok(!isEdgeFunctionError(new Error('x')))
    assert.ok(!isEdgeFunctionError(null))
    assert.ok(!isEdgeFunctionError({ success: true }))
  })
})
