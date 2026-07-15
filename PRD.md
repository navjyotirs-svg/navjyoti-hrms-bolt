# Navjyoti HRMS — PRD (No Payroll)

## Objective
Build a secure multi-entity, multi-branch HRMS for employee identity, hierarchy, attendance, leave, tasks, task rejection/reassignment, tickets, daily reports, calendar, notifications, documents, operational reports and audit trails.

## Roles
Director, HR Administrator, Manager, Team Leader, Employee, Intern/Trainee and System Administrator.

## Explicitly excluded
Do not create payroll, salary, payslips, compensation, incentives, salary deductions, PF/ESIC/TDS or any financial-performance workflow. Task performance remains operational only.

## Attendance
- Monday–Saturday working; Sunday weekly off.
- No Late status based on check-in time.
- Required checkout = server check-in + 540 minutes.
- 540 minutes = 480 work + 60 break.
- Before checkout: `PENDING_CHECKOUT`.
- Checkout at/after 540 minutes: `FULL_DAY`.
- Checkout before 540 minutes: `HALF_DAY`.
- Missing checkout remains pending until authorized correction.
- Do not use Late, Absent or Short Attendance for an actual check-in record.
- Store UTC; display Asia/Kolkata.
- Approved leave, holiday and weekly off must not be overwritten.

## Checkout evidence
Checkout requires a direct-click camera permission request, captured photo, direct-click location permission, latitude/longitude, server timestamp and private storage confirmation. Employees cannot edit evidence or timestamps.

## Reminders
- Pre-alert two minutes before required checkout.
- Final alert at required checkout.
- Server cron creates reminders idempotently.
- Realtime sends in-app alerts.
- Sound requires explicit user enablement and an open app.

## Leave
One paid CL and one paid SL credited monthly; both carry forward. Use separate ledgers and audited approvals/cancellations/corrections.

## Tasks
Authorized Director/Manager assigns tasks. Employee may accept, request clarification/revision/reassignment or reject before acceptance. Rejection requires reason, workload, assigned target/deadline, proposed target/deadline and support required. Preserve immutable task/deadline/status history. Early/on-time/delayed labels have no financial effect.

## Tickets
Support task reassignment, unrealistic deadline, attendance correction, leave, technical, access, resources, HR grievance and other categories with status history, comments, attachments, SLA and audit.

## Daily reports
Link reports to tasks and capture plan, completed work, percentage, result, blockers, support, follow-up, tomorrow plan and evidence. Provide team/department/branch/organization summaries.

## Calendar and notifications
Support holidays, Sunday, branch calendars, meetings, training, deadlines, leave and reminders. Release 1 includes in-app realtime and email. Google Calendar, WhatsApp and Web Push are later releases.

## Security
Bolt Authentication, database-enforced role/scope rules, private storage, MFA for privileged roles, append-only audit, HTTPS and no secrets in client code.

## Done
A feature requires database, server logic, authorization, validation, UI states, audit, automated tests and documentation.
