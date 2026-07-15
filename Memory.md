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
- Role assignment is currently self-service at sign-up; Phase 1 must restrict role assignment to authorized admins
- No organization/branch/department scoping yet — Phase 1 adds these

### Next task
Phase 1 — Auth, organization and RBAC: organizations, branches, departments, reporting hierarchy, role assignment by authorized users, server authorization, and RLS with org/branch scope.
