import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, Apikey",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const today = new Date().toISOString().slice(0, 10);
    const now = new Date();

    // Fetch active tasks (not COMPLETED, CANCELLED, REJECTED)
    const { data: tasks, error } = await supabase
      .from("tasks")
      .select("id, task_code, title, current_deadline, owner_id, status")
      .not("status", "in", '("COMPLETED","CANCELLED","REJECTED","DRAFT")')
      .order("current_deadline", { ascending: true });

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let remindersCreated = 0;

    for (const task of tasks || []) {
      const deadline = new Date(task.current_deadline);
      const daysDiff = Math.ceil((deadline.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

      let reminderType: string | null = null;
      let priority = "normal";

      if (daysDiff === 3) {
        reminderType = "deadline_3_days";
      } else if (daysDiff === 1) {
        reminderType = "deadline_1_day";
      } else if (daysDiff === 0) {
        reminderType = "deadline_today";
        priority = "high";
      } else if (daysDiff < 0) {
        reminderType = "overdue";
        priority = "high";
      }

      if (!reminderType) continue;

      // Idempotent notification with dedup_key
      const dedupKey = `task_reminder:${task.id}:${reminderType}:${today}`;

      // Check if already sent
      const { data: existing } = await supabase
        .from("notifications")
        .select("id")
        .eq("dedup_key", dedupKey)
        .maybeSingle();

      if (existing) continue;

      // Create notification
      const message =
        reminderType === "overdue"
          ? `Task ${task.task_code}: ${task.title} is overdue (deadline was ${task.current_deadline})`
          : reminderType === "deadline_today"
          ? `Task ${task.task_code}: ${task.title} is due today`
          : `Task ${task.task_code}: ${task.title} is due in ${daysDiff} day(s) (${task.current_deadline})`;

      await supabase.from("notifications").insert({
        recipient_id: task.owner_id,
        notification_type: `task_reminder_${reminderType}`,
        title: "Task Deadline Reminder",
        message,
        priority,
        dedup_key: dedupKey,
      });

      remindersCreated++;
    }

    return new Response(
      JSON.stringify({ message: "Task reminders processed", reminders_created: remindersCreated, tasks_checked: tasks?.length || 0 }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
