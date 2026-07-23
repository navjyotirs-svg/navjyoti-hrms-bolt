import { useEffect, useState } from 'react'
import { getKolkataDate, fetchMyReport, saveDraft, submitReport, type DailyReportRow, type DailyReportTaskItem } from '@/lib/dailyReports'
import '@/styles/shared.css'

export function DailyReportPage() {
  const today = getKolkataDate()
  const [reportDate, setReportDate] = useState(today)
  const [existing, setExisting] = useState<DailyReportRow | null>(null)
  const [taskItems, setTaskItems] = useState<DailyReportTaskItem[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

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
    setLoading(true)
    setError(null)
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
        setTaskItems(data.daily_report_task_items || [])
      } else {
        setExisting(null)
        setForm({ overall_summary: '', work_planned: '', work_completed: '', overall_result: '', pending_work: '', blockers: '', support_required: '', follow_up_required: false, tomorrow_plan: '' })
        setTaskItems([])
      }
    } catch (e) { setError((e as Error).message) }
    setLoading(false)
  }

  const isReadOnly = existing && !['draft', 'returned'].includes(existing.status)

  async function handleSaveDraft() {
    setSaving(true); setError(null); setSuccess(null)
    try {
      await saveDraft({ report_date: reportDate, ...form, task_items: taskItems.map(t => ({ ...t })) })
      setSuccess('Draft saved successfully')
      await loadReport()
    } catch (e) { setError((e as Error).message) }
    setSaving(false)
  }

  async function handleSubmit() {
    if (!form.overall_summary.trim()) { setError('Overall summary is required'); return }
    setSaving(true); setError(null); setSuccess(null)
    try {
      await submitReport({ report_date: reportDate, ...form, task_items: taskItems.map(t => ({ ...t })) })
      setSuccess('Report submitted successfully')
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
            <input id="report-date" type="date" value={reportDate} onChange={(e) => setReportDate(e.target.value)} disabled={!!isReadOnly} />
          </div>
          {existing && (
            <div className="form-field">
              <label>Status</label>
              <div><span className={`attendance-badge ${existing.status}`}>{existing.status}</span></div>
            </div>
          )}
        </div>

        {loading ? (
          <div className="loading-state">Loading report…</div>
        ) : (
          <>
            {isReadOnly && (
              <div className="form-info" style={{ marginBottom: '12px' }}>
                This report has been {existing?.status}. You can no longer edit it.
              </div>
            )}

            <div className="form-field" style={{ marginBottom: 'var(--space-4)' }}>
              <label htmlFor="summary">Overall Summary *</label>
              <textarea id="summary" rows={3} value={form.overall_summary} onChange={(e) => setForm({ ...form, overall_summary: e.target.value })} disabled={!!isReadOnly} placeholder="High-level summary of the day's work" />
            </div>

            <div className="form-grid" style={{ marginBottom: 'var(--space-4)' }}>
              <div className="form-field">
                <label htmlFor="work-planned">Work Planned</label>
                <textarea id="work-planned" rows={3} value={form.work_planned} onChange={(e) => setForm({ ...form, work_planned: e.target.value })} disabled={!!isReadOnly} />
              </div>
              <div className="form-field">
                <label htmlFor="work-completed">Work Completed</label>
                <textarea id="work-completed" rows={3} value={form.work_completed} onChange={(e) => setForm({ ...form, work_completed: e.target.value })} disabled={!!isReadOnly} />
              </div>
            </div>

            <div className="form-grid" style={{ marginBottom: 'var(--space-4)' }}>
              <div className="form-field">
                <label htmlFor="overall-result">Overall Result</label>
                <textarea id="overall-result" rows={2} value={form.overall_result} onChange={(e) => setForm({ ...form, overall_result: e.target.value })} disabled={!!isReadOnly} />
              </div>
              <div className="form-field">
                <label htmlFor="pending-work">Pending Work</label>
                <textarea id="pending-work" rows={2} value={form.pending_work} onChange={(e) => setForm({ ...form, pending_work: e.target.value })} disabled={!!isReadOnly} />
              </div>
            </div>

            <div className="form-grid" style={{ marginBottom: 'var(--space-4)' }}>
              <div className="form-field">
                <label htmlFor="blockers">Blockers</label>
                <textarea id="blockers" rows={2} value={form.blockers} onChange={(e) => setForm({ ...form, blockers: e.target.value })} disabled={!!isReadOnly} />
              </div>
              <div className="form-field">
                <label htmlFor="support">Support Required</label>
                <textarea id="support" rows={2} value={form.support_required} onChange={(e) => setForm({ ...form, support_required: e.target.value })} disabled={!!isReadOnly} />
              </div>
            </div>

            <div className="form-grid" style={{ marginBottom: 'var(--space-4)' }}>
              <div className="form-field">
                <label htmlFor="tomorrow">Tomorrow's Plan</label>
                <textarea id="tomorrow" rows={2} value={form.tomorrow_plan} onChange={(e) => setForm({ ...form, tomorrow_plan: e.target.value })} disabled={!!isReadOnly} />
              </div>
              <div className="form-field">
                <label htmlFor="follow-up">Follow-up Required</label>
                <select id="follow-up" value={form.follow_up_required ? 'yes' : 'no'} onChange={(e) => setForm({ ...form, follow_up_required: e.target.value === 'yes' })} disabled={!!isReadOnly}>
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
    </div>
  )
}
