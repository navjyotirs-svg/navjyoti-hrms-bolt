import { useEffect, useRef, useState } from 'react'
import {
  getKolkataDate, fetchMyReport, saveDraft, submitReport,
  fetchTaskPhotos, uploadTaskPhoto, deleteTaskPhoto,
  createTaskPhotoSignedUrl, validatePhotoFile,
  MAX_PHOTOS_PER_TASK_ITEM, MAX_TOTAL_PHOTO_BYTES_PER_TASK_ITEM,
  type DailyReportRow, type DailyReportTaskPhoto,
} from '@/lib/dailyReports'
import { DailyReportSkeleton } from '@/components/Skeleton'
import { useAuth } from '@/auth/AuthContext'
import { processImage, isHeic } from '@/lib/imageProcessing'
import { PhotoSlider } from '@/components/PhotoSlider'
import '@/styles/shared.css'

type PhotoStatus = 'SELECTED' | 'PROCESSING' | 'UPLOADING' | 'UPLOADED' | 'FAILED' | 'REMOVED'

interface PhotoEntry {
  id: string
  file: File | null
  previewUrl: string | null
  signedUrl: string | null
  photo: DailyReportTaskPhoto | null
  status: PhotoStatus
  progress: number
  error: string | null
  caption: string
  displayOrder: number
}

export function DailyReportPage() {
  const today = getKolkataDate()
  const { profile } = useAuth()
  const [reportDate, setReportDate] = useState(today)
  const [existing, setExisting] = useState<DailyReportRow | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const [photos, setPhotos] = useState<PhotoEntry[]>([])
  const [preparingDraft, setPreparingDraft] = useState(false)
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null)
  const galleryRef = useRef<HTMLInputElement>(null)

  const [form, setForm] = useState({
    overall_summary: '',
    work_completed: '',
    follow_up_required: false,
  })

  useEffect(() => { loadReport() }, [reportDate])

  async function loadReport() {
    setLoading(true); setError(null)
    try {
      const data = await fetchMyReport(reportDate)
      if (data) {
        setExisting(data as DailyReportRow)
        setForm({
          overall_summary: data.overall_summary || '',
          work_completed: data.work_completed || '',
          follow_up_required: data.follow_up_required || false,
        })
        await loadPhotos(data.id)
      } else {
        setExisting(null)
        setForm({ overall_summary: '', work_completed: '', follow_up_required: false })
        setPhotos([])
      }
    } catch (e) { setError((e as Error).message) }
    setLoading(false)
  }

  async function loadPhotos(reportId: string) {
    try {
      const list = await fetchTaskPhotos(reportId)
      const entries: PhotoEntry[] = await Promise.all(list.map(async (p, i) => {
        const signedUrl = await createTaskPhotoSignedUrl(p.storage_path).catch(() => null)
        return {
          id: p.id,
          file: null,
          previewUrl: null,
          signedUrl,
          photo: p,
          status: 'UPLOADED' as PhotoStatus,
          progress: 100,
          error: null,
          caption: p.caption || '',
          displayOrder: i,
        }
      }))
      setPhotos(entries)
    } catch { /* best-effort */ }
  }

  const isReadOnly = !!(existing && !['DRAFT', 'RETURNED_FOR_CORRECTION'].includes(existing.status))

  async function ensureDraft(): Promise<{ reportId: string; employeeId: string; orgId: string } | null> {
    if (existing?.id) {
      return {
        reportId: existing.id,
        employeeId: (existing as any).employee_id || '',
        orgId: (existing as any).organization_id || profile?.organization_id || '',
      }
    }
    setPreparingDraft(true)
    try {
      await saveDraft({ report_date: reportDate, ...form, task_items: [] })
      const data = await fetchMyReport(reportDate)
      if (data) {
        setExisting(data as DailyReportRow)
        return {
          reportId: data.id,
          employeeId: (data as any).employee_id || '',
          orgId: (data as any).organization_id || profile?.organization_id || '',
        }
      }
      setError('Could not create your daily report draft. Please try again.')
      return null
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Could not create your daily report draft.'
      setError(msg)
      return null
    } finally {
      setPreparingDraft(false)
    }
  }

  async function handlePhotoSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || [])
    if (!files.length) return
    if (galleryRef.current) galleryRef.current.value = ''

    if (photos.length + files.length > MAX_PHOTOS_PER_TASK_ITEM) {
      setError(`PHOTO_LIMIT_EXCEEDED: Maximum ${MAX_PHOTOS_PER_TASK_ITEM} photos per report.`)
      return
    }

    const totalNewBytes = files.reduce((s, f) => s + f.size, 0)
    const existingBytes = photos.filter(p => p.photo).reduce((s, p) => s + (p.photo?.file_size_bytes || 0), 0)
    if (existingBytes + totalNewBytes > MAX_TOTAL_PHOTO_BYTES_PER_TASK_ITEM) {
      setError('PHOTO_TOO_LARGE: Total photo size exceeds 50 MB limit per report.')
      return
    }

    setError(null)

    const newEntries: PhotoEntry[] = files.map((file, i) => ({
      id: crypto.randomUUID(),
      file,
      previewUrl: URL.createObjectURL(file),
      signedUrl: null,
      photo: null,
      status: 'SELECTED' as PhotoStatus,
      progress: 0,
      error: null,
      caption: '',
      displayOrder: photos.length + i,
    }))
    setPhotos(prev => [...prev, ...newEntries])

    const draft = await ensureDraft()
    if (!draft) {
      setPhotos(prev => prev.map((p) => {
        if (newEntries.find(ne => ne.id === p.id)) {
          return { ...p, status: 'FAILED', error: 'Could not create your daily report draft. Please try again.' }
        }
        return p
      }))
      return
    }

    const { reportId, employeeId, orgId } = draft

    for (const entry of newEntries) {
      if (!entry.file) continue

      if (isHeic(entry.file)) {
        setPhotos(prev => prev.map(p => p.id === entry.id ? {
          ...p, status: 'FAILED', error: 'HEIC images are not supported. Please upload JPG, PNG or WEBP.'
        } : p))
        continue
      }

      const validationError = validatePhotoFile(entry.file)
      if (validationError) {
        setPhotos(prev => prev.map(p => p.id === entry.id ? { ...p, status: 'FAILED', error: validationError } : p))
        continue
      }

      setPhotos(prev => prev.map(p => p.id === entry.id ? { ...p, status: 'PROCESSING', progress: 10 } : p))

      let processedFile: File
      let imgWidth: number | undefined
      let imgHeight: number | undefined
      try {
        const processed = await processImage(entry.file)
        imgWidth = processed.width
        imgHeight = processed.height
        const ext = processed.blob.type === 'image/webp' ? 'webp' : 'jpg'
        processedFile = new File([processed.blob], entry.file.name.replace(/\.[^.]+$/, `.${ext}`), {
          type: processed.blob.type || 'image/jpeg',
        })
      } catch {
        setPhotos(prev => prev.map(p => p.id === entry.id ? { ...p, status: 'FAILED', error: 'PHOTO_PROCESSING_FAILED' } : p))
        continue
      }

      setPhotos(prev => prev.map(p => p.id === entry.id ? { ...p, status: 'UPLOADING', progress: 30 } : p))

      try {
        const photo = await uploadTaskPhoto(
          reportId, null, null, employeeId, orgId, processedFile, entry.displayOrder, 'GALLERY', entry.caption, imgWidth, imgHeight
        )
        const signedUrl = await createTaskPhotoSignedUrl(photo.storage_path).catch(() => null)
        setPhotos(prev => prev.map(p => p.id === entry.id ? {
          ...p, status: 'UPLOADED', progress: 100, photo, signedUrl, error: null
        } : p))
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'PHOTO_UPLOAD_FAILED'
        setPhotos(prev => prev.map(p => p.id === entry.id ? { ...p, status: 'FAILED', error: msg } : p))
      }
    }
  }

  async function handleRetryPhoto(entryId: string) {
    const entry = photos.find(p => p.id === entryId)
    if (!entry || !entry.file) return

    setPhotos(prev => prev.map(p => p.id === entryId ? { ...p, status: 'PROCESSING', progress: 10, error: null } : p))

    const reportId = existing?.id
    if (!reportId) { setPhotos(prev => prev.map(p => p.id === entryId ? { ...p, status: 'FAILED', error: 'Could not create your daily report draft. Please try again.' } : p)); return }

    const orgId = (existing as any)?.organization_id || profile?.organization_id || ''
    const employeeId = (existing as any)?.employee_id || ''

    try {
      const processed = await processImage(entry.file)
      const ext = processed.blob.type === 'image/webp' ? 'webp' : 'jpg'
      const processedFile = new File([processed.blob], entry.file.name.replace(/\.[^.]+$/, `.${ext}`), {
        type: processed.blob.type || 'image/jpeg',
      })
      setPhotos(prev => prev.map(p => p.id === entryId ? { ...p, status: 'UPLOADING', progress: 30 } : p))
      const photo = await uploadTaskPhoto(reportId, null, null, employeeId, orgId, processedFile, entry.displayOrder, 'GALLERY', entry.caption, processed.width, processed.height)
      const signedUrl = await createTaskPhotoSignedUrl(photo.storage_path).catch(() => null)
      setPhotos(prev => prev.map(p => p.id === entryId ? { ...p, status: 'UPLOADED', progress: 100, photo, signedUrl, error: null } : p))
    } catch (err) {
      setPhotos(prev => prev.map(p => p.id === entryId ? { ...p, status: 'FAILED', error: err instanceof Error ? err.message : 'PHOTO_UPLOAD_FAILED' } : p))
    }
  }

  function handleRemovePhoto(entryId: string) {
    const entry = photos.find(p => p.id === entryId)
    if (!entry) return
    if (entry.previewUrl) URL.revokeObjectURL(entry.previewUrl)
    if (entry.photo && !isReadOnly) {
      deleteTaskPhoto(entry.photo.id, entry.photo.storage_path).catch(() => {})
    }
    setPhotos(prev => prev.filter(p => p.id !== entryId))
  }

  function handleCaptionChange(entryId: string, caption: string) {
    setPhotos(prev => prev.map(p => p.id === entryId ? { ...p, caption } : p))
  }

  async function handleSaveDraft() {
    setSaving(true); setError(null); setSuccess(null)
    try {
      await saveDraft({ report_date: reportDate, ...form, task_items: [] })
      setSuccess('Draft saved.')
      await loadReport()
    } catch (e) { setError((e as Error).message) }
    setSaving(false)
  }

  const hasPendingUploads = photos.some(p => p.status === 'PROCESSING' || p.status === 'UPLOADING')

  async function handleSubmit() {
    if (!form.overall_summary.trim()) { setError('Overall summary is required'); return }
    if (hasPendingUploads) { setError('Please wait for all photos to finish uploading.'); return }
    setSaving(true); setError(null); setSuccess(null)
    try {
      await submitReport({ report_date: reportDate, ...form, task_items: [] })
      setSuccess('Report submitted successfully.')
      await loadReport()
    } catch (e) { setError((e as Error).message) }
    setSaving(false)
  }

  const uploadedPhotos = photos.filter(p => p.status === 'UPLOADED' && (p.signedUrl || p.previewUrl))
  const sliderImages = uploadedPhotos.map(p => ({
    url: p.signedUrl || p.previewUrl || '',
    caption: p.caption || p.photo?.file_name || '',
    fileName: p.photo?.file_name || p.file?.name || '',
    uploadedAt: p.photo?.uploaded_at || '',
  }))

  useEffect(() => {
    return () => { photos.forEach(p => { if (p.previewUrl) URL.revokeObjectURL(p.previewUrl) }) }
  }, [])

  return (
    <div className="page">
      <div className="page-header">
        <h2 className="page-title">My Daily Report</h2>
      </div>

      {error && <div className="form-error" style={{ marginBottom: '12px' }}>{error}</div>}
      {success && <div className="form-success" style={{ marginBottom: '12px' }}>{success}</div>}

      <div className="card">
        <div className="form-grid" style={{ marginBottom: 'var(--space-4)' }}>
          <div className="form-field">
            <label htmlFor="report-date">Report Date</label>
            <input id="report-date" type="date" value={reportDate} onChange={(e) => setReportDate(e.target.value)} disabled={isReadOnly} />
          </div>
          {existing && (
            <div className="form-field">
              <label>Status</label>
              <div><span className={`attendance-badge ${existing.status}`}>{existing.status}</span></div>
            </div>
          )}
        </div>

        {loading ? <DailyReportSkeleton /> : (
          <>
            {isReadOnly && (
              <div className="form-info" style={{ marginBottom: '12px' }}>
                This report has been {existing?.status}. You can no longer edit it.
              </div>
            )}

            {/* PHOTO UPLOAD */}
            <div style={{ marginBottom: 'var(--space-4)', padding: 'var(--space-3)', border: '1px solid var(--border)', borderRadius: '8px', background: 'var(--surface)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-3)', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
                <h3 style={{ fontSize: '15px', fontWeight: 600, margin: 0 }}>
                  Photos
                  {photos.length > 0 && <span style={{ marginLeft: '8px', fontWeight: 400, color: 'var(--slate)', fontSize: '13px' }}>{photos.length} of {MAX_PHOTOS_PER_TASK_ITEM} photos added</span>}
                </h3>
                {!isReadOnly && photos.length < MAX_PHOTOS_PER_TASK_ITEM && (
                  <label style={{ cursor: 'pointer' }}>
                    <input
                      ref={galleryRef}
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      multiple
                      style={{ display: 'none' }}
                      onChange={handlePhotoSelect}
                      disabled={preparingDraft}
                    />
                    <span className="btn btn-sm btn-secondary" style={{ pointerEvents: preparingDraft ? 'none' : 'auto', opacity: preparingDraft ? 0.6 : 1 }}>
                      {preparingDraft ? 'Preparing your Daily Report…' : 'Upload Photos'}
                    </span>
                  </label>
                )}
              </div>

              {photos.length === 0 ? (
                <div style={{ fontSize: '13px', color: 'var(--slate)', padding: 'var(--space-2) 0' }}>
                  {isReadOnly ? 'No photos attached to this report.' : 'Upload photos from your gallery to attach evidence to this report.'}
                </div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))', gap: 'var(--space-2)' }}>
                  {photos.map((p) => (
                    <div key={p.id} style={{ position: 'relative', borderRadius: '6px', overflow: 'hidden', border: '1px solid var(--border)', background: 'var(--surface-2)' }}>
                      <div style={{ aspectRatio: '1', position: 'relative' }}>
                        {(p.signedUrl || p.previewUrl) && (p.status === 'UPLOADED' || p.status === 'SELECTED') ? (
                          <img
                            src={p.signedUrl || p.previewUrl || ''}
                            alt={p.photo?.file_name || p.file?.name || ''}
                            style={{ width: '100%', height: '100%', objectFit: 'cover', cursor: 'pointer' }}
                            onClick={() => {
                              const sliderIdx = uploadedPhotos.findIndex(up => up.id === p.id)
                              if (sliderIdx >= 0) setLightboxIndex(sliderIdx)
                            }}
                          />
                        ) : (
                          <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '4px', padding: '4px' }}>
                            {p.status === 'PROCESSING' && <span style={{ fontSize: '11px', color: 'var(--slate)' }}>Processing…</span>}
                            {p.status === 'UPLOADING' && (
                              <>
                                <span style={{ fontSize: '11px', color: 'var(--slate)' }}>Uploading…</span>
                                <div style={{ width: '70%', height: '3px', background: 'var(--border)', borderRadius: '2px', overflow: 'hidden' }}>
                                  <div style={{ width: `${p.progress}%`, height: '100%', background: 'var(--teal)', transition: 'width 0.3s' }} />
                                </div>
                              </>
                            )}
                            {p.status === 'FAILED' && <span style={{ fontSize: '10px', color: 'var(--rose)', textAlign: 'center' }}>Failed</span>}
                          </div>
                        )}
                      </div>
                      {/* Info bar */}
                      <div style={{ padding: '4px 6px', fontSize: '10px', color: 'var(--slate)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {p.photo?.file_name || p.file?.name || ''}
                      </div>
                      <div style={{ padding: '0 6px 4px', fontSize: '9px', color: 'var(--slate)' }}>
                        {p.photo ? `${(p.photo.file_size_bytes / 1024).toFixed(0)} KB` : p.file ? `${(p.file.size / 1024).toFixed(0)} KB` : ''}
                        {' · '}
                        {p.status === 'UPLOADED' && <span style={{ color: 'var(--teal)' }}>Uploaded</span>}
                        {p.status === 'SELECTED' && <span style={{ color: 'var(--slate)' }}>Selected</span>}
                        {p.status === 'PROCESSING' && <span style={{ color: 'var(--slate)' }}>Processing</span>}
                        {p.status === 'UPLOADING' && <span style={{ color: 'var(--slate)' }}>{p.progress}%</span>}
                        {p.status === 'FAILED' && <span style={{ color: 'var(--rose)' }}>Failed</span>}
                      </div>
                      {/* Action buttons */}
                      <div style={{ position: 'absolute', top: '4px', right: '4px', display: 'flex', gap: '2px' }}>
                        {p.status === 'FAILED' && (
                          <button type="button" onClick={() => handleRetryPhoto(p.id)} title="Retry"
                            style={{ background: 'rgba(0,0,0,0.55)', color: 'white', border: 'none', borderRadius: '50%', width: '20px', height: '20px', fontSize: '11px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1 }}>
                            ↻
                          </button>
                        )}
                        {!isReadOnly && (
                          <button type="button" onClick={() => handleRemovePhoto(p.id)} title="Remove"
                            style={{ background: 'rgba(0,0,0,0.55)', color: 'white', border: 'none', borderRadius: '50%', width: '20px', height: '20px', fontSize: '13px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1 }}>
                            ×
                          </button>
                        )}
                      </div>
                      {/* Error tooltip */}
                      {p.error && (
                        <div style={{ position: 'absolute', bottom: '0', left: '0', right: '0', background: 'rgba(220,38,38,0.9)', color: 'white', fontSize: '9px', padding: '2px 4px', lineHeight: 1.2 }}>
                          {p.error}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Captions for uploaded photos */}
              {uploadedPhotos.length > 0 && !isReadOnly && (
                <div style={{ marginTop: 'var(--space-3)' }}>
                  {photos.filter(p => p.status === 'UPLOADED').map(p => (
                    <div key={`cap-${p.id}`} style={{ display: 'flex', gap: 'var(--space-1)', marginBottom: 'var(--space-1)', alignItems: 'center' }}>
                      <input type="text" placeholder={`Caption for ${(p.photo?.file_name || p.file?.name || '').slice(0, 20)}…`}
                        value={p.caption} onChange={(e) => handleCaptionChange(p.id, e.target.value)}
                        style={{ flex: 1, fontSize: '12px', minHeight: '28px' }} />
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* REPORT FIELDS */}
            <div className="form-field" style={{ marginBottom: 'var(--space-4)' }}>
              <label htmlFor="summary">Overall Summary *</label>
              <textarea id="summary" rows={3} value={form.overall_summary} onChange={(e) => setForm({ ...form, overall_summary: e.target.value })} disabled={isReadOnly} placeholder="High-level summary of the day's work" />
            </div>

            <div className="form-field" style={{ marginBottom: 'var(--space-4)' }}>
              <label htmlFor="work-completed">Work Completed</label>
              <textarea id="work-completed" rows={4} value={form.work_completed} onChange={(e) => setForm({ ...form, work_completed: e.target.value })} disabled={isReadOnly} />
            </div>

            <div className="form-field" style={{ marginBottom: 'var(--space-4)' }}>
              <label htmlFor="follow-up">Follow-up Required</label>
              <select id="follow-up" value={form.follow_up_required ? 'yes' : 'no'} onChange={(e) => setForm({ ...form, follow_up_required: e.target.value === 'yes' })} disabled={isReadOnly}><option value="no">No</option><option value="yes">Yes</option></select>
            </div>

            {!isReadOnly && (
              <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
                <button className="btn btn-secondary" onClick={handleSaveDraft} disabled={saving || preparingDraft}>Save Draft</button>
                <button className="btn btn-primary" onClick={handleSubmit} disabled={saving || hasPendingUploads}>
                  {saving ? 'Submitting…' : 'Submit Report'}
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* LIGHTBOX / SLIDER */}
      {lightboxIndex !== null && sliderImages.length > 0 && (
        <PhotoSlider
          images={sliderImages}
          initialIndex={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
        />
      )}
    </div>
  )
}
