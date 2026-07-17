/*
# Phase 5 — Task and Ticket Permissions

## Summary
Adds 27 new permissions (16 task + 11 ticket) and assigns them to roles
following the PRD's role authority model.

## New Permissions (27)

### Task Permissions (16)
1. task.create — Create/assign a task
2. task.assign — Assign task to employee
3. task.read_self — Read own assigned tasks
4. task.read_team — Read team's tasks (reporting subtree)
5. task.read_all — Read all tasks in organization
6. task.accept_self — Accept assigned task
7. task.request_change_self — Request clarification/revision/reassignment/rejection
8. task.progress_update_self — Add progress updates
9. task.submit_self — Submit task for review
10. task.review — Review submission, approve/revision/reject
11. task.reassign — Reassign task to different employee
12. task.change_deadline — Modify task deadline
13. task.cancel — Cancel a task
14. task.comment — Add comments to tasks
15. task.attachment_upload — Upload task attachments
16. task.attachment_read — Read task attachments
17. task.report_read — Read task operational reports

### Ticket Permissions (11)
18. ticket.create_self — Raise own ticket
19. ticket.read_self — Read own tickets
20. ticket.read_team — Read team's tickets
21. ticket.read_all — Read all tickets in organization
22. ticket.assign — Assign ticket to department/user
23. ticket.update — Update ticket details
24. ticket.resolve — Resolve a ticket
25. ticket.close — Close a ticket
26. ticket.reopen — Reopen a resolved/closed ticket
27. ticket.escalate — Escalate a ticket
28. ticket.comment — Add comments to tickets
29. ticket.attachment_upload — Upload ticket attachments
30. ticket.attachment_read — Read ticket attachments
31. ticket.report_read — Read ticket reports

## Role Assignments
- director: all 27
- hr_admin: task.read_all, task.comment, task.attachment_read, task.report_read,
  ticket.read_all, ticket.assign, ticket.update, ticket.resolve, ticket.close,
  ticket.reopen, ticket.escalate, ticket.comment, ticket.attachment_read, ticket.report_read
- manager: task.create, task.assign, task.read_team, task.review, task.reassign,
  task.change_deadline, task.cancel, task.comment, task.attachment_upload,
  task.attachment_read, task.report_read, ticket.read_team, ticket.assign,
  ticket.update, ticket.resolve, ticket.close, ticket.reopen, ticket.escalate,
  ticket.comment, ticket.attachment_upload, ticket.attachment_read, ticket.report_read
- team_leader: task.create, task.assign, task.read_team, task.review, task.comment,
  task.attachment_upload, task.attachment_read, ticket.read_team, ticket.assign,
  ticket.comment, ticket.attachment_upload, ticket.attachment_read
- employee: task.read_self, task.accept_self, task.request_change_self,
  task.progress_update_self, task.submit_self, task.comment, task.attachment_upload,
  task.attachment_read, ticket.create_self, ticket.read_self, ticket.comment,
  ticket.attachment_upload, ticket.attachment_read
- intern: same as employee
- system_admin: none (no private task/ticket content access by default)
*/

DO $$
BEGIN
  -- Task permissions (17 codes — task.report_read added)
  INSERT INTO permissions (code, label, description) VALUES
    ('task.create', 'Create Task', 'Create and assign tasks'),
    ('task.assign', 'Assign Task', 'Assign task to an employee'),
    ('task.read_self', 'Read Own Tasks', 'Read own assigned tasks'),
    ('task.read_team', 'Read Team Tasks', 'Read tasks of reporting subtree'),
    ('task.read_all', 'Read All Tasks', 'Read all tasks in organization'),
    ('task.accept_self', 'Accept Task', 'Accept an assigned task'),
    ('task.request_change_self', 'Request Task Change', 'Request clarification/revision/reassignment/rejection'),
    ('task.progress_update_self', 'Update Progress', 'Add progress updates to own tasks'),
    ('task.submit_self', 'Submit Task', 'Submit task for review'),
    ('task.review', 'Review Task', 'Review task submission'),
    ('task.reassign', 'Reassign Task', 'Reassign task to different employee'),
    ('task.change_deadline', 'Change Deadline', 'Modify task deadline'),
    ('task.cancel', 'Cancel Task', 'Cancel a task'),
    ('task.comment', 'Comment on Task', 'Add comments to tasks'),
    ('task.attachment_upload', 'Upload Task Attachment', 'Upload task attachments'),
    ('task.attachment_read', 'Read Task Attachment', 'Read task attachments'),
    ('task.report_read', 'Read Task Reports', 'Read task operational reports')
  ON CONFLICT (code) DO NOTHING;

  -- Ticket permissions (14 codes — ticket.report_read added)
  INSERT INTO permissions (code, label, description) VALUES
    ('ticket.create_self', 'Raise Ticket', 'Raise own support ticket'),
    ('ticket.read_self', 'Read Own Tickets', 'Read own tickets'),
    ('ticket.read_team', 'Read Team Tickets', 'Read team tickets'),
    ('ticket.read_all', 'Read All Tickets', 'Read all tickets in organization'),
    ('ticket.assign', 'Assign Ticket', 'Assign ticket to department or user'),
    ('ticket.update', 'Update Ticket', 'Update ticket details'),
    ('ticket.resolve', 'Resolve Ticket', 'Resolve a ticket'),
    ('ticket.close', 'Close Ticket', 'Close a ticket'),
    ('ticket.reopen', 'Reopen Ticket', 'Reopen a resolved or closed ticket'),
    ('ticket.escalate', 'Escalate Ticket', 'Escalate a ticket'),
    ('ticket.comment', 'Comment on Ticket', 'Add comments to tickets'),
    ('ticket.attachment_upload', 'Upload Ticket Attachment', 'Upload ticket attachments'),
    ('ticket.attachment_read', 'Read Ticket Attachment', 'Read ticket attachments'),
    ('ticket.report_read', 'Read Ticket Reports', 'Read ticket operational reports')
  ON CONFLICT (code) DO NOTHING;
END $$;

-- Assign permissions to roles
DO $$
DECLARE
  v_director_role uuid;
  v_hr_role uuid;
  v_manager_role uuid;
  v_team_leader_role uuid;
  v_employee_role uuid;
  v_intern_role uuid;
  v_perm uuid;
BEGIN
  SELECT id INTO v_director_role FROM roles WHERE code = 'director';
  SELECT id INTO v_hr_role FROM roles WHERE code = 'hr_admin';
  SELECT id INTO v_manager_role FROM roles WHERE code = 'manager';
  SELECT id INTO v_team_leader_role FROM roles WHERE code = 'team_leader';
  SELECT id INTO v_employee_role FROM roles WHERE code = 'employee';
  SELECT id INTO v_intern_role FROM roles WHERE code = 'intern';

  -- Director: all task + ticket permissions
  INSERT INTO role_permissions (role_id, permission_id)
  SELECT v_director_role, p.id FROM permissions p
  WHERE p.code LIKE 'task.%' OR p.code LIKE 'ticket.%'
  ON CONFLICT DO NOTHING;

  -- HR Admin: read-all + comment + attachment_read + report_read for tasks;
  --           full ticket management (read_all, assign, update, resolve, close, reopen, escalate, comment, attachment_read, report_read)
  INSERT INTO role_permissions (role_id, permission_id)
  SELECT v_hr_role, p.id FROM permissions p
  WHERE p.code IN (
    'task.read_all', 'task.comment', 'task.attachment_read', 'task.report_read',
    'ticket.read_all', 'ticket.assign', 'ticket.update', 'ticket.resolve',
    'ticket.close', 'ticket.reopen', 'ticket.escalate', 'ticket.comment',
    'ticket.attachment_read', 'ticket.report_read'
  )
  ON CONFLICT DO NOTHING;

  -- Manager: task.create, task.assign, task.read_team, task.review, task.reassign,
  --          task.change_deadline, task.cancel, task.comment, task.attachment_upload,
  --          task.attachment_read, task.report_read
  --          ticket.read_team, ticket.assign, ticket.update, ticket.resolve,
  --          ticket.close, ticket.reopen, ticket.escalate, ticket.comment,
  --          ticket.attachment_upload, ticket.attachment_read, ticket.report_read
  INSERT INTO role_permissions (role_id, permission_id)
  SELECT v_manager_role, p.id FROM permissions p
  WHERE p.code IN (
    'task.create', 'task.assign', 'task.read_team', 'task.review', 'task.reassign',
    'task.change_deadline', 'task.cancel', 'task.comment', 'task.attachment_upload',
    'task.attachment_read', 'task.report_read',
    'ticket.read_team', 'ticket.assign', 'ticket.update', 'ticket.resolve',
    'ticket.close', 'ticket.reopen', 'ticket.escalate', 'ticket.comment',
    'ticket.attachment_upload', 'ticket.attachment_read', 'ticket.report_read'
  )
  ON CONFLICT DO NOTHING;

  -- Team Leader: task.create, task.assign, task.read_team, task.review, task.comment,
  --             task.attachment_upload, task.attachment_read
  --             ticket.read_team, ticket.assign, ticket.comment,
  --             ticket.attachment_upload, ticket.attachment_read
  INSERT INTO role_permissions (role_id, permission_id)
  SELECT v_team_leader_role, p.id FROM permissions p
  WHERE p.code IN (
    'task.create', 'task.assign', 'task.read_team', 'task.review', 'task.comment',
    'task.attachment_upload', 'task.attachment_read',
    'ticket.read_team', 'ticket.assign', 'ticket.comment',
    'ticket.attachment_upload', 'ticket.attachment_read'
  )
  ON CONFLICT DO NOTHING;

  -- Employee: task.read_self, task.accept_self, task.request_change_self,
  --           task.progress_update_self, task.submit_self, task.comment,
  --           task.attachment_upload, task.attachment_read
  --           ticket.create_self, ticket.read_self, ticket.comment,
  --           ticket.attachment_upload, ticket.attachment_read
  INSERT INTO role_permissions (role_id, permission_id)
  SELECT v_employee_role, p.id FROM permissions p
  WHERE p.code IN (
    'task.read_self', 'task.accept_self', 'task.request_change_self',
    'task.progress_update_self', 'task.submit_self', 'task.comment',
    'task.attachment_upload', 'task.attachment_read',
    'ticket.create_self', 'ticket.read_self', 'ticket.comment',
    'ticket.attachment_upload', 'ticket.attachment_read'
  )
  ON CONFLICT DO NOTHING;

  -- Intern: same as employee
  INSERT INTO role_permissions (role_id, permission_id)
  SELECT v_intern_role, p.id FROM permissions p
  WHERE p.code IN (
    'task.read_self', 'task.accept_self', 'task.request_change_self',
    'task.progress_update_self', 'task.submit_self', 'task.comment',
    'task.attachment_upload', 'task.attachment_read',
    'ticket.create_self', 'ticket.read_self', 'ticket.comment',
    'ticket.attachment_upload', 'ticket.attachment_read'
  )
  ON CONFLICT DO NOTHING;

  -- System Admin: no task/ticket permissions (no private content access by default)
END $$;
