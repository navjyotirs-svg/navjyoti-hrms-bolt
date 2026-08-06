import { supabase } from '@/lib/supabase'

export interface PayrollEmployee {
  id: string
  employee_code: string
  full_name: string
  designation: string | null
  department_id: string | null
  branch_id: string | null
  employment_status: string
  is_active: boolean
  user_id: string
  role: string | null
  salary_profile: {
    id: string
    monthly_salary: number
    currency: string
    effective_from: string
  } | null
  department_name: string | null
  branch_name: string | null
}

export interface SalaryHistoryEntry {
  id: string
  old_monthly_salary: number | null
  new_monthly_salary: number
  effective_from: string
  reason: string
  changed_by: string | null
  created_at: string
  changed_by_name: string | null
}

export interface SalaryPolicy {
  id: string
  organization_id: string
  free_leave_days_per_month: number
  salary_divisor: number
  sunday_is_paid_weekly_off: boolean
  exclude_sundays_from_leave_count: boolean
  policy_version: number
  effective_from: string
}

export async function fetchPayrollEmployees(orgId: string): Promise<PayrollEmployee[]> {
  const [employeesResult, profilesResult, salaryResult, deptResult, branchResult] = await Promise.all([
    supabase
      .from('employees')
      .select('id, employee_code, full_name, designation, department_id, branch_id, employment_status, is_active, user_id')
      .eq('organization_id', orgId)
      .order('employee_code'),
    supabase
      .from('user_profiles')
      .select('id, role'),
    supabase
      .from('employee_salary_profiles')
      .select('id, employee_id, monthly_salary, currency, effective_from')
      .eq('is_active', true),
    supabase
      .from('departments')
      .select('id, name'),
    supabase
      .from('branches')
      .select('id, name'),
  ])

  if (employeesResult.error) throw new Error(employeesResult.error.message)

  const profileMap = new Map((profilesResult.data ?? []).map((p: { id: string; role: string | null }) => [p.id, p.role]))
  const salaryMap = new Map((salaryResult.data ?? []).map((s) => [s.employee_id, s]))
  const deptMap = new Map((deptResult.data ?? []).map((d) => [d.id, d.name]))
  const branchMap = new Map((branchResult.data ?? []).map((b) => [b.id, b.name]))

  return (employeesResult.data ?? [])
    .filter((e) => {
      const role = profileMap.get(e.user_id)
      return role !== 'director'
    })
    .map((e) => ({
      ...e,
      role: profileMap.get(e.user_id) ?? null,
      salary_profile: salaryMap.get(e.id) ?? null,
      department_name: e.department_id ? (deptMap.get(e.department_id) ?? null) : null,
      branch_name: e.branch_id ? (branchMap.get(e.branch_id) ?? null) : null,
    }))
}

export async function fetchOwnSalaryProfile(): Promise<{ monthly_salary: number; currency: string; effective_from: string } | null> {
  const { data: employeeId } = await supabase.rpc('current_user_employee_id')
  if (!employeeId) return null

  const { data, error } = await supabase
    .from('employee_salary_profiles')
    .select('monthly_salary, currency, effective_from')
    .eq('employee_id', employeeId)
    .eq('is_active', true)
    .maybeSingle()

  if (error) throw new Error(error.message)
  return data
}

export async function fetchSalaryHistory(employeeId: string): Promise<SalaryHistoryEntry[]> {
  const { data, error } = await supabase
    .from('employee_salary_history')
    .select('id, old_monthly_salary, new_monthly_salary, effective_from, reason, changed_by, created_at')
    .eq('employee_id', employeeId)
    .order('created_at', { ascending: false })

  if (error) throw new Error(error.message)

  if (!data || data.length === 0) return []

  const userIds = [...new Set(data.map((h) => h.changed_by).filter(Boolean))]
  if (userIds.length === 0) {
    return data.map((h) => ({ ...h, changed_by_name: null }))
  }

  const { data: profiles } = await supabase
    .from('user_profiles')
    .select('id, full_name')
    .in('id', userIds)

  const nameMap = new Map((profiles ?? []).map((p) => [p.id, p.full_name]))

  return data.map((h) => ({
    ...h,
    changed_by_name: h.changed_by ? (nameMap.get(h.changed_by) ?? null) : null,
  }))
}

export async function fetchSalaryPolicy(orgId: string): Promise<SalaryPolicy | null> {
  const { data, error } = await supabase
    .from('salary_policies')
    .select('*')
    .eq('organization_id', orgId)
    .maybeSingle()

  if (error) throw new Error(error.message)
  return data
}

export async function updateEmployeeSalary(
  employeeId: string,
  newMonthlySalary: number,
  effectiveFrom: string,
  reason: string
): Promise<{ success: boolean; error?: string; old_salary?: number; new_salary?: number }> {
  const { data, error } = await supabase.rpc('update_employee_salary', {
    p_employee_id: employeeId,
    p_new_monthly_salary: newMonthlySalary,
    p_effective_from: effectiveFrom,
    p_reason: reason,
  })

  if (error) throw new Error(error.message)
  return data as { success: boolean; error?: string; old_salary?: number; new_salary?: number }
}

export function formatCurrency(amount: number | null | undefined): string {
  if (amount === null || amount === undefined) return '—'
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount)
}

export function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}
