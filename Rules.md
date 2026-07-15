# Navjyoti HRMS — Bolt AI Rules

1. Read PRD, Architecture, Phases, Design and Memory before coding.
2. Never build payroll, salary, payslips, compensation, incentives or deductions.
3. Treat payroll sections in the legacy HTML as deleted requirements.
4. Never use mock user switching, localStorage/window.storage or browser-only persistence in production.
5. Server time is authoritative for attendance.
6. Reminders must not depend on an open tab.
7. Camera/location permission must be requested only after direct user click.
8. Private documents, photos and coordinates must never be public.
9. Frontend visibility is not authorization; enforce RLS and server checks.
10. Work on one phase at a time and create a checkpoint before broad changes.

For every feature implement: schema/constraints, RLS, server function, validation, audit, UI states, tests, documentation and Memory update.

Attendance: check-in +540 minutes; Pending before checkout; Full Day at/after 540; Half Day before 540; no Late status.

Completion labels: Not started, In progress, Implemented unverified, Automated tests passing, UAT passed, Production approved.
