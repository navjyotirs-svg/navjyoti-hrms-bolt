import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/auth/AuthContext'
import { ROLE_LABELS } from '@/types/roles'
import '@/styles/shared.css'

interface Employee {
  id: string; employee_code: string; full_name: string; designation: string | null
  employment_type: string | null; work_mode: string | null; employment_status: string
  is_active: boolean; user_id: string; work_email: string | null
}

interface EmployeeWithRole extends Employee {
  role: string | null
  profile_status: string | null
  profile_is_active: boolean | null
  membership_active: boolean | null
}

type DirectoryStatus =
  | 'Invitation Sent'
  | 'Password Setup Pending'
  | 'Activation Pending'
  | 'Active'
  | 'Suspended'
  | 'Inactive'
  | 'Offboarded'
  | 'Configuration Error'

function deriveDirectoryStatus(e: EmployeeWithRole): DirectoryStatus {
  if (e.employment_status === 'offboarded') return 'Offboarded'
  if (e.employment_status === 'suspended' || e.profile_status === 'disabled') return 'Suspended'
  if (e.employment_status === 'invited' && e.profile_status === 'pending_activation') return 'Invitation Sent'
  if (e.employment_status === 'invited' && !e.profile_status) return 'Invitation Sent'
  if (e.profile_status === 'pending_activation' && e.employment_status !== 'invited') return 'Password Setup Pending'
  // All records exist — check for full consistency
  if (e.profile_status === 'active' && e.profile_is_active && e.is_active && e.membership_active) return 'Active'
  // Partial activation — records are inconsistent
  if (e.profile_status === 'active' || e.employment_status === 'active') return 'Configuration Error'
  if (!e.profile_is_active || !e.is_active) return 'Inactive'
  return 'Activation Pending'
}

function getConfigDetails(e: EmployeeWithRole): { label: string; value: string }[] {
  return [
    { label: 'Authentication', value: e.user_id ? 'Ready' : 'Pending' },
    { label: 'Profile', value: e.profile_status === 'active' ? 'Active' : e.profile_status ?? 'Missing' },
    { label: 'Membership', value: e.membership_active ? 'Active' : e.membership_active === false ? 'Inactive' : 'Missing' },
    { label: 'Employee', value: e.employment_status },
    { label: 'Role', value: e.role ?? 'Not configured' },
  ]
}

export function EmployeeDirectoryPage() {
  const { profile, permissions } = useAuth()
  const [employees, setEmployees] = useState<EmployeeWithRole[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [resending, setResending] = useState<string | null>(null)
  const [resendMessage, setResendMessage] = useState<string | null>(null)
  const [resendLink, setResendLink] = useState<string | null>(null)
  const [repairing, setRepairing] = useState<string | null>(null)
  const [statusChanging, setStatusChanging] = useState<string | null>(null)
  const canCreate = permissions.includes('employee.create')
  const canManageStatus = permissions.includes('employee.status.manage')

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
          .select('id, role, status, is_active')
          .in('id', empList.map((e) => e.user_id))
          .then(({ data: profileData }) => {
            const profileMap = new Map(
              (profileData ?? []).map((p: { id: string; role: string | null; status: string | null; is_active: boolean | null }) =>
                [p.id, p])
            )
            supabase
              .from('user_organization_memberships')
              .select('user_id, is_active')
              .in('user_id', empList.map((e) => e.user_id))
              .then(({ data: membershipData }) => {
                const membershipMap = new Map(
                  (membershipData ?? []).map((m: { user_id: string; is_active: boolean }) => [m.user_id, m.is_active])
                )
                setEmployees(empList.map((e) => {
                  const p = profileMap.get(e.user_id)
                  return {
                    ...e,
                    role: p?.role ?? null,
                    profile_status: p?.status ?? null,
                    profile_is_active: p?.is_active ?? null,
                    membership_active: membershipMap.get(e.user_id) ?? null,
                  }
                }))
                setLoading(false)
              })
          })
      })
  }, [profile?.organization_id])

  const filtered = employees.filter((e) => {
    const q = search.trim().toLowerCase()
    const dirStatus = deriveDirectoryStatus(e)
    return (!q || e.full_name.toLowerCase().includes(q) || e.employee_code.toLowerCase().includes(q))
      && (statusFilter === 'all' || dirStatus === statusFilter || e.employment_status === statusFilter)
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
        setResendLink(null)
      } else {
        setResendMessage(data.message || 'Invitation link generated.')
        setResendLink(data.setup_link ?? null)
      }
    } catch (err) {
      setResendMessage(err instanceof Error ? err.message : 'Failed to resend invitation')
    }
    setResending(null)
  }

  async function handleRepairActivation(employeeId: string) {
    setRepairing(employeeId)
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
        body: JSON.stringify({ action: 'repair_activation', employee_id: employeeId }),
      })

      const data = await response.json()
      if (!response.ok) {
        setResendMessage(data.error || 'Failed to repair account activation')
      } else {
        setResendMessage('Account activation repaired successfully.')
        setEmployees((prev) =>
          prev.map((e) =>
            e.id === employeeId
              ? {
                  ...e,
                  employment_status: 'active',
                  is_active: true,
                  profile_status: 'active',
                  profile_is_active: true,
                  membership_active: true,
                }
              : e
          )
        )
      }
    } catch (err) {
      setResendMessage(err instanceof Error ? err.message : 'Failed to repair account activation')
    }
    setRepairing(null)
  }

  async function handleStatusChange(employeeId: string, newStatus: string) {
    setStatusChanging(employeeId)
    setResendMessage(null)
    try {
      const { data: sessionData } = await supabase.auth.getSession()
      const accessToken = sessionData.session?.access_token
      if (!accessToken) throw new Error('No session')

      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/manage-employee`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
          apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({
          action: 'change_status',
          employee_id: employeeId,
          new_status: newStatus,
          reason: 'Status changed by administrator',
        }),
      })

      const data = await response.json()
      if (!response.ok) {
        setResendMessage(data.error || 'Failed to change status')
      } else {
        setResendMessage(data.message || 'Status updated successfully.')
        const isActive = !['inactive', 'offboarded', 'terminated', 'suspended'].includes(newStatus)
        setEmployees((prev) =>
          prev.map((e) =>
            e.id === employeeId
              ? { ...e, employment_status: newStatus, is_active: isActive }
              : e
          )
        )
      }
    } catch (err) {
      setResendMessage(err instanceof Error ? err.message : 'Failed to change status')
    }
    setStatusChanging(null)
  }

  async function handleOffboard(employeeId: string) {
    const lastWorkingDate = prompt('Enter last working date (YYYY-MM-DD) or leave blank for today:')
    if (lastWorkingDate === null) return
    setStatusChanging(employeeId)
    setResendMessage(null)
    try {
      const { data: sessionData } = await supabase.auth.getSession()
      const accessToken = sessionData.session?.access_token
      if (!accessToken) throw new Error('No session')

      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/manage-employee`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
          apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({
          action: 'offboard',
          employee_id: employeeId,
          last_working_date: lastWorkingDate || null,
          reason: 'Offboarded by administrator',
        }),
      })

      const data = await response.json()
      if (!response.ok) {
        setResendMessage(data.error || 'Failed to offboard employee')
      } else {
        setResendMessage(data.message || 'Employee offboarded successfully.')
        setEmployees((prev) =>
          prev.map((e) =>
            e.id === employeeId
              ? { ...e, employment_status: 'offboarded', is_active: false }
              : e
          )
        )
      }
    } catch (err) {
      setResendMessage(err instanceof Error ? err.message : 'Failed to offboard employee')
    }
    setStatusChanging(null)
  }

  return (
    <div className="page">
      <div className="page-header">
        <h2 className="page-title">Employees</h2>
        {canCreate && <Link to="/employees/add" className="btn btn-sm">+ Invite Employee</Link>}
      </div>

      {error && <div className="form-error">{error}</div>}
      {resendMessage && (
        <div className={resendMessage.includes('success') || resendMessage.includes('generated') ? 'form-success' : 'form-error'} style={{ marginBottom: 'var(--space-3)' }}>
          {resendMessage}
          {resendLink && (
            <div style={{ marginTop: 'var(--space-2)', wordBreak: 'break-all' }}>
              <label style={{ fontWeight: 700, display: 'block', marginBottom: 'var(--space-1)' }}>Password Setup Link:</label>
              <code style={{ display: 'block', padding: 'var(--space-2)', background: 'var(--surface-2)', borderRadius: '4px', fontSize: '0.85em' }}>{resendLink}</code>
              <button
                type="button"
                className="btn btn-sm"
                style={{ marginTop: 'var(--space-2)' }}
                onClick={() => navigator.clipboard.writeText(resendLink)}
              >
                Copy Link
              </button>
            </div>
          )}
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
              <option value="Active">Active</option>
              <option value="Invitation Sent">Invitation Sent</option>
              <option value="Password Setup Pending">Password Setup Pending</option>
              <option value="Activation Pending">Activation Pending</option>
              <option value="Suspended">Suspended</option>
              <option value="Inactive">Inactive</option>
              <option value="Offboarded">Offboarded</option>
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
                    <td>
                      <span
                        className={`tag ${deriveDirectoryStatus(e) === 'Active' ? 'tag-teal' : deriveDirectoryStatus(e) === 'Configuration Error' ? 'tag-rose' : 'tag-gray'}`}
                        title={getConfigDetails(e).map((d) => `${d.label}: ${d.value}`).join(' | ')}
                      >
                        {deriveDirectoryStatus(e)}
                      </span>
                    </td>
                    <td>
                      {canCreate && deriveDirectoryStatus(e) === 'Invitation Sent' && (
                        <button
                          type="button"
                          className="btn btn-sm"
                          disabled={resending === e.id}
                          onClick={() => handleResend(e.id, e.work_email ?? '')}
                        >
                          {resending === e.id ? 'Sending…' : 'Resend Invitation'}
                        </button>
                      )}
                      {canManageStatus && (deriveDirectoryStatus(e) === 'Activation Pending' || deriveDirectoryStatus(e) === 'Configuration Error' || deriveDirectoryStatus(e) === 'Password Setup Pending') && (
                        <button
                          type="button"
                          className="btn btn-sm"
                          disabled={repairing === e.id}
                          onClick={() => handleRepairActivation(e.id)}
                          style={{ marginLeft: canCreate && deriveDirectoryStatus(e) === 'Invitation Sent' ? 'var(--space-2)' : 0 }}
                        >
                          {repairing === e.id ? 'Repairing…' : 'Repair Account Activation'}
                        </button>
                      )}
                      {canManageStatus && deriveDirectoryStatus(e) === 'Active' && (
                        <select
                          className="btn btn-sm"
                          value=""
                          disabled={statusChanging === e.id}
                          onChange={(ev) => {
                            const ns = ev.target.value
                            if (!ns) return
                            if (ns === 'offboarded') {
                              handleOffboard(e.id)
                            } else {
                              handleStatusChange(e.id, ns)
                            }
                            ev.target.value = ''
                          }}
                          style={{ fontSize: '12px', padding: '4px 8px' }}
                        >
                          <option value="">Actions…</option>
                          <option value="suspended">Suspend</option>
                          <option value="inactive">Deactivate</option>
                          <option value="notice_period">Notice Period</option>
                          <option value="offboarded">Offboard</option>
                        </select>
                      )}
                      {canManageStatus && deriveDirectoryStatus(e) === 'Offboarded' && (
                        <button
                          type="button"
                          className="btn btn-sm"
                          disabled={statusChanging === e.id}
                          onClick={() => handleStatusChange(e.id, 'active')}
                        >
                          {statusChanging === e.id ? 'Reactivating…' : 'Reactivate'}
                        </button>
                      )}
                      {canManageStatus && (deriveDirectoryStatus(e) === 'Suspended' || deriveDirectoryStatus(e) === 'Inactive') && (
                        <button
                          type="button"
                          className="btn btn-sm"
                          disabled={statusChanging === e.id}
                          onClick={() => handleStatusChange(e.id, 'active')}
                          style={{ marginLeft: 'var(--space-2)' }}
                        >
                          {statusChanging === e.id ? 'Reactivating…' : 'Reactivate'}
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
