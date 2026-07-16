import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/auth/AuthContext'
import { ROLE_LABELS, EMPLOYMENT_STATUS_LABELS, type EmploymentStatus } from '@/types/roles'
import '@/styles/shared.css'

interface Employee {
  id: string; employee_code: string; full_name: string; designation: string | null
  employment_type: string | null; work_mode: string | null; employment_status: string
  is_active: boolean; user_id: string; work_email: string | null
}

interface EmployeeWithRole extends Employee { role: string | null }

export function EmployeeDirectoryPage() {
  const { profile, permissions } = useAuth()
  const [employees, setEmployees] = useState<EmployeeWithRole[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [resending, setResending] = useState<string | null>(null)
  const [resendMessage, setResendMessage] = useState<string | null>(null)
  const canCreate = permissions.includes('employee.create')

  useEffect(() => {
    const orgId = profile?.organization_id
    if (!orgId) {
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    supabase
      .from('employees')
      .select('id, employee_code, full_name, designation, employment_type, work_mode, employment_status, is_active, user_id, work_email')
      .eq('organization_id', orgId)
      .order('full_name')
      .then(({ data, error }) => {
        if (error) {
          setError(error.message)
          setLoading(false)
          return
        }
        const empList = (data ?? []) as Employee[]
        if (empList.length === 0) {
          setEmployees([])
          setLoading(false)
          return
        }
        supabase
          .from('user_profiles')
          .select('id, role')
          .in('id', empList.map((e) => e.user_id))
          .then(({ data: profileData }) => {
            const roleMap = new Map(
              (profileData ?? []).map((p: { id: string; role: string | null }) => [p.id, p.role])
            )
            setEmployees(empList.map((e) => ({ ...e, role: roleMap.get(e.user_id) ?? null })))
            setLoading(false)
          })
      })
  }, [profile?.organization_id])

  const filtered = employees.filter((e) => {
    const q = search.trim().toLowerCase()
    return (!q || e.full_name.toLowerCase().includes(q) || e.employee_code.toLowerCase().includes(q))
      && (statusFilter === 'all' || e.employment_status === statusFilter)
  })

  async function handleResend(employeeId: string, _email: string) {
    setResending(employeeId)
    setResendMessage(null)
    try {
      const { data: sessionData } = await supabase.auth.getSession()
      const accessToken = sessionData.session?.access_token
      if (!accessToken) throw new Error('No session')

      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/invite-employee`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
          apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({ action: 'resend_invitation', employee_id: employeeId }),
      })

      const data = await response.json()
      if (!response.ok) {
        setResendMessage(data.error || 'Failed to resend invitation')
      } else {
        setResendMessage('Invitation email resent successfully.')
      }
    } catch (err) {
      setResendMessage(err instanceof Error ? err.message : 'Failed to resend invitation')
    }
    setResending(null)
  }

  return (
    <div className="page">
      <div className="page-header">
        <h2 className="page-title">Employees</h2>
        {canCreate && <Link to="/employees/add" className="btn btn-sm">+ Invite Employee</Link>}
      </div>

      {error && <div className="form-error">{error}</div>}
      {resendMessage && (
        <div className={resendMessage.includes('success') ? 'form-success' : 'form-error'} style={{ marginBottom: 'var(--space-3)' }}>
          {resendMessage}
        </div>
      )}

      <div className="card">
        <div className="form-grid" style={{ marginBottom: 'var(--space-4)' }}>
          <div className="form-field">
            <label htmlFor="employee-search">Search</label>
            <input id="employee-search" type="text" value={search}
              onChange={(e) => setSearch(e.target.value)} placeholder="Name or employee code" />
          </div>
          <div className="form-field">
            <label htmlFor="status-filter">Status</label>
            <select id="status-filter" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="all">All Statuses</option>
              {Object.entries(EMPLOYMENT_STATUS_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>
        </div>

        {loading ? <div className="loading-state">Loading…</div>
          : filtered.length === 0 ? <div className="empty-state"><div className="empty-state-text">No employees found.</div></div>
          : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr><th>Code</th><th>Name</th><th>Role</th><th>Designation</th><th>Employment Type</th><th>Work Mode</th><th>Status</th><th></th></tr>
              </thead>
              <tbody>
                {filtered.map((e) => (
                  <tr key={e.id}>
                    <td>{e.employee_code}</td>
                    <td><Link to={`/employees/${e.id}`} style={{ fontWeight: 600 }}>{e.full_name}</Link></td>
                    <td>{e.role ? <span className="tag tag-ink">{ROLE_LABELS[e.role as keyof typeof ROLE_LABELS] ?? e.role}</span> : '—'}</td>
                    <td>{e.designation ?? '—'}</td>
                    <td>{e.employment_type ?? '—'}</td>
                    <td>{e.work_mode ?? '—'}</td>
                    <td><span className={`tag ${e.is_active ? 'tag-teal' : 'tag-gray'}`}>{EMPLOYMENT_STATUS_LABELS[e.employment_status as EmploymentStatus] ?? e.employment_status}</span></td>
                    <td>
                      {canCreate && e.employment_status === 'invited' && (
                        <button
                          type="button"
                          className="btn btn-sm"
                          disabled={resending === e.id}
                          onClick={() => handleResend(e.id, e.work_email ?? '')}
                        >
                          {resending === e.id ? 'Sending…' : 'Resend Invitation'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
