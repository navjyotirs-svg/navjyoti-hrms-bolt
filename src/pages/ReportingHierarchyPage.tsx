import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/auth/AuthContext'
import '@/styles/shared.css'

interface EmployeeNode {
  id: string
  employee_code: string
  full_name: string
  designation: string | null
  user_id: string
  role: string | null
}

interface ReportingLine {
  employee_id: string
  manager_id: string
}

interface HierarchyNode extends EmployeeNode {
  children: HierarchyNode[]
}

export function ReportingHierarchyPage() {
  const { profile } = useAuth()
  const [employees, setEmployees] = useState<EmployeeNode[]>([])
  const [reportingLines, setReportingLines] = useState<ReportingLine[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!profile?.organization_id) {
      setLoading(false)
      return
    }

    Promise.all([
      supabase
        .from('employees')
        .select('id, employee_code, full_name, designation, user_id')
        .eq('organization_id', profile.organization_id)
        .eq('is_active', true)
        .order('full_name'),
      supabase
        .from('employee_reporting_lines')
        .select('employee_id, manager_id'),
    ]).then(async ([empRes, rlRes]) => {
      if (empRes.error) {
        setError(empRes.error.message)
        setLoading(false)
        return
      }
      const empList = empRes.data as EmployeeNode[]
      const rlList = (rlRes.data ?? []) as ReportingLine[]

      if (empList.length > 0) {
        const { data: profileData } = await supabase
          .from('user_profiles')
          .select('id, role')
          .in('id', empList.map((e) => e.user_id))

        const roleMap = new Map(
          (profileData ?? []).map((p: { id: string; role: string | null }) => [p.id, p.role])
        )
        const empWithRoles = empList.map((e) => ({ ...e, role: roleMap.get(e.user_id) ?? null }))
        setEmployees(empWithRoles)
      }
      setReportingLines(rlList)
      setLoading(false)
    })
  }, [profile?.organization_id])

  if (loading) return <div className="loading-state">Loading…</div>
  if (error) return <div className="form-error">{error}</div>

  // Build tree
  const empMap = new Map(employees.map((e) => [e.id, { ...e, children: [] as HierarchyNode[] }]))
  const managedIds = new Set<string>()

  for (const rl of reportingLines) {
    const emp = empMap.get(rl.employee_id)
    const mgr = empMap.get(rl.manager_id)
    if (emp && mgr) {
      mgr.children.push(emp)
      managedIds.add(rl.employee_id)
    }
  }

  // Roots = employees not managed by anyone
  const roots = Array.from(empMap.values()).filter((e) => !managedIds.has(e.id))

  function renderNode(node: HierarchyNode, depth: number = 0): React.ReactNode {
    return (
      <div key={node.id} style={{ marginLeft: depth * 24 }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-2)',
          padding: 'var(--space-2) var(--space-3)',
          borderBottom: '1px solid var(--border)',
        }}>
          <span style={{ fontWeight: 600 }}>{node.full_name}</span>
          <span className="mono" style={{ fontSize: '11px', color: 'var(--slate)' }}>{node.employee_code}</span>
          {node.designation && <span style={{ fontSize: '12px', color: 'var(--slate)' }}>· {node.designation}</span>}
        </div>
        {node.children.map((child) => renderNode(child, depth + 1))}
      </div>
    )
  }

  return (
    <div className="page">
      <div className="page-header">
        <h2 className="page-title">Reporting Hierarchy</h2>
      </div>

      <div className="card">
        {roots.length === 0 ? (
          <div className="empty-state"><div className="empty-state-text">No reporting hierarchy established yet.</div></div>
        ) : (
          <div style={{ padding: 'var(--space-3)' }}>
            {roots.map((root) => renderNode(root))}
          </div>
        )}
      </div>
    </div>
  )
}
