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

## Phase 2 — completed 2026-07-15

### Objective
Employee lifecycle, detailed employee profiles, onboarding checklists, private document management with Supabase Storage, transfers, deactivation/offboarding, and enhanced audit trails. No payroll/salary/compensation features.

### Migrations applied (7)
1. `phase2_new_permissions` — 13 new permissions added (employee.profile.read_all/read_self/read_team/update_all/update_self/view_sensitive, employee.document.manage/read_self/upload_self, employee.onboarding.manage, employee.status.manage, employee.transfer.manage, employee.offboarding.manage) + role_permissions matrix updates across 7 roles
2. `phase2_extend_employees` — 16 new columns on employees (preferred_name, personal_email, mobile_number, alternate_mobile_number, date_of_birth, gender, current_address, permanent_address, emergency_contact_name, emergency_contact_relation, emergency_contact_phone, employment_type, probation_end_date, confirmation_date, profile_photo_reference, exit_date) + 12-state CHECK constraint on employment_status + trigger `trg_prevent_self_employment_status_change` blocking self-edits of status/org/branch/department/manager/joining_date/designation/employment_type/employee_code
3. `phase2_document_types` — 15 document type seed rows (aadhaar, pan, identity_proof, address_proof, education_certificate, experience_letter, resume, offer_letter, appointment_letter, confirmation_letter, relieving_letter, resignation_letter, warning_letter, medical_certificate, other) with is_identity_proof and is_confidential flags
4. `phase2_document_tables` — employee_documents (with storage_path, randomized object names), document_versions (append-only), document_verification_history (append-only)
5. `phase2_onboarding` — onboarding_checklists + onboarding_checklist_items + `trg_create_onboarding_checklist` AFTER INSERT trigger auto-creating 10 standard checklist items on employee insert
6. `phase2_transfer_status_offboarding` — employee_transfers (with from/to branch+department+manager), employee_status_history (append-only), employee_offboarding
7. `phase2_rls_policies` — RLS on all 9 new tables + `can_access_employee_doc()` SECURITY DEFINER helper for document access (self-ownership or same-org with employee.document.manage permission)
8. `phase2_storage_policies` — Storage bucket `employee-documents` (private, public=false) with 4 storage policies (SELECT scoped by folder=auth.uid() or org-scoped manage permission, INSERT for authenticated, UPDATE/DELETE for manage permission)

### Tables created (9 new + 1 modified)
1. `document_types` (id, code, label, is_identity_proof, is_confidential, created_at) — RLS: SELECT only
2. `employee_documents` (id, employee_id, document_type_id, file_name, storage_path, mime_type, file_size, uploaded_by, is_verified, verified_by, verified_at, rejection_reason, created_at) — RLS: 3 policies (SELECT/INSERT scoped, UPDATE manage)
3. `document_versions` (id, document_id, version_number, file_name, storage_path, mime_type, file_size, uploaded_by, created_at) — RLS: 2 policies (SELECT scoped, INSERT authorized) — append-only
4. `document_verification_history` (id, document_id, action, performed_by, notes, created_at) — RLS: 2 policies (SELECT scoped, INSERT manage) — append-only
5. `onboarding_checklists` (id, employee_id, status, created_at, updated_at) — RLS: 2 policies (SELECT scoped, UPDATE manage)
6. `onboarding_checklist_items` (id, checklist_id, item_key, label, status, assigned_to, verified_by, notes, updated_at) — RLS: 2 policies (SELECT scoped, UPDATE manage)
7. `employee_transfers` (id, employee_id, from_branch_id, to_branch_id, from_department_id, to_department_id, from_manager_id, to_manager_id, transfer_date, reason, status, created_at) — RLS: 3 policies (SELECT/INSERT/UPDATE scoped)
8. `employee_status_history` (id, employee_id, previous_status, new_status, changed_by, reason, created_at) — RLS: 2 policies (SELECT scoped, INSERT manage) — append-only
9. `employee_offboarding` (id, employee_id, offboarding_type, last_working_date, reason, exit_interview_notes, created_at) — RLS: 3 policies (SELECT/INSERT/UPDATE scoped)
10. `employees` (modified: 16 new columns + 12-state CHECK + self-change prevention trigger)

### RLS helper functions (1 new)
- `can_access_employee_doc(p_doc_id uuid)` — SECURITY DEFINER; checks self-ownership (e.user_id = auth.uid()) or same-org with employee.document.manage permission

### Permission matrix updates (13 new permissions)
- director: all 13 new
- hr_admin: 10 new (profile.read_all/update_all/view_sensitive, document.manage, onboarding.manage, status.manage, transfer.manage, offboarding.manage, profile.read_self/update_self, document.read_self/upload_self)
- manager: 4 new (profile.read_team, profile.read_self, profile.update_self, document.read_self)
- team_leader: 2 new (profile.read_self, document.read_self)
- employee: 3 new (profile.read_self, profile.update_self, document.read_self/upload_self)
- intern: 3 new (same as employee)
- system_admin: 0 new (no employee data access)

### Edge functions (2 deployed)
1. `invite-employee` (ACTIVE, JWT verified) — updated: sets employment_status='invited' instead of 'active'
2. `manage-employee` (ACTIVE, JWT verified) — NEW: handles 3 actions:
   - `change_status`: updates employee employment_status, inserts employee_status_history, creates audit log
   - `transfer`: inserts employee_transfers record, updates employee branch/department/manager, creates audit log
   - `offboard`: inserts employee_offboarding record, updates employee employment_status to 'offboarded', sets user_profiles.status='disabled' and is_active=false, creates audit log

### Files changed
- `src/types/roles.ts` — updated with 28 total permissions, EmploymentStatus type (12 states), EMPLOYMENT_STATUS_LABELS, SENSITIVE_FIELDS, SELF_SERVICE_FIELDS, APPROVED_MIME_TYPES, nav items updated for Phase 2 permissions
- `src/auth/AuthContext.tsx` — unchanged from Phase 1
- `src/App.tsx` — all Phase 2 routes added with PermissionRoute guards
- `src/components/AppShell.tsx` — updated with getPageTitle helper for dynamic employee profile paths
- `src/components/Sidebar.tsx` — unchanged (permission-based nav from Phase 1)
- `src/components/PermissionGuard.tsx` — unchanged
- `src/pages/EmployeeProfilePage.tsx` — rewritten: 8 tabs (Overview, Personal Details, Employment Details, Documents, Onboarding, Transfer History, Status History, Audit History), document upload/download via Supabase Storage with signed URLs, sensitive field gating via view_sensitive permission, onboarding checklist management
- `src/pages/EmployeeDirectoryPage.tsx` — rewritten: search input, status filter dropdown (12 states), 7-column table (code, name, designation, department, branch, status, actions)
- `src/pages/AccountSettingsPage.tsx` — rewritten: self-service editable fields (preferred_name, personal_email, mobile_number, alternate_mobile_number, current_address, permanent_address, emergency contacts), read-only org fields, password change, MFA info
- `src/pages/Dashboard.tsx` — updated for Phase 2
- `src/styles/shared.css` — updated with Phase 2 shared classes
- `supabase/functions/invite-employee/index.ts` — updated employment_status to 'invited'
- `supabase/functions/manage-employee/index.ts` — NEW: server-side employee management (change_status, transfer, offboard)

### Storage
- Bucket `employee-documents`: private (public=false), 4 storage policies (SELECT, INSERT, UPDATE, DELETE)
- Documents stored with randomized object names (crypto.randomUUID in path)
- Access via signed URLs (short-lived, server-generated)

### Checks
- TypeScript: `tsc -b --noEmit` — passes
- Build: `npm run build` (tsc -b && vite build) — passes (104 modules, 448.34 kB JS / 14.45 kB CSS)
- RLS tests: 16 tests passed:
  1. All 9 new Phase 2 tables exist with RLS enabled
  2. No payroll/salary/payslip/compensation/deduction/incentive tables or columns exist (count=0)
  3. All 9 new tables have RLS policies (20 policies total across 9 tables)
  4. Employees CHECK constraint enforces 12-state employment_status
  5. Trigger `trg_prevent_self_employment_status_change` exists on employees (BEFORE UPDATE)
  6. All 13 new Phase 2 permissions exist in permissions table with correct role assignments
  7. 15 document type seed rows present with correct is_identity_proof/is_confidential flags
  8. Onboarding checklist auto-create trigger `trg_create_onboarding_checklist` exists (AFTER INSERT) with 10 standard items
  9. `create_onboarding_checklist()` function creates checklist with 10 items (identity_proof, address_proof, education_certificates, experience_documents, profile_photo, emergency_contact, policy_acknowledgement, it_access_confirmation, manager_confirmation, hr_verification)
  10. `prevent_self_employment_status_change()` function blocks self-changes to 9 fields (status, org, employee_code, branch, department, reporting_manager, joining_date, designation, employment_type)
  11. `can_access_employee_doc()` helper checks self-ownership or same-org with document.manage permission
  12. employee_documents policies: SELECT/INSERT scoped (self or org+manage), UPDATE (org+manage only)
  13. employee_transfers policies: SELECT scoped (self or org+manage), INSERT/UPDATE (org+manage)
  14. employee_status_history: append-only (SELECT + INSERT only, no UPDATE/DELETE)
  15. audit_logs: append-only (SELECT + INSERT only, no UPDATE/DELETE)
  16. Storage bucket `employee-documents` exists (private), 4 storage policies with correct scoping (SELECT by folder=auth.uid() or org+manage, INSERT authenticated, UPDATE/DELETE manage-only)

### Known risks
- No automated test framework (vitest/jest) — RLS tests are SQL-based via execute_sql
- Onboarding checklists are auto-created but no checklist items have been seeded yet (no employees created since trigger was added)
- Document signed URLs are generated client-side (not via edge function) — the manage-employee edge function does not handle document operations
- The `is_in_reporting_subtree` function uses a recursive CTE which may be slow for very deep hierarchies
- MFA is documented but not yet implemented (preparation only)
- No file size limit enforcement at the database level (enforced in frontend via APPROVED_MIME_TYPES only)
- Employee profile page fetches by ID — RLS enforces read scope at DB level but the page does not pre-check subtree access for team leaders/managers

### Next task
Phase 3 — Attendance & Leave Management: check-in/checkout with camera and location, server-side attendance computation, leave types and balances, leave application/approval workflow, holiday calendar, and attendance reports.
