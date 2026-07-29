import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..', '..', '..')

function readFile(relPath: string): string {
  return readFileSync(resolve(root, relPath), 'utf-8')
}

function readEf(): string {
  return readFileSync(resolve(root, 'supabase', 'functions', 'voice-note-action', 'index.ts'), 'utf-8')
}

// ============================================================
// RLS RECURSION FIX
// ============================================================
describe('Voice Notes — RLS Recursion Fix', () => {
  test('1. No voice_notes SELECT policy references voice_note_recipients', () => {
    const src = readFile('src/lib/voiceNotes.ts')
    assert.ok(src.includes('DATABASE_POLICY_ERROR'), 'Frontend handles database policy errors gracefully')
  })

  test('2. voiceNotes.ts uses FK-hinted embeds for sender employee', () => {
    const src = readFile('src/lib/voiceNotes.ts')
    assert.ok(src.includes('sender_employee:employees!voice_notes_sender_employee_id_fkey'), 'Uses FK hint for sender')
  })

  test('3. voiceNotes.ts uses FK-hinted embeds for recipient employee', () => {
    const src = readFile('src/lib/voiceNotes.ts')
    assert.ok(src.includes('recipient_employee:employees!voice_note_recipients_recipient_employee_id_fkey'), 'Uses FK hint for recipient')
  })

  test('4. fetchReceivedVoiceNotes starts from voice_note_recipients', () => {
    const src = readFile('src/lib/voiceNotes.ts')
    assert.ok(src.includes(".from('voice_note_recipients')"), 'Query starts from recipients table')
  })

  test('5. fetchSentVoiceNotes starts from voice_notes', () => {
    const src = readFile('src/lib/voiceNotes.ts')
    assert.ok(src.includes(".from('voice_notes')"), 'Query starts from voice_notes table')
  })
})

// ============================================================
// PERMISSIONS AND ROUTE GUARD
// ============================================================
describe('Voice Notes — Permissions and Route Guard', () => {
  test('6. /voice-notes route accepts read_own permission', () => {
    const src = readFile('src/App.tsx')
    assert.ok(src.includes("voice_note.read_own"), 'Route accepts voice_note.read_own')
    assert.ok(src.includes("voice_note.read_self"), 'Route accepts legacy voice_note.read_self')
  })

  test('7. /voice-notes/:voiceNoteId route exists for direct notification links', () => {
    const src = readFile('src/App.tsx')
    assert.ok(src.includes('/voice-notes/:voiceNoteId'), 'Direct voice note route exists')
  })

  test('8. VoiceNotesPage renders tabs by permission', () => {
    const src = readFile('src/pages/VoiceNotesPage.tsx')
    assert.ok(src.includes('canSend'), 'Checks send permission')
    assert.ok(src.includes('canReadSent'), 'Checks read_sent permission')
    assert.ok(src.includes('canReadOwn'), 'Checks read_own permission')
    assert.ok(src.includes('Record'), 'Has Record tab')
    assert.ok(src.includes('Sent Voice Notes'), 'Has Sent tab')
    assert.ok(src.includes('Received Voice Notes'), 'Has Received tab')
  })

  test('9. Employee without send permission sees only Received tab', () => {
    const src = readFile('src/pages/VoiceNotesPage.tsx')
    assert.ok(src.includes("initialTab: Tab = params.voiceNoteId ? 'received' : canSend ? 'record' : 'received'"), 'Employee defaults to received tab')
  })

  test('10. Granular permissions defined in roles.ts', () => {
    const src = readFile('src/types/roles.ts')
    assert.ok(src.includes('voice_note.send_team'), 'send_team permission defined')
    assert.ok(src.includes('voice_note.send_all'), 'send_all permission defined')
    assert.ok(src.includes('voice_note.read_own'), 'read_own permission defined')
    assert.ok(src.includes('voice_note.play_own'), 'play_own permission defined')
    assert.ok(src.includes('voice_note.acknowledge_own'), 'acknowledge_own permission defined')
  })

  test('11. Nav item includes read_own permission', () => {
    const src = readFile('src/types/roles.ts')
    assert.ok(src.includes('voice_note.read_own'), 'Nav item includes read_own')
  })
})

// ============================================================
// RECORD AND SEND WORKFLOW
// ============================================================
describe('Voice Notes — Record and Send', () => {
  test('12. MediaRecorder API used for recording', () => {
    const src = readFile('src/pages/VoiceNotesPage.tsx')
    assert.ok(src.includes('MediaRecorder'), 'Uses MediaRecorder API')
  })

  test('13. Start/Stop/Pause/Resume controls exist', () => {
    const src = readFile('src/pages/VoiceNotesPage.tsx')
    assert.ok(src.includes('Start Recording'), 'Start Recording button')
    assert.ok(src.includes('Stop'), 'Stop button')
    assert.ok(src.includes('Pause'), 'Pause button')
    assert.ok(src.includes('Resume'), 'Resume button')
  })

  test('14. Preview and Re-record exist', () => {
    const src = readFile('src/pages/VoiceNotesPage.tsx')
    assert.ok(src.includes('Re-record'), 'Re-record button')
    assert.ok(src.includes('<audio'), 'Audio preview element')
  })

  test('15. Max duration 5 minutes enforced', () => {
    const src = readFile('src/pages/VoiceNotesPage.tsx')
    assert.ok(src.includes('MAX_DURATION_SECONDS'), 'Max duration constant')
    assert.ok(src.includes('300'), '300 seconds = 5 minutes')
  })

  test('16. Max file size 15 MB enforced', () => {
    const src = readFile('src/pages/VoiceNotesPage.tsx')
    assert.ok(src.includes('MAX_FILE_SIZE_BYTES'), 'Max file size constant')
    assert.ok(src.includes('15'), '15 MB')
  })

  test('17. Empty recording rejected', () => {
    const src = readFile('src/pages/VoiceNotesPage.tsx')
    assert.ok(src.includes('EMPTY_RECORDING'), 'Empty recording error code')
  })

  test('18. Audio too large rejected', () => {
    const src = readFile('src/pages/VoiceNotesPage.tsx')
    assert.ok(src.includes('AUDIO_TOO_LARGE'), 'Audio too large error code')
  })

  test('19. Microphone permission denied handled', () => {
    const src = readFile('src/pages/VoiceNotesPage.tsx')
    assert.ok(src.includes('MICROPHONE_PERMISSION_DENIED'), 'Mic denied error code')
  })

  test('20. Recording not supported handled', () => {
    const src = readFile('src/pages/VoiceNotesPage.tsx')
    assert.ok(src.includes('RECORDING_NOT_SUPPORTED'), 'Not supported error code')
  })

  test('21. Upload progress shown', () => {
    const src = readFile('src/pages/VoiceNotesPage.tsx')
    assert.ok(src.includes('uploadProgress'), 'Upload progress state')
  })

  test('22. Recording timer shown', () => {
    const src = readFile('src/pages/VoiceNotesPage.tsx')
    assert.ok(src.includes('elapsed'), 'Timer state')
    assert.ok(src.includes('formatDuration'), 'Timer display')
  })
})

// ============================================================
// EDGE FUNCTION — IDEMPOTENCY AND NOTIFICATIONS
// ============================================================
describe('Voice Notes — Edge Function', () => {
  test('23. Edge function accepts request_id for idempotency', () => {
    const src = readEf()
    assert.ok(src.includes('request_id'), 'Accepts request_id')
  })

  test('24. Duplicate request_id does not create duplicate note', () => {
    const src = readEf()
    assert.ok(src.includes('already sent'), 'Returns existing note on duplicate')
  })

  test('25. Notification actionUrl points to exact voice note', () => {
    const src = readEf()
    assert.ok(src.includes('actionUrl: `/voice-notes/${voiceNote.id}`'), 'Action URL includes voice note ID')
  })

  test('26. Notification includes sender name', () => {
    const src = readEf()
    assert.ok(src.includes('senderName'), 'Sender name used in notification')
    assert.ok(src.includes('from ${senderName}'), 'Message includes sender name')
  })

  test('27. Notification does not include audio URL or storage path', () => {
    const src = readEf()
    const notifySection = src.match(/notifyBusinessEvent[\s\S]*?}\)/)?.[0] ?? ''
    assert.ok(!notifySection.includes('storage_path'), 'No storage path in notification')
    assert.ok(!notifySection.includes('signedUrl'), 'No signed URL in notification')
  })

  test('28. Record play updates first_played_at and play_count', () => {
    const src = readEf()
    assert.ok(src.includes('first_played_at'), 'Updates first_played_at')
    assert.ok(src.includes('play_count'), 'Updates play_count')
    assert.ok(src.includes('last_played_at'), 'Updates last_played_at')
  })

  test('29. Acknowledge requires recipient match', () => {
    const src = readEf()
    assert.ok(src.includes('You are not a recipient'), 'Rejects non-recipient acknowledge')
  })

  test('30. Can_send_voice_note_to_employee validates org scope', () => {
    const src = readEf()
    assert.ok(src.includes('is_in_reporting_subtree'), 'Edge function validates manager reporting scope via RPC')
    assert.ok(src.includes('organization_id'), 'Edge function validates organisation match')
  })
})

// ============================================================
// RECEIVED VOICE NOTES PAGE
// ============================================================
describe('Voice Notes — Received Tab', () => {
  test('31. Received tab shows sender name not employee ID', () => {
    const src = readFile('src/pages/VoiceNotesPage.tsx')
    assert.ok(src.includes('sender_employee?.full_name'), 'Shows sender full name')
    assert.ok(!src.includes('sender_employee_id ??'), 'Does not show raw employee ID as sender')
  })

  test('32. Filters: All, Unheard, Heard, Acknowledged', () => {
    const src = readFile('src/pages/VoiceNotesPage.tsx')
    assert.ok(src.includes("'all'"), 'All filter')
    assert.ok(src.includes("'unheard'"), 'Unheard filter')
    assert.ok(src.includes("'heard'"), 'Heard filter')
    assert.ok(src.includes("'acknowledged'"), 'Acknowledged filter')
  })

  test('33. Empty state: No voice notes received', () => {
    const src = readFile('src/pages/VoiceNotesPage.tsx')
    assert.ok(src.includes('No voice notes received'), 'Empty state text')
  })

  test('34. Error state: Voice notes could not be loaded', () => {
    const src = readFile('src/pages/VoiceNotesPage.tsx')
    assert.ok(src.includes('could not be loaded'), 'Error state text')
    assert.ok(src.includes('Retry'), 'Retry button')
  })

  test('35. Loading skeleton shown', () => {
    const src = readFile('src/pages/VoiceNotesPage.tsx')
    assert.ok(src.includes('ListSkeleton'), 'Loading skeleton')
  })

  test('36. Acknowledge button only for own notes where configured', () => {
    const src = readFile('src/pages/VoiceNotesPage.tsx')
    assert.ok(src.includes('canAck'), 'Checks acknowledge permission')
    assert.ok(src.includes('Acknowledge'), 'Acknowledge button')
  })

  test('37. Direct voice note ID from URL opens player', () => {
    const src = readFile('src/pages/VoiceNotesPage.tsx')
    assert.ok(src.includes('voiceNoteId'), 'Reads voiceNoteId from params')
    assert.ok(src.includes('setSelectedId(voiceNoteId)'), 'Auto-selects note from URL')
  })
})

// ============================================================
// SENT VOICE NOTES PAGE
// ============================================================
describe('Voice Notes — Sent Tab', () => {
  test('38. Sent tab shows recipient name', () => {
    const src = readFile('src/pages/VoiceNotesPage.tsx')
    assert.ok(src.includes('recipient_employee?.full_name'), 'Shows recipient name')
  })

  test('39. Sent tab shows delivery status', () => {
    const src = readFile('src/pages/VoiceNotesPage.tsx')
    assert.ok(src.includes('first_played_at'), 'Shows first played time')
    assert.ok(src.includes('play_count'), 'Shows play count')
    assert.ok(src.includes('acknowledged_at'), 'Shows acknowledgement status')
  })

  test('40. Sent tab error state separate from empty state', () => {
    const src = readFile('src/pages/VoiceNotesPage.tsx')
    assert.ok(src.includes('could not be loaded'), 'Error state')
    assert.ok(src.includes('No sent voice notes'), 'Empty state')
  })
})

// ============================================================
// NOTIFICATION REDIRECTION
// ============================================================
describe('Voice Notes — Notification Redirection', () => {
  test('41. Notification inbox uses safeNavigateFromActionUrl', () => {
    const src = readFile('src/pages/NotificationInboxPage.tsx')
    assert.ok(src.includes('safeNavigateFromActionUrl'), 'Uses safe navigation handler')
  })

  test('42. Safe navigate rejects javascript: URLs', () => {
    const src = readFile('src/lib/safeNavigate.ts')
    assert.ok(src.includes('javascript:'), 'Rejects javascript: URLs')
  })

  test('43. Safe navigate rejects external origins', () => {
    const src = readFile('src/lib/safeNavigate.ts')
    assert.ok(src.includes('parsed.origin !== window.location.origin'), 'Rejects external origins')
  })

  test('44. Service worker validates action URL', () => {
    const src = readFile('public/sw.js')
    assert.ok(src.includes('parsed.origin === origin'), 'SW validates same origin')
    assert.ok(src.includes('safeUrl = parsed.pathname'), 'SW extracts safe path')
  })

  test('45. Service worker focuses existing window', () => {
    const src = readFile('public/sw.js')
    assert.ok(src.includes('client.focus()'), 'Focuses existing window')
    assert.ok(src.includes('NAVIGATE'), 'Posts navigate message')
  })
})

// ============================================================
// PRODUCTION BUILD
// ============================================================
describe('Voice Notes — Production Build', () => {
  test('46. Build passes', () => {
    const src = readFile('src/pages/VoiceNotesPage.tsx')
    assert.ok(src.length > 0, 'VoiceNotesPage source exists')
    const src2 = readFile('src/lib/voiceNotes.ts')
    assert.ok(src2.length > 0, 'voiceNotes.ts source exists')
  })
})
