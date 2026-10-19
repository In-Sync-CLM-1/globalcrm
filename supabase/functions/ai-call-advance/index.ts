// Cron-driven advancer (every minute, via a Cloudflare Worker). For each org with AI calling switched
// on: reconcile stuck calls, then place as many queued calls as the concurrency limit allows.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { insideCallingWindow, loadAiConfig, placeAiCall, requireInternalToken } from "../_shared/aiCallLivekit.ts";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  const denied = requireInternalToken(req);
  if (denied) return denied;
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: orgs } = await supabase.from("organizations").select("id").eq("settings->ai_calling->>enabled", "true");
  const summary: Record<string, unknown>[] = [];

  for (const org of orgs ?? []) {
    const orgId = org.id as string;
    const cfg = await loadAiConfig(supabase, orgId);
    const nowIso = () => new Date().toISOString();

    // A call stuck non-terminal for 15 minutes is dead: free its queue slot.
    const stale = new Date(Date.now() - 15 * 60000).toISOString();
    await supabase.from("call_logs").update({ status: "error" }).eq("org_id", orgId).eq("caller_type", "ai").in("status", ["initiated", "in-progress"]).lt("created_at", stale);
    const { data: calling } = await supabase.from("ai_call_queue").select("id, call_log_id, attempts").eq("org_id", orgId).eq("status", "calling");
    for (const it of calling ?? []) {
      const { data: cl } = it.call_log_id ? await supabase.from("call_logs").select("status").eq("id", it.call_log_id).maybeSingle() : { data: null };
      if (!cl || cl.status === "error") {
        await supabase.from("ai_call_queue").update({
          status: (it.attempts as number) < cfg.max_attempts ? "pending" : "failed", call_log_id: null, last_error: "Call did not complete",
          next_attempt_at: new Date(Date.now() + cfg.retry_gap_hours * 3600e3).toISOString(), updated_at: nowIso(),
        }).eq("id", it.id);
      }
    }

    const win = insideCallingWindow(cfg);
    if (!win.inside) { summary.push({ orgId, skipped: win.reason }); continue; }
    const { count: active } = await supabase.from("call_logs").select("id", { count: "exact", head: true }).eq("org_id", orgId).eq("caller_type", "ai").in("status", ["initiated", "in-progress"]);
    const slots = Math.max(0, cfg.max_concurrent - (active ?? 0));
    if (slots === 0) { summary.push({ orgId, skipped: "all call slots busy" }); continue; }

    const { data: due } = await supabase.from("ai_call_queue").select("id, contact_id, script_id, attempts").eq("org_id", orgId).eq("status", "pending").lte("next_attempt_at", nowIso()).order("created_at", { ascending: true }).limit(slots);
    let placed = 0;
    for (const item of due ?? []) {
      const r = await placeAiCall(supabase, { orgId, contactId: item.contact_id as string, scriptId: item.script_id as string, initiatedBy: null });
      if (r.success) {
        placed++;
        await supabase.from("ai_call_queue").update({ status: "calling", call_log_id: r.call_log_id, attempts: (item.attempts as number) + 1, last_error: null, updated_at: nowIso() }).eq("id", item.id);
      } else if (r.skip) {
        await supabase.from("ai_call_queue").update({ status: "skipped", last_error: r.error, updated_at: nowIso() }).eq("id", item.id);
      } else {
        await supabase.from("ai_call_queue").update({ last_error: r.error, updated_at: nowIso() }).eq("id", item.id);
        break; // a config or provider problem would repeat for every item
      }
    }
    summary.push({ orgId, placed });
  }
  return json({ ok: true, summary });
});
