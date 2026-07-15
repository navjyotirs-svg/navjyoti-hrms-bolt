# Navjyoti HRMS — Memory

## 2026-07-15 scope reset
Payroll, salary, compensation, payslips, incentives, deductions and performance-linked financial actions are excluded.

## Current source
The available source is a single legacy HTML prototype with useful UI/workflow examples but mock users, browser storage, browser timestamps, client-only reminders and obsolete payroll sections. It is reference-only.

## Confirmed attendance
Check-in any time; no Late status; required checkout = server check-in +540 minutes; Pending before checkout; Full Day at/after 540; Half Day before 540; missing checkout remains pending; camera and location required; reminders at -2 minutes and required checkout using cron + realtime.

## Phase 0 — completed 2026-07-15

### Objective
Create React/TypeScript shell, design tokens, role-aware navigation, Bolt Database/Auth foundation, GitHub-ready structure, no localStorage, no user-switch login, no payroll code.

### Files created
- `package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`, `.gitignore`
- `src/main.tsx` — app entry point
- `src/App.tsx` — routing with auth guard, protected routes, placeholder pages
- `src/vite-env.d.ts` — env type declarations
- `src/lib/supabase.ts` — Supabase client singleton
- `src/auth/AuthContext.tsx` — auth provider with signIn/signUp/signOut, session + profile loading, onAuthStateChange with async guard
- `src/auth/LoginPage.tsx` — sign in / sign up page with email/password
- `src/styles/auth.css` — login page styles
- `src/components/AppShell.tsx` — sidebar + topbar layout with Outlet
- `src/components/Sidebar.tsx` — role-aware responsive navigation with mobile drawer
- `src/components/Topbar.tsx` — page title, notifications bell, user info
- `src/styles/shell.css` — shell layout styles, responsive breakpoints
- `src/pages/Dashboard.tsx` — Phase 0 status dashboard
- `src/styles/dashboard.css` — dashboard styles
- `src/pages/PlaceholderPage.tsx` — placeholder + not-found pages
- `src/styles/tokens.css` — design tokens (colors, typography, spacing, radius, shadows)
- `src/types/roles.ts` — 7-role definitions, nav items, role-to-nav filtering

### Tables created
- `user_profiles` (id, email, full_name, role, created_at, updated_at) with RLS (4 policies: select/insert/update/delete, all auth.uid()-scoped)

### Checks
- TypeScript: `tsc -b --noEmit` — passes
- Build: `vite build` — passes (88 modules, 395.93 kB JS / 9.39 kB CSS)

### Decisions
- 7 roles from PRD (director, hr_administrator, manager, team_leader, employee, intern_trainee, system_administrator) — not the legacy 4
- Design tokens extracted from Design.md and legacy HTML CSS variables
- Navigation uses SVG icons instead of unicode glyphs
- Mobile sidebar drawer with overlay for responsive design
- user_profiles.id defaults to auth.uid() for safe client inserts
- Sign-up creates a user_profiles row with role='employee' as default
- No payroll/salary/compensation code anywhere in the project

### Risks
- Profile fetch after sign-up may race with auth state change; may need retry logic in Phase 1
- Role assignment is currently self-service at sign-up; Phase 1 must restrict to authorized admins
- No organization/branch/department scoping yet — Phase 1 adds these

### Next task
Phase 1 — Auth, organization and RBAC: organizations, branches, departments, reporting hierarchy, role assignment by authorized users, server authorization, and RLS with org/branch scope.

## Phase 1 — completed 2026-07-15

### Objective
Authentication, organization structure, role-based access control, reporting hierarchy, server-enforced authorization, and RLS.

### Tables created (11 new + 1 modified)
1. `organizations` (id, name, slug, is_active, created_at, updated_at) — RLS: 4 policies
2. `branches` (id, organization_id, name, location, is_active, created_at, updated_at) — RLS: 4 policies
3. `departments` (id, organization_id, branch_id, name, is_active, created_at, updated_at) — RLS: 4 policies
4. `roles` (id, code, label, description, is_system_role, created_at) — RLS: SELECT only
5. `permissions` (id, code, label, description, created_at) — RLS: SELECT only
6. `role_permissions` (role_id, permission_id) — RLS: SELECT only
7. `employees` (id, user_id, organization_id, branch_id, department_id, employee_code, full_name, designation, work_email, work_mode, employment_status, joining_date, is_active, created_at, updated_at) — RLS: 4 policies
8. `employee_reporting_lines` (employee_id, manager_id, created_at) — RLS: 3 policies (SELECT, INSERT, DELETE)
9. `user_organization_memberships` (user_id, organization_id, is_active, created_at) — RLS: 4 policies
10. `audit_logs` (id, actor_id, action, entity_type, entity_id, old_values, new_values, created_at) — RLS: 2 policies (SELECT, INSERT only — append-only)
11. `user_profiles` (modified: added organization_id, status, is_active; updated RLS: 4 policies; added trigger to prevent self-role/org/status change)

### RLS helper functions (5)
- `current_user_org_id()` — returns user's active org from memberships
- `current_user_role_code()` — returns user's role from user_profiles
- `current_user_has_permission(perm_code)` — checks role_permissions join
- `current_user_employee_id()` — returns user's active employee record id
- `is_in_reporting_subtree(manager_id, employee_id)` — recursive CTE for reporting tree traversal

### RLS policies (32 total across 11 tables)
- organizations: SELECT (membership or org.manage), INSERT/UPDATE/DELETE (org.manage)
- branches: SELECT (same-org), INSERT/UPDATE/DELETE (same-org + branch.manage)
- departments: SELECT (same-org), INSERT/UPDATE/DELETE (same-org + department.manage)
- roles/permissions/role_permissions: SELECT only (system-managed)
- employees: SELECT (self or same-org with read_all or read_team via subtree), INSERT (employee.create), UPDATE (self or employee.update), DELETE (employee.deactivate)
- employee_reporting_lines: SELECT (self, manager, or same-org with read permissions), INSERT/DELETE (reporting_line.manage)
- user_organization_memberships: SELECT (self or same-org read_all), INSERT (employee.create), UPDATE (employee.update), DELETE (org.manage)
- user_profiles: SELECT (self or same-org with read permissions), INSERT (self only), UPDATE (self or employee.update with trigger blocking role/org/status changes), DELETE (org.manage)
- audit_logs: SELECT (audit.read), INSERT (any authenticated), no UPDATE/DELETE (append-only)

### Permission matrix (15 permissions × 7 roles)
- director: all 15
- hr_admin: 12 (org.read, branch.read/manage, dept.read/manage, employee.read_all/create/update/deactivate, role.assign, reporting_line.manage, audit.read)
- manager: 6 (org.read, branch.read, dept.read, employee.read_team, employee.update, reporting_line.manage)
- team_leader: 4 (org.read, branch.read, dept.read, employee.read_team)
- employee: 1 (employee.read_self)
- intern: 1 (employee.read_self)
- system_admin: 3 (org.read, org.manage, audit.read) — NO employee data access by default

### Files changed
- `src/types/roles.ts` — rewritten with Permission type, 15 permission codes, nav items use permissions instead of roles
- `src/auth/AuthContext.tsx` — removed signUp, added resetPassword/updatePassword/refreshProfile, fetches permissions, handles pending/disabled status
- `src/auth/LoginPage.tsx` — sign-in only (no sign-up), forgot password link
- `src/auth/ForgotPasswordPage.tsx` — NEW: email entry for reset link
- `src/auth/ResetPasswordPage.tsx` — NEW: new password entry
- `src/auth/PendingActivationPage.tsx` — NEW: shows pending activation state
- `src/auth/UnauthorizedPage.tsx` — NEW: 403 access denied
- `src/components/AppShell.tsx` — added pending/disabled handling
- `src/components/Sidebar.tsx` — uses permissions for nav filtering
- `src/components/PermissionGuard.tsx` — NEW: conditional rendering by permission
- `src/pages/Dashboard.tsx` — updated for Phase 1
- `src/pages/OrganizationSettingsPage.tsx` — NEW: view/edit organization
- `src/pages/BranchManagementPage.tsx` — NEW: list/create branches
- `src/pages/DepartmentManagementPage.tsx` — NEW: list/create departments
- `src/pages/EmployeeDirectoryPage.tsx` — NEW: list employees with role display
- `src/pages/AddEmployeePage.tsx` — NEW: invite employee form (calls edge function)
- `src/pages/EmployeeProfilePage.tsx` — NEW: view employee detail
- `src/pages/RolePermissionPage.tsx` — NEW: roles list + permission matrix
- `src/pages/ReportingHierarchyPage.tsx` — NEW: reporting tree view
- `src/pages/AuditTrailPage.tsx` — NEW: audit log viewer
- `src/pages/AccountSettingsPage.tsx` — NEW: profile + password change + MFA info
- `src/App.tsx` — all new routes with PermissionGuard
- `src/styles/shared.css` — NEW: shared styles for management pages
- `supabase/functions/invite-employee/index.ts` — NEW: server-side employee creation edge function

### Edge function
- `invite-employee` (ACTIVE, JWT verified) — creates auth user, user_profile (pending_activation), employee record, org membership, reporting line, and audit log in a single server-side transaction. Only users with employee.create permission can call it. Only Director can assign Director role.

### Bootstrap procedure
1. An existing user (`navjyoti.rs@gmail.com`) was promoted to Director via a controlled SQL seed (execute_sql with service role).
2. This created: organization "Navjyoti Foundation", user_profile with role=director, employee record EMP-001, org membership, and audit log entry.
3. This is a one-time operation. No public signup route exists. All future employee creation goes through the invite-employee edge function.
4. The bootstrap SQL is not stored as a migration — it was a manual one-time operation via execute_sql.

### Checks
- TypeScript: `tsc -b --noEmit` — passes
- Build: `vite build` — passes (104 modules, 430.97 kB JS / 14.45 kB CSS)
- RLS tests: 12 tests passed (all tables have RLS, no payroll tables/columns, permission matrix correct, trigger exists, audit append-only, system_admin no employee access, bootstrap verified, edge function deployed)

### Known risks
- Profile fetch after sign-up may race with auth state change (mitigated: removed public sign-up)
- Role assignment is server-side only (edge function) but RLS on user_profiles UPDATE still allows self-update of non-protected fields
- MFA is documented but not yet implemented (preparation only)
- No automated test framework (vitest/jest) — RLS tests are SQL-based via execute_sql
- The `is_in_reporting_subtree` function uses a recursive CTE which may be slow for very deep hierarchies
- Employee profile page does not enforce read_team scope at the DB level (RLS does, but the page fetches by ID without checking subtree)

### Next task
Phase 2 — Employee lifecycle: detailed profiles, onboarding workflows, private document management, transfers, deactivation, and enhanced audit trails.
