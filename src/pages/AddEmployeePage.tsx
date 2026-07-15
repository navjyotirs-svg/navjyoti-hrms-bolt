import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/auth/AuthContext'
import { ROLES, type Role } from '@/types/roles'
import '@/styles/shared.css'

interface Branch { id: string; name: string }
interface Department { id: string; name: string }
interface Manager { id: string; full_name: string; employee_code: string }

export function AddEmployeePage() {
  const { profile, session } = useAuth()
  const navigate = useNavigate()
  const [branches, setBranches] = useState<Branch[]>([])
  const [departments, setDepartments] = useState<Department[]>([])
  const [managers, setManagers] = useState<Manager[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
    })
  }, [profile?.organization_id])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)

    if (!fullName.trim() || !workEmail.trim() || !employeeCode.trim() || !joiningDate) {
      setError('Full name, work email, employee code, and joining date are required')
      setSubmitting(false)
      return
    }

    try {
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/invite-employee`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session?.access_token}`,
            apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
          },
          body: JSON.stringify({
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
          }),
        }
      )

      const data = await response.json()

      if (!response.ok) {
        setError(data.error || 'Failed to invite employee')
        setSubmitting(false)
      } else {
        navigate('/employees')
      }
    } catch {
      setError('Network error — please try again')
      setSubmitting(false)
    }
  }

  return (
    <div className="page">
      <div className="page-header">
        <h2 className="page-title">Invite Employee</h2>
      </div>

      <div className="card">
        <div className="card-body">
          {error && <div className="form-error" style={{ marginBottom: 'var(--space-4)' }}>{error}</div>}
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
                {submitting ? 'Inviting…' : 'Invite Employee'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}
