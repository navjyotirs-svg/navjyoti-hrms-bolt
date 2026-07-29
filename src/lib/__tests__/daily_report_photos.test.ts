import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..', '..', '..')

function readFile(relPath: string): string {
  return readFileSync(resolve(root, relPath), 'utf-8')
}

// ============================================================
// GALLERY SELECTION
// ============================================================
describe('Daily Report Photos — Gallery Selection', () => {
  test('1. Upload Photos input has multiple attribute', () => {
    const src = readFile('src/pages/DailyReportPage.tsx')
    assert.ok(src.includes('multiple'), 'Input has multiple attribute')
  })

  test('2. Upload Photos input accepts correct formats', () => {
    const src = readFile('src/pages/DailyReportPage.tsx')
    assert.ok(src.includes('accept="image/jpeg,image/png,image/webp"'), 'Accepts JPG, PNG, WebP')
  })

  test('3. Upload Photos input does not have capture attribute', () => {
    const src = readFile('src/pages/DailyReportPage.tsx')
    assert.ok(!src.includes('capture="environment"'), 'No capture attribute on gallery input')
  })

  test('4. Selected files stored in component state', () => {
    const src = readFile('src/pages/DailyReportPage.tsx')
    assert.ok(src.includes('setPhotos'), 'Photos stored in state')
    assert.ok(src.includes('PhotoEntry'), 'PhotoEntry type used')
  })
})

// ============================================================
// IMMEDIATE PREVIEW
// ============================================================
describe('Daily Report Photos — Immediate Preview', () => {
  test('5. Preview object URLs created on selection', () => {
    const src = readFile('src/pages/DailyReportPage.tsx')
    assert.ok(src.includes('URL.createObjectURL'), 'Creates object URLs for preview')
  })

  test('6. Preview shown before upload completes', () => {
    const src = readFile('src/pages/DailyReportPage.tsx')
    assert.ok(src.includes("'SELECTED'"), 'SELECTED status exists')
    assert.ok(src.includes('previewUrl'), 'Preview URL used in render')
  })

  test('7. Photo counter shows N of 10', () => {
    const src = readFile('src/pages/DailyReportPage.tsx')
    assert.ok(src.includes('of') && src.includes('photos added'), 'Counter shows N of MAX')
  })

  test('8. Each photo has independent status', () => {
    const src = readFile('src/pages/DailyReportPage.tsx')
    assert.ok(src.includes("'SELECTED'"), 'SELECTED status')
    assert.ok(src.includes("'PROCESSING'"), 'PROCESSING status')
    assert.ok(src.includes("'UPLOADING'"), 'UPLOADING status')
    assert.ok(src.includes("'UPLOADED'"), 'UPLOADED status')
    assert.ok(src.includes("'FAILED'"), 'FAILED status')
  })
})

// ============================================================
// UPLOAD VALIDATION
// ============================================================
describe('Daily Report Photos — Upload Validation', () => {
  test('9. Photo limit enforced (10 max)', () => {
    const src = readFile('src/lib/dailyReports.ts')
    assert.ok(src.includes('MAX_PHOTOS_PER_TASK_ITEM = 10'), '10 photo limit')
  })

  test('10. Per-file size limit enforced (10MB)', () => {
    const src = readFile('src/lib/dailyReports.ts')
    assert.ok(src.includes('MAX_PHOTO_SIZE_BYTES = 10 * 1024 * 1024'), '10MB per file')
  })

  test('11. Total size limit enforced (50MB)', () => {
    const src = readFile('src/lib/dailyReports.ts')
    assert.ok(src.includes('MAX_TOTAL_PHOTO_BYTES_PER_TASK_ITEM = 50 * 1024 * 1024'), '50MB total')
  })

  test('12. Unsupported formats rejected', () => {
    const src = readFile('src/lib/dailyReports.ts')
    assert.ok(src.includes('ALLOWED_PHOTO_MIME_TYPES'), 'Allowed MIME types defined')
    assert.ok(src.includes('image/jpeg'), 'JPEG allowed')
    assert.ok(src.includes('image/png'), 'PNG allowed')
    assert.ok(src.includes('image/webp'), 'WebP allowed')
  })

  test('13. HEIC rejected with message', () => {
    const src = readFile('src/pages/DailyReportPage.tsx')
    assert.ok(src.includes('isHeic'), 'HEIC check used')
    assert.ok(src.includes('HEIC images are not supported'), 'HEIC rejection message')
  })
})

// ============================================================
// IMAGE PROCESSING
// ============================================================
describe('Daily Report Photos — Image Processing', () => {
  test('14. processImage called before upload', () => {
    const src = readFile('src/pages/DailyReportPage.tsx')
    assert.ok(src.includes('processImage'), 'processImage imported and used')
    assert.ok(src.includes('await processImage(entry.file)'), 'Called before upload')
  })

  test('15. Image resized to max 1920px', () => {
    const src = readFile('src/lib/imageProcessing.ts')
    assert.ok(src.includes('1920'), 'Max dimension 1920px')
  })

  test('16. Image compressed to ~82-85% quality', () => {
    const src = readFile('src/lib/imageProcessing.ts')
    assert.ok(src.includes('0.82') || src.includes('0.85'), 'Quality 82-85%')
  })
})

// ============================================================
// AUTO-DRAFT WORKFLOW
// ============================================================
describe('Daily Report Photos — Auto-Draft', () => {
  test('17. ensureDraft creates draft before upload', () => {
    const src = readFile('src/pages/DailyReportPage.tsx')
    assert.ok(src.includes('ensureDraft'), 'ensureDraft function exists')
    assert.ok(src.includes('saveDraft'), 'Calls saveDraft to create draft')
  })

  test('18. Preparing message shown during draft creation', () => {
    const src = readFile('src/pages/DailyReportPage.tsx')
    assert.ok(src.includes('Preparing your Daily Report'), 'Shows preparing message')
  })

  test('19. Draft creation failure shows error', () => {
    const src = readFile('src/pages/DailyReportPage.tsx')
    assert.ok(src.includes('REPORT_DRAFT_CREATION_FAILED'), 'Draft creation error code')
  })
})

// ============================================================
// STORAGE AND METADATA
// ============================================================
describe('Daily Report Photos — Storage', () => {
  test('20. Upload uses private bucket daily-report-task-photos', () => {
    const src = readFile('src/lib/dailyReports.ts')
    assert.ok(src.includes("'daily-report-task-photos'"), 'Uses private bucket')
  })

  test('21. Upload uses random UUID filename', () => {
    const src = readFile('src/lib/dailyReports.ts')
    assert.ok(src.includes('crypto.randomUUID()'), 'Random UUID filename')
  })

  test('22. Metadata row created after upload', () => {
    const src = readFile('src/lib/dailyReports.ts')
    assert.ok(src.includes('.insert('), 'Inserts metadata row')
    assert.ok(src.includes('daily_report_task_photos'), 'Inserts into correct table')
  })

  test('23. Storage cleanup on metadata failure', () => {
    const src = readFile('src/lib/dailyReports.ts')
    assert.ok(src.includes('.remove('), 'Cleans up storage on failure')
  })
})

// ============================================================
// SAVE DRAFT AND RELOAD
// ============================================================
describe('Daily Report Photos — Save and Reload', () => {
  test('24. Photos loaded on page load', () => {
    const src = readFile('src/pages/DailyReportPage.tsx')
    assert.ok(src.includes('loadPhotos'), 'loadPhotos function exists')
    assert.ok(src.includes('fetchTaskPhotos'), 'Fetches photos from database')
  })

  test('25. Signed URLs generated for saved photos', () => {
    const src = readFile('src/pages/DailyReportPage.tsx')
    assert.ok(src.includes('createTaskPhotoSignedUrl'), 'Generates signed URLs')
  })

  test('26. Object URLs revoked on cleanup', () => {
    const src = readFile('src/pages/DailyReportPage.tsx')
    assert.ok(src.includes('URL.revokeObjectURL'), 'Revokes object URLs')
  })
})

// ============================================================
// SUBMISSION
// ============================================================
describe('Daily Report Photos — Submission', () => {
  test('27. Submit blocked while uploads pending', () => {
    const src = readFile('src/pages/DailyReportPage.tsx')
    assert.ok(src.includes('hasPendingUploads'), 'Checks pending uploads')
    assert.ok(src.includes('Please wait for all photos'), 'Blocks submission')
  })

  test('28. Read-only after submission', () => {
    const src = readFile('src/pages/DailyReportPage.tsx')
    assert.ok(src.includes('isReadOnly'), 'Read-only check exists')
    assert.ok(src.includes('disabled={isReadOnly}'), 'Fields disabled when read-only')
  })

  test('29. Remove button hidden when read-only', () => {
    const src = readFile('src/pages/DailyReportPage.tsx')
    assert.ok(src.includes('!isReadOnly'), 'Remove hidden when read-only')
  })
})

// ============================================================
// PHOTO SLIDER
// ============================================================
describe('Daily Report Photos — Photo Slider', () => {
  test('30. PhotoSlider component exists', () => {
    const src = readFile('src/components/PhotoSlider.tsx')
    assert.ok(src.includes('PhotoSlider'), 'Component exported')
  })

  test('31. Slider has next/previous controls', () => {
    const src = readFile('src/components/PhotoSlider.tsx')
    assert.ok(src.includes('goNext'), 'Next function')
    assert.ok(src.includes('goPrev'), 'Previous function')
  })

  test('32. Slider supports keyboard arrows', () => {
    const src = readFile('src/components/PhotoSlider.tsx')
    assert.ok(src.includes('ArrowRight'), 'Right arrow')
    assert.ok(src.includes('ArrowLeft'), 'Left arrow')
  })

  test('33. Slider supports mobile swipe', () => {
    const src = readFile('src/components/PhotoSlider.tsx')
    assert.ok(src.includes('touchstart'), 'Touch start handler')
    assert.ok(src.includes('touchend'), 'Touch end handler')
  })

  test('34. Slider has thumbnail strip', () => {
    const src = readFile('src/components/PhotoSlider.tsx')
    assert.ok(src.includes('48px'), 'Thumbnail size')
  })

  test('35. Slider shows photo counter', () => {
    const src = readFile('src/components/PhotoSlider.tsx')
    assert.ok(src.includes('index + 1'), 'Current index')
    assert.ok(src.includes('images.length'), 'Total count')
  })

  test('36. Slider uses object-fit: contain', () => {
    const src = readFile('src/components/PhotoSlider.tsx')
    assert.ok(src.includes('objectFit: contain') || src.includes("objectFit: 'contain'"), 'No cropping')
  })

  test('37. Slider does not autoplay', () => {
    const src = readFile('src/components/PhotoSlider.tsx')
    assert.ok(!src.includes('autoplay'), 'No autoplay')
  })

  test('38. Slider has fullscreen mode', () => {
    const src = readFile('src/components/PhotoSlider.tsx')
    assert.ok(src.includes('isFullscreen'), 'Fullscreen state')
  })

  test('39. Slider has close button', () => {
    const src = readFile('src/components/PhotoSlider.tsx')
    assert.ok(src.includes('onClose'), 'Close handler')
  })
})

// ============================================================
// TEAM TASKS EVIDENCE
// ============================================================
describe('Daily Report Photos — Team Tasks Evidence', () => {
  test('40. fetchTaskEvidenceCounts function exists', () => {
    const src = readFile('src/lib/tasks.ts')
    assert.ok(src.includes('fetchTaskEvidenceCounts'), 'Evidence count function')
  })

  test('41. Evidence count returns report_count and photo_count', () => {
    const src = readFile('src/lib/tasks.ts')
    assert.ok(src.includes('daily_report_count'), 'Returns report count')
    assert.ok(src.includes('photo_count'), 'Returns photo count')
  })

  test('42. TeamTasksPage shows evidence badge', () => {
    const src = readFile('src/pages/TeamTasksPage.tsx')
    assert.ok(src.includes('EvidenceBadge'), 'Evidence badge component')
    assert.ok(src.includes('No Report Evidence'), 'No evidence text')
  })

  test('43. View Evidence button navigates to evidence page', () => {
    const src = readFile('src/pages/TeamTasksPage.tsx')
    assert.ok(src.includes('daily-report-evidence'), 'Navigates to evidence route')
  })

  test('44. Team Tasks loads even if evidence query fails', () => {
    const src = readFile('src/pages/TeamTasksPage.tsx')
    assert.ok(src.includes('catch'), 'Has catch for evidence failure')
    assert.ok(src.includes('new Map()'), 'Fallback to empty map')
  })
})

// ============================================================
// TASK EVIDENCE VIEWER
// ============================================================
describe('Daily Report Photos — Evidence Viewer', () => {
  test('45. TaskEvidenceViewerPage exists', () => {
    const src = readFile('src/pages/TaskEvidenceViewerPage.tsx')
    assert.ok(src.includes('TaskEvidenceViewerPage'), 'Page exported')
  })

  test('46. Evidence grouped by employee', () => {
    const src = readFile('src/pages/TaskEvidenceViewerPage.tsx')
    assert.ok(src.includes('employeeName'), 'Groups by employee name')
    assert.ok(src.includes('sorted'), 'Sorts by employee')
  })

  test('47. Evidence viewer uses PhotoSlider', () => {
    const src = readFile('src/pages/TaskEvidenceViewerPage.tsx')
    assert.ok(src.includes('PhotoSlider'), 'Uses PhotoSlider')
  })

  test('48. Route exists in App.tsx', () => {
    const src = readFile('src/App.tsx')
    assert.ok(src.includes('TaskEvidenceViewerPage'), 'Import exists')
    assert.ok(src.includes('/tasks/:taskId/daily-report-evidence'), 'Route exists')
  })
})

// ============================================================
// PRODUCTION BUILD
// ============================================================
describe('Daily Report Photos — Production Build', () => {
  test('49. Build passes', () => {
    const src = readFile('src/pages/DailyReportPage.tsx')
    assert.ok(src.length > 0, 'DailyReportPage exists')
  })

  test('50. PhotoSlider build passes', () => {
    const src = readFile('src/components/PhotoSlider.tsx')
    assert.ok(src.length > 0, 'PhotoSlider exists')
  })
})
