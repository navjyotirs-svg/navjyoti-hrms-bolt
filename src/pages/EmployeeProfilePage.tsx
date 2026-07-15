import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { ROLE_LABELS } from '@/types/roles'
import '@/styles/shared.css'

interface EmployeeDetail {
  id: string
  employee_code: string
  full_name: string
  designation: string | null
  work_email: string
  work_mode: string
  employment_status: string
  is_active: boolean
  joining_date: string
  branch_id: string | null
  department_id: string | null
  user_id: string
}

interface Manager {
  full_name: string
  employee_code: string
}

export function EmployeeProfilePage() {
  const { id } = useParams<{ id: string }>()
  const [employee, setEmployee] = useState<EmployeeDetail | null>(null)
  const [role, setRole] = useState<string | null>(null)
  const [branchName, setBranchName] = useState<string | null>(null)
  const [deptName, setDeptName] = useState<string | null>(null)
  const [manager, setManager] = useState<Manager | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!id) return

    async function loadEmployee() {
      const { data, error } = await supabase
        .from('employees')
        .select('id, employee_code, full_name, designation, work_email, work_mode, employment_status, is_active, joining_date, branch_id, department_id, user_id')
        .eq('id', id)
        .maybeSingle()

      if (error || !data) {
        setError(error?.message ?? 'Employee not found')
        setLoading(false)
        return
      }

      const emp = data as EmployeeDetail
      setEmployee(emp)

      // Fetch role
      const { data: profileData } = await supabase
        .from('user_profiles')
        .select('role')
        .eq('id', emp.user_id)
        .maybeSingle()
      if (profileData) setRole((profileData as { role: string }).role)

      // Fetch branch name
      if (emp.branch_id) {
        const { data: branchData } = await supabase
          .from('branches')
          .select('name')
          .eq('id', emp.branch_id)
          .maybeSingle()
        if (branchData) setBranchName((branchData as { name: string }).name)
      }

      // Fetch department name
      if (emp.department_id) {
        const { data: deptData } = await supabase
          .from('departments')
          .select('name')
          .eq('id', emp.department_id)
          .maybeSingle()
        if (deptData) setDeptName((deptData as { name: string }).name)
      }

      // Fetch reporting manager
      const { data: rlData } = await supabase
        .from('employee_reporting_lines')
        .select('manager_id')
        .eq('employee_id', emp.id)
        .maybeSingle()

      if (rlData && (rlData as { manager_id: string }).manager_id) {
        const { data: mgrData } = await supabase
          .from('employees')
          .select('full_name, employee_code')
          .eq('id', (rlData as { manager_id: string }).manager_id)
          .maybeSingle()
        if (mgrData) setManager(mgrData as Manager)
      }

      setLoading(false)
    }

    loadEmployee()
  }, [id])

  if (loading) return <div className="loading-state">Loading…</div>
  if (error || !employee) return (
    <div className="page">
      <div className="empty-state"><div className="empty-state-text">{error ?? 'Employee not found'}</div></div>
      <Link to="/employees" className="btn btn-sm" style={{ alignSelf: 'flex-start' }}>Back to Employees</Link>
    </div>
  )

  return (
    <div className="page">
      <div className="page-header">
        <h2 className="page-title">{employee.full_name}</h2>
        <Link to="/employees" className="btn btn-sm btn-secondary">Back</Link>
      </div>

      <div className="card">
        <div className="info-list">
          <div className="info-row"><span className="info-label">Employee Code</span><span className="info-value mono">{employee.employee_code}</span></div>
          <div className="info-row"><span className="info-label">Role</span><span className="info-value">{role ? <span className="tag tag-ink">{ROLE_LABELS[role as keyof typeof ROLE_LABELS] ?? role}</span> : '—'}</span></div>
          <div className="info-row"><span className="info-label">Designation</span><span className="info-value">{employee.designation ?? '—'}</span></div>
          <div className="info-row"><span className="info-label">Work Email</span><span className="info-value">{employee.work_email}</span></div>
          <div className="info-row"><span className="info-label">Work Mode</span><span className="info-value">{employee.work_mode}</span></div>
          <div className="info-row"><span className="info-label">Branch</span><span className="info-value">{branchName ?? '—'}</span></div>
          <div className="info-row"><span className="info-label">Department</span><span className="info-value">{deptName ?? '—'}</span></div>
          <div className="info-row"><span className="info-label">Reporting Manager</span><span className="info-value">{manager ? `${manager.full_name} (${manager.employee_code})` : '—'}</span></div>
          <div className="info-row"><span className="info-label">Joining Date</span><span className="info-value mono">{employee.joining_date}</span></div>
          <div className="info-row"><span className="info-label">Employment Status</span><span className={`tag ${employee.is_active ? 'tag-teal' : 'tag-gray'}`}>{employee.employment_status}</span></div>
        </div>
      </div>
    </div>
  )
}
