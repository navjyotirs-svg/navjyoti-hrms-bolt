# Navjyoti HRMS — Bolt Architecture (No Payroll)

## Stack
React + TypeScript + Vite, React Router, TanStack Query, React Hook Form, Zod, Bolt Database/PostgreSQL, Bolt Authentication, private storage, server functions, realtime subscriptions, cron jobs and GitHub.

Do not use localStorage/window.storage as production persistence. Do not create a second database.

## Modules
auth, organizations, branches, departments, roles-permissions, employees, documents, attendance, attendance-evidence, corrections, leave, tasks, task-history, tickets, daily-reports, calendar, notifications, reports and audit.

Do not create payroll, salary, compensation, incentive, deduction or payslip modules.

## Core tables
organizations, branches, departments, roles, permissions, role_permissions, user_profiles, employees, reporting_lines, employee_documents, attendance_records, attendance_evidence, attendance_corrections, leave_types, leave_balances, leave_ledger, leave_requests, tasks, task_assignments, task_status_history, task_deadline_history, task_comments, task_attachments, tickets, ticket_history, daily_reports, daily_report_task_items, calendar_events, notifications, notification_deliveries and audit_logs.

## Authorization
Enforce route/function permission, organization/branch/reporting scope and database RLS. Frontend hiding is not authorization.

## Attendance server flow
Check-in validates identity, prevents duplicate active records, uses server UTC, calculates +540 minutes and returns required checkout. Checkout verifies private image evidence and coordinates, records server UTC, computes elapsed minutes, assigns Full/Half Day and writes audit.

## Realtime reminders
Cron inserts idempotent notification rows. Realtime filters to the authenticated recipient. The UI de-duplicates by ID and fetches unread rows after reconnect.

## Security
Deny by default, private files, least-privilege RLS, safe errors, auth rate limits, privileged MFA, audited sensitive changes and secrets only in Bolt Secrets.
