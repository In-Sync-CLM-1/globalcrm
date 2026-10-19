// Receives the LiveKit agent's terminal POST when an AI call ends:
// {call_id, status, room_name, duration_seconds, transcript, recording_url}. call_id is call_logs.id.
// Records the call, classifies the outcome into the org's dispositions, moves the lead, and schedules
// a retry (no answer) or a callback. Bearer = AI_CALL_INTERNAL_TOKEN.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { classifyOutcome, isConnected, loadAiConfig, requireInternalToken } from "../_shared/aiCallLivekit.ts";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const TERMINAL = new Set(["completed", "error", "no-answer", "busy", "failed"]);
const STAGE_FOR: Record<string, string> = {
  interested_register_today: "Interested", interested_register_week: "Interested", link_requested: "Interested", callback: "Interested",
  not_interested_elsewhere: "Lost", not_interested_no_games: "Lost", not_interested_trust: "Lost", not_interested_no_time: "Lost", not_interested_other: "Lost",
  wrong_number: "Lost", do_not_call: "Lost", unclear: "Contacted", language_barrier: "Contacted",
};

Deno.serve(async (req) => {
  const denied = requireInternalToken(req);
  if (denied) return denied;
  try {
    const { call_id, status, room_name, duration_seconds, transcript, recording_url } = await req.json().catch(() => ({}));
    if (!call_id || !status) return json({ error: "call_id and status are required" }, 400);

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: log } = await supabase.from("call_logs").select("id, org_id, contact_id, status").eq("id", call_id).eq("caller_type", "ai").maybeSingle();
    if (!log) return json({ error: "Unknown call_id" }, 404);
    if (TERMINAL.has(log.status as string)) return json({ success: true, skipped: "already-terminal" });

    const orgId = log.org_id as string;
    const text = typeof transcript === "string" ? transcript : "";
    const connected = status === "completed" && isConnected(text);
    const seconds = Math.round(Number(duration_seconds) || 0);
    const update: Record<string, unknown> = { status, ended_at: new Date().toISOString(), conversation_duration: connected ? seconds : 0, call_duration: seconds };
    if (text) { update.transcript = text; update.transcript_status = "completed"; }
    if (recording_url) update.recording_url = recording_url;
    if (room_name) update.room_name = room_name;
    if (connected) update.answered_at = new Date().toISOString();

    const lookupDispo = async (name: string, sub?: string) => {
      const { data: d } = await supabase.from("call_dispositions").select("id").eq("org_id", orgId).eq("name", name).maybeSingle();
      if (!d) return { d: null as string | null, s: null as string | null };
      if (!sub) return { d: d.id as string, s: null as string | null };
      const { data: s } = await supabase.from("call_sub_dispositions").select("id").eq("disposition_id", d.id).eq("name", sub).maybeSingle();
      return { d: d.id as string, s: (s?.id as string) ?? null };
    };

    let outcome = "no_answer";
    let optOut = false;
    if (connected) {
      const r = await classifyOutcome(text);
      outcome = r.outcome;
      update.analysis_summary = r.summary;
      update.analysis_status = "completed";
      const { data: map } = await supabase.from("ai_outcome_disposition_map").select("disposition_id, sub_disposition_id, sets_opt_out").eq("org_id", orgId).eq("outcome_key", outcome).maybeSingle();
      if (map) {
        update.disposition_id = map.disposition_id;
        update.sub_disposition_id = map.sub_disposition_id;
        optOut = !!map.sets_opt_out;
      }
    } else {
      const nc = await lookupDispo("Not Connected", status === "busy" ? "Busy" : "No Answer");
      update.disposition_id = nc.d;
      update.sub_disposition_id = nc.s;
    }
    await supabase.from("call_logs").update(update).eq("id", call_id);

    const contactId = log.contact_id as string | null;
    if (contactId) {
      const stageName = connected ? STAGE_FOR[outcome] ?? "Contacted" : "Contacted";
      const { data: stage } = await supabase.from("pipeline_stages").select("id").eq("org_id", orgId).eq("name", stageName).maybeSingle();
      const { data: contact } = await supabase.from("contacts").select("assigned_to, first_name, last_name").eq("id", contactId).maybeSingle();
      const patch: Record<string, unknown> = {};
      if (stage) patch.pipeline_stage_id = stage.id;
      if (optOut) {
        Object.assign(patch, {
          do_not_call: true, do_not_whatsapp: true, do_not_email: true, opted_out: true,
          opt_out_reason: "Asked not to be called again on an AI call", opt_out_at: new Date().toISOString(),
        });
      }
      if (Object.keys(patch).length) await supabase.from("contacts").update(patch).eq("id", contactId);
      if (connected && outcome === "callback") {
        const when = new Date(Date.now() + 24 * 3600e3);
        when.setUTCHours(5, 30, 0, 0); // 11:00 IST tomorrow
        await supabase.from("contact_activities").insert({
          org_id: orgId, contact_id: contactId, created_by: contact?.assigned_to ?? null, activity_type: "call",
          subject: `Callback — ${contact?.first_name ?? ""} ${contact?.last_name ?? ""}`.trim(),
          description: "Asked for a call back on the AI call.", scheduled_at: when.toISOString(), priority: "normal",
        });
      }
    }

    // Queue bookkeeping: retry when nobody answered, otherwise done.
    const cfg = await loadAiConfig(supabase, orgId);
    const { data: item } = await supabase.from("ai_call_queue").select("id, attempts").eq("call_log_id", call_id).maybeSingle();
    if (item) {
      const retry = !connected && (item.attempts as number) < cfg.max_attempts;
      const next = retry
        ? { status: "pending", call_log_id: null, next_attempt_at: new Date(Date.now() + cfg.retry_gap_hours * 3600e3).toISOString(), updated_at: new Date().toISOString() }
        : { status: connected ? "done" : "failed", last_error: connected ? null : "No answer after the allowed attempts", updated_at: new Date().toISOString() };
      await supabase.from("ai_call_queue").update(next).eq("id", item.id);
    }
    return json({ success: true, outcome });
  } catch (e) {
    console.error("ai-call-webhook error:", e);
    return json({ success: false, error: e instanceof Error ? e.message : "Internal error" });
  }
});
