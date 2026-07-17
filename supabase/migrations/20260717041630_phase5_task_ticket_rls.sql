/*
# Phase 5 — RLS Policies for Task and Ticket Tables

## Summary
Enables RLS on all 15 Phase 5 tables and creates scoped policies.

## RLS Strategy

### Task tables
- tasks: SELECT (self as owner/assignee/collaborator OR team read OR org read_all);
  INSERT (task.create + same org); UPDATE (task.assign/review/reassign/change_deadline/cancel + same org);
  DELETE (none — tasks are never deleted)
- task_assignments: SELECT (same scope as tasks); INSERT (task.assign); UPDATE (task.reassign/accept_self); DELETE (none)
- task_status_history: SELECT (same scope); INSERT (authenticated with task access); NO UPDATE/DELETE (append-only)
- task_deadline_history: SELECT (same scope); INSERT (task.change_deadline); NO UPDATE/DELETE (append-only)
- task_action_requests: SELECT (own requests OR team read OR read_all); INSERT (task.request_change_self); UPDATE (task.review for reviewer)
- task_progress_updates: SELECT (same scope); INSERT (task.progress_update_self); UPDATE (none); DELETE (none)
- task_submissions: SELECT (same scope); INSERT (task.submit_self); UPDATE (task.review for reviewer)
- task_comments: SELECT (same scope); INSERT (task.comment); UPDATE (own comment edit only); DELETE (none — soft delete via UPDATE)
- task_attachments: SELECT (same scope + task.attachment_read); INSERT (task.attachment_upload); UPDATE/DELETE (none)
- task_dependencies: SELECT (same scope); INSERT (task.create/task.assign); DELETE (task.create/task.assign)

### Ticket tables
- tickets: SELECT (own OR team read OR read_all); INSERT (ticket.create_self); UPDATE (ticket.assign/update/resolve/close/reopen/escalate); DELETE (none)
- ticket_history: SELECT (same scope); INSERT (authenticated with ticket access); NO UPDATE/DELETE (append-only)
- ticket_comments: SELECT (same scope); INSERT (ticket.comment); UPDATE (own edit)
- ticket_attachments: SELECT (same scope + ticket.attachment_read); INSERT (ticket.attachment_upload); UPDATE/DELETE (none)
- ticket_escalations: SELECT (same scope); INSERT (ticket.escalate); UPDATE/DELETE (none)

## Helper functions used
- current_user_org_id()
- current_user_has_permission(perm_code)
- current_user_employee_id()
- is_in_reporting_subtree(manager_id, employee_id)
*/

-- ============================================================
-- Enable RLS on all 15 tables
-- ============================================================
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_deadline_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_action_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_progress_updates ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_dependencies ENABLE ROW LEVEL SECURITY;
ALTER TABLE tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE ticket_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE ticket_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE ticket_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE ticket_escalations ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- Helper: can_read_task(p_task_id)
-- SECURITY DEFINER — checks if current user can read a given task
-- ============================================================
CREATE OR REPLACE FUNCTION can_read_task(p_task_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, auth AS $$
DECLARE
  v_org uuid;
  v_uid uuid := auth.uid();
  v_has_read_all boolean;
  v_has_read_team boolean;
  v_is_owner boolean;
  v_is_assignee boolean;
BEGIN
  IF v_uid IS NULL THEN RETURN false; END IF;

  SELECT organization_id INTO v_org FROM tasks WHERE id = p_task_id;
  IF v_org IS NULL THEN RETURN false; END IF;

  IF v_org <> current_user_org_id() THEN RETURN false; END IF;

  v_has_read_all := current_user_has_permission('task.read_all');
  IF v_has_read_all THEN RETURN true; END IF;

  SELECT EXISTS(SELECT 1 FROM tasks WHERE id = p_task_id AND (owner_id = v_uid OR created_by = v_uid))
    INTO v_is_owner;
  IF v_is_owner THEN RETURN true; END IF;

  SELECT EXISTS(
    SELECT 1 FROM task_assignments
    WHERE task_id = p_task_id AND assigned_to = v_uid AND is_current = true
  ) INTO v_is_assignee;
  IF v_is_assignee THEN RETURN true; END IF;

  v_has_read_team := current_user_has_permission('task.read_team');
  IF v_has_read_team THEN
    PERFORM 1
    FROM task_assignments ta
    JOIN employees e ON e.user_id = ta.assigned_to
    WHERE ta.task_id = p_task_id AND ta.is_current = true
    AND is_in_reporting_subtree(current_user_employee_id(), e.id);
    IF FOUND THEN RETURN true; END IF;
  END IF;

  RETURN false;
END;
$$;

-- ============================================================
-- Helper: can_read_ticket(p_ticket_id)
-- SECURITY DEFINER — checks if current user can read a given ticket
-- ============================================================
CREATE OR REPLACE FUNCTION can_read_ticket(p_ticket_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, auth AS $$
DECLARE
  v_org uuid;
  v_uid uuid := auth.uid();
  v_has_read_all boolean;
  v_has_read_team boolean;
  v_is_raiser boolean;
  v_is_assigned boolean;
BEGIN
  IF v_uid IS NULL THEN RETURN false; END IF;

  SELECT organization_id INTO v_org FROM tickets WHERE id = p_ticket_id;
  IF v_org IS NULL THEN RETURN false; END IF;

  IF v_org <> current_user_org_id() THEN RETURN false; END IF;

  v_has_read_all := current_user_has_permission('ticket.read_all');
  IF v_has_read_all THEN RETURN true; END IF;

  SELECT EXISTS(SELECT 1 FROM tickets WHERE id = p_ticket_id AND raised_by = v_uid)
    INTO v_is_raiser;
  IF v_is_raiser THEN RETURN true; END IF;

  SELECT EXISTS(SELECT 1 FROM tickets WHERE id = p_ticket_id AND assigned_to = v_uid)
    INTO v_is_assigned;
  IF v_is_assigned THEN RETURN true; END IF;

  v_has_read_team := current_user_has_permission('ticket.read_team');
  IF v_has_read_team THEN
    PERFORM 1
    FROM tickets t
    JOIN employees e ON e.user_id = t.raised_by
    WHERE t.id = p_ticket_id
    AND is_in_reporting_subtree(current_user_employee_id(), e.id);
    IF FOUND THEN RETURN true; END IF;
  END IF;

  RETURN false;
END;
$$;

GRANT EXECUTE ON FUNCTION can_read_task(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION can_read_ticket(uuid) TO authenticated;

-- ============================================================
-- tasks policies
-- ============================================================
DROP POLICY IF EXISTS "select_tasks" ON tasks;
CREATE POLICY "select_tasks" ON tasks FOR SELECT
  TO authenticated USING (can_read_task(id));

DROP POLICY IF EXISTS "insert_tasks" ON tasks;
CREATE POLICY "insert_tasks" ON tasks FOR INSERT
  TO authenticated WITH CHECK (
    organization_id = current_user_org_id()
    AND current_user_has_permission('task.create')
  );

DROP POLICY IF EXISTS "update_tasks" ON tasks;
CREATE POLICY "update_tasks" ON tasks FOR UPDATE
  TO authenticated USING (
    organization_id = current_user_org_id()
    AND (
      current_user_has_permission('task.assign')
      OR current_user_has_permission('task.review')
      OR current_user_has_permission('task.reassign')
      OR current_user_has_permission('task.change_deadline')
      OR current_user_has_permission('task.cancel')
    )
  ) WITH CHECK (
    organization_id = current_user_org_id()
  );

-- ============================================================
-- task_assignments policies
-- ============================================================
DROP POLICY IF EXISTS "select_task_assignments" ON task_assignments;
CREATE POLICY "select_task_assignments" ON task_assignments FOR SELECT
  TO authenticated USING (can_read_task(task_id));

DROP POLICY IF EXISTS "insert_task_assignments" ON task_assignments;
CREATE POLICY "insert_task_assignments" ON task_assignments FOR INSERT
  TO authenticated WITH CHECK (
    can_read_task(task_id)
    AND current_user_has_permission('task.assign')
  );

DROP POLICY IF EXISTS "update_task_assignments" ON task_assignments;
CREATE POLICY "update_task_assignments" ON task_assignments FOR UPDATE
  TO authenticated USING (
    can_read_task(task_id)
    AND (
      assigned_to = auth.uid() OR current_user_has_permission('task.reassign') OR current_user_has_permission('task.assign')
    )
  ) WITH CHECK (
    can_read_task(task_id)
  );

-- ============================================================
-- task_status_history policies (append-only: SELECT + INSERT only)
-- ============================================================
DROP POLICY IF EXISTS "select_task_status_history" ON task_status_history;
CREATE POLICY "select_task_status_history" ON task_status_history FOR SELECT
  TO authenticated USING (can_read_task(task_id));

DROP POLICY IF EXISTS "insert_task_status_history" ON task_status_history;
CREATE POLICY "insert_task_status_history" ON task_status_history FOR INSERT
  TO authenticated WITH CHECK (can_read_task(task_id));

-- ============================================================
-- task_deadline_history policies (append-only: SELECT + INSERT only)
-- ============================================================
DROP POLICY IF EXISTS "select_task_deadline_history" ON task_deadline_history;
CREATE POLICY "select_task_deadline_history" ON task_deadline_history FOR SELECT
  TO authenticated USING (can_read_task(task_id));

DROP POLICY IF EXISTS "insert_task_deadline_history" ON task_deadline_history;
CREATE POLICY "insert_task_deadline_history" ON task_deadline_history FOR INSERT
  TO authenticated WITH CHECK (
    can_read_task(task_id)
    AND current_user_has_permission('task.change_deadline')
  );

-- ============================================================
-- task_action_requests policies
-- ============================================================
DROP POLICY IF EXISTS "select_task_action_requests" ON task_action_requests;
CREATE POLICY "select_task_action_requests" ON task_action_requests FOR SELECT
  TO authenticated USING (
    employee_id = auth.uid()
    OR (
      current_user_has_permission('task.read_team')
      AND EXISTS (
        SELECT 1 FROM employees e
        WHERE e.user_id = task_action_requests.employee_id
        AND is_in_reporting_subtree(current_user_employee_id(), e.id)
      )
    )
    OR current_user_has_permission('task.read_all')
  );

DROP POLICY IF EXISTS "insert_task_action_requests" ON task_action_requests;
CREATE POLICY "insert_task_action_requests" ON task_action_requests FOR INSERT
  TO authenticated WITH CHECK (
    employee_id = auth.uid()
    AND current_user_has_permission('task.request_change_self')
  );

DROP POLICY IF EXISTS "update_task_action_requests" ON task_action_requests;
CREATE POLICY "update_task_action_requests" ON task_action_requests FOR UPDATE
  TO authenticated USING (
    current_user_has_permission('task.review')
    OR employee_id = auth.uid()
  ) WITH CHECK (
    current_user_has_permission('task.review')
    OR employee_id = auth.uid()
  );

-- ============================================================
-- task_progress_updates policies
-- ============================================================
DROP POLICY IF EXISTS "select_task_progress_updates" ON task_progress_updates;
CREATE POLICY "select_task_progress_updates" ON task_progress_updates FOR SELECT
  TO authenticated USING (can_read_task(task_id));

DROP POLICY IF EXISTS "insert_task_progress_updates" ON task_progress_updates;
CREATE POLICY "insert_task_progress_updates" ON task_progress_updates FOR INSERT
  TO authenticated WITH CHECK (
    employee_id = auth.uid()
    AND current_user_has_permission('task.progress_update_self')
  );

-- ============================================================
-- task_submissions policies
-- ============================================================
DROP POLICY IF EXISTS "select_task_submissions" ON task_submissions;
CREATE POLICY "select_task_submissions" ON task_submissions FOR SELECT
  TO authenticated USING (can_read_task(task_id));

DROP POLICY IF EXISTS "insert_task_submissions" ON task_submissions;
CREATE POLICY "insert_task_submissions" ON task_submissions FOR INSERT
  TO authenticated WITH CHECK (
    submitted_by = auth.uid()
    AND current_user_has_permission('task.submit_self')
  );

DROP POLICY IF EXISTS "update_task_submissions" ON task_submissions;
CREATE POLICY "update_task_submissions" ON task_submissions FOR UPDATE
  TO authenticated USING (
    can_read_task(task_id)
    AND current_user_has_permission('task.review')
  ) WITH CHECK (
    can_read_task(task_id)
    AND current_user_has_permission('task.review')
  );

-- ============================================================
-- task_comments policies
-- ============================================================
DROP POLICY IF EXISTS "select_task_comments" ON task_comments;
CREATE POLICY "select_task_comments" ON task_comments FOR SELECT
  TO authenticated USING (can_read_task(task_id));

DROP POLICY IF EXISTS "insert_task_comments" ON task_comments;
CREATE POLICY "insert_task_comments" ON task_comments FOR INSERT
  TO authenticated WITH CHECK (
    author_id = auth.uid()
    AND current_user_has_permission('task.comment')
  );

DROP POLICY IF EXISTS "update_task_comments" ON task_comments;
CREATE POLICY "update_task_comments" ON task_comments FOR UPDATE
  TO authenticated USING (
    author_id = auth.uid()
  ) WITH CHECK (
    author_id = auth.uid()
  );

-- ============================================================
-- task_attachments policies
-- ============================================================
DROP POLICY IF EXISTS "select_task_attachments" ON task_attachments;
CREATE POLICY "select_task_attachments" ON task_attachments FOR SELECT
  TO authenticated USING (
    can_read_task(task_id)
    AND current_user_has_permission('task.attachment_read')
  );

DROP POLICY IF EXISTS "insert_task_attachments" ON task_attachments;
CREATE POLICY "insert_task_attachments" ON task_attachments FOR INSERT
  TO authenticated WITH CHECK (
    uploaded_by = auth.uid()
    AND current_user_has_permission('task.attachment_upload')
  );

-- ============================================================
-- task_dependencies policies
-- ============================================================
DROP POLICY IF EXISTS "select_task_dependencies" ON task_dependencies;
CREATE POLICY "select_task_dependencies" ON task_dependencies FOR SELECT
  TO authenticated USING (can_read_task(task_id) OR can_read_task(depends_on_task_id));

DROP POLICY IF EXISTS "insert_task_dependencies" ON task_dependencies;
CREATE POLICY "insert_task_dependencies" ON task_dependencies FOR INSERT
  TO authenticated WITH CHECK (
    can_read_task(task_id)
    AND (current_user_has_permission('task.create') OR current_user_has_permission('task.assign'))
  );

DROP POLICY IF EXISTS "delete_task_dependencies" ON task_dependencies;
CREATE POLICY "delete_task_dependencies" ON task_dependencies FOR DELETE
  TO authenticated USING (
    can_read_task(task_id)
    AND (current_user_has_permission('task.create') OR current_user_has_permission('task.assign'))
  );

-- ============================================================
-- tickets policies
-- ============================================================
DROP POLICY IF EXISTS "select_tickets" ON tickets;
CREATE POLICY "select_tickets" ON tickets FOR SELECT
  TO authenticated USING (can_read_ticket(id));

DROP POLICY IF EXISTS "insert_tickets" ON tickets;
CREATE POLICY "insert_tickets" ON tickets FOR INSERT
  TO authenticated WITH CHECK (
    organization_id = current_user_org_id()
    AND raised_by = auth.uid()
    AND current_user_has_permission('ticket.create_self')
  );

DROP POLICY IF EXISTS "update_tickets" ON tickets;
CREATE POLICY "update_tickets" ON tickets FOR UPDATE
  TO authenticated USING (
    organization_id = current_user_org_id()
    AND (
      current_user_has_permission('ticket.assign')
      OR current_user_has_permission('ticket.update')
      OR current_user_has_permission('ticket.resolve')
      OR current_user_has_permission('ticket.close')
      OR current_user_has_permission('ticket.reopen')
      OR current_user_has_permission('ticket.escalate')
    )
  ) WITH CHECK (
    organization_id = current_user_org_id()
  );

-- ============================================================
-- ticket_history policies (append-only)
-- ============================================================
DROP POLICY IF EXISTS "select_ticket_history" ON ticket_history;
CREATE POLICY "select_ticket_history" ON ticket_history FOR SELECT
  TO authenticated USING (can_read_ticket(ticket_id));

DROP POLICY IF EXISTS "insert_ticket_history" ON ticket_history;
CREATE POLICY "insert_ticket_history" ON ticket_history FOR INSERT
  TO authenticated WITH CHECK (can_read_ticket(ticket_id));

-- ============================================================
-- ticket_comments policies
-- ============================================================
DROP POLICY IF EXISTS "select_ticket_comments" ON ticket_comments;
CREATE POLICY "select_ticket_comments" ON ticket_comments FOR SELECT
  TO authenticated USING (can_read_ticket(ticket_id));

DROP POLICY IF EXISTS "insert_ticket_comments" ON ticket_comments;
CREATE POLICY "insert_ticket_comments" ON ticket_comments FOR INSERT
  TO authenticated WITH CHECK (
    author_id = auth.uid()
    AND current_user_has_permission('ticket.comment')
  );

DROP POLICY IF EXISTS "update_ticket_comments" ON ticket_comments;
CREATE POLICY "update_ticket_comments" ON ticket_comments FOR UPDATE
  TO authenticated USING (author_id = auth.uid())
  WITH CHECK (author_id = auth.uid());

-- ============================================================
-- ticket_attachments policies
-- ============================================================
DROP POLICY IF EXISTS "select_ticket_attachments" ON ticket_attachments;
CREATE POLICY "select_ticket_attachments" ON ticket_attachments FOR SELECT
  TO authenticated USING (
    can_read_ticket(ticket_id)
    AND current_user_has_permission('ticket.attachment_read')
  );

DROP POLICY IF EXISTS "insert_ticket_attachments" ON ticket_attachments;
CREATE POLICY "insert_ticket_attachments" ON ticket_attachments FOR INSERT
  TO authenticated WITH CHECK (
    uploaded_by = auth.uid()
    AND current_user_has_permission('ticket.attachment_upload')
  );

-- ============================================================
-- ticket_escalations policies
-- ============================================================
DROP POLICY IF EXISTS "select_ticket_escalations" ON ticket_escalations;
CREATE POLICY "select_ticket_escalations" ON ticket_escalations FOR SELECT
  TO authenticated USING (can_read_ticket(ticket_id));

DROP POLICY IF EXISTS "insert_ticket_escalations" ON ticket_escalations;
CREATE POLICY "insert_ticket_escalations" ON ticket_escalations FOR INSERT
  TO authenticated WITH CHECK (
    can_read_ticket(ticket_id)
    AND current_user_has_permission('ticket.escalate')
  );
