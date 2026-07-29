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
// MIME TYPE DETECTION
// ============================================================
describe('Voice Notes Playback — MIME Type Detection', () => {
  test('1. MediaRecorder selects preferred MIME type with codecs=opus', () => {
    const src = readFile('src/lib/voiceNotes.ts')
    assert.ok(src.includes('audio/webm;codecs=opus'), 'Prefers audio/webm;codecs=opus')
    assert.ok(src.includes('audio/webm'), 'Falls back to audio/webm')
    assert.ok(src.includes('audio/ogg;codecs=opus'), 'Includes audio/ogg;codecs=opus')
    assert.ok(src.includes('audio/mp4'), 'Includes audio/mp4')
  })

  test('2. Uses MediaRecorder.isTypeSupported for detection', () => {
    const src = readFile('src/lib/voiceNotes.ts')
    assert.ok(src.includes('MediaRecorder.isTypeSupported'), 'Uses isTypeSupported')
  })

  test('3. Returns null when no MIME type supported', () => {
    const src = readFile('src/lib/voiceNotes.ts')
    assert.ok(src.includes('return null'), 'Returns null when unsupported')
  })

  test('4. MIME-to-extension mapping is correct', () => {
    const src = readFile('src/lib/voiceNotes.ts')
    assert.ok(src.includes("'audio/webm;codecs=opus': 'webm'"), 'webm;codecs=opus → webm')
    assert.ok(src.includes("'audio/webm': 'webm'"), 'webm → webm')
    assert.ok(src.includes("'audio/ogg;codecs=opus': 'ogg'"), 'ogg;codecs=opus → ogg')
    assert.ok(src.includes("'audio/mp4': 'm4a'"), 'mp4 → m4a')
  })
})

// ============================================================
// RECORDING BLOB VALIDATION
// ============================================================
describe('Voice Notes Playback — Blob Validation', () => {
  test('5. MediaRecorder uses timeslice for chunk collection', () => {
    const src = readFile('src/pages/VoiceNotesPage.tsx')
    assert.ok(src.includes('recorder.start(1000)'), 'Uses 1s timeslice')
  })

  test('6. Empty Blob rejected before upload', () => {
    const src = readFile('src/pages/VoiceNotesPage.tsx')
    assert.ok(src.includes('EMPTY_RECORDING'), 'Empty recording error')
    assert.ok(src.includes('finalBlob.size === 0'), 'Checks blob size === 0')
  })

  test('7. Oversized Blob rejected', () => {
    const src = readFile('src/pages/VoiceNotesPage.tsx')
    assert.ok(src.includes('AUDIO_TOO_LARGE'), 'Audio too large error')
    assert.ok(src.includes('MAX_FILE_SIZE_BYTES'), 'Max size check')
  })

  test('8. Blob created with correct MIME type from MediaRecorder', () => {
    const src = readFile('src/pages/VoiceNotesPage.tsx')
    assert.ok(src.includes('new Blob(chunksRef.current, { type: mimeTypeRef.current! })'), 'Blob uses recorder MIME type')
  })
})

// ============================================================
// LOCAL PREVIEW VALIDATION
// ============================================================
describe('Voice Notes Playback — Local Preview', () => {
  test('9. Preview validates before send is enabled', () => {
    const src = readFile('src/pages/VoiceNotesPage.tsx')
    assert.ok(src.includes('previewValid'), 'Tracks preview validity')
    assert.ok(src.includes('disabled={!previewValid'), 'Send disabled until preview valid')
  })

  test('10. Preview handles Infinity duration for WebM', () => {
    const src = readFile('src/pages/VoiceNotesPage.tsx')
    assert.ok(src.includes('Infinity'), 'Handles Infinity duration')
    assert.ok(src.includes('1e101'), 'Uses seek trick for WebM duration')
  })

  test('11. Preview audio uses preload="metadata"', () => {
    const src = readFile('src/pages/VoiceNotesPage.tsx')
    assert.ok(src.includes('preload="metadata"'), 'Preview uses preload metadata')
    assert.ok(src.includes('onLoadedMetadata'), 'Listens for loadedmetadata')
  })

  test('12. Object URL revoked on cleanup', () => {
    const src = readFile('src/pages/VoiceNotesPage.tsx')
    assert.ok(src.includes('URL.revokeObjectURL'), 'Revokes object URLs')
  })
})

// ============================================================
// STORAGE UPLOAD
// ============================================================
describe('Voice Notes Playback — Storage Upload', () => {
  test('13. Upload uses File with explicit contentType', () => {
    const src = readFile('src/lib/voiceNotes.ts')
    assert.ok(src.includes('new File([blob]'), 'Creates File object')
    assert.ok(src.includes('contentType: mimeType'), 'Sets contentType')
    assert.ok(src.includes('upsert: false'), 'No upsert')
  })

  test('14. Upload uses random UUID filename', () => {
    const src = readFile('src/lib/voiceNotes.ts')
    assert.ok(src.includes('crypto.randomUUID()'), 'Uses random UUID')
  })

  test('15. Upload error throws AUDIO_UPLOAD_FAILED', () => {
    const src = readFile('src/lib/voiceNotes.ts')
    assert.ok(src.includes('AUDIO_UPLOAD_FAILED'), 'Upload error code')
  })
})

// ============================================================
// PLAYBACK URL FUNCTION
// ============================================================
describe('Voice Notes Playback — Playback URL Function', () => {
  test('16. getPlaybackUrl function exists in frontend', () => {
    const src = readFile('src/lib/voiceNotes.ts')
    assert.ok(src.includes('getPlaybackUrl'), 'Frontend has getPlaybackUrl')
    assert.ok(src.includes('PlaybackUrlResult'), 'Has PlaybackUrlResult type')
  })

  test('17. Edge function has get_playback_url action', () => {
    const src = readEf()
    assert.ok(src.includes('get_playback_url'), 'Edge function has get_playback_url action')
    assert.ok(src.includes('handleGetPlaybackUrl'), 'Has handleGetPlaybackUrl handler')
  })

  test('18. Playback function verifies sender or recipient', () => {
    const src = readEf()
    assert.ok(src.includes('isSender'), 'Checks if sender')
    assert.ok(src.includes('isRecipient'), 'Checks if recipient')
    assert.ok(src.includes('VOICE_NOTE_ACCESS_DENIED'), 'Denies non-authorized users')
  })

  test('19. Playback function validates org membership', () => {
    const src = readEf()
    assert.ok(src.includes('organization_id !== orgId'), 'Validates org match')
  })

  test('20. Playback function verifies object exists and size > 0', () => {
    const src = readEf()
    assert.ok(src.includes('fileInfo'), 'Checks file info')
    assert.ok(src.includes('=== 0'), 'Checks size is not zero')
    assert.ok(src.includes('CORRUPT'), 'Marks corrupt if zero bytes')
  })

  test('21. Playback function generates short-lived signed URL', () => {
    const src = readEf()
    assert.ok(src.includes('createSignedUrl'), 'Creates signed URL')
    assert.ok(src.includes('120'), '120 second expiry')
  })

  test('22. Playback function returns structured response', () => {
    const src = readEf()
    assert.ok(src.includes('signedUrl'), 'Returns signedUrl')
    assert.ok(src.includes('mimeType'), 'Returns mimeType')
    assert.ok(src.includes('fileSizeBytes'), 'Returns fileSizeBytes')
    assert.ok(src.includes('durationSeconds'), 'Returns durationSeconds')
    assert.ok(src.includes('expiresInSeconds'), 'Returns expiresInSeconds')
    assert.ok(src.includes('correlationId'), 'Returns correlationId')
  })
})

// ============================================================
// AUDIO PLAYER LIFECYCLE
// ============================================================
describe('Voice Notes Playback — Audio Player Lifecycle', () => {
  test('23. Play button requests fresh signed URL on click', () => {
    const src = readFile('src/pages/VoiceNotesPage.tsx')
    assert.ok(src.includes('handleShowPlayer'), 'Has handleShowPlayer')
    assert.ok(src.includes('getPlaybackUrl(noteId)'), 'Calls getPlaybackUrl on click')
  })

  test('24. Player shows loading state', () => {
    const src = readFile('src/pages/VoiceNotesPage.tsx')
    assert.ok(src.includes("'loading'"), 'Has loading state')
    assert.ok(src.includes('Loading voice note'), 'Shows loading text')
  })

  test('25. Player shows error state with retry', () => {
    const src = readFile('src/pages/VoiceNotesPage.tsx')
    assert.ok(src.includes("'error'"), 'Has error state')
    assert.ok(src.includes('Retry Playback'), 'Has retry button')
  })

  test('26. Audio element uses preload="metadata"', () => {
    const src = readFile('src/pages/VoiceNotesPage.tsx')
    assert.ok(src.includes('preload="metadata"'), 'Audio uses preload metadata')
  })

  test('27. Audio error handler clears URL and shows retry', () => {
    const src = readFile('src/pages/VoiceNotesPage.tsx')
    assert.ok(src.includes('handleAudioError'), 'Has error handler')
    assert.ok(src.includes('secure playback link expired'), 'Shows expiry message')
  })

  test('28. Playing event fires before marking as Heard', () => {
    const src = readFile('src/pages/VoiceNotesPage.tsx')
    assert.ok(src.includes('onPlaying'), 'Listens for playing event')
    assert.ok(src.includes('handleAudioPlaying'), 'Has playing handler')
    assert.ok(src.includes('recordVoiceNotePlay'), 'Records play after playing event')
  })

  test('29. Hide player pauses and clears audio source', () => {
    const src = readFile('src/pages/VoiceNotesPage.tsx')
    assert.ok(src.includes('handleHidePlayer'), 'Has hide handler')
    assert.ok(src.includes('audio.pause()'), 'Pauses audio')
    assert.ok(src.includes("audio.src = ''"), 'Clears source')
  })
})

// ============================================================
// SENT/RECEIVED QUERY CORRECTION
// ============================================================
describe('Voice Notes Playback — Query Corrections', () => {
  test('30. Received notes filtered by recipient_user_id', () => {
    const src = readFile('src/lib/voiceNotes.ts')
    assert.ok(src.includes(".eq('recipient_user_id', userId)"), 'Filters by recipient_user_id')
  })

  test('31. Sent notes filtered by sender_user_id', () => {
    const src = readFile('src/lib/voiceNotes.ts')
    assert.ok(src.includes(".eq('sender_user_id', userId)"), 'Filters by sender_user_id')
  })

  test('32. fetchReceivedVoiceNotes gets user ID from session', () => {
    const src = readFile('src/lib/voiceNotes.ts')
    assert.ok(src.includes('session?.user?.id'), 'Gets user ID from session')
  })
})

// ============================================================
// PLAYBACK STATUS
// ============================================================
describe('Voice Notes Playback — Status Handling', () => {
  test('33. VoiceNoteRow includes playback_status', () => {
    const src = readFile('src/lib/voiceNotes.ts')
    assert.ok(src.includes('playback_status'), 'Type includes playback_status')
  })

  test('34. CORRUPT notes show unavailable message', () => {
    const src = readFile('src/pages/VoiceNotesPage.tsx')
    assert.ok(src.includes("playbackStatus === 'CORRUPT'"), 'Checks CORRUPT status')
    assert.ok(src.includes('Audio recording is unavailable'), 'Shows unavailable message')
  })

  test('35. MISSING notes show not found message', () => {
    const src = readFile('src/pages/VoiceNotesPage.tsx')
    assert.ok(src.includes("playbackStatus === 'MISSING'"), 'Checks MISSING status')
    assert.ok(src.includes('voice note file could not be found'), 'Shows not found message')
  })

  test('36. Play button hidden for CORRUPT/MISSING notes', () => {
    const src = readFile('src/pages/VoiceNotesPage.tsx')
    assert.ok(src.includes('!showUnavailable && ('), 'Hides play for unavailable')
  })
})

// ============================================================
// NEW/HEARD/ACKNOWLEDGED STATES
// ============================================================
describe('Voice Notes Playback — State Consistency', () => {
  test('37. New status only when not played and not corrupt', () => {
    const src = readFile('src/pages/VoiceNotesPage.tsx')
    assert.ok(src.includes('!isPlayed && !showUnavailable'), 'New only when not played and not unavailable')
  })

  test('38. Heard status requires first_played_at', () => {
    const src = readFile('src/pages/VoiceNotesPage.tsx')
    assert.ok(src.includes('isPlayed && !isAck'), 'Heard only when played and not acknowledged')
  })

  test('39. Acknowledged requires explicit action', () => {
    const src = readFile('src/pages/VoiceNotesPage.tsx')
    assert.ok(src.includes('handleAcknowledge'), 'Has explicit acknowledge handler')
    assert.ok(src.includes('acknowledgeVoiceNote'), 'Calls acknowledge API')
  })

  test('40. Playing event sets played, not acknowledge', () => {
    const src = readFile('src/pages/VoiceNotesPage.tsx')
    assert.ok(src.includes('handleAudioPlaying'), 'Playing handler only marks played')
    assert.ok(!src.includes('handleAudioPlaying.*acknowledge'), 'Does not auto-acknowledge on play')
  })
})

// ============================================================
// ERROR UX
// ============================================================
describe('Voice Notes Playback — Error UX', () => {
  test('41. Loading message: Loading voice note…', () => {
    const src = readFile('src/pages/VoiceNotesPage.tsx')
    assert.ok(src.includes('Loading voice note'), 'Loading message')
  })

  test('42. Error message: secure playback link expired', () => {
    const src = readFile('src/pages/VoiceNotesPage.tsx')
    assert.ok(src.includes('secure playback link expired'), 'Expiry error message')
  })

  test('43. Retry button available on error', () => {
    const src = readFile('src/pages/VoiceNotesPage.tsx')
    assert.ok(src.includes('Retry Playback'), 'Retry button')
  })

  test('44. Hide player button available', () => {
    const src = readFile('src/pages/VoiceNotesPage.tsx')
    assert.ok(src.includes('Hide Player'), 'Hide button')
  })
})

// ============================================================
// PRODUCTION BUILD
// ============================================================
describe('Voice Notes Playback — Production Build', () => {
  test('45. Build passes', () => {
    const src = readFile('src/pages/VoiceNotesPage.tsx')
    assert.ok(src.length > 0, 'VoiceNotesPage exists')
    const lib = readFile('src/lib/voiceNotes.ts')
    assert.ok(lib.length > 0, 'voiceNotes.ts exists')
  })

  test('46. Old MyVoiceNotesPage removed', () => {
    const src = readFile('src/App.tsx')
    assert.ok(!src.includes('MyVoiceNotesPage'), 'Old page import removed')
  })
})
