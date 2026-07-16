import { useEffect, useState, type FormEvent } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/auth/AuthContext'
import {
  fetchHolidayCalendars,
  createHolidayCalendar,
  fetchHolidayDates,
  addHolidayDate,
  deleteHolidayDate,
  formatLeaveDate,
  type HolidayCalendar,
  type HolidayCalendarDate,
} from '@/lib/leave'
import '@/styles/shared.css'

interface Branch {
  id: string
  name: string
}

const HOLIDAY_TYPES = ['NATIONAL', 'RELIGIOUS', 'REGIONAL', 'COMPANY', 'RESTRICTED']

export function HolidayManagementPage() {
  const { profile, permissions } = useAuth()
  const [calendars, setCalendars] = useState<HolidayCalendar[]>([])
  const [branches, setBranches] = useState<Branch[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [selected, setSelected] = useState<HolidayCalendar | null>(null)
  const [dates, setDates] = useState<HolidayCalendarDate[]>([])
  const [datesLoading, setDatesLoading] = useState(false)

  const [name, setName] = useState('')
  const [year, setYear] = useState(new Date().getFullYear())
  const [branchId, setBranchId] = useState('')

  const [hDate, setHDate] = useState('')
  const [hName, setHName] = useState('')
  const [hType, setHType] = useState('NATIONAL')
  const [hPaid, setHPaid] = useState(true)
  const [hWorking, setHWorking] = useState(false)

  const canManage = permissions.includes('calendar.holiday_manage')

  useEffect(() => {
    if (!profile?.organization_id) {
      setLoading(false)
      return
    }
    const orgId = profile.organization_id
    Promise.all([
      fetchHolidayCalendars(orgId).then((d) => setCalendars(d)).catch((e: Error) => setError(e.message)),
      supabase.from('branches').select('id, name').eq('organization_id', orgId).order('name')
        .then(({ data }) => setBranches((data ?? []) as Branch[])),
    ]).finally(() => setLoading(false))
  }, [profile?.organization_id])

  async function loadDates(cal: HolidayCalendar) {
    setSelected(cal)
    setDatesLoading(true)
    try {
      setDates(await fetchHolidayDates(cal.id))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setDatesLoading(false)
    }
  }

  async function handleCreateCalendar(e: FormEvent) {
    e.preventDefault()
    if (!profile?.organization_id) return
    setError(null)
    try {
      const cal = await createHolidayCalendar({
        organization_id: profile.organization_id,
        branch_id: branchId || null,
        name,
        year,
      })
      setCalendars([cal, ...calendars])
      setShowCreate(false)
      setName('')
      setBranchId('')
      setYear(new Date().getFullYear())
    } catch (e) {
      setError((e as Error).message)
    }
  }

  async function handleAddDate(e: FormEvent) {
    e.preventDefault()
    if (!selected) return
    setError(null)
    try {
      const d = await addHolidayDate({
        holiday_calendar_id: selected.id,
        date: hDate,
        name: hName,
        holiday_type: hType,
        is_paid_holiday: hPaid,
        is_working_day_override: hWorking,
      })
      setDates([...dates, d].sort((a, b) => a.date.localeCompare(b.date)))
      setHDate('')
      setHName('')
      setHType('NATIONAL')
      setHPaid(true)
      setHWorking(false)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  async function handleDeleteDate(id: string) {
    setError(null)
    try {
      await deleteHolidayDate(id)
      setDates(dates.filter((d) => d.id !== id))
    } catch (e) {
      setError((e as Error).message)
    }
  }

  async function handleDeleteCalendar(cal: HolidayCalendar) {
    if (!confirm(`Delete calendar "${cal.name}" and all its dates?`)) return
    setError(null)
    try {
      const { error: err } = await supabase.from('holiday_calendars').delete().eq('id', cal.id)
      if (err) throw err
      setCalendars(calendars.filter((c) => c.id !== cal.id))
      if (selected?.id === cal.id) setSelected(null)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const branchName = (id: string | null) => branches.find((b) => b.id === id)?.name ?? 'All branches'
  const grouped = calendars.reduce<Record<number, HolidayCalendar[]>>((acc, c) => {
    (acc[c.year] ??= []).push(c)
    return acc
  }, {})
  const years = Object.keys(grouped).map(Number).sort((a, b) => b - a)

  return (
    <div className="page">
      <div className="page-header">
        <h2 className="page-title">Holiday Calendars</h2>
        {canManage && (
          <button className="btn btn-sm" onClick={() => setShowCreate(true)}>+ Add Calendar</button>
        )}
      </div>

      {error && <div className="form-error">{error}</div>}

      {loading ? (
        <div className="card"><div className="loading-state">Loading…</div></div>
      ) : calendars.length === 0 ? (
        <div className="card"><div className="empty-state"><div className="empty-state-text">No holiday calendars yet.</div></div></div>
      ) : (
        <div style={{ display: 'grid', gap: 'var(--space-5)' }}>
          {years.map((y) => (
            <div key={y}>
              <h3 style={{ margin: '0 0 var(--space-3)', fontSize: '1rem', color: 'var(--text-muted)' }}>{y}</h3>
              <div style={{ display: 'grid', gap: 'var(--space-3)' }}>
                {grouped[y].map((cal) => (
                  <div key={cal.id} className="card" style={{ padding: 'var(--space-4)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
                      <div>
                        <strong>{cal.name}</strong>
                        <span style={{ marginLeft: 'var(--space-3)', color: 'var(--text-muted)' }}>{branchName(cal.branch_id)}</span>
                        {cal.is_default && <span className="tag tag-teal" style={{ marginLeft: 'var(--space-2)' }}>Default</span>}
                      </div>
                      <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                        <button className="btn btn-sm" onClick={() => loadDates(cal)}>
                          {selected?.id === cal.id ? 'Hide dates' : 'View dates'}
                        </button>
                        {canManage && (
                          <button className="btn btn-sm btn-secondary" onClick={() => handleDeleteCalendar(cal)}>Delete</button>
                        )}
                      </div>
                    </div>

                    {selected?.id === cal.id && (
                      <div style={{ marginTop: 'var(--space-4)' }}>
                        {datesLoading ? (
                          <div className="loading-state">Loading dates…</div>
                        ) : (
                          <>
                            {canManage && (
                              <form onSubmit={handleAddDate} style={{ display: 'grid', gap: 'var(--space-3)', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', marginBottom: 'var(--space-4)' }}>
                                <div className="form-field"><label htmlFor="h-date">Date</label><input id="h-date" type="date" value={hDate} onChange={(e) => setHDate(e.target.value)} required /></div>
                                <div className="form-field"><label htmlFor="h-name">Name</label><input id="h-name" value={hName} onChange={(e) => setHName(e.target.value)} required /></div>
                                <div className="form-field"><label htmlFor="h-type">Type</label>
                                  <select id="h-type" value={hType} onChange={(e) => setHType(e.target.value)}>
                                    {HOLIDAY_TYPES.map((t) => <option key={t} value={t}>{t.toLowerCase()}</option>)}
                                  </select>
                                </div>
                                <div className="form-field"><label>Paid</label><label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}><input type="checkbox" checked={hPaid} onChange={(e) => setHPaid(e.target.checked)} /> Paid holiday</label></div>
                                <div className="form-field"><label>Working override</label><label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}><input type="checkbox" checked={hWorking} onChange={(e) => setHWorking(e.target.checked)} /> Working day</label></div>
                                <div style={{ display: 'flex', alignItems: 'flex-end' }}><button type="submit" className="btn btn-sm">+ Add date</button></div>
                              </form>
                            )}

                            {dates.length === 0 ? (
                              <div className="empty-state"><div className="empty-state-text">No holiday dates yet.</div></div>
                            ) : (
                              <div className="table-wrap">
                                <table className="data-table">
                                  <thead><tr><th>Date</th><th>Name</th><th>Type</th><th>Paid</th><th>Working</th>{canManage && <th></th>}</tr></thead>
                                  <tbody>
                                    {dates.map((d) => (
                                      <tr key={d.id}>
                                        <td>{formatLeaveDate(d.date)}</td>
                                        <td><strong>{d.name}</strong></td>
                                        <td><span className="tag tag-gray">{d.holiday_type.toLowerCase()}</span></td>
                                        <td>{d.is_paid_holiday ? 'Yes' : 'No'}</td>
                                        <td>{d.is_working_day_override ? 'Yes' : 'No'}</td>
                                        {canManage && (
                                          <td><button className="btn btn-sm btn-secondary" onClick={() => handleDeleteDate(d.id)}>Delete</button></td>
                                        )}
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {showCreate && (
        <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) setShowCreate(false) }}>
          <div className="modal">
            <div className="modal-header">
              Add Holiday Calendar
              <button className="modal-close" onClick={() => setShowCreate(false)}>×</button>
            </div>
            <div className="modal-body">
              <form onSubmit={handleCreateCalendar}>
                <div className="form-field" style={{ marginBottom: 'var(--space-4)' }}>
                  <label htmlFor="cal-name">Name</label>
                  <input id="cal-name" value={name} onChange={(e) => setName(e.target.value)} required />
                </div>
                <div className="form-field" style={{ marginBottom: 'var(--space-4)' }}>
                  <label htmlFor="cal-year">Year</label>
                  <input id="cal-year" type="number" value={year} onChange={(e) => setYear(Number(e.target.value))} required />
                </div>
                <div className="form-field" style={{ marginBottom: 'var(--space-4)' }}>
                  <label htmlFor="cal-branch">Branch (optional)</label>
                  <select id="cal-branch" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
                    <option value="">— All branches —</option>
                    {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                </div>
                {error && <div className="form-error">{error}</div>}
                <div className="form-actions">
                  <button type="button" className="btn btn-secondary" onClick={() => setShowCreate(false)}>Cancel</button>
                  <button type="submit" className="btn">Create</button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
