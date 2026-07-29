import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { fetchTaskPhotos, createTaskPhotoSignedUrl, type DailyReportTaskPhoto } from '@/lib/dailyReports'
import { PhotoSlider, type SliderImage } from '@/components/PhotoSlider'
import { useAuth } from '@/auth/AuthContext'
import '@/styles/shared.css'

interface EmployeeEvidence {
  employeeId: string
  employeeName: string
  employeeCode: string
  reportId: string
  reportDate: string
  overallSummary: string
  workCompleted: string
  overallResult: string
  blockers: string
  supportRequired: string
  photos: DailyReportTaskPhoto[]
}

export function TaskEvidenceViewerPage() {
  const { taskId } = useParams<{ taskId: string }>()
  const navigate = useNavigate()
  const { } = useAuth()
  const [task, setTask] = useState<{ task_code: string; title: string; projects?: { project_name: string } | null } | null>(null)
  const [evidence, setEvidence] = useState<EmployeeEvidence[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [sliderState, setSliderState] = useState<{ employeeIdx: number; photoIdx: number } | null>(null)

  useEffect(() => { load() }, [taskId])

  async function load() {
    if (!taskId) return
    setLoading(true); setError(null)
    try {
      const { data: taskData, error: taskError } = await supabase
        .from('tasks')
        .select('task_code, title, projects ( project_name )')
        .eq('id', taskId)
        .maybeSingle()
      if (taskError) throw taskError
      setTask(taskData as any)

      const { data: assignments } = await supabase
        .from('task_assignments')
        .select('assigned_employee_id, assigned_employee:employees!task_assignments_assigned_employee_id_fkey ( id, full_name, employee_code )')
        .eq('task_id', taskId)
        .eq('is_current', true)

      const employeeMap = new Map<string, { id: string; full_name: string; employee_code: string }>()
      ;(assignments || []).forEach((a: any) => {
        if (a.assigned_employee) {
          employeeMap.set(a.assigned_employee.id, {
            id: a.assigned_employee.id,
            full_name: a.assigned_employee.full_name,
            employee_code: a.assigned_employee.employee_code || '',
          })
        }
      })

      const { data: taskItems } = await supabase
        .from('daily_report_task_items')
        .select('daily_report_id, daily_reports ( id, report_date, overall_summary, work_completed, overall_result, blockers, support_required, employee_id )')
        .eq('task_id', taskId)

      const reportMap = new Map<string, EmployeeEvidence>()
      ;(taskItems || []).forEach((item: any) => {
        const r = item.daily_reports
        if (!r) return
        const emp = employeeMap.get(r.employee_id)
        const empName = emp?.full_name ?? 'Unknown Employee'
        const empCode = emp?.employee_code ?? ''
        if (!reportMap.has(r.id)) {
          reportMap.set(r.id, {
            employeeId: r.employee_id,
            employeeName: empName,
            employeeCode: empCode,
            reportId: r.id,
            reportDate: r.report_date,
            overallSummary: r.overall_summary || '',
            workCompleted: r.work_completed || '',
            overallResult: r.overall_result || '',
            blockers: r.blockers || '',
            supportRequired: r.support_required || '',
            photos: [],
          })
        }
      })

      for (const [reportId, ev] of reportMap) {
        const photos = await fetchTaskPhotos(reportId)
        ev.photos = photos.filter(p => !p.task_id || p.task_id === taskId)
      }

      const sorted = Array.from(reportMap.values()).filter(ev => ev.photos.length > 0)
      sorted.sort((a, b) => a.employeeName.localeCompare(b.employeeName))
      setEvidence(sorted)
    } catch (e) {
      setError('Evidence unavailable. ' + (e as Error).message)
    }
    setLoading(false)
  }

  async function openSlider(employeeIdx: number, photoIdx: number) {
    setSliderState({ employeeIdx, photoIdx })
  }

  async function getSliderImages(employeeIdx: number): Promise<SliderImage[]> {
    const ev = evidence[employeeIdx]
    if (!ev) return []
    return Promise.all(ev.photos.map(async (p) => {
      const url = await createTaskPhotoSignedUrl(p.storage_path).catch(() => '')
      return {
        url: url || '',
        caption: p.caption || '',
        fileName: p.file_name,
        uploadedAt: p.uploaded_at,
      }
    }))
  }

  const [sliderImages, setSliderImages] = useState<SliderImage[]>([])

  useEffect(() => {
    if (sliderState) {
      getSliderImages(sliderState.employeeIdx).then(setSliderImages)
    } else {
      setSliderImages([])
    }
  }, [sliderState])

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h2 className="page-title">Daily Report Evidence</h2>
          {task && (
            <div style={{ fontSize: '13px', color: 'var(--slate)', marginTop: '2px' }}>
              {task.task_code} — {task.title}
              {task.projects?.project_name && ` · ${task.projects.project_name}`}
            </div>
          )}
        </div>
        <button className="btn btn-secondary" onClick={() => navigate(-1)}>← Back</button>
      </div>

      {error && <div className="form-error" style={{ marginBottom: '12px' }}>{error}</div>}

      {loading ? (
        <div className="card"><div style={{ padding: 'var(--space-4)', textAlign: 'center', color: 'var(--slate)' }}>Loading evidence…</div></div>
      ) : evidence.length === 0 ? (
        <div className="card"><div className="empty-state"><div className="empty-state-text">No report evidence found for this task.</div></div></div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          {evidence.map((ev, empIdx) => (
            <div key={ev.reportId} className="card">
              <div className="card-body">
                {/* Employee header */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-3)' }}>
                  <span style={{
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    width: '32px', height: '32px', borderRadius: '50%', background: 'var(--teal)', color: 'white', fontSize: '13px', fontWeight: 600,
                  }}>
                    {ev.employeeName.charAt(0)}
                  </span>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '14px' }}>{ev.employeeName}</div>
                    <div style={{ fontSize: '12px', color: 'var(--slate)' }}>
                      {ev.employeeCode && `${ev.employeeCode} · `}Report: {new Date(ev.reportDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                      {' · '}{ev.photos.length} {ev.photos.length === 1 ? 'Photo' : 'Photos'}
                    </div>
                  </div>
                </div>

                {/* Report summary */}
                {(ev.overallSummary || ev.workCompleted || ev.overallResult) && (
                  <div style={{ marginBottom: 'var(--space-3)', padding: 'var(--space-2) var(--space-3)', background: 'var(--surface)', borderRadius: '6px', fontSize: '13px' }}>
                    {ev.overallSummary && <div style={{ marginBottom: '4px' }}><strong>Summary:</strong> {ev.overallSummary}</div>}
                    {ev.workCompleted && <div style={{ marginBottom: '4px' }}><strong>Work Completed:</strong> {ev.workCompleted}</div>}
                    {ev.overallResult && <div style={{ marginBottom: '4px' }}><strong>Result:</strong> {ev.overallResult}</div>}
                    {ev.blockers && <div style={{ marginBottom: '4px' }}><strong>Blockers:</strong> {ev.blockers}</div>}
                    {ev.supportRequired && <div><strong>Support Required:</strong> {ev.supportRequired}</div>}
                  </div>
                )}

                {/* Photo grid */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 'var(--space-2)' }}>
                  {ev.photos.map((photo, photoIdx) => (
                    <PhotoThumb key={photo.id} photo={photo} onClick={() => openSlider(empIdx, photoIdx)} />
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Slider */}
      {sliderState && sliderImages.length > 0 && (
        <PhotoSlider
          images={sliderImages}
          initialIndex={sliderState.photoIdx}
          onClose={() => setSliderState(null)}
        />
      )}
    </div>
  )
}

function PhotoThumb({ photo, onClick }: { photo: DailyReportTaskPhoto; onClick: () => void }) {
  const [url, setUrl] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let cancelled = false
    createTaskPhotoSignedUrl(photo.storage_path).then(u => { if (!cancelled) setUrl(u) }).catch(() => {})
    return () => { cancelled = true }
  }, [photo.storage_path])

  return (
    <div onClick={onClick} style={{ position: 'relative', borderRadius: '6px', overflow: 'hidden', border: '1px solid var(--border)', background: 'var(--surface-2)', cursor: 'pointer', aspectRatio: '1' }}>
      {!loaded && <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', color: 'var(--slate)' }}>Loading…</div>}
      {url && <img src={url} alt={photo.file_name} onLoad={() => setLoaded(true)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
    </div>
  )
}
