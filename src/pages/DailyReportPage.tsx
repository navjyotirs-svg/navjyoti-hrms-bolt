import { useEffect, useRef, useState } from 'react'
import {
  getKolkataDate, fetchMyReport, saveDraft, submitReport,
  fetchTaskPhotos, uploadTaskPhoto, deleteTaskPhoto,
  createTaskPhotoSignedUrl, validatePhotoFile, MAX_PHOTOS_PER_TASK_ITEM,
  type DailyReportRow, type DailyReportTaskPhoto,
} from '@/lib/dailyReports'
import { DailyReportSkeleton } from '@/components/Skeleton'
import { useAuth } from '@/auth/AuthContext'
import '@/styles/shared.css'

export function DailyReportPage() {
  const today = getKolkataDate()
  const { profile } = useAuth()
  const [reportDate, setReportDate] = useState(today)
  const [existing, setExisting] = useState<DailyReportRow | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const [photos, setPhotos] = useState<DailyReportTaskPhoto[]>([])
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({})
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [lightbox, setLightbox] = useState<string | null>(null)
  const galleryRef = useRef<HTMLInputElement>(null)

  const [form, setForm] = useState({
    overall_summary: '',
    work_planned: '',
    work_completed: '',
    overall_result: '',
    pending_work: '',
    blockers: '',
    support_required: '',
    follow_up_required: false,
    tomorrow_plan: '',
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
          work_planned: data.work_planned || '',
          work_completed: data.work_completed || '',
          overall_result: data.overall_result || '',
          pending_work: data.pending_work || '',
          blockers: data.blockers || '',
          support_required: data.support_required || '',
          follow_up_required: data.follow_up_required || false,
          tomorrow_plan: data.tomorrow_plan || '',
        })
        await loadPhotos(data.id)
      } else {
        setExisting(null)
        setForm({ overall_summary: '', work_planned: '', work_completed: '', overall_result: '', pending_work: '', blockers: '', support_required: '', follow_up_required: false, tomorrow_plan: '' })
        setPhotos([])
        setPhotoUrls({})
      }
    } catch (e) { setError((e as Error).message) }
    setLoading(false)
  }

  async function loadPhotos(reportId: string) {
    try {
      const list = await fetchTaskPhotos(reportId)
      setPhotos(list)
      const urls: Record<string, string> = {}
      await Promise.all(list.map(async (p) => {
        const url = await createTaskPhotoSignedUrl(p.storage_path)
        if (url) urls[p.id] = url
      }))
      setPhotoUrls(urls)
    } catch { /* best-effort */ }
  }

  const isReadOnly = !!(existing && !['draft', 'returned'].includes(existing.status))

  async function ensureDraft(): Promise<string> {
    if (existing?.id) return existing.id
    const result = await saveDraft({ report_date: reportDate, ...form, task_items: [] })
    const id: string = result.report_id
    await loadReport()
    return id
  }

  async function handlePhotoSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || [])
    if (!files.length) return
    if (photos.length + files.length > MAX_PHOTOS_PER_TASK_ITEM) {
      setUploadError(`You can upload at most ${MAX_PHOTOS_PER_TASK_ITEM} photos per report.`)
      return
    }
    for (const f of files) {
      const err = validatePhotoFile(f)
      if (err) { setUploadError(err); return }
    }
    setUploading(true); setUploadError(null)
    try {
      const reportId = await ensureDraft()
      const orgId = profile?.organization_id || ''
      const currentReport = existing || { id: reportId, employee_id: '' } as any

      for (let i = 0; i < files.length; i++) {
        const photo = await uploadTaskPhoto(
          reportId,
          null,
          null,
          currentReport.employee_id || '',
          orgId,
          files[i],
          photos.length + i,
        )
        const url = await createTaskPhotoSignedUrl(photo.storage_path)
        setPhotos(prev => [...prev, photo])
        if (url) setPhotoUrls(prev => ({ ...prev, [photo.id]: url }))
      }
    } catch (e) { setUploadError((e as Error).message) }
    setUploading(false)
    if (galleryRef.current) galleryRef.current.value = ''
  }

  async function handleDeletePhoto(photo: DailyReportTaskPhoto) {
    try {
      await deleteTaskPhoto(photo.id, photo.storage_path)
      setPhotos(prev => prev.filter(p => p.id !== photo.id))
      setPhotoUrls(prev => { const n = { ...prev }; delete n[photo.id]; return n })
    } catch (e) { setUploadError((e as Error).message) }
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

  async function handleSubmit() {
    if (!form.overall_summary.trim()) { setError('Overall summary is required'); return }
    setSaving(true); setError(null); setSuccess(null)
    try {
      await submitReport({ report_date: reportDate, ...form, task_items: [] })
      setSuccess('Report submitted successfully.')
      await loadReport()
    } catch (e) { setError((e as Error).message) }
    setSaving(false)
  }

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
                  {photos.length > 0 && <span style={{ marginLeft: '8px', fontWeight: 400, color: 'var(--slate)', fontSize: '13px' }}>({photos.length})</span>}
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
                      disabled={uploading}
                    />
                    <span className="btn btn-sm btn-secondary" style={{ pointerEvents: uploading ? 'none' : 'auto', opacity: uploading ? 0.6 : 1 }}>
                      {uploading ? 'Uploading…' : 'Upload Photos'}
                    </span>
                  </label>
                )}
              </div>

              {uploadError && <div className="form-error" style={{ marginBottom: '8px' }}>{uploadError}</div>}

              {photos.length === 0 ? (
                <div style={{ fontSize: '13px', color: 'var(--slate)', padding: 'var(--space-2) 0' }}>
                  {isReadOnly ? 'No photos attached to this report.' : 'Upload photos from your gallery to attach evidence to this report.'}
                </div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))', gap: 'var(--space-2)' }}>
                  {photos.map(p => (
                    <div key={p.id} style={{ position: 'relative', aspectRatio: '1', borderRadius: '6px', overflow: 'hidden', background: '#f0f0f0', cursor: 'pointer' }}>
                      {photoUrls[p.id] ? (
                        <img
                          src={photoUrls[p.id]}
                          alt={p.file_name}
                          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                          onClick={() => setLightbox(photoUrls[p.id])}
                        />
                      ) : (
                        <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', color: 'var(--slate)' }}>…</div>
                      )}
                      {!isReadOnly && (
                        <button
                          type="button"
                          onClick={() => handleDeletePhoto(p)}
                          style={{ position: 'absolute', top: '4px', right: '4px', background: 'rgba(0,0,0,0.55)', color: 'white', border: 'none', borderRadius: '50%', width: '22px', height: '22px', fontSize: '13px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1 }}
                          title="Remove photo"
                        >
                          ×
                        </button>
                      )}
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

            <div className="form-grid" style={{ marginBottom: 'var(--space-4)' }}>
              <div className="form-field">
                <label>Work Planned</label>
                <textarea rows={3} value={form.work_planned} onChange={(e) => setForm({ ...form, work_planned: e.target.value })} disabled={isReadOnly} />
              </div>
              <div className="form-field">
                <label>Work Completed</label>
                <textarea rows={3} value={form.work_completed} onChange={(e) => setForm({ ...form, work_completed: e.target.value })} disabled={isReadOnly} />
              </div>
            </div>

            <div className="form-grid" style={{ marginBottom: 'var(--space-4)' }}>
              <div className="form-field">
                <label>Overall Result</label>
                <textarea rows={2} value={form.overall_result} onChange={(e) => setForm({ ...form, overall_result: e.target.value })} disabled={isReadOnly} />
              </div>
              <div className="form-field">
                <label>Pending Work</label>
                <textarea rows={2} value={form.pending_work} onChange={(e) => setForm({ ...form, pending_work: e.target.value })} disabled={isReadOnly} />
              </div>
            </div>

            <div className="form-grid" style={{ marginBottom: 'var(--space-4)' }}>
              <div className="form-field">
                <label>Blockers</label>
                <textarea rows={2} value={form.blockers} onChange={(e) => setForm({ ...form, blockers: e.target.value })} disabled={isReadOnly} />
              </div>
              <div className="form-field">
                <label>Support Required</label>
                <textarea rows={2} value={form.support_required} onChange={(e) => setForm({ ...form, support_required: e.target.value })} disabled={isReadOnly} />
              </div>
            </div>

            <div className="form-grid" style={{ marginBottom: 'var(--space-4)' }}>
              <div className="form-field">
                <label>Tomorrow's Plan</label>
                <textarea rows={2} value={form.tomorrow_plan} onChange={(e) => setForm({ ...form, tomorrow_plan: e.target.value })} disabled={isReadOnly} />
              </div>
              <div className="form-field">
                <label>Follow-up Required</label>
                <select value={form.follow_up_required ? 'yes' : 'no'} onChange={(e) => setForm({ ...form, follow_up_required: e.target.value === 'yes' })} disabled={isReadOnly}>
                  <option value="no">No</option>
                  <option value="yes">Yes</option>
                </select>
              </div>
            </div>

            {!isReadOnly && (
              <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
                <button className="btn btn-secondary" onClick={handleSaveDraft} disabled={saving}>Save Draft</button>
                <button className="btn btn-primary" onClick={handleSubmit} disabled={saving}>Submit Report</button>
              </div>
            )}
          </>
        )}
      </div>

      {/* LIGHTBOX */}
      {lightbox && (
        <div
          onClick={() => setLightbox(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, cursor: 'zoom-out' }}
        >
          <img src={lightbox} alt="Preview" style={{ maxWidth: '90vw', maxHeight: '90vh', borderRadius: '8px', objectFit: 'contain' }} />
        </div>
      )}
    </div>
  )
}
