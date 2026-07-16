import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from '@/auth/AuthContext'
import { LoginPage } from '@/auth/LoginPage'
import { ForgotPasswordPage } from '@/auth/ForgotPasswordPage'
import { ResetPasswordPage } from '@/auth/ResetPasswordPage'
import { UnauthorizedPage } from '@/auth/UnauthorizedPage'
import { AppShell } from '@/components/AppShell'
import { PermissionGuard } from '@/components/PermissionGuard'
import { Dashboard } from '@/pages/Dashboard'
import { NotFoundPage } from '@/pages/PlaceholderPage'
import { OrganizationSettingsPage } from '@/pages/OrganizationSettingsPage'
import { BranchManagementPage } from '@/pages/BranchManagementPage'
import { DepartmentManagementPage } from '@/pages/DepartmentManagementPage'
import { EmployeeDirectoryPage } from '@/pages/EmployeeDirectoryPage'
import { AddEmployeePage } from '@/pages/AddEmployeePage'
import { EmployeeProfilePage } from '@/pages/EmployeeProfilePage'
import { RolePermissionPage } from '@/pages/RolePermissionPage'
import { ReportingHierarchyPage } from '@/pages/ReportingHierarchyPage'
import { AuditTrailPage } from '@/pages/AuditTrailPage'
import { AccountSettingsPage } from '@/pages/AccountSettingsPage'
import { AttendancePage } from '@/pages/AttendancePage'
import { AttendanceManagementPage } from '@/pages/AttendanceManagementPage'
import { AttendanceCorrectionsPage } from '@/pages/AttendanceCorrectionsPage'
import type { ReactNode } from 'react'
import type { Permission } from '@/types/roles'

function ProtectedRoute({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth()

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
        <p style={{ color: 'var(--slate)', fontSize: '14px' }}>Loading…</p>
      </div>
    )
  }

  if (!session) {
    return <Navigate to="/login" replace />
  }

  return <>{children}</>
}

function PermissionRoute({ permissions, children }: { permissions: Permission[]; children: ReactNode }) {
  return (
    <PermissionGuard permissions={permissions}>
      {children}
    </PermissionGuard>
  )
}

function AppRoutes() {
  const { session, loading } = useAuth()

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
        <p style={{ color: 'var(--slate)', fontSize: '14px' }}>Loading…</p>
      </div>
    )
  }

  return (
    <Routes>
      <Route path="/login" element={session ? <Navigate to="/" replace /> : <LoginPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/unauthorized" element={<UnauthorizedPage />} />
      <Route
        element={
          <ProtectedRoute>
            <AppShell />
          </ProtectedRoute>
        }
      >
        <Route path="/" element={<Dashboard />} />
        <Route path="/organization" element={
          <PermissionRoute permissions={['organization.read']}><OrganizationSettingsPage /></PermissionRoute>
        } />
        <Route path="/branches" element={
          <PermissionRoute permissions={['branch.read']}><BranchManagementPage /></PermissionRoute>
        } />
        <Route path="/departments" element={
          <PermissionRoute permissions={['department.read']}><DepartmentManagementPage /></PermissionRoute>
        } />
        <Route path="/employees" element={
          <PermissionRoute permissions={['employee.read_self', 'employee.read_team', 'employee.read_all', 'employee.profile.read_self', 'employee.profile.read_team', 'employee.profile.read_all']}><EmployeeDirectoryPage /></PermissionRoute>
        } />
        <Route path="/employees/add" element={
          <PermissionRoute permissions={['employee.create']}><AddEmployeePage /></PermissionRoute>
        } />
        <Route path="/employees/:id" element={
          <PermissionRoute permissions={['employee.read_self', 'employee.read_team', 'employee.read_all', 'employee.profile.read_self', 'employee.profile.read_team', 'employee.profile.read_all']}><EmployeeProfilePage /></PermissionRoute>
        } />
        <Route path="/hierarchy" element={
          <PermissionRoute permissions={['employee.read_team', 'employee.read_all', 'reporting_line.manage']}><ReportingHierarchyPage /></PermissionRoute>
        } />
        <Route path="/roles" element={
          <PermissionRoute permissions={['role.assign', 'audit.read']}><RolePermissionPage /></PermissionRoute>
        } />
        <Route path="/audit" element={
          <PermissionRoute permissions={['audit.read']}><AuditTrailPage /></PermissionRoute>
        } />
        <Route path="/attendance" element={
          <PermissionRoute permissions={['attendance.read_self', 'attendance.check_in_self']}><AttendancePage /></PermissionRoute>
        } />
        <Route path="/attendance-management" element={
          <PermissionRoute permissions={['attendance.read_all', 'attendance.correct_manage', 'attendance.report_read']}><AttendanceManagementPage /></PermissionRoute>
        } />
        <Route path="/attendance-corrections" element={
          <PermissionRoute permissions={['attendance.correct_request_self', 'attendance.correct_manage']}><AttendanceCorrectionsPage /></PermissionRoute>
        } />
        <Route path="/settings" element={<AccountSettingsPage />} />
      </Route>
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  )
}

export function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </AuthProvider>
  )
}
