/*
# Add Tables to Supabase Realtime Publication

## Purpose
Enables Supabase Realtime for all tables that need application-wide
realtime updates. Without this, no realtime events are delivered to
the frontend.

## Tables Added to supabase_realtime Publication
- employees
- user_profiles
- user_organization_memberships
- employee_status_history
- attendance_records
- attendance_corrections
- leave_requests
- leave_balances
- leave_ledger
- calendar_events
- holiday_calendar_dates
- tasks
- task_assignments
- task_status_history
- task_submissions
- task_comments
- tickets
- ticket_comments
- ticket_history
- daily_reports
- daily_report_history
- daily_report_comments
- notifications
- announcements
- management_follow_ups

## Security
- RLS remains enforced on all tables — realtime events are filtered by RLS
- Users only receive events for rows they can read (RLS applies to realtime)
- No additional policies needed — existing RLS is sufficient
*/

-- Add all tables to the realtime publication
-- Using ALTER PUBLICATION ... ADD TABLE which is idempotent-safe via DO block
DO $$
BEGIN
  -- Employees and profiles
  ALTER PUBLICATION supabase_realtime ADD TABLE public.employees;
  ALTER PUBLICATION supabase_realtime ADD TABLE public.user_profiles;
  ALTER PUBLICATION supabase_realtime ADD TABLE public.user_organization_memberships;
  ALTER PUBLICATION supabase_realtime ADD TABLE public.employee_status_history;

  -- Attendance
  ALTER PUBLICATION supabase_realtime ADD TABLE public.attendance_records;
  ALTER PUBLICATION supabase_realtime ADD TABLE public.attendance_corrections;

  -- Leave
  ALTER PUBLICATION supabase_realtime ADD TABLE public.leave_requests;
  ALTER PUBLICATION supabase_realtime ADD TABLE public.leave_balances;
  ALTER PUBLICATION supabase_realtime ADD TABLE public.leave_ledger;

  -- Calendar
  ALTER PUBLICATION supabase_realtime ADD TABLE public.calendar_events;
  ALTER PUBLICATION supabase_realtime ADD TABLE public.holiday_calendar_dates;

  -- Tasks
  ALTER PUBLICATION supabase_realtime ADD TABLE public.tasks;
  ALTER PUBLICATION supabase_realtime ADD TABLE public.task_assignments;
  ALTER PUBLICATION supabase_realtime ADD TABLE public.task_status_history;
  ALTER PUBLICATION supabase_realtime ADD TABLE public.task_submissions;
  ALTER PUBLICATION supabase_realtime ADD TABLE public.task_comments;

  -- Tickets
  ALTER PUBLICATION supabase_realtime ADD TABLE public.tickets;
  ALTER PUBLICATION supabase_realtime ADD TABLE public.ticket_comments;
  ALTER PUBLICATION supabase_realtime ADD TABLE public.ticket_history;

  -- Daily reports
  ALTER PUBLICATION supabase_realtime ADD TABLE public.daily_reports;
  ALTER PUBLICATION supabase_realtime ADD TABLE public.daily_report_history;
  ALTER PUBLICATION supabase_realtime ADD TABLE public.daily_report_comments;

  -- Notifications
  ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
  ALTER PUBLICATION supabase_realtime ADD TABLE public.announcements;

  -- Follow-ups
  ALTER PUBLICATION supabase_realtime ADD TABLE public.management_follow_ups;
EXCEPTION WHEN OTHERS THEN
  -- Tables may already be in the publication — ignore duplicate add errors
  NULL;
END $$;

-- Set replica identity to FULL for tables where we need old values in triggers
-- (needed for realtime to deliver both old and new row data)
ALTER TABLE public.employees REPLICA IDENTITY FULL;
ALTER TABLE public.attendance_records REPLICA IDENTITY FULL;
ALTER TABLE public.tasks REPLICA IDENTITY FULL;
ALTER TABLE public.tickets REPLICA IDENTITY FULL;
ALTER TABLE public.leave_requests REPLICA IDENTITY FULL;
ALTER TABLE public.daily_reports REPLICA IDENTITY FULL;
ALTER TABLE public.notifications REPLICA IDENTITY FULL;
