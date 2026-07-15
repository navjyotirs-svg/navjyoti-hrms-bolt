import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/auth/AuthContext'
import { ROLE_LABELS } from '@/types/roles'
import '@/styles/shared.css'

interface Employee {
  id: string
  employee_code: string
  full_name: string
  designation: string | null
  work_email: string
  work_mode: string
  employment_status: string
  is_active: boolean
  user_id: string
}

interface EmployeeWithRole extends Employee {
  role: string | null
}

export function EmployeeDirectoryPage() {
  const { profile, permissions } = useAuth()
  const [employees, setEmployees] = useState<EmployeeWithRole[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const canCreate = permissions.includes('employee.create')

  useEffect(() => {
    if (!profile?.organization_id) {
      setLoading(false)
      return
    }
    supabase
      .from('employees')
      .select(`
        id, employee_code, full_name, designation, work_email, work_mode,
        employment_status, is_active, user_id
      `)
      .eq('organization_id', profile.organization_id)
      .order('full_name')
      .then(({ data, error }) => {
        if (error) {
          setError(error.message)
        } else if (data) {
          const empList = data as Employee[]
          if (empList.length > 0) {
            supabase
              .from('user_profiles')
              .select('id, role')
              .in('id', empList.map((e) => e.user_id))
              .then(({ data: profileData }) => {
                const roleMap = new Map(
                  (profileData ?? []).map((p: { id: string; role: string | null }) => [p.id, p.role])
                )
                setEmployees(
                  empList.map((e) => ({
                    ...e,
                    role: roleMap.get(e.user_id) ?? null,
                  }))
                )
                setLoading(false)
              })
          } else {
            setEmployees([])
            setLoading(false)
          }
        }
      })
  }, [profile?.organization_id])

  return (
    <div className="page">
      <div className="page-header">
        <h2 className="page-title">Employees</h2>
        {canCreate && (
          <Link to="/employees/add" className="btn btn-sm">+ Invite Employee</Link>
        )}
      </div>

      {error && <div className="form-error">{error}</div>}

      <div className="card">
        {loading ? (
          <div className="loading-state">Loading…</div>
        ) : employees.length === 0 ? (
          <div className="empty-state"><div className="empty-state-text">No employees found.</div></div>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr><th>Code</th><th>Name</th><th>Role</th><th>Designation</th><th>Work Mode</th><th>Status</th></tr>
              </thead>
              <tbody>
                {employees.map((e) => (
                  <tr key={e.id}>
                    <td className="mono">{e.employee_code}</td>
                    <td>
                      <Link to={`/employees/${e.id}`} style={{ fontWeight: 600 }}>{e.full_name}</Link>
                    </td>
                    <td>{e.role ? <span className="tag tag-ink">{ROLE_LABELS[e.role as keyof typeof ROLE_LABELS] ?? e.role}</span> : '—'}</td>
                    <td>{e.designation ?? '—'}</td>
                    <td>{e.work_mode}</td>
                    <td>
                      <span className={`tag ${e.is_active ? 'tag-teal' : 'tag-gray'}`}>
                        {e.employment_status}
                      </span>
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
