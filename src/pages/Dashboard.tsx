import { useEffect, useState, useCallback } from 'react'
import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '@/auth/AuthContext'
import { supabase } from '@/lib/supabase'
import { ATTENDANCE_STATUS_LABELS, ROLE_LABELS, type AttendanceStatus } from '@/types/roles'
import { formatTimeRemaining, formatTimestamp, checkIn, fetchTodayAttendance } from '@/lib/attendance'
import { CheckoutModal } from '@/components/CheckoutModal'
import { DashboardSkeleton } from '@/components/Skeleton'
import { DrillDownDrawer, DrillDownEmpty, DrillDownTable } from '@/components/DrillDownDrawer'
import '@/styles/dashboard.css'

type DrillDownType =
  | 'checked_in' | 'pending_checkout' | 'full_day' | 'half_day' | 'pending_corrections'
  | 'active_employees' | 'pending_activation' | 'onboarding' | 'documents_pending'
  | 'branches' | 'departments'
  | 'unread_notifications'
  | null

interface AttDrillRow {
  id: string
  employee_code: string
  full_name: string
  branch: string
  department: string
  check_in_at: string
  required_checkout_at: string
  check_out_at: string | null
  elapsed: number | null
  status: string
  correction_version: number
}

interface EmpDrillRow {
  id: string
  employee_code: string
  full_name: string
  designation: string | null
  branch: string | null
  department: string | null
  role: string | null
  work_mode: string | null
  employment_status: string
  directory_status: string
  user_id: string
}

interface BranchDrillRow {
  id: string
  name: string
  active_employees: number
  departments: number
  checked_in_today: number
  on_leave: number
  pending_activation: number
}

interface DeptDrillRow {
  id: string
  name: string
  branch: string | null
  active_employees: number
  manager: string | null
  checked_in_today: number
  on_leave: number
}

interface NotifDrillRow {
  id: string
  title: string
  message: string
  priority: string
  category: string
  created_at: string
  is_read: boolean
}

export function Dashboard() {
  const { profile, permissions } = useAuth()
  const navigate = useNavigate()
  const [metrics, setMetrics] = useState<Record<string, number | null>>({
    activeEmployees: null,
    branches: null,
    departments: null,
    pendingActivation: null,
    onboardingPending: null,
    documentsPendingVerification: null,
    checkedInToday: null,
    pendingCheckout: null,
    fullDay: null,
    halfDay: null,
    pendingCorrections: null,
    unreadNotifications: null,
    pendingReviews: null,
    openFollowUps: null,
    todayReports: null,
  })
  const [recentAudit, setRecentAudit] = useState<{ action: string; entity_type: string; created_at: string }[]>([])
  const [todayAttendance, setTodayAttendance] = useState<{
    check_in_at: string
    required_checkout_at: string
    final_status: string
    actual_elapsed_minutes: number | null
  } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [checkingIn, setCheckingIn] = useState(false)
  const [showCheckout, setShowCheckout] = useState(false)
  const [attendanceError, setAttendanceError] = useState<string | null>(null)
  const [attendanceSuccess, setAttendanceSuccess] = useState<string | null>(null)

  const [drillDown, setDrillDown] = useState<DrillDownType>(null)
  const [drillLoading, setDrillLoading] = useState(false)
  const [drillError, setDrillError] = useState<string | null>(null)
  const [drillRows, setDrillRows] = useState<Record<string, unknown>[]>([])
  const [drillCount, setDrillCount] = useState<number | null>(null)

  const canReadAll = permissions.includes('attendance.read_all')
  const canCheckIn = permissions.includes('attendance.check_in_self')
  const canCheckOut = permissions.includes('attendance.check_out_self')
  const canReadAudit = permissions.includes('audit.read')
  const canReadEmployees = permissions.includes('employee.read_all') || permissions.includes('employee.read_team')
  const canReadOrg = permissions.includes('organization.read')
  const canExportOrg = permissions.includes('export.organization')
  const canExportTeam = permissions.includes('export.team')

  useEffect(() => {
    if (!profile?.id) { setLoading(false); return }
    let cancelled = false

    async function load() {
      try {
        const { data: emp } = await supabase
          .from('employees')
          .select('id, organization_id')
          .eq('user_id', profile!.id)
          .maybeSingle()

        if (!emp || cancelled) { setLoading(false); return }
        const empData = emp as { id: string; organization_id: string }
        const orgId = empData.organization_id

        const updates: Record<string, number | null> = {}

        if (canReadEmployees) {
          const { count } = await supabase
            .from('employees')
            .select('*', { count: 'exact', head: true })
            .eq('organization_id', orgId)
            .eq('is_active', true)
          updates.activeEmployees = count ?? 0
        }

        if (canReadOrg) {
          const { count: branchCount } = await supabase
            .from('branches')
            .select('*', { count: 'exact', head: true })
            .eq('organization_id', orgId)
            .eq('is_active', true)
          updates.branches = branchCount ?? 0

          const { count: deptCount } = await supabase
            .from('departments')
            .select('*', { count: 'exact', head: true })
            .eq('organization_id', orgId)
            .eq('is_active', true)
          updates.departments = deptCount ?? 0
        }

        if (canReadEmployees) {
          const { count: pendingCount } = await supabase
            .from('employees')
            .select('*', { count: 'exact', head: true })
            .eq('organization_id', orgId)
            .in('employment_status', ['invited', 'pending_activation'])
          updates.pendingActivation = pendingCount ?? 0

          const { data: orgEmps } = await supabase
            .from('employees')
            .select('id')
            .eq('organization_id', orgId)
            .eq('is_active', true)
          const empIds = (orgEmps ?? []).map((e: { id: string }) => e.id)

          if (empIds.length > 0) {
            const { count: onboardCount } = await supabase
              .from('onboarding_checklists')
              .select('*', { count: 'exact', head: true })
              .eq('status', 'pending')
              .in('employee_id', empIds)
            updates.onboardingPending = onboardCount ?? 0
          } else {
            updates.onboardingPending = 0
          }

          const { data: allOrgEmps } = await supabase
            .from('employees')
            .select('id')
            .eq('organization_id', orgId)
          const allEmpIds = (allOrgEmps ?? []).map((e: { id: string }) => e.id)

          if (allEmpIds.length > 0) {
            const { count: docCount } = await supabase
              .from('employee_documents')
              .select('*', { count: 'exact', head: true })
              .eq('is_verified', false)
              .in('employee_id', allEmpIds)
            updates.documentsPendingVerification = docCount ?? 0
          } else {
            updates.documentsPendingVerification = 0
          }
        }

        if (canReadAll) {
          const today = new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' })
          const kolkataDate = new Date(today).toISOString().slice(0, 10)

          const { count: checkedIn } = await supabase
            .from('attendance_records')
            .select('*', { count: 'exact', head: true })
            .eq('organization_id', orgId)
            .eq('attendance_date', kolkataDate)
          updates.checkedInToday = checkedIn ?? 0

          const { count: pendingOut } = await supabase
            .from('attendance_records')
            .select('*', { count: 'exact', head: true })
            .eq('organization_id', orgId)
            .eq('attendance_date', kolkataDate)
            .eq('final_status', 'PENDING_CHECKOUT')
          updates.pendingCheckout = pendingOut ?? 0

          const { count: fullD } = await supabase
            .from('attendance_records')
            .select('*', { count: 'exact', head: true })
            .eq('organization_id', orgId)
            .eq('attendance_date', kolkataDate)
            .eq('final_status', 'FULL_DAY')
          updates.fullDay = fullD ?? 0

          const { count: halfD } = await supabase
            .from('attendance_records')
            .select('*', { count: 'exact', head: true })
            .eq('organization_id', orgId)
            .eq('attendance_date', kolkataDate)
            .eq('final_status', 'HALF_DAY')
          updates.halfDay = halfD ?? 0

          const { count: corrCount } = await supabase
            .from('attendance_corrections')
            .select('*', { count: 'exact', head: true })
            .eq('status', 'PENDING')
          updates.pendingCorrections = corrCount ?? 0
        }

        const canReviewReports = permissions.includes('daily_report.review')
        const canReadFollowUps = permissions.includes('follow_up.read_all') || permissions.includes('follow_up.read_team')
        const canReadReports = permissions.includes('daily_report.read_all') || permissions.includes('daily_report.read_team')

        if (canReviewReports) {
          const { count: reviewCount } = await supabase
            .from('daily_reports')
            .select('*', { count: 'exact', head: true })
            .eq('status', 'submitted')
          updates.pendingReviews = reviewCount ?? 0
        }

        if (canReadFollowUps) {
          const { count: fuCount } = await supabase
            .from('management_follow_ups')
            .select('*', { count: 'exact', head: true })
            .in('status', ['open', 'assigned', 'in_progress'])
          updates.openFollowUps = fuCount ?? 0
        }

        if (canReadReports) {
          const todayDate = new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' })
          const kolkataDate = new Date(todayDate).toISOString().slice(0, 10)
          const { count: reportCount } = await supabase
            .from('daily_reports')
            .select('*', { count: 'exact', head: true })
            .eq('report_date', kolkataDate)
          updates.todayReports = reportCount ?? 0
        }

        const { count: unread } = await supabase
          .from('notifications')
          .select('*', { count: 'exact', head: true })
          .eq('is_read', false)
        updates.unreadNotifications = unread ?? 0

        if (canReadAudit) {
          const { data: audit } = await supabase
            .from('audit_logs')
            .select('action, entity_type, created_at')
            .order('created_at', { ascending: false })
            .limit(5)
          if (!cancelled) setRecentAudit((audit ?? []) as { action: string; entity_type: string; created_at: string }[])
        }

        if (canCheckIn) {
          const today = new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' })
          const kolkataDate = new Date(today).toISOString().slice(0, 10)
          const { data: att } = await supabase
            .from('attendance_records')
            .select('check_in_at, required_checkout_at, final_status, actual_elapsed_minutes')
            .eq('employee_id', empData.id)
            .eq('attendance_date', kolkataDate)
            .maybeSingle()
          if (!cancelled) setTodayAttendance(att as { check_in_at: string; required_checkout_at: string; final_status: string; actual_elapsed_minutes: number | null } | null)
        }

        if (!cancelled) {
          setMetrics((prev) => ({ ...prev, ...updates }))
          setError(null)
        }
      } catch (e) {
        if (!cancelled) setError((e as Error).message)
      }
      if (!cancelled) setLoading(false)
    }

    load()
    return () => { cancelled = true }
  }, [profile?.id, profile?.organization_id, permissions.length, canReadAll, canCheckIn, canReadAudit, canReadEmployees, canReadOrg])

  const greeting = profile?.full_name ?? profile?.email
  const roleLabel = profile?.role ? ROLE_LABELS[profile.role] : ''

  const handleDashboardCheckIn = useCallback(async () => {
    setAttendanceError(null)
    setAttendanceSuccess(null)
    setCheckingIn(true)
    try {
      await checkIn()
      setAttendanceSuccess('Checked in successfully!')
      if (profile?.id) {
        const { data: emp } = await supabase
          .from('employees')
          .select('id')
          .eq('user_id', profile.id)
          .maybeSingle()
        const empId = (emp as { id: string } | null)?.id
        if (empId) {
          const rec = await fetchTodayAttendance(empId)
          setTodayAttendance(rec ? {
            check_in_at: rec.check_in_at,
            required_checkout_at: rec.required_checkout_at,
            final_status: rec.final_status,
            actual_elapsed_minutes: (rec as { actual_elapsed_minutes?: number }).actual_elapsed_minutes ?? null,
          } : null)
        }
      }
    } catch (e) {
      setAttendanceError((e as Error).message)
    }
    setCheckingIn(false)
  }, [profile?.id])

  function handleDashboardCheckoutSuccess(result: { final_status: string; elapsed_minutes: number }) {
    setShowCheckout(false)
    setAttendanceSuccess(`Checked out! Status: ${ATTENDANCE_STATUS_LABELS[result.final_status as AttendanceStatus] ?? result.final_status}`)
    if (profile?.id) {
      ;(async () => {
        const { data: emp } = await supabase
          .from('employees')
          .select('id')
          .eq('user_id', profile!.id)
          .maybeSingle()
        const empId = (emp as { id: string } | null)?.id
        if (empId) {
          const rec = await fetchTodayAttendance(empId)
          setTodayAttendance(rec ? {
            check_in_at: rec.check_in_at,
            required_checkout_at: rec.required_checkout_at,
            final_status: rec.final_status,
            actual_elapsed_minutes: (rec as { actual_elapsed_minutes?: number }).actual_elapsed_minutes ?? null,
          } : null)
        }
      })()
    }
  }

  // ===== Drill-down data loaders =====
  const loadDrillDown = useCallback(async (type: DrillDownType) => {
    if (!type || !profile?.organization_id) return
    setDrillDown(type)
    setDrillLoading(true)
    setDrillError(null)
    setDrillRows([])
    setDrillCount(null)

    try {
      const orgId = profile.organization_id
      const todayKolkata = new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' })
      const kolkataDate = new Date(todayKolkata).toISOString().slice(0, 10)

      switch (type) {
        case 'checked_in':
        case 'pending_checkout':
        case 'full_day':
        case 'half_day': {
          let query = supabase
            .from('attendance_records')
            .select(`
              id, employee_id, attendance_date, check_in_at, required_checkout_at,
              check_out_at, actual_elapsed_minutes, final_status, correction_version,
              employees!inner (employee_code, full_name, branches (name), departments (name))
            `)
            .eq('organization_id', orgId)
            .eq('attendance_date', kolkataDate)
          if (type === 'pending_checkout') query = query.eq('final_status', 'PENDING_CHECKOUT')
          if (type === 'full_day') query = query.eq('final_status', 'FULL_DAY')
          if (type === 'half_day') query = query.eq('final_status', 'HALF_DAY')
          query = query.order('check_in_at', { ascending: false }).limit(200)
          const { data: attData, error: attErr } = await query
          if (attErr) throw attErr
          const rows: AttDrillRow[] = (attData ?? []).map((r: any) => ({
            id: r.id,
            employee_code: r.employees?.employee_code ?? '—',
            full_name: r.employees?.full_name ?? '—',
            branch: r.employees?.branches?.name ?? '—',
            department: r.employees?.departments?.name ?? '—',
            check_in_at: r.check_in_at ?? '—',
            required_checkout_at: r.required_checkout_at ?? '—',
            check_out_at: r.check_out_at,
            elapsed: r.actual_elapsed_minutes,
            status: r.final_status,
            correction_version: r.correction_version ?? 0,
          }))
          setDrillRows(rows as unknown as Record<string, unknown>[])
          setDrillCount(rows.length)
          break
        }

        case 'pending_corrections': {
          const { data: corrData, error: corrErr } = await supabase
            .from('attendance_corrections')
            .select(`
              id, correction_type, reason, status, created_at, reviewed_at,
              employees!inner (employee_code, full_name, organization_id)
            `)
            .eq('employees.organization_id', orgId)
            .eq('status', 'PENDING')
            .order('created_at', { ascending: false })
            .limit(100)
          if (corrErr) throw corrErr
          const rows = (corrData ?? []).map((r: any) => ({
            id: r.id,
            employee: `${r.employees?.full_name ?? '—'} (${r.employees?.employee_code ?? '—'})`,
            type: r.correction_type,
            reason: r.reason,
            status: r.status,
            submitted: r.created_at,
            reviewed: r.reviewed_at,
          }))
          setDrillRows(rows as unknown as Record<string, unknown>[])
          setDrillCount(rows.length)
          break
        }

        case 'active_employees': {
          const { data: empData, error: empErr } = await supabase
            .from('employees')
            .select(`
              id, employee_code, full_name, designation, work_mode, employment_status, user_id,
              branches (name), departments (name)
            `)
            .eq('organization_id', orgId)
            .eq('is_active', true)
            .order('full_name')
            .limit(200)
          if (empErr) throw empErr
          const empIds = (empData ?? []).map((e: any) => e.user_id)
          const { data: profiles } = await supabase
            .from('user_profiles')
            .select('id, role, status, is_active')
            .in('id', empIds)
          const profileMap = new Map((profiles ?? []).map((p: any) => [p.id, p]))
          const rows: EmpDrillRow[] = (empData ?? []).map((e: any) => {
            const p = profileMap.get(e.user_id)
            return {
              id: e.id,
              employee_code: e.employee_code,
              full_name: e.full_name,
              designation: e.designation,
              branch: e.branches?.name ?? null,
              department: e.departments?.name ?? null,
              role: p?.role ?? null,
              work_mode: e.work_mode,
              employment_status: e.employment_status,
              directory_status: 'Active',
              user_id: e.user_id,
            }
          })
          setDrillRows(rows as unknown as Record<string, unknown>[])
          setDrillCount(rows.length)
          break
        }

        case 'pending_activation': {
          const { data: empData, error: empErr } = await supabase
            .from('employees')
            .select(`
              id, employee_code, full_name, designation, employment_status, user_id,
              branches (name), departments (name)
            `)
            .eq('organization_id', orgId)
            .in('employment_status', ['invited', 'pending_activation'])
            .order('full_name')
            .limit(200)
          if (empErr) throw empErr
          const empIds = (empData ?? []).map((e: any) => e.user_id)
          const { data: profiles } = await supabase
            .from('user_profiles')
            .select('id, role, status, is_active')
            .in('id', empIds)
          const profileMap = new Map((profiles ?? []).map((p: any) => [p.id, p]))
          const rows: EmpDrillRow[] = (empData ?? []).map((e: any) => {
            const p = profileMap.get(e.user_id)
            let dirStatus = 'Activation Pending'
            if (e.employment_status === 'invited' && p?.status === 'pending_activation') dirStatus = 'Invitation Pending'
            else if (e.employment_status === 'invited' && !p?.status) dirStatus = 'Invitation Pending'
            else if (p?.status === 'pending_activation') dirStatus = 'Password Setup Pending'
            else if (!p?.is_active) dirStatus = 'Membership Inactive'
            else if (!p?.role) dirStatus = 'Role Missing'
            return {
              id: e.id,
              employee_code: e.employee_code,
              full_name: e.full_name,
              designation: e.designation,
              branch: e.branches?.name ?? null,
              department: e.departments?.name ?? null,
              role: p?.role ?? null,
              work_mode: null,
              employment_status: e.employment_status,
              directory_status: dirStatus,
              user_id: e.user_id,
            }
          })
          setDrillRows(rows as unknown as Record<string, unknown>[])
          setDrillCount(rows.length)
          break
        }

        case 'onboarding': {
          const { data: empData } = await supabase
            .from('employees')
            .select('id')
            .eq('organization_id', orgId)
            .eq('is_active', true)
          const empIds = (empData ?? []).map((e: { id: string }) => e.id)
          if (empIds.length === 0) { setDrillCount(0); break }
          const { data: checklists, error: clErr } = await supabase
            .from('onboarding_checklists')
            .select(`
              id, status, employee_id,
              employees (employee_code, full_name, joining_date),
              onboarding_checklist_items (item_key, label, status)
            `)
            .eq('status', 'pending')
            .in('employee_id', empIds)
            .order('created_at', { ascending: false })
            .limit(100)
          if (clErr) throw clErr
          const rows = (checklists ?? []).map((c: any) => {
            const items = c.onboarding_checklist_items ?? []
            const completed = items.filter((i: any) => i.status === 'completed').length
            const pendingItems = items.filter((i: any) => i.status !== 'completed').map((i: any) => i.label).join(', ')
            return {
              id: c.id,
              employee: `${c.employees?.full_name ?? '—'} (${c.employees?.employee_code ?? '—'})`,
              joining_date: c.employees?.joining_date ?? '—',
              progress: `${completed}/${items.length}`,
              pending_items: pendingItems || '—',
              status: c.status,
            }
          })
          setDrillRows(rows as unknown as Record<string, unknown>[])
          setDrillCount(rows.length)
          break
        }

        case 'documents_pending': {
          const { data: empData } = await supabase
            .from('employees')
            .select('id')
            .eq('organization_id', orgId)
          const empIds = (empData ?? []).map((e: { id: string }) => e.id)
          if (empIds.length === 0) { setDrillCount(0); break }
          const { data: docs, error: docErr } = await supabase
            .from('employee_documents')
            .select(`
              id, file_name, created_at, is_verified,
              employees (employee_code, full_name),
              document_types (label)
            `)
            .eq('is_verified', false)
            .in('employee_id', empIds)
            .order('created_at', { ascending: false })
            .limit(100)
          if (docErr) throw docErr
          const rows = (docs ?? []).map((d: any) => ({
            id: d.id,
            employee: `${d.employees?.full_name ?? '—'} (${d.employees?.employee_code ?? '—'})`,
            document_type: d.document_types?.label ?? '—',
            uploaded: d.created_at,
            status: 'Pending Verification',
          }))
          setDrillRows(rows as unknown as Record<string, unknown>[])
          setDrillCount(rows.length)
          break
        }

        case 'branches': {
          const { data: branchData, error: branchErr } = await supabase
            .from('branches')
            .select('id, name, organization_id')
            .eq('organization_id', orgId)
            .eq('is_active', true)
            .order('name')
          if (branchErr) throw branchErr
          const branches = branchData ?? []
          const { data: empData } = await supabase
            .from('employees')
            .select('id, branch_id, is_active, employment_status')
            .eq('organization_id', orgId)
          const { data: deptData } = await supabase
            .from('departments')
            .select('id, branch_id')
            .eq('organization_id', orgId)
            .eq('is_active', true)
          const todayKolkata2 = new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' })
          const kolkataDate2 = new Date(todayKolkata2).toISOString().slice(0, 10)
          const { data: attData } = await supabase
            .from('attendance_records')
            .select('employee_id, attendance_date')
            .eq('organization_id', orgId)
            .eq('attendance_date', kolkataDate2)
          const attEmpIds = new Set((attData ?? []).map((a: any) => a.employee_id))

          const rows: BranchDrillRow[] = branches.map((b: any) => {
            const branchEmps = (empData ?? []).filter((e: any) => e.branch_id === b.id)
            const active = branchEmps.filter((e: any) => e.is_active).length
            const pending = branchEmps.filter((e: any) => ['invited', 'pending_activation'].includes(e.employment_status)).length
            const depts = (deptData ?? []).filter((d: any) => d.branch_id === b.id).length
            const checkedIn = branchEmps.filter((e: any) => attEmpIds.has(e.id)).length
            return {
              id: b.id,
              name: b.name,
              active_employees: active,
              departments: depts,
              checked_in_today: checkedIn,
              on_leave: 0,
              pending_activation: pending,
            }
          })
          setDrillRows(rows as unknown as Record<string, unknown>[])
          setDrillCount(rows.length)
          break
        }

        case 'departments': {
          const { data: deptData, error: deptErr } = await supabase
            .from('departments')
            .select('id, name, branch_id, branches (name)')
            .eq('organization_id', orgId)
            .eq('is_active', true)
            .order('name')
          if (deptErr) throw deptErr
          const { data: empData } = await supabase
            .from('employees')
            .select('id, department_id, is_active')
            .eq('organization_id', orgId)
          const todayKolkata3 = new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' })
          const kolkataDate3 = new Date(todayKolkata3).toISOString().slice(0, 10)
          const { data: attData } = await supabase
            .from('attendance_records')
            .select('employee_id')
            .eq('organization_id', orgId)
            .eq('attendance_date', kolkataDate3)
          const attEmpIds = new Set((attData ?? []).map((a: any) => a.employee_id))

          const rows: DeptDrillRow[] = (deptData ?? []).map((d: any) => {
            const deptEmps = (empData ?? []).filter((e: any) => e.department_id === d.id)
            const active = deptEmps.filter((e: any) => e.is_active).length
            const checkedIn = deptEmps.filter((e: any) => attEmpIds.has(e.id)).length
            return {
              id: d.id,
              name: d.name,
              branch: d.branches?.name ?? null,
              active_employees: active,
              manager: null,
              checked_in_today: checkedIn,
              on_leave: 0,
            }
          })
          setDrillRows(rows as unknown as Record<string, unknown>[])
          setDrillCount(rows.length)
          break
        }

        case 'unread_notifications': {
          const { data: notifData, error: notifErr } = await supabase
            .from('notifications')
            .select('id, title, message, priority, category, created_at, is_read')
            .eq('is_read', false)
            .order('created_at', { ascending: false })
            .limit(50)
          if (notifErr) throw notifErr
          const rows: NotifDrillRow[] = (notifData ?? []).map((n: any) => ({
            id: n.id,
            title: n.title,
            message: n.message,
            priority: n.priority,
            category: n.category,
            created_at: n.created_at,
            is_read: n.is_read,
          }))
          setDrillRows(rows as unknown as Record<string, unknown>[])
          setDrillCount(rows.length)
          break
        }
      }
    } catch (e) {
      setDrillError((e as Error).message)
    } finally {
      setDrillLoading(false)
    }
  }, [profile?.organization_id])

  const openDrillDown = useCallback((type: DrillDownType) => {
    loadDrillDown(type)
  }, [loadDrillDown])

  const closeDrillDown = useCallback(() => {
    setDrillDown(null)
    setDrillRows([])
    setDrillError(null)
    setDrillCount(null)
  }, [])

  // Navigate to filtered route (for large datasets)
  const navigateToFiltered = useCallback((path: string) => {
    navigate(path)
  }, [navigate])

  // Export shortcut from drill-down
  const exportFromDrillDown = useCallback(async (exportType: string) => {
    const today = new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' })
    const kolkataDate = new Date(today).toISOString().slice(0, 10)
    try {
      const { data: session } = await supabase.auth.getSession()
      const token = session.session?.access_token
      if (!token) throw new Error('Not authenticated')
      await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/export-handler`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({
          action: 'request_export',
          export_type: exportType,
          format: 'csv',
          filters: { from_date: kolkataDate, to_date: kolkataDate },
        }),
      })
    } catch {
      // best-effort
    }
  }, [])

  if (loading) {
    return <div className="dashboard"><DashboardSkeleton /></div>
  }

  if (error) {
    return <div className="dashboard"><div className="form-error">Failed to load dashboard: {error}</div></div>
  }

  const drillDownTitles: Record<string, string> = {
    checked_in: 'Checked In Today',
    pending_checkout: 'Pending Checkout',
    full_day: 'Full Day Today',
    half_day: 'Half Day Today',
    pending_corrections: 'Pending Corrections',
    active_employees: 'Active Employees',
    pending_activation: 'Pending Activation',
    onboarding: 'Onboarding Pending',
    documents_pending: 'Documents Pending Verification',
    branches: 'Branches',
    departments: 'Departments',
    unread_notifications: 'Unread Notifications',
  }

  // Render drill-down table based on type
  function renderDrillDownContent() {
    if (drillLoading) return <div className="drilldown-loading">Loading records…</div>
    if (drillError) return (
      <div className="drilldown-error">
        <div className="form-error">{drillError}</div>
        <button className="btn btn-sm" onClick={() => loadDrillDown(drillDown)} style={{ marginTop: '8px' }}>Retry</button>
      </div>
    )
    if (drillRows.length === 0) return <DrillDownEmpty message="No records found." />

    switch (drillDown) {
      case 'checked_in':
      case 'pending_checkout':
      case 'full_day':
      case 'half_day': {
        const rows = drillRows as unknown as AttDrillRow[]
        return <DrillDownTable
          columns={[
            { key: 'employee_code', label: 'Code', mono: true },
            { key: 'full_name', label: 'Name' },
            { key: 'branch', label: 'Branch' },
            { key: 'department', label: 'Department' },
            { key: 'check_in_at', label: 'Check-In', mono: true },
            { key: 'required_checkout_at', label: 'Std Checkout', mono: true },
            { key: 'check_out_at', label: 'Checkout', mono: true },
            { key: 'elapsed', label: 'Minutes', mono: true },
            { key: 'status', label: 'Status' },
          ]}
          rows={rows.map(r => ({
            employee_code: r.employee_code,
            full_name: r.full_name,
            branch: r.branch,
            department: r.department,
            check_in_at: formatTimestamp(r.check_in_at),
            required_checkout_at: formatTimestamp(r.required_checkout_at),
            check_out_at: r.check_out_at ? formatTimestamp(r.check_out_at) : '—',
            elapsed: r.elapsed ? `${r.elapsed}m` : '—',
            status: <span className={`attendance-badge ${r.status.toLowerCase()}`}>{ATTENDANCE_STATUS_LABELS[r.status as AttendanceStatus] ?? r.status}</span>,
          })) as unknown as Record<string, ReactNode>[]}
        />
      }

      case 'pending_corrections': {
        const rows = drillRows as unknown as { id: string; employee: string; type: string; reason: string; status: string; submitted: string; reviewed: string | null }[]
        return <DrillDownTable
          columns={[
            { key: 'employee', label: 'Employee' },
            { key: 'type', label: 'Type' },
            { key: 'reason', label: 'Reason' },
            { key: 'status', label: 'Status' },
            { key: 'submitted', label: 'Submitted', mono: true },
          ]}
          rows={rows.map(r => ({
            employee: r.employee,
            type: r.type,
            reason: r.reason,
            status: <span className={`attendance-badge ${r.status.toLowerCase()}`}>{r.status}</span>,
            submitted: formatTimestamp(r.submitted),
          })) as unknown as Record<string, ReactNode>[]}
        />
      }

      case 'active_employees': {
        const rows = drillRows as unknown as EmpDrillRow[]
        return <DrillDownTable
          columns={[
            { key: 'employee_code', label: 'Code', mono: true },
            { key: 'full_name', label: 'Name' },
            { key: 'designation', label: 'Designation' },
            { key: 'branch', label: 'Branch' },
            { key: 'department', label: 'Department' },
            { key: 'role', label: 'Role' },
            { key: 'work_mode', label: 'Work Mode' },
            { key: 'directory_status', label: 'Status' },
          ]}
          rows={rows.map(r => ({
            employee_code: r.employee_code,
            full_name: r.full_name,
            designation: r.designation ?? '—',
            branch: r.branch ?? '—',
            department: r.department ?? '—',
            role: r.role ? (ROLE_LABELS as Record<string, string>)[r.role] ?? r.role : '—',
            work_mode: r.work_mode ?? '—',
            directory_status: r.directory_status,
          })) as unknown as Record<string, ReactNode>[]}
        />
      }

      case 'pending_activation': {
        const rows = drillRows as unknown as EmpDrillRow[]
        return <DrillDownTable
          columns={[
            { key: 'employee_code', label: 'Code', mono: true },
            { key: 'full_name', label: 'Name' },
            { key: 'designation', label: 'Designation' },
            { key: 'branch', label: 'Branch' },
            { key: 'directory_status', label: 'Activation Status' },
            { key: 'role', label: 'Role' },
          ]}
          rows={rows.map(r => ({
            employee_code: r.employee_code,
            full_name: r.full_name,
            designation: r.designation ?? '—',
            branch: r.branch ?? '—',
            directory_status: r.directory_status,
            role: r.role ? (ROLE_LABELS as Record<string, string>)[r.role] ?? r.role : 'Not configured',
          })) as unknown as Record<string, ReactNode>[]}
        />
      }

      case 'onboarding': {
        const rows = drillRows as unknown as { id: string; employee: string; joining_date: string; progress: string; pending_items: string; status: string }[]
        return <DrillDownTable
          columns={[
            { key: 'employee', label: 'Employee' },
            { key: 'joining_date', label: 'Joining Date', mono: true },
            { key: 'progress', label: 'Progress', mono: true },
            { key: 'pending_items', label: 'Pending Items' },
            { key: 'status', label: 'Status' },
          ]}
          rows={rows.map(r => ({
            employee: r.employee,
            joining_date: r.joining_date,
            progress: r.progress,
            pending_items: r.pending_items,
            status: <span className="tag tag-amber">{r.status}</span>,
          })) as unknown as Record<string, ReactNode>[]}
        />
      }

      case 'documents_pending': {
        const rows = drillRows as unknown as { id: string; employee: string; document_type: string; uploaded: string; status: string }[]
        return <DrillDownTable
          columns={[
            { key: 'employee', label: 'Employee' },
            { key: 'document_type', label: 'Document Type' },
            { key: 'uploaded', label: 'Uploaded', mono: true },
            { key: 'status', label: 'Status' },
          ]}
          rows={rows.map(r => ({
            employee: r.employee,
            document_type: r.document_type,
            uploaded: formatTimestamp(r.uploaded),
            status: <span className="tag tag-amber">{r.status}</span>,
          })) as unknown as Record<string, ReactNode>[]}
        />
      }

      case 'branches': {
        const rows = drillRows as unknown as BranchDrillRow[]
        return <DrillDownTable
          columns={[
            { key: 'name', label: 'Branch' },
            { key: 'active_employees', label: 'Active', mono: true },
            { key: 'departments', label: 'Departments', mono: true },
            { key: 'checked_in_today', label: 'Checked In', mono: true },
            { key: 'pending_activation', label: 'Pending Activation', mono: true },
          ]}
          rows={rows.map(r => ({
            name: r.name,
            active_employees: r.active_employees,
            departments: r.departments,
            checked_in_today: r.checked_in_today,
            pending_activation: r.pending_activation,
          })) as unknown as Record<string, ReactNode>[]}
        />
      }

      case 'departments': {
        const rows = drillRows as unknown as DeptDrillRow[]
        return <DrillDownTable
          columns={[
            { key: 'name', label: 'Department' },
            { key: 'branch', label: 'Branch' },
            { key: 'active_employees', label: 'Active', mono: true },
            { key: 'checked_in_today', label: 'Checked In', mono: true },
          ]}
          rows={rows.map(r => ({
            name: r.name,
            branch: r.branch ?? '—',
            active_employees: r.active_employees,
            checked_in_today: r.checked_in_today,
          })) as unknown as Record<string, ReactNode>[]}
        />
      }

      case 'unread_notifications': {
        const rows = drillRows as unknown as NotifDrillRow[]
        return <DrillDownTable
          columns={[
            { key: 'title', label: 'Title' },
            { key: 'priority', label: 'Priority' },
            { key: 'category', label: 'Category' },
            { key: 'created_at', label: 'Time', mono: true },
          ]}
          rows={rows.map(r => ({
            title: r.title,
            priority: <span className={`tag tag-${r.priority}`}>{r.priority}</span>,
            category: r.category.replace(/_/g, ' '),
            created_at: new Date(r.created_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
          })) as unknown as Record<string, ReactNode>[]}
        />
      }

      default:
        return null
    }
  }

  // Export shortcut footer for drill-downs
  function renderDrillDownFooter() {
    if (!canExportOrg && !canExportTeam) return null
    const exportMap: Record<string, string> = {
      active_employees: 'attendance_summary',
      checked_in: 'attendance_summary',
      pending_checkout: 'attendance_summary',
      full_day: 'attendance_summary',
      half_day: 'attendance_summary',
    }
    const exportType = exportMap[drillDown ?? '']
    if (!exportType) return null
    return (
      <button
        className="btn btn-sm btn-secondary"
        onClick={() => exportFromDrillDown(exportType)}
        type="button"
      >
        Export this list
      </button>
    )
  }

  return (
    <div className="dashboard">
      <div className="dashboard-welcome">
        <h2 className="dashboard-greeting">Welcome, {greeting}</h2>
        <p className="dashboard-role">
          <span className="dashboard-role-badge">{roleLabel}</span>
        </p>
      </div>

      {canCheckIn && (
        <div className="dashboard-section">
          <h3 className="dashboard-section-title">Today's Attendance</h3>
          <div className="card dashboard-status-card">
            {attendanceError && <div className="form-error" style={{ marginBottom: '12px' }}>{attendanceError}</div>}
            {attendanceSuccess && <div className="form-success" style={{ marginBottom: '12px' }}>{attendanceSuccess}</div>}
            {todayAttendance ? (
              <>
                <div className="dashboard-status-row">
                  <span className="dashboard-status-label">Check-In</span>
                  <span className="dashboard-status-value mono">{formatTimestamp(todayAttendance.check_in_at)}</span>
                </div>
                <div className="dashboard-status-row">
                  <span className="dashboard-status-label">Standard Checkout Time</span>
                  <span className="dashboard-status-value mono">{formatTimestamp(todayAttendance.required_checkout_at)}</span>
                </div>
                <div className="dashboard-status-row">
                  <span className="dashboard-status-label">Standard Shift</span>
                  <span className="dashboard-status-value">9 Hours</span>
                </div>
                <div className="dashboard-status-row">
                  <span className="dashboard-status-label">Status</span>
                  <span className="dashboard-status-value">
                    <span className={`attendance-badge ${todayAttendance.final_status.toLowerCase()}`}>
                      {ATTENDANCE_STATUS_LABELS[todayAttendance.final_status as AttendanceStatus] ?? todayAttendance.final_status}
                    </span>
                  </span>
                </div>
                {todayAttendance.final_status === 'PENDING_CHECKOUT' && todayAttendance.actual_elapsed_minutes !== null && (
                  <div className="dashboard-status-row">
                    <span className="dashboard-status-label">Working Hours Completed</span>
                    <span className="dashboard-status-value mono" style={{ fontWeight: 700 }}>
                      {Math.floor(todayAttendance.actual_elapsed_minutes / 60)}h {todayAttendance.actual_elapsed_minutes % 60}m
                    </span>
                  </div>
                )}
                {todayAttendance.final_status === 'PENDING_CHECKOUT' && todayAttendance.actual_elapsed_minutes !== null && todayAttendance.actual_elapsed_minutes < 540 && (
                  <div className="form-success" style={{ marginTop: '8px' }}>
                    You must complete the standard 9-hour attendance duration to qualify for Full Day. Early checkout will be marked Half Day.
                  </div>
                )}
                {todayAttendance.final_status === 'PENDING_CHECKOUT' && todayAttendance.actual_elapsed_minutes !== null && todayAttendance.actual_elapsed_minutes >= 540 && (
                  <div className="form-success" style={{ marginTop: '8px' }}>
                    You have completed the standard 9-hour attendance duration and now qualify for Full Day.
                  </div>
                )}
                {todayAttendance.final_status === 'PENDING_CHECKOUT' && (
                  <>
                    <div className="dashboard-status-row">
                      <span className="dashboard-status-label">Time Remaining</span>
                      <span className="dashboard-status-value mono" style={{ fontWeight: 700 }}>
                        {formatTimeRemaining(todayAttendance.required_checkout_at)}
                      </span>
                    </div>
                    {canCheckOut && (
                      <button className="btn btn-checkout" style={{ marginTop: '12px', width: '100%' }} onClick={() => setShowCheckout(true)}>
                        Check Out
                      </button>
                    )}
                  </>
                )}
              </>
            ) : (
              <>
                <div className="dashboard-status-row">
                  <span className="dashboard-status-label">No check-in yet today</span>
                </div>
                <button className="btn btn-checkin" style={{ marginTop: '12px', width: '100%' }} onClick={handleDashboardCheckIn} disabled={checkingIn}>
                  {checkingIn ? 'Checking in…' : 'Check In'}
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {canReadAll && (
        <div className="dashboard-section">
          <h3 className="dashboard-section-title">Attendance Today</h3>
          <div className="dashboard-grid">
            <MetricCard label="Checked In" value={metrics.checkedInToday} onClick={() => openDrillDown('checked_in')} ariaLabel="View checked-in employees" />
            <MetricCard label="Pending Checkout" value={metrics.pendingCheckout} onClick={() => openDrillDown('pending_checkout')} ariaLabel="View employees pending checkout" />
            <MetricCard label="Full Day" value={metrics.fullDay} onClick={() => openDrillDown('full_day')} ariaLabel="View full day employees" />
            <MetricCard label="Half Day" value={metrics.halfDay} onClick={() => openDrillDown('half_day')} ariaLabel="View half day employees" />
            <MetricCard label="Pending Corrections" value={metrics.pendingCorrections} onClick={() => navigateToFiltered('/corrections?status=pending')} ariaLabel="View pending corrections" />
          </div>
        </div>
      )}

      {canReadEmployees && (
        <div className="dashboard-section">
          <h3 className="dashboard-section-title">Organization Overview</h3>
          <div className="dashboard-grid">
            <MetricCard label="Active Employees" value={metrics.activeEmployees} onClick={() => openDrillDown('active_employees')} ariaLabel="View active employees" />
            {canReadOrg && <MetricCard label="Branches" value={metrics.branches} onClick={() => openDrillDown('branches')} ariaLabel="View branches" />}
            {canReadOrg && <MetricCard label="Departments" value={metrics.departments} onClick={() => openDrillDown('departments')} ariaLabel="View departments" />}
            <MetricCard label="Pending Activation" value={metrics.pendingActivation} onClick={() => openDrillDown('pending_activation')} ariaLabel="View pending activation employees" />
            <MetricCard label="Onboarding Pending" value={metrics.onboardingPending} onClick={() => openDrillDown('onboarding')} ariaLabel="View onboarding pending" />
            <MetricCard label="Documents Pending Verification" value={metrics.documentsPendingVerification} onClick={() => openDrillDown('documents_pending')} ariaLabel="View documents pending verification" />
          </div>
        </div>
      )}

      <div className="dashboard-section">
        <h3 className="dashboard-section-title">Notifications</h3>
        <div className="dashboard-grid">
          <MetricCard label="Unread" value={metrics.unreadNotifications} onClick={() => navigateToFiltered('/notifications?read=false')} ariaLabel="View unread notifications" />
        </div>
      </div>

      {(metrics.pendingReviews !== null || metrics.openFollowUps !== null || metrics.todayReports !== null) && (
        <div className="dashboard-section">
          <h3 className="dashboard-section-title">Daily Reports & Follow-ups</h3>
          <div className="dashboard-grid">
            {metrics.pendingReviews !== null && <MetricCard label="Pending Reviews" value={metrics.pendingReviews} onClick={() => navigateToFiltered('/report-review?status=submitted')} ariaLabel="View pending report reviews" />}
            {metrics.openFollowUps !== null && <MetricCard label="Open Follow-ups" value={metrics.openFollowUps} onClick={() => navigateToFiltered('/follow-up-queue?status=open')} ariaLabel="View open follow-ups" />}
            {metrics.todayReports !== null && <MetricCard label="Today's Reports" value={metrics.todayReports} onClick={() => navigateToFiltered('/team-reports?date=today')} ariaLabel="View today's reports" />}
          </div>
        </div>
      )}

      {canReadAudit && recentAudit.length > 0 && (
        <div className="dashboard-section">
          <h3 className="dashboard-section-title">Recent Activity</h3>
          <div className="card dashboard-status-card">
            {recentAudit.map((a, i) => (
              <div key={i} className="dashboard-status-row">
                <span className="dashboard-status-label">
                  <span className="tag tag-ink">{a.action}</span>
                </span>
                <span className="dashboard-status-value mono" style={{ fontSize: '11px' }}>
                  {a.entity_type} · {new Date(a.created_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {showCheckout && (
        <CheckoutModal
          userId={profile!.id}
          onClose={() => setShowCheckout(false)}
          onSuccess={handleDashboardCheckoutSuccess}
        />
      )}

      <DrillDownDrawer
        open={drillDown !== null}
        title={drillDown ? drillDownTitles[drillDown] : ''}
        onClose={closeDrillDown}
        loading={drillLoading}
        error={drillError}
        onRetry={() => loadDrillDown(drillDown)}
        count={drillCount}
        footer={renderDrillDownFooter()}
      >
        {renderDrillDownContent()}
      </DrillDownDrawer>
    </div>
  )
}

function MetricCard({
  label,
  value,
  onClick,
  ariaLabel,
}: {
  label: string
  value: number | null
  onClick?: () => void
  ariaLabel?: string
}) {
  if (!onClick) {
    return (
      <div className="dashboard-card">
        <div className="dashboard-card-num">{value ?? '—'}</div>
        <div className="dashboard-card-lbl">{label}</div>
      </div>
    )
  }
  return (
    <div
      className="dashboard-card dashboard-card-interactive"
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onClick()
        }
      }}
      role="button"
      tabIndex={0}
      aria-label={ariaLabel ?? `View details for ${label}`}
    >
      <div className="dashboard-card-num">{value ?? '—'}</div>
      <div className="dashboard-card-lbl">{label}</div>
      <div className="dashboard-card-details">
        <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
          <path d="M6 3l5 5-5 5V3z" />
        </svg>
        View details
      </div>
    </div>
  )
}
