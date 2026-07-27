import { useEffect, useState, useRef, type ChangeEvent } from 'react'
import {
  fetchTaskPhotos, uploadTaskPhoto, deleteTaskPhoto, updateTaskPhotoCaption,
  createTaskPhotoSignedUrl, validatePhotoFile,
  MAX_PHOTOS_PER_TASK_ITEM, MAX_TOTAL_PHOTO_BYTES_PER_TASK_ITEM,
  type DailyReportTaskPhoto,
} from '@/lib/dailyReports'
import { useAuth } from '@/auth/AuthContext'

interface TaskPhotoGridProps {
  dailyReportId: string
  taskItemId: string | null
  taskId: string | null
  employeeId: string
  isReadOnly: boolean
  onPhotoCountChange?: (count: number) => void
}

interface PhotoItem {
  photo: DailyReportTaskPhoto
  signedUrl: string | null
  loading: boolean
  error: string | null
}

interface UploadingItem {
  id: string
  fileName: string
  progress: number
  error: string | null
}

export function TaskPhotoGrid({ dailyReportId, taskItemId, taskId, employeeId, isReadOnly, onPhotoCountChange }: TaskPhotoGridProps) {
  const { profile } = useAuth()
  const [photos, setPhotos] = useState<PhotoItem[]>([])
  const [uploading, setUploading] = useState<UploadingItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [captionDrafts, setCaptionDrafts] = useState<Record<string, string>>({})
  const fileInputRef = useRef<HTMLInputElement>(null)
  const cameraInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    loadPhotos()
  }, [dailyReportId, taskItemId])

  useEffect(() => {
    onPhotoCountChange?.(photos.length)
  }, [photos.length])

  async function loadPhotos() {
    setLoading(true)
    try {
      const fetched = await fetchTaskPhotos(dailyReportId)
      const filtered = taskItemId
        ? fetched.filter(p => p.daily_report_task_item_id === taskItemId)
        : fetched.filter(p => !p.daily_report_task_item_id)
      const items = await Promise.all(
        filtered.map(async (photo) => {
          const signedUrl = await createTaskPhotoSignedUrl(photo.storage_path).catch(() => null)
          return { photo, signedUrl, loading: false, error: null }
        })
      )
      setPhotos(items)
      const drafts: Record<string, string> = {}
      filtered.forEach(p => { drafts[p.id] = p.caption || '' })
      setCaptionDrafts(drafts)
    } catch (e) {
      setError((e as Error).message)
    }
    setLoading(false)
  }

  async function handleFileSelect(e: ChangeEvent<HTMLInputElement>, sourceType: 'GALLERY' | 'CAMERA') {
    const files = Array.from(e.target.files || [])
    e.target.value = ''
    if (!files.length || !profile?.organization_id) return

    const currentCount = photos.length
    const remainingSlots = MAX_PHOTOS_PER_TASK_ITEM - currentCount
    if (remainingSlots <= 0) {
      setError(`Maximum ${MAX_PHOTOS_PER_TASK_ITEM} photos per task item`)
      return
    }

    const filesToUpload = files.slice(0, remainingSlots)
    const totalBytes = filesToUpload.reduce((sum, f) => sum + f.size, 0)
    const existingBytes = photos.reduce((sum, p) => sum + p.photo.file_size_bytes, 0)
    if (existingBytes + totalBytes > MAX_TOTAL_PHOTO_BYTES_PER_TASK_ITEM) {
      setError('Total photo size exceeds 50 MB limit per task item')
      return
    }

    setError(null)

    for (const file of filesToUpload) {
      const uploadId = crypto.randomUUID()
      setUploading(prev => [...prev, { id: uploadId, fileName: file.name, progress: 0, error: null }])

      const validationError = validatePhotoFile(file)
      if (validationError) {
        setUploading(prev => prev.map(u => u.id === uploadId ? { ...u, error: validationError } : u))
        continue
      }

      try {
        const newPhoto = await uploadTaskPhoto(
          dailyReportId, taskItemId, taskId, employeeId,
          profile.organization_id, file, photos.length + uploading.length,
          sourceType
        )
        const signedUrl = await createTaskPhotoSignedUrl(newPhoto.storage_path).catch(() => null)
        setPhotos(prev => [...prev, { photo: newPhoto, signedUrl, loading: false, error: null }])
        setCaptionDrafts(prev => ({ ...prev, [newPhoto.id]: '' }))
      } catch (err) {
        setUploading(prev => prev.map(u => u.id === uploadId ? { ...u, error: (err as Error).message } : u))
      }

      setUploading(prev => prev.filter(u => u.id !== uploadId))
    }
  }

  async function handleRemove(photoId: string, storagePath: string) {
    try {
      await deleteTaskPhoto(photoId, storagePath)
      setPhotos(prev => prev.filter(p => p.photo.id !== photoId))
    } catch (e) {
      setError((e as Error).message)
    }
  }

  async function handleSaveCaption(photoId: string) {
    const caption = captionDrafts[photoId] || ''
    try {
      await updateTaskPhotoCaption(photoId, caption)
      setPhotos(prev => prev.map(p => p.photo.id === photoId ? { ...p, photo: { ...p.photo, caption } } : p))
    } catch (e) {
      setError((e as Error).message)
    }
  }

  function handleRetry(uploadId: string) {
    setUploading(prev => prev.filter(u => u.id !== uploadId))
  }

  return (
    <div className="task-photo-grid-container" style={{ marginTop: 'var(--space-3)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-2)', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
        <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--ink)' }}>
          Task Photos
        </span>
        <span style={{ fontSize: '12px', color: 'var(--slate)' }}>
          {photos.length} of {MAX_PHOTOS_PER_TASK_ITEM} photos added
        </span>
      </div>

      {error && (
        <div className="form-error" style={{ marginBottom: 'var(--space-2)', fontSize: '13px' }}>
          {error}
          <button type="button" className="btn btn-sm" style={{ marginLeft: 'var(--space-2)' }} onClick={() => setError(null)}>Dismiss</button>
        </div>
      )}

      {!isReadOnly && photos.length < MAX_PHOTOS_PER_TASK_ITEM && (
        <div style={{ display: 'flex', gap: 'var(--space-2)', marginBottom: 'var(--space-3)' }}>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            style={{ display: 'none' }}
            onChange={(e) => handleFileSelect(e, 'GALLERY')}
          />
          <button
            type="button"
            className="btn btn-sm btn-secondary"
            onClick={() => fileInputRef.current?.click()}
          >
            Add Photos from Gallery
          </button>
          <input
            ref={cameraInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            capture="environment"
            style={{ display: 'none' }}
            onChange={(e) => handleFileSelect(e, 'CAMERA')}
          />
          <button
            type="button"
            className="btn btn-sm btn-secondary"
            onClick={() => cameraInputRef.current?.click()}
          >
            Take Photo
          </button>
        </div>
      )}

      {loading ? (
        <div style={{ fontSize: '13px', color: 'var(--slate)' }}>Loading photos…</div>
      ) : (
        <>
          {photos.length === 0 && uploading.length === 0 && !isReadOnly && (
            <div style={{ fontSize: '13px', color: 'var(--slate)', padding: 'var(--space-3)', textAlign: 'center', border: '1px dashed var(--border)', borderRadius: '6px' }}>
              No photos yet. Click "Add Photos from Gallery" to attach evidence.
            </div>
          )}

          {(photos.length > 0 || uploading.length > 0) && (
            <div className="task-photo-grid" style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))',
              gap: 'var(--space-2)',
            }}>
              {photos.map((item) => (
                <div key={item.photo.id} className="task-photo-thumb" style={{
                  position: 'relative',
                  borderRadius: '6px',
                  overflow: 'hidden',
                  aspectRatio: '1',
                  border: '1px solid var(--border)',
                  background: 'var(--surface-2)',
                }}>
                  {item.signedUrl ? (
                    <img
                      src={item.signedUrl}
                      alt={item.photo.file_name}
                      style={{ width: '100%', height: '100%', objectFit: 'cover', cursor: 'pointer' }}
                      onClick={() => setPreviewUrl(item.signedUrl)}
                    />
                  ) : (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', fontSize: '11px', color: 'var(--slate)' }}>
                      Preview unavailable
                    </div>
                  )}
                  {!isReadOnly && (
                    <button
                      type="button"
                      onClick={() => handleRemove(item.photo.id, item.photo.storage_path)}
                      style={{
                        position: 'absolute', top: '2px', right: '2px',
                        background: 'rgba(0,0,0,0.6)', color: 'white',
                        border: 'none', borderRadius: '50%',
                        width: '20px', height: '20px', fontSize: '12px',
                        cursor: 'pointer', lineHeight: 1, padding: 0,
                      }}
                      aria-label="Remove photo"
                    >
                      ×
                    </button>
                  )}
                  {item.photo.source_type === 'CAMERA' && (
                    <span style={{
                      position: 'absolute', bottom: '2px', left: '2px',
                      background: 'rgba(0,0,0,0.6)', color: 'white',
                      fontSize: '9px', padding: '1px 4px', borderRadius: '3px',
                    }}>
                      📷
                    </span>
                  )}
                </div>
              ))}

              {uploading.map((u) => (
                <div key={u.id} className="task-photo-uploading" style={{
                  position: 'relative',
                  borderRadius: '6px',
                  overflow: 'hidden',
                  aspectRatio: '1',
                  border: '1px solid var(--border)',
                  background: 'var(--surface-2)',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: 'var(--space-1)',
                }}>
                  {u.error ? (
                    <>
                      <span style={{ fontSize: '10px', color: 'var(--rose)', textAlign: 'center' }}>{u.error}</span>
                      <button type="button" className="btn btn-sm" style={{ marginTop: '4px', fontSize: '10px' }} onClick={() => handleRetry(u.id)}>Retry</button>
                    </>
                  ) : (
                    <>
                      <div style={{ fontSize: '10px', color: 'var(--slate)', textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', width: '100%' }}>
                        {u.fileName}
                      </div>
                      <div style={{ marginTop: '4px', width: '80%', height: '4px', background: 'var(--border)', borderRadius: '2px', overflow: 'hidden' }}>
                        <div style={{ width: '60%', height: '100%', background: 'var(--teal)', animation: 'skl-shimmer 1.5s infinite' }} />
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}

          {photos.length > 0 && !isReadOnly && (
            <div style={{ marginTop: 'var(--space-2)' }}>
              {photos.map((item) => (
                <div key={`caption-${item.photo.id}`} style={{ display: 'flex', gap: 'var(--space-1)', marginBottom: 'var(--space-1)', alignItems: 'center' }}>
                  <input
                    type="text"
                    placeholder={`Caption for ${item.photo.file_name.slice(0, 20)}…`}
                    value={captionDrafts[item.photo.id] || ''}
                    onChange={(e) => setCaptionDrafts(prev => ({ ...prev, [item.photo.id]: e.target.value }))}
                    style={{ flex: 1, fontSize: '12px', minHeight: '28px' }}
                  />
                  <button type="button" className="btn btn-sm" style={{ fontSize: '11px' }} onClick={() => handleSaveCaption(item.photo.id)}>Save</button>
                </div>
              ))}
            </div>
          )}

          {photos.length > 0 && isReadOnly && (
            <div style={{ marginTop: 'var(--space-2)' }}>
              {photos.filter(p => p.photo.caption).map((item) => (
                <div key={`cap-${item.photo.id}`} style={{ fontSize: '12px', color: 'var(--slate)', marginBottom: '2px' }}>
                  <strong>{item.photo.file_name.slice(0, 25)}</strong>: {item.photo.caption}
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {previewUrl && (
        <div
          onClick={() => setPreviewUrl(null)}
          style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            background: 'rgba(0,0,0,0.85)', zIndex: 9999,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', padding: 'var(--space-4)',
          }}
        >
          <img src={previewUrl} alt="Full preview" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
        </div>
      )}
    </div>
  )
}
