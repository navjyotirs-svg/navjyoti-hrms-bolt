import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/auth/AuthContext'
import { ROLES, type Role } from '@/types/roles'
import { FormSkeleton } from '@/components/Skeleton'
import '@/styles/shared.css'

interface Branch { id: string; name: string }
interface Department { id: string; name: string }
interface Manager { id: string; full_name: string; employee_code: string }

type CreateMode = 'invite' | 'direct'

export function AddEmployeePage() {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const [branches, setBranches] = useState<Branch[]>([])
  const [departments, setDepartments] = useState<Department[]>([])
  const [managers, setManagers] = useState<Manager[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [setupLink, setSetupLink] = useState<string | null>(null)
  const [createdCredentials, setCreatedCredentials] = useState<{ email: string; password: string } | null>(null)

  const [mode, setMode] = useState<CreateMode>('invite')
  const [fullName, setFullName] = useState('')
  const [workEmail, setWorkEmail] = useState('')
  const [role, setRole] = useState<Role>('employee')
  const [employeeCode, setEmployeeCode] = useState('')
  const [designation, setDesignation] = useState('')
  const [branchId, setBranchId] = useState('')
  const [departmentId, setDepartmentId] = useState('')
  const [managerId, setManagerId] = useState('')
  const [joiningDate, setJoiningDate] = useState(new Date().toISOString().slice(0, 10))
  const [workMode, setWorkMode] = useState('Office')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)

  useEffect(() => {
    if (!profile?.organization_id) return
    const orgId = profile.organization_id

    Promise.all([
      supabase.from('branches').select('id, name').eq('organization_id', orgId).eq('is_active', true).order('name'),
      supabase.from('departments').select('id, name').eq('organization_id', orgId).eq('is_active', true).order('name'),
      supabase.from('employees').select('id, full_name, employee_code').eq('organization_id', orgId).eq('is_active', true).order('full_name'),
    ]).then(([bRes, dRes, mRes]) => {
      if (bRes.data) setBranches(bRes.data as Branch[])
      if (dRes.data) setDepartments(dRes.data as Department[])
      if (mRes.data) setManagers(mRes.data as Manager[])
      setLoading(false)
    })
  }, [profile?.organization_id])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSuccessMessage(null)
    setSetupLink(null)
    setCreatedCredentials(null)
    setSubmitting(true)

    if (!fullName.trim() || !workEmail.trim() || !employeeCode.trim() || !joiningDate) {
      setError('Full name, work email, employee code, and joining date are required')
      setSubmitting(false)
      return
    }

    if (mode === 'direct' && password.length < 8) {
      setError('Password must be at least 8 characters')
      setSubmitting(false)
      return
    }

    try {
      const { data: sessionData } = await supabase.auth.getSession()
      let accessToken = sessionData.session?.access_token
      if (!accessToken) {
        const { data: refreshData, error: refreshError } = await supabase.auth.refreshSession()
        if (refreshError || !refreshData.session) {
          setError('Your session has expired. Please sign in again.')
          setSubmitting(false)
          return
        }
        accessToken = refreshData.session.access_token
      }

      const payload: Record<string, unknown> = {
        full_name: fullName.trim(),
        work_email: workEmail.trim(),
        role,
        employee_code: employeeCode.trim(),
        designation: designation.trim() || null,
        branch_id: branchId || null,
        department_id: departmentId || null,
        reporting_manager_id: managerId || null,
        joining_date: joiningDate,
        work_mode: workMode,
      }

      if (mode === 'direct') {
        payload.action = 'create_direct'
        payload.password = password
      }

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/invite-employee`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
            apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
          },
          body: JSON.stringify(payload),
        }
      )

      const data = await response.json()

      if (!response.ok) {
        setError(data.error || 'Failed to create employee')
        setSubmitting(false)
      } else {
        setSuccessMessage(data.message || 'Employee created successfully.')
        if (mode === 'direct' && data.credentials) {
          setCreatedCredentials(data.credentials)
        } else {
          setSetupLink(data.setup_link ?? null)
        }
        setSubmitting(false)
      }
    } catch {
      setError('Network error — please try again')
      setSubmitting(false)
    }
  }

  if (loading) return <div className="page"><FormSkeleton rows={8} /></div>

  return (
    <div className="page">
      <div className="page-header">
        <h2 className="page-title">{mode === 'direct' ? 'Create Employee' : 'Invite Employee'}</h2>
      </div>

      <div className="card">
        <div className="card-body">
          {error && <div className="form-error" style={{ marginBottom: 'var(--space-4)' }}>{error}</div>}
          {successMessage && (
            <div className="form-success" style={{ marginBottom: 'var(--space-4)' }}>
              {successMessage}
              {setupLink && (
                <div style={{ marginTop: 'var(--space-3)', wordBreak: 'break-all' }}>
                  <label style={{ fontWeight: 700, display: 'block', marginBottom: 'var(--space-1)' }}>Password Setup Link:</label>
                  <code style={{ display: 'block', padding: 'var(--space-2)', background: 'var(--surface-2)', borderRadius: '4px', fontSize: '0.85em' }}>{setupLink}</code>
                  <button
                    type="button"
                    className="btn btn-sm"
                    style={{ marginTop: 'var(--space-2)' }}
                    onClick={() => navigator.clipboard.writeText(setupLink)}
                  >
                    Copy Link
                  </button>
                </div>
              )}
              {createdCredentials && (
                <div style={{ marginTop: 'var(--space-3)' }}>
                  <label style={{ fontWeight: 700, display: 'block', marginBottom: 'var(--space-1)' }}>Login Credentials (give these to the employee):</label>
                  <div style={{ padding: 'var(--space-3)', background: 'var(--surface-2)', borderRadius: '6px', fontSize: '0.9em' }}>
                    <div><strong>Email:</strong> {createdCredentials.email}</div>
                    <div><strong>Password:</strong> {createdCredentials.password}</div>
                  </div>
                  <button
                    type="button"
                    className="btn btn-sm"
                    style={{ marginTop: 'var(--space-2)' }}
                    onClick={() => navigator.clipboard.writeText(`Email: ${createdCredentials.email}\nPassword: ${createdCredentials.password}`)}
                  >
                    Copy Credentials
                  </button>
                </div>
              )}
              <div style={{ marginTop: 'var(--space-3)' }}>
                <button type="button" className="btn btn-sm" onClick={() => navigate('/employees')}>
                  Back to Employees
                </button>
              </div>
            </div>
          )}
          {!successMessage && (
          <>
          <div className="form-grid" style={{ marginBottom: 'var(--space-4)' }}>
            <div className="form-field">
              <label>Creation Mode</label>
              <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                <button
                  type="button"
                  className={`btn btn-sm ${mode === 'invite' ? '' : 'btn-secondary'}`}
                  onClick={() => setMode('invite')}
                >
                  Send Invitation
                </button>
                <button
                  type="button"
                  className={`btn btn-sm ${mode === 'direct' ? '' : 'btn-secondary'}`}
                  onClick={() => setMode('direct')}
                >
                  Create with Password
                </button>
              </div>
              <div style={{ fontSize: '12px', color: 'var(--slate)', marginTop: 'var(--space-1)' }}>
                {mode === 'invite'
                  ? 'Sends an invitation email with a password-setup link.'
                  : 'Creates the account with a password you choose. No email is sent. Give the credentials to the employee directly.'}
              </div>
            </div>
          </div>

          <form onSubmit={handleSubmit}>
            <div className="form-grid">
              <div className="form-field">
                <label htmlFor="fullName">Full Name *</label>
                <input id="fullName" value={fullName} onChange={(e) => setFullName(e.target.value)} required />
              </div>
              <div className="form-field">
                <label htmlFor="workEmail">Work Email *</label>
                <input id="workEmail" type="email" value={workEmail} onChange={(e) => setWorkEmail(e.target.value)} required />
              </div>
              <div className="form-field">
                <label htmlFor="employeeCode">Employee Code *</label>
                <input id="employeeCode" value={employeeCode} onChange={(e) => setEmployeeCode(e.target.value)} required />
              </div>
              <div className="form-field">
                <label htmlFor="role">Role *</label>
                <select id="role" value={role} onChange={(e) => setRole(e.target.value as Role)}>
                  {ROLES.map((r) => (
                    <option key={r.code} value={r.code}>{r.label}</option>
                  ))}
                </select>
              </div>
              {mode === 'direct' && (
                <div className="form-field">
                  <label htmlFor="password">Password *</label>
                  <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                    <input
                      id="password"
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      minLength={8}
                      placeholder="At least 8 characters"
                      style={{ flex: 1 }}
                    />
                    <button
                      type="button"
                      className="btn btn-sm btn-secondary"
                      onClick={() => setShowPassword((s) => !s)}
                      style={{ whiteSpace: 'nowrap' }}
                    >
                      {showPassword ? 'Hide' : 'Show'}
                    </button>
                  </div>
                </div>
              )}
              <div className="form-field">
                <label htmlFor="designation">Designation</label>
                <input id="designation" value={designation} onChange={(e) => setDesignation(e.target.value)} />
              </div>
              <div className="form-field">
                <label htmlFor="workMode">Work Mode</label>
                <select id="workMode" value={workMode} onChange={(e) => setWorkMode(e.target.value)}>
                  <option>Office</option>
                  <option>WFH</option>
                  <option>Hybrid</option>
                </select>
              </div>
              <div className="form-field">
                <label htmlFor="branch">Branch</label>
                <select id="branch" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
                  <option value="">— No branch —</option>
                  {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </div>
              <div className="form-field">
                <label htmlFor="department">Department</label>
                <select id="department" value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
                  <option value="">— No department —</option>
                  {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </div>
              <div className="form-field">
                <label htmlFor="manager">Reporting Manager</label>
                <select id="manager" value={managerId} onChange={(e) => setManagerId(e.target.value)}>
                  <option value="">— No manager —</option>
                  {managers.map((m) => <option key={m.id} value={m.id}>{m.full_name} ({m.employee_code})</option>)}
                </select>
              </div>
              <div className="form-field">
                <label htmlFor="joiningDate">Joining Date *</label>
                <input id="joiningDate" type="date" value={joiningDate} onChange={(e) => setJoiningDate(e.target.value)} required />
              </div>
            </div>

            <div className="form-actions">
              <button type="button" className="btn btn-secondary" onClick={() => navigate('/employees')}>Cancel</button>
              <button type="submit" className="btn" disabled={submitting}>
                {submitting
                  ? (mode === 'direct' ? 'Creating…' : 'Inviting…')
                  : (mode === 'direct' ? 'Create Employee' : 'Invite Employee')}
              </button>
            </div>
          </form>
          </>
          )}
        </div>
      </div>
    </div>
  )
}
