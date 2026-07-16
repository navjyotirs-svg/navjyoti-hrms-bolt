import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '@/auth/AuthContext'
import { supabase } from '@/lib/supabase'
import {
  fetchCalendarEvents,
  createCalendarEvent,
  deleteCalendarEvent,
  formatLeaveDate,
  type CalendarEvent,
  type LeaveRequest,
} from '@/lib/leave'
import { CALENDAR_EVENT_LABELS, type CalendarEventType } from '@/types/roles'
import '@/styles/shared.css'

type ViewMode = 'month' | 'agenda'

interface Branch { id: string; name: string }
interface DayCell { date: Date; day: number; inMonth: boolean; isSunday: boolean; isToday: boolean }

const WEEKDAY_HEADERS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const ALL_EVENT_TYPES = Object.keys(CALENDAR_EVENT_LABELS) as CalendarEventType[]

const EVENT_TYPE_COLORS: Record<CalendarEventType, string> = {
  PUBLIC_HOLIDAY: '#e74c3c', COMPANY_HOLIDAY: '#e67e22', BRANCH_HOLIDAY: '#f39c12',
  WORKING_DAY_OVERRIDE: '#27ae60', WEEKLY_OFF: '#95a5a6', COMPANY_EVENT: '#3498db',
  MEETING: '#9b59b6', TRAINING: '#16a085', ANNOUNCEMENT: '#d35400', OTHER: '#7f8c8d',
}

function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function buildMonthGrid(year: number, month: number): DayCell[] {
  const first = new Date(year, month, 1)
  const offset = (first.getDay() + 6) % 7 // Monday=0 .. Sunday=6
  const start = new Date(year, month, 1 - offset)
  const today = new Date(); today.setHours(0, 0, 0, 0)
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start); d.setDate(start.getDate() + i)
    return { date: d, day: d.getDate(), inMonth: d.getMonth() === month, isSunday: d.getDay() === 0, isToday: d.getTime() === today.getTime() }
  })
}

function eventOnDate(ev: { start_date: string; end_date: string }, iso: string): boolean {
  return iso >= ev.start_date && iso <= ev.end_date
}
function leaveOnDate(l: { from_date: string; to_date: string }, iso: string): boolean {
  return iso >= l.from_date && iso <= l.to_date
}

export function CompanyCalendarPage() {
  const { profile, permissions } = useAuth()
  const canCreate = permissions.includes('calendar.event_create')
  const canDelete = permissions.includes('calendar.event_delete')

  const [view, setView] = useState<ViewMode>('month')
  const [cursor, setCursor] = useState(() => new Date())
  const year = cursor.getFullYear()
  const month = cursor.getMonth()

  const [events, setEvents] = useState<CalendarEvent[]>([])
  const [approvedLeaves, setApprovedLeaves] = useState<LeaveRequest[]>([])
  const [branches, setBranches] = useState<Branch[]>([])
  const [typeFilter, setTypeFilter] = useState<CalendarEventType | 'ALL'>('ALL')
  const [branchFilter, setBranchFilter] = useState<string>('ALL')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [showModal, setShowModal] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({
    title: '', description: '', event_type: 'COMPANY_EVENT' as CalendarEventType,
    start_date: '', end_date: '', is_all_day: true, is_working_day_override: false, branch_id: '',
  })

  // ---- Data fetching ----
  const loadAll = useCallback(async () => {
    if (!profile?.organization_id) return
    setLoading(true); setError(null)
    try {
      const [evs, { data: brs, error: brErr }] = await Promise.all([
        fetchCalendarEvents(profile.organization_id),
        supabase.from('branches').select('id, name').eq('organization_id', profile.organization_id).order('name'),
      ])
      if (brErr) throw new Error(brErr.message)
      setEvents(evs); setBranches((brs ?? []) as Branch[])
      const { data: leaves, error: lvErr } = await supabase
        .from('leave_requests')
        .select('*, leave_types!inner(*), employees!inner(id, full_name, employee_code)')
        .eq('organization_id', profile.organization_id).eq('status', 'APPROVED')
        .order('from_date', { ascending: true })
      if (lvErr) throw new Error(lvErr.message)
      setApprovedLeaves((leaves ?? []) as LeaveRequest[])
    } catch (e) { setError((e as Error).message) } finally { setLoading(false) }
  }, [profile?.organization_id])

  useEffect(() => { loadAll() }, [loadAll])

  // ---- Derived data ----
  const filteredEvents = useMemo(() => events.filter((ev) => {
    if (typeFilter !== 'ALL' && ev.event_type !== typeFilter) return false
    if (branchFilter !== 'ALL' && ev.branch_id && ev.branch_id !== branchFilter) return false
    return true
  }), [events, typeFilter, branchFilter])

  const filteredLeaves = useMemo(() => branchFilter === 'ALL'
    ? approvedLeaves
    : approvedLeaves.filter((l) => l.branch_id === branchFilter || !l.branch_id),
  [approvedLeaves, branchFilter])

  const cells = useMemo(() => buildMonthGrid(year, month), [year, month])

  const agendaItems = useMemo(() => {
    const todayIso = isoDate(new Date())
    const evList = filteredEvents.filter((ev) => ev.end_date >= todayIso).map((ev) => ({
      kind: 'event' as const, id: ev.id, title: ev.title, type: ev.event_type,
      date: ev.start_date, endDate: ev.end_date, description: ev.description,
    }))
    const lvList = filteredLeaves.filter((l) => l.to_date >= todayIso).map((l) => ({
      kind: 'leave' as const, id: l.id,
      title: `${l.employees?.full_name ?? 'Employee'} — ${l.leave_types?.name ?? 'Leave'}`,
      type: 'OTHER' as CalendarEventType, date: l.from_date, endDate: l.to_date, description: l.reason,
    }))
    return [...evList, ...lvList].sort((a, b) => a.date.localeCompare(b.date)).slice(0, 30)
  }, [filteredEvents, filteredLeaves])

  const selectedDay = useMemo(() => {
    if (!selectedDate) return null
    return {
      events: filteredEvents.filter((ev) => eventOnDate(ev, selectedDate)),
      leaves: filteredLeaves.filter((l) => leaveOnDate(l, selectedDate)),
    }
  }, [selectedDate, filteredEvents, filteredLeaves])

  // ---- Handlers ----
  const prevMonth = () => setCursor((c) => new Date(c.getFullYear(), c.getMonth() - 1, 1))
  const nextMonth = () => setCursor((c) => new Date(c.getFullYear(), c.getMonth() + 1, 1))
  const goToday = () => setCursor(new Date())

  function openModal() {
    const today = isoDate(new Date())
    setForm({
      title: '', description: '', event_type: 'COMPANY_EVENT',
      start_date: selectedDate ?? today, end_date: selectedDate ?? today,
      is_all_day: true, is_working_day_override: false,
      branch_id: branchFilter !== 'ALL' ? branchFilter : '',
    })
    setShowModal(true)
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!profile?.organization_id) return
    if (!form.title.trim() || !form.start_date || !form.end_date) { setError('Title and dates are required'); return }
    setSaving(true); setError(null)
    try {
      await createCalendarEvent({
        organization_id: profile.organization_id, branch_id: form.branch_id || null, department_id: null,
        title: form.title.trim(), description: form.description.trim() || null,
        event_type: form.event_type, start_date: form.start_date, end_date: form.end_date,
        start_time: form.is_all_day ? null : '09:00', end_time: form.is_all_day ? null : '17:00',
        is_all_day: form.is_all_day, is_working_day_override: form.is_working_day_override,
        is_weekly_off_override: false, visibility_scope: 'ORG', is_active: true,
      })
      setShowModal(false); await loadAll()
    } catch (e2) { setError((e2 as Error).message) } finally { setSaving(false) }
  }

  async function handleDelete(id: string) {
    if (!window.confirm('Delete this calendar event?')) return
    try { await deleteCalendarEvent(id); await loadAll() } catch (e) { setError((e as Error).message) }
  }

  if (loading) return <div className="page"><div className="loading-state">Loading calendar…</div></div>

  return (
    <div className="page">
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
        <h2 className="page-title">Company Calendar</h2>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: '4px' }}>
            <button className={`btn btn-sm ${view === 'month' ? '' : 'btn-secondary'}`} onClick={() => setView('month')}>Month</button>
            <button className={`btn btn-sm ${view === 'agenda' ? '' : 'btn-secondary'}`} onClick={() => setView('agenda')}>Agenda</button>
          </div>
          {canCreate && <button className="btn btn-sm" onClick={openModal}>+ Add Event</button>}
        </div>
      </div>

      {error && <div className="form-error" style={{ marginBottom: '12px' }}>{error}</div>}

      {/* Filters */}
      <div style={{ display: 'flex', gap: '12px', marginBottom: '16px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div className="form-field" style={{ minWidth: '180px' }}>
          <label>Event Type</label>
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as CalendarEventType | 'ALL')}>
            <option value="ALL">All Types</option>
            {ALL_EVENT_TYPES.map((t) => <option key={t} value={t}>{CALENDAR_EVENT_LABELS[t]}</option>)}
          </select>
        </div>
        <div className="form-field" style={{ minWidth: '180px' }}>
          <label>Branch</label>
          <select value={branchFilter} onChange={(e) => setBranchFilter(e.target.value)}>
            <option value="ALL">All Branches</option>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </div>
      </div>

      {/* ---------------- Month view ---------------- */}
      {view === 'month' && (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button className="btn btn-sm btn-secondary" onClick={prevMonth}>‹ Prev</button>
              <button className="btn btn-sm btn-secondary" onClick={nextMonth}>Next ›</button>
              <button className="btn btn-sm btn-secondary" onClick={goToday}>Today</button>
            </div>
            <h3 style={{ margin: 0, fontFamily: 'var(--font-heading)' }}>
              {cursor.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}
            </h3>
          </div>

          <div className="calendar-grid">
            {WEEKDAY_HEADERS.map((d) => <div key={d} className="calendar-cell calendar-cell-header">{d}</div>)}
            {cells.map((cell) => {
              const iso = isoDate(cell.date)
              const dayEvents = filteredEvents.filter((ev) => eventOnDate(ev, iso))
              const dayLeaves = filteredLeaves.filter((l) => leaveOnDate(l, iso))
              const dots = dayEvents.slice(0, 4)
              const cls = ['calendar-cell', !cell.inMonth && 'calendar-cell-out', cell.isSunday && 'calendar-cell-sunday', cell.isToday && 'calendar-cell-today', selectedDate === iso && 'calendar-cell-selected'].filter(Boolean).join(' ')
              return (
                <div key={iso} className={cls} onClick={() => setSelectedDate(iso)}>
                  <div className="calendar-cell-date">{cell.day}</div>
                  <div className="calendar-event-dots">
                    {dots.map((ev) => (
                      <span key={ev.id} className="calendar-event-dot" style={{ background: EVENT_TYPE_COLORS[ev.event_type] }} title={ev.title} />
                    ))}
                    {dayLeaves.length > 0 && (
                      <span className="calendar-event-dot" style={{ background: '#2c3e50' }} title="Approved leave" />
                    )}
                  </div>
                  {(dayEvents.length > 4 || dayLeaves.length > 1) && (
                    <div style={{ fontSize: '10px', color: 'var(--slate)', marginTop: '2px' }}>
                      +{Math.max(0, dayEvents.length - 4) + (dayLeaves.length > 1 ? dayLeaves.length - 1 : 0)} more
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {/* Selected day details */}
          {selectedDate && selectedDay && (
            <div className="card" style={{ marginTop: '16px' }}>
              <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>{formatLeaveDate(selectedDate)}</span>
                <button className="modal-close" style={{ float: 'none' }} onClick={() => setSelectedDate(null)}>×</button>
              </div>
              <div className="card-body">
                {selectedDay.events.length === 0 && selectedDay.leaves.length === 0 ? (
                  <div className="empty-state"><div className="empty-state-text">No events on this day.</div></div>
                ) : (
                  <ul className="calendar-event-list">
                    {selectedDay.events.map((ev) => (
                      <li key={ev.id} className="calendar-event-list-item">
                        <span className="calendar-event-dot" style={{ background: EVENT_TYPE_COLORS[ev.event_type] }} />
                        <div style={{ flex: 1 }}>
                          <strong>{ev.title}</strong>
                          <div style={{ fontSize: '12px', color: 'var(--slate)' }}>
                            {CALENDAR_EVENT_LABELS[ev.event_type]}
                            {ev.start_date !== ev.end_date && ` · ${formatLeaveDate(ev.start_date)} – ${formatLeaveDate(ev.end_date)}`}
                          </div>
                          {ev.description && <div style={{ fontSize: '13px', marginTop: '2px' }}>{ev.description}</div>}
                        </div>
                        {canDelete && <button className="btn btn-sm btn-danger" onClick={() => handleDelete(ev.id)}>Delete</button>}
                      </li>
                    ))}
                    {selectedDay.leaves.map((l) => (
                      <li key={l.id} className="calendar-event-list-item">
                        <span className="calendar-event-dot" style={{ background: '#2c3e50' }} />
                        <div style={{ flex: 1 }}>
                          <strong>{l.employees?.full_name ?? 'Employee'}</strong>
                          <div style={{ fontSize: '12px', color: 'var(--slate)' }}>
                            On leave: {l.leave_types?.name ?? 'Leave'} · {formatLeaveDate(l.from_date)} – {formatLeaveDate(l.to_date)}
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}
        </>
      )}

      {/* ---------------- Agenda view ---------------- */}
      {view === 'agenda' && (
        <div className="card">
          <div className="card-header">Upcoming Events &amp; Leave</div>
          <div className="card-body">
            {agendaItems.length === 0 ? (
              <div className="empty-state"><div className="empty-state-text">No upcoming events.</div></div>
            ) : (
              <ul className="calendar-event-list">
                {agendaItems.map((item) => (
                  <li key={`${item.kind}-${item.id}`} className="calendar-event-list-item">
                    <span className="calendar-event-dot" style={{ background: EVENT_TYPE_COLORS[item.type] }} />
                    <div style={{ flex: 1 }}>
                      <strong>{item.title}</strong>
                      <div style={{ fontSize: '12px', color: 'var(--slate)' }}>
                        {formatLeaveDate(item.date)}
                        {item.endDate !== item.date && ` – ${formatLeaveDate(item.endDate)}`}
                        {item.kind === 'event' && ` · ${CALENDAR_EVENT_LABELS[item.type]}`}
                      </div>
                      {item.description && <div style={{ fontSize: '13px', marginTop: '2px' }}>{item.description}</div>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {/* ---------------- Add Event modal ---------------- */}
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              Add Calendar Event
              <button className="modal-close" onClick={() => setShowModal(false)}>×</button>
            </div>
            <div className="modal-body">
              <form onSubmit={handleCreate}>
                <div className="form-field" style={{ marginBottom: '12px' }}>
                  <label>Title</label>
                  <input type="text" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required />
                </div>
                <div className="form-field" style={{ marginBottom: '12px' }}>
                  <label>Event Type</label>
                  <select value={form.event_type} onChange={(e) => setForm({ ...form, event_type: e.target.value as CalendarEventType })}>
                    {ALL_EVENT_TYPES.map((t) => <option key={t} value={t}>{CALENDAR_EVENT_LABELS[t]}</option>)}
                  </select>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
                  <div className="form-field">
                    <label>Start Date</label>
                    <input type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} required />
                  </div>
                  <div className="form-field">
                    <label>End Date</label>
                    <input type="date" value={form.end_date} min={form.start_date || undefined} onChange={(e) => setForm({ ...form, end_date: e.target.value })} required />
                  </div>
                </div>
                <div className="form-field" style={{ marginBottom: '12px' }}>
                  <label>Branch (optional)</label>
                  <select value={form.branch_id} onChange={(e) => setForm({ ...form, branch_id: e.target.value })}>
                    <option value="">All branches</option>
                    {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                </div>
                <div className="form-field" style={{ marginBottom: '12px' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 'normal' }}>
                    <input type="checkbox" checked={form.is_all_day} onChange={(e) => setForm({ ...form, is_all_day: e.target.checked })} />
                    All day event
                  </label>
                </div>
                <div className="form-field" style={{ marginBottom: '12px' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 'normal' }}>
                    <input type="checkbox" checked={form.is_working_day_override} onChange={(e) => setForm({ ...form, is_working_day_override: e.target.checked })} />
                    Working day override (marks this as a working day)
                  </label>
                </div>
                <div className="form-field" style={{ marginBottom: '12px' }}>
                  <label>Description</label>
                  <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={3} />
                </div>
                <div className="modal-footer" style={{ padding: 0 }}>
                  <button type="button" className="btn btn-secondary" onClick={() => setShowModal(false)}>Cancel</button>
                  <button type="submit" className="btn" disabled={saving}>{saving ? 'Saving…' : 'Create Event'}</button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
