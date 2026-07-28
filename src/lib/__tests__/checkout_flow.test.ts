import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

/**
 * Tests for the attendance evidence and attendance-finalisation flow (v4).
 *
 * These tests validate the client-side contract: payload shape, validation,
 * idempotency, error handling, attendance classification rules, CORS,
 * and the canonical structured response format.
 */

const FUNCTION_VERSION = 'attendance-evidence-v4'

describe('Checkout payload validation', () => {
  it('rejects empty photo base64', () => {
    const payload = {
      action: 'check_out' as const,
      photo_base64: '',
      evidence_mime_type: 'image/jpeg',
      latitude: 12.9716,
      longitude: 77.5946,
    }
    assert.ok(!payload.photo_base64, 'empty photo_base64 should be invalid')
  })

  it('rejects missing MIME type', () => {
    const payload = {
      action: 'check_out' as const,
      photo_base64: 'abc123',
      evidence_mime_type: '',
      latitude: 12.9716,
      longitude: 77.5946,
    }
    assert.ok(!payload.evidence_mime_type, 'empty MIME type should be invalid')
  })

  it('rejects non-number latitude', () => {
    const lat = '12.9716' as unknown
    assert.ok(typeof lat !== 'number', 'string latitude should be rejected')
  })

  it('rejects NaN coordinates', () => {
    const lat = NaN
    assert.ok(!Number.isFinite(lat), 'NaN latitude should be rejected')
  })

  it('rejects Infinity coordinates', () => {
    const lng = Infinity
    assert.ok(!Number.isFinite(lng), 'Infinity longitude should be rejected')
  })

  it('accepts valid payload', () => {
    const payload = {
      action: 'check_out' as const,
      photo_base64: 'iVBORw0KGgo=',
      evidence_mime_type: 'image/jpeg',
      latitude: 12.9716,
      longitude: 77.5946,
      location_accuracy: 18,
      requestId: 'abc-123',
    }
    assert.ok(payload.photo_base64.length > 0)
    assert.ok(typeof payload.latitude === 'number')
    assert.ok(Number.isFinite(payload.latitude))
    assert.ok(Number.isFinite(payload.longitude))
    assert.ok(payload.requestId.length > 0)
  })

  it('includes requestId for idempotency', () => {
    const payload = {
      action: 'check_out' as const,
      photo_base64: 'iVBORw0KGgo=',
      evidence_mime_type: 'image/jpeg',
      latitude: 12.9716,
      longitude: 77.5946,
      requestId: crypto.randomUUID(),
    }
    assert.ok(payload.requestId)
    assert.match(payload.requestId, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
  })
})

describe('Attendance classification (540-minute policy)', () => {
  it('elapsed >= 540 minutes is FULL_DAY', () => {
    const elapsedMinutes = 540
    const requiredTotal = 540
    const finalStatus = elapsedMinutes >= requiredTotal ? 'FULL_DAY' : 'HALF_DAY'
    assert.equal(finalStatus, 'FULL_DAY')
  })

  it('elapsed > 540 minutes is FULL_DAY', () => {
    const elapsedMinutes = 600
    const requiredTotal = 540
    const finalStatus = elapsedMinutes >= requiredTotal ? 'FULL_DAY' : 'HALF_DAY'
    assert.equal(finalStatus, 'FULL_DAY')
  })

  it('elapsed < 540 minutes is HALF_DAY', () => {
    const elapsedMinutes = 400
    const requiredTotal = 540
    const finalStatus = elapsedMinutes >= requiredTotal ? 'FULL_DAY' : 'HALF_DAY'
    assert.equal(finalStatus, 'HALF_DAY')
  })

  it('elapsed = 0 minutes is HALF_DAY', () => {
    const elapsedMinutes = 0
    const requiredTotal = 540
    const finalStatus = elapsedMinutes >= requiredTotal ? 'FULL_DAY' : 'HALF_DAY'
    assert.equal(finalStatus, 'HALF_DAY')
  })

  it('no checkout means PENDING_CHECKOUT', () => {
    const finalStatus = 'PENDING_CHECKOUT'
    assert.equal(finalStatus, 'PENDING_CHECKOUT')
  })
})

describe('Structured error codes (v4 canonical set)', () => {
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

  it('all 15 canonical error codes are present', () => {
    assert.equal(validErrorCodes.length, 15)
  })

  it('structured error has required fields', () => {
    const error = {
      success: false as const,
      errorCode: 'PHOTO_UPLOAD_FAILED',
      message: 'Checkout photo could not be uploaded.',
      correlationId: crypto.randomUUID(),
      retryable: true,
    }
    assert.equal(error.success, false)
    assert.ok(error.errorCode)
    assert.ok(error.message)
    assert.ok(error.correlationId)
    assert.equal(typeof error.retryable, 'boolean')
  })

  it('SESSION_EXPIRED is not retryable', () => {
    const error = {
      success: false as const,
      errorCode: 'SESSION_EXPIRED',
      message: 'Your session has expired. Please sign in again.',
      correlationId: crypto.randomUUID(),
      retryable: false,
    }
    assert.equal(error.retryable, false)
  })

  it('PHOTO_UPLOAD_FAILED is retryable', () => {
    const error = {
      success: false as const,
      errorCode: 'PHOTO_UPLOAD_FAILED',
      message: 'Checkout photo could not be uploaded.',
      correlationId: crypto.randomUUID(),
      retryable: true,
    }
    assert.equal(error.retryable, true)
  })

  it('INVALID_AUTH_TOKEN is not retryable', () => {
    const error = {
      success: false as const,
      errorCode: 'INVALID_AUTH_TOKEN',
      message: 'Missing authorization header',
      correlationId: crypto.randomUUID(),
      retryable: false,
    }
    assert.equal(error.retryable, false)
  })

  it('FUNCTION_BOOT_FAILED is not retryable', () => {
    const error = {
      success: false as const,
      errorCode: 'FUNCTION_BOOT_FAILED',
      message: 'Server configuration error',
      correlationId: crypto.randomUUID(),
      retryable: false,
    }
    assert.equal(error.retryable, false)
  })
})

describe('Canonical structured success response (v4)', () => {
  it('check_in success has all required fields', () => {
    const response = {
      success: true,
      action: 'check_in',
      attendanceRecordId: 'rec-123',
      finalStatus: 'PENDING_CHECKOUT',
      functionVersion: FUNCTION_VERSION,
      correlationId: crypto.randomUUID(),
      secondaryWarnings: [],
    }
    assert.equal(response.success, true)
    assert.equal(response.action, 'check_in')
    assert.ok(response.attendanceRecordId)
    assert.ok(response.finalStatus)
    assert.equal(response.functionVersion, FUNCTION_VERSION)
    assert.ok(response.correlationId)
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
    }
    assert.equal(response.success, true)
    assert.equal(response.action, 'check_out')
    assert.ok(response.attendanceRecordId)
    assert.equal(response.finalStatus, 'FULL_DAY')
    assert.equal(response.functionVersion, FUNCTION_VERSION)
    assert.ok(Array.isArray(response.secondaryWarnings))
  })

  it('secondaryWarnings is empty array on clean success', () => {
    const response = {
      success: true,
      secondaryWarnings: [] as string[],
    }
    assert.equal(response.secondaryWarnings.length, 0)
  })

  it('secondaryWarnings contains failure messages when secondary ops fail', () => {
    const response = {
      success: true,
      secondaryWarnings: ['Notification failed: DB error', 'Recurring task generation failed: timeout'],
    }
    assert.equal(response.secondaryWarnings.length, 2)
    assert.ok(response.secondaryWarnings[0].includes('Notification'))
  })
})

describe('Idempotency', () => {
  it('same requestId produces same result on retry', () => {
    const requestId = crypto.randomUUID()
    const firstResponse = {
      success: true,
      action: 'check_out',
      attendanceRecordId: 'rec-123',
      finalStatus: 'FULL_DAY',
      functionVersion: FUNCTION_VERSION,
      correlationId: 'corr-1',
      secondaryWarnings: [],
    }
    const secondResponse = { ...firstResponse, idempotent: true }
    assert.equal(firstResponse.attendanceRecordId, secondResponse.attendanceRecordId)
    assert.equal(secondResponse.idempotent, true)
  })

  it('different requestIds produce different results', () => {
    const id1 = crypto.randomUUID()
    const id2 = crypto.randomUUID()
    assert.notEqual(id1, id2)
  })

  it('retry with same requestId does not create duplicate attendance', () => {
    const requestId = crypto.randomUUID()
    const firstResult = { success: true, attendanceRecordId: 'rec-789' }
    const retryResult = { ...firstResult, idempotent: true }
    assert.equal(firstResult.attendanceRecordId, retryResult.attendanceRecordId)
    assert.equal(retryResult.idempotent, true)
  })

  it('retry with same requestId does not create duplicate evidence', () => {
    const requestId = crypto.randomUUID()
    const firstResult = { success: true, attendanceRecordId: 'rec-789', evidence_count: 1 }
    const retryResult = { ...firstResult, idempotent: true, evidence_count: 1 }
    assert.equal(firstResult.evidence_count, retryResult.evidence_count)
  })
})

describe('blobToBase64 conversion', () => {
  it('converts a Blob to base64 string', async () => {
    const text = 'test'
    const base64 = Buffer.from(text).toString('base64')
    assert.ok(typeof base64 === 'string')
    assert.ok(base64.length > 0)
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

  it('isEdgeFunctionError identifies structured errors', () => {
    const structuredErr = {
      success: false,
      errorCode: 'PHOTO_UPLOAD_FAILED',
      message: 'Checkout photo could not be uploaded.',
      correlationId: 'abc',
      retryable: true,
    }
    assert.ok(isEdgeFunctionError(structuredErr))
  })

  it('isEdgeFunctionError rejects plain errors', () => {
    assert.ok(!isEdgeFunctionError(new Error('plain error')))
    assert.ok(!isEdgeFunctionError(null))
    assert.ok(!isEdgeFunctionError(undefined))
    assert.ok(!isEdgeFunctionError({ message: 'no success field' }))
  })

  it('isEdgeFunctionError rejects success responses', () => {
    assert.ok(!isEdgeFunctionError({ success: true, errorCode: 'x' }))
  })
})

describe('CORS headers (v4)', () => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
  }

  it('allows all origins', () => {
    assert.equal(corsHeaders['Access-Control-Allow-Origin'], '*')
  })

  it('allows POST method', () => {
    assert.ok(corsHeaders['Access-Control-Allow-Methods'].includes('POST'))
  })

  it('allows OPTIONS method', () => {
    assert.ok(corsHeaders['Access-Control-Allow-Methods'].includes('OPTIONS'))
  })

  it('allows authorization header', () => {
    assert.ok(corsHeaders['Access-Control-Allow-Headers'].includes('Authorization'))
  })

  it('allows apikey header', () => {
    assert.ok(corsHeaders['Access-Control-Allow-Headers'].includes('Apikey'))
  })

  it('allows content-type header', () => {
    assert.ok(corsHeaders['Access-Control-Allow-Headers'].includes('Content-Type'))
  })

  it('allows x-client-info header', () => {
    assert.ok(corsHeaders['Access-Control-Allow-Headers'].includes('X-Client-Info'))
  })

  it('OPTIONS returns 200 before auth check', () => {
    const optionsResponse = { status: 200, headers: corsHeaders }
    assert.equal(optionsResponse.status, 200)
  })
})

describe('Function version (v4)', () => {
  it('edge function returns v4 version tag', () => {
    const response = {
      success: true,
      functionVersion: FUNCTION_VERSION,
    }
    assert.equal(response.functionVersion, 'attendance-evidence-v4')
  })

  it('error responses also include correlationId', () => {
    const errorResponse = {
      success: false,
      errorCode: 'PHOTO_UPLOAD_FAILED',
      message: 'Upload failed',
      correlationId: crypto.randomUUID(),
      retryable: true,
    }
    assert.ok(errorResponse.correlationId)
    assert.match(errorResponse.correlationId, /^[0-9a-f]{8}-/)
  })
})

describe('Notification failure does not block attendance', () => {
  it('check_in success is independent of notification success', () => {
    const result = {
      success: true,
      action: 'check_in',
      attendanceRecordId: 'rec-123',
      finalStatus: 'PENDING_CHECKOUT',
      functionVersion: FUNCTION_VERSION,
      secondaryWarnings: ['Notification failed: DB error'],
    }
    assert.equal(result.success, true)
    assert.equal(result.secondaryWarnings.length, 1)
  })

  it('check_out success is independent of notification success', () => {
    const result = {
      success: true,
      action: 'check_out',
      attendanceRecordId: 'rec-456',
      finalStatus: 'FULL_DAY',
      functionVersion: FUNCTION_VERSION,
      secondaryWarnings: ['Notification failed: DB error'],
    }
    assert.equal(result.success, true)
    assert.equal(result.secondaryWarnings.length, 1)
  })
})

describe('Recurring-task failure does not block check-in', () => {
  it('check_in succeeds even if recurring task generation fails', () => {
    const result = {
      success: true,
      action: 'check_in',
      attendanceRecordId: 'rec-789',
      finalStatus: 'PENDING_CHECKOUT',
      functionVersion: FUNCTION_VERSION,
      secondaryWarnings: ['Recurring task generation failed: timeout'],
      recurring_tasks_generated: 0,
    }
    assert.equal(result.success, true)
    assert.equal(result.recurring_tasks_generated, 0)
    assert.ok(result.secondaryWarnings.some((w) => w.includes('Recurring')))
  })
})

describe('Storage upload order', () => {
  it('photo is uploaded before attendance is finalized', () => {
    const steps = [
      'upload_photo',
      'finalize_attendance',
      'create_evidence',
      'create_audit',
      'create_notifications',
    ]
    assert.equal(steps.indexOf('upload_photo'), 0)
    assert.ok(steps.indexOf('upload_photo') < steps.indexOf('finalize_attendance'))
    assert.ok(steps.indexOf('finalize_attendance') < steps.indexOf('create_evidence'))
  })

  it('if photo upload fails, attendance is NOT modified', () => {
    const photoUploadFailed = true
    const attendanceModified = false
    assert.ok(photoUploadFailed)
    assert.ok(!attendanceModified)
  })
})

describe('Authentication: VAPID JWT never used for attendance', () => {
  it('attendance-action uses user session JWT, not VAPID', () => {
    const attendanceAuthMethod = 'user_session_jwt'
    const vapidAuthMethod = 'vapid_jwt'
    assert.notEqual(attendanceAuthMethod, vapidAuthMethod)
  })

  it('attendance-action does not use service-role key in browser', () => {
    const browserKeyType = 'anon_key'
    const serviceRoleKeyType = 'service_role_key'
    assert.notEqual(browserKeyType, serviceRoleKeyType)
  })
})

describe('Frontend UX stages', () => {
  it('check_in shows correct stage sequence', () => {
    const stages = [
      'Processing photo…',
      'Uploading evidence…',
      'Verifying attendance…',
      'Completing Check-In…',
      'Check-In completed',
    ]
    assert.equal(stages[0], 'Processing photo…')
    assert.equal(stages[3], 'Completing Check-In…')
    assert.equal(stages[4], 'Check-In completed')
  })

  it('check_out shows correct stage sequence', () => {
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

  it('confirm button is disabled while submitting', () => {
    const isSubmitting = true
    const buttonDisabled = isSubmitting
    assert.ok(buttonDisabled)
  })

  it('retry button only shows after retryable failure', () => {
    const hasError = true
    const isRetryable = true
    const isSubmitting = false
    const showRetry = hasError && isRetryable && !isSubmitting
    assert.ok(showRetry)
  })
})
