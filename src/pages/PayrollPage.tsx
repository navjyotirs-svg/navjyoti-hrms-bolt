import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '@/auth/AuthContext'
import {
  fetchPayrollEmployees,
  fetchSalaryHistory,
  fetchSalaryPolicy,
  updateEmployeeSalary,
  formatCurrency,
  formatDate,
  type PayrollEmployee,
  type SalaryHistoryEntry,
  type SalaryPolicy,
} from '@/lib/payroll'
import { ROLE_LABELS } from '@/types/roles'
import '@/styles/shared.css'

interface EditFormData {
  employeeId: string
  employeeName: string
  currentSalary: number | null
  newSalary: string
  effectiveFrom: string
  reason: string
}

export function PayrollPage() {
  const { profile, permissions } = useAuth()
  const [employees, setEmployees] = useState<PayrollEmployee[]>([])
  const [policy, setPolicy] = useState<SalaryPolicy | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [deptFilter, setDeptFilter] = useState('all')
  const [branchFilter, setBranchFilter] = useState('all')

  const [editModal, setEditModal] = useState<EditFormData | null>(null)
  const [editError, setEditError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const [historyModal, setHistoryModal] = useState<{ employeeId: string; employeeName: string } | null>(null)
  const [history, setHistory] = useState<SalaryHistoryEntry[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)

  const canEdit = permissions.includes('payroll.salary.edit')
  const canReadAudit = permissions.includes('payroll.audit.read')

  const load = useCallback(async () => {
    if (!profile?.organization_id) return
    setLoading(true)
    setError(null)
    try {
      const [emps, pol] = await Promise.all([
        fetchPayrollEmployees(profile.organization_id),
        fetchSalaryPolicy(profile.organization_id),
      ])
      setEmployees(emps)
      setPolicy(pol)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load payroll data')
    } finally {
      setLoading(false)
    }
  }, [profile?.organization_id])

  useEffect(() => {
    load()
  }, [load])

  const departments = [...new Set(employees.map((e) => e.department_name).filter(Boolean))] as string[]
  const branches = [...new Set(employees.map((e) => e.branch_name).filter(Boolean))] as string[]

  const filtered = employees.filter((e) => {
    if (search) {
      const q = search.toLowerCase()
      if (
        !e.full_name.toLowerCase().includes(q) &&
        !e.employee_code.toLowerCase().includes(q)
      ) return false
    }
    if (statusFilter !== 'all') {
      if (statusFilter === 'active' && !e.is_active) return false
      if (statusFilter === 'inactive' && e.is_active) return false
    }
    if (deptFilter !== 'all' && e.department_name !== deptFilter) return false
    if (branchFilter !== 'all' && e.branch_name !== branchFilter) return false
    return true
  })

  const totalSalary = filtered.reduce((sum, e) => sum + (e.salary_profile?.monthly_salary ?? 0), 0)
  const employeesWithSalary = filtered.filter((e) => e.salary_profile).length
  const employeesWithoutSalary = filtered.filter((e) => !e.salary_profile).length

  async function handleSaveEdit() {
    if (!editModal) return
    setEditError(null)
    const salary = parseFloat(editModal.newSalary)
    if (isNaN(salary) || salary < 0) {
      setEditError('Please enter a valid salary amount (>= 0).')
      return
    }
    if (!editModal.effectiveFrom) {
      setEditError('Effective date is required.')
      return
    }
    if (!editModal.reason.trim()) {
      setEditError('Reason is required.')
      return
    }
    setSaving(true)
    try {
      const result = await updateEmployeeSalary(editModal.employeeId, salary, editModal.effectiveFrom, editModal.reason.trim())
      if (!result.success) {
        const errorMessages: Record<string, string> = {
          PERMISSION_DENIED: 'You do not have permission to edit salary.',
          INVALID_SALARY: 'Invalid salary amount.',
          REASON_REQUIRED: 'Reason is required.',
          EFFECTIVE_DATE_REQUIRED: 'Effective date is required.',
          EMPLOYEE_NOT_FOUND: 'Employee not found.',
          CROSS_ORG_DENIED: 'Cross-organization access denied.',
          DIRECTOR_SALARY_NOT_SUPPORTED: 'Director salary is not supported.',
        }
        setEditError(errorMessages[result.error ?? ''] ?? result.error ?? 'Failed to update salary.')
        return
      }
      setEditModal(null)
      await load()
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Failed to update salary.')
    } finally {
      setSaving(false)
    }
  }

  async function handleOpenHistory(employeeId: string, employeeName: string) {
    setHistoryModal({ employeeId, employeeName })
    setHistoryLoading(true)
    try {
      const h = await fetchSalaryHistory(employeeId)
      setHistory(h)
    } catch {
      setHistory([])
    } finally {
      setHistoryLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="page-container">
        <p style={{ color: 'var(--slate)', fontSize: '14px' }}>Loading payroll…</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="page-container">
        <div className="error-banner">{error}</div>
        <button className="btn btn-sm" onClick={load}>Retry</button>
      </div>
    )
  }

  return (
    <div className="page-container">
      <div className="page-header">
        <h1 className="page-title">Payroll</h1>
        <p className="page-subtitle">Monthly salary management for non-Director employees</p>
      </div>

      {/* Policy info */}
      {policy && (
        <div className="kpi-grid" style={{ marginBottom: '24px' }}>
          <div className="kpi-card">
            <div className="kpi-label">Free Leave Days / Month</div>
            <div className="kpi-value">{policy.free_leave_days_per_month}</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-label">Salary Divisor</div>
            <div className="kpi-value">{policy.salary_divisor}</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-label">Sunday Excluded</div>
            <div className="kpi-value">{policy.exclude_sundays_from_leave_count ? 'Yes' : 'No'}</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-label">Policy Version</div>
            <div className="kpi-value">v{policy.policy_version}</div>
          </div>
        </div>
      )}

      {/* Summary metrics */}
      <div className="kpi-grid" style={{ marginBottom: '24px' }}>
        <div className="kpi-card">
          <div className="kpi-label">Total Employees</div>
          <div className="kpi-value">{filtered.length}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">With Salary Set</div>
          <div className="kpi-value">{employeesWithSalary}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Salary Not Set</div>
          <div className="kpi-value">{employeesWithoutSalary}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Total Monthly Salary</div>
          <div className="kpi-value" style={{ fontSize: '18px' }}>{formatCurrency(totalSalary)}</div>
        </div>
      </div>

      {/* Filters */}
      <div className="filter-bar" style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginBottom: '16px' }}>
        <input
          type="text"
          placeholder="Search name or code…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="form-input"
          style={{ flex: '1 1 200px' }}
        />
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="form-select">
          <option value="all">All Status</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
        {departments.length > 0 && (
          <select value={deptFilter} onChange={(e) => setDeptFilter(e.target.value)} className="form-select">
            <option value="all">All Departments</option>
            {departments.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        )}
        {branches.length > 0 && (
          <select value={branchFilter} onChange={(e) => setBranchFilter(e.target.value)} className="form-select">
            <option value="all">All Branches</option>
            {branches.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
        )}
      </div>

      {/* Desktop table */}
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Code</th>
              <th>Name</th>
              <th>Role</th>
              <th>Designation</th>
              <th>Department</th>
              <th>Monthly Salary</th>
              <th>Effective From</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={9} style={{ textAlign: 'center', padding: '24px', color: 'var(--slate)' }}>
                  No employees found.
                </td>
              </tr>
            )}
            {filtered.map((e) => (
              <tr key={e.id}>
                <td className="mono">{e.employee_code}</td>
                <td>{e.full_name}</td>
                <td>{e.role ? <span className="tag tag-ink">{ROLE_LABELS[e.role as keyof typeof ROLE_LABELS] ?? e.role}</span> : '—'}</td>
                <td>{e.designation ?? '—'}</td>
                <td>{e.department_name ?? '—'}</td>
                <td className="mono">{formatCurrency(e.salary_profile?.monthly_salary)}</td>
                <td>{formatDate(e.salary_profile?.effective_from)}</td>
                <td>
                  {e.is_active ? <span className="tag tag-success">Active</span> : <span className="tag tag-muted">Inactive</span>}
                </td>
                <td>
                  <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                    {canEdit && (
                      <button
                        className="btn btn-sm"
                        onClick={() => setEditModal({
                          employeeId: e.id,
                          employeeName: e.full_name,
                          currentSalary: e.salary_profile?.monthly_salary ?? null,
                          newSalary: '',
                          effectiveFrom: new Date().toISOString().slice(0, 10),
                          reason: '',
                        })}
                      >
                        Edit Salary
                      </button>
                    )}
                    {canReadAudit && (
                      <button
                        className="btn btn-sm btn-ghost"
                        onClick={() => handleOpenHistory(e.id, e.full_name)}
                      >
                        History
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Edit Salary Modal */}
      {editModal && (
        <div className="modal-overlay" onClick={() => !saving && setEditModal(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">Edit Salary — {editModal.employeeName}</h2>
              <button className="modal-close" onClick={() => !saving && setEditModal(null)} disabled={saving}>×</button>
            </div>
            <div className="modal-body">
              {editError && <div className="error-banner" style={{ marginBottom: '12px' }}>{editError}</div>}
              <div className="form-group">
                <label className="form-label">Current Salary</label>
                <div className="form-static">{formatCurrency(editModal.currentSalary)}</div>
              </div>
              <div className="form-group">
                <label className="form-label">New Monthly Salary (₹) *</label>
                <input
                  type="number"
                  className="form-input"
                  value={editModal.newSalary}
                  onChange={(e) => setEditModal({ ...editModal, newSalary: e.target.value })}
                  placeholder="35000"
                  min="0"
                  step="100"
                  disabled={saving}
                />
              </div>
              <div className="form-group">
                <label className="form-label">Effective From *</label>
                <input
                  type="date"
                  className="form-input"
                  value={editModal.effectiveFrom}
                  onChange={(e) => setEditModal({ ...editModal, effectiveFrom: e.target.value })}
                  disabled={saving}
                />
              </div>
              <div className="form-group">
                <label className="form-label">Reason *</label>
                <select
                  className="form-select"
                  value={editModal.reason}
                  onChange={(e) => setEditModal({ ...editModal, reason: e.target.value })}
                  disabled={saving}
                >
                  <option value="">Select a reason…</option>
                  <option value="Initial salary setup">Initial salary setup</option>
                  <option value="Salary revision">Salary revision</option>
                  <option value="Correction">Correction</option>
                  <option value="Promotion revision">Promotion revision</option>
                </select>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={() => setEditModal(null)} disabled={saving}>Cancel</button>
              <button className="btn btn-primary" onClick={handleSaveEdit} disabled={saving}>
                {saving ? 'Saving…' : 'Save Salary'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* History Modal */}
      {historyModal && (
        <div className="modal-overlay" onClick={() => setHistoryModal(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">Salary History — {historyModal.employeeName}</h2>
              <button className="modal-close" onClick={() => setHistoryModal(null)}>×</button>
            </div>
            <div className="modal-body">
              {historyLoading ? (
                <p style={{ color: 'var(--slate)' }}>Loading…</p>
              ) : history.length === 0 ? (
                <p style={{ color: 'var(--slate)' }}>No salary changes recorded.</p>
              ) : (
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Effective From</th>
                        <th>Old Salary</th>
                        <th>New Salary</th>
                        <th>Reason</th>
                        <th>Changed By</th>
                        <th>Date</th>
                      </tr>
                    </thead>
                    <tbody>
                      {history.map((h) => (
                        <tr key={h.id}>
                          <td>{formatDate(h.effective_from)}</td>
                          <td className="mono">{formatCurrency(h.old_monthly_salary)}</td>
                          <td className="mono">{formatCurrency(h.new_monthly_salary)}</td>
                          <td>{h.reason}</td>
                          <td>{h.changed_by_name ?? 'System'}</td>
                          <td className="mono">{formatDate(h.created_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={() => setHistoryModal(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
