// Native port of supabase/functions/ai-callback-dispatcher/index.ts.
import { pgSelect, pgSelectOne, pgInsertReturning, pgPatch } from "./_lib/postgrest.js";
import { isInsideWorkingWindow, triggerBolnaCall } from "./_lib/aiCalling.js";

// Riya is currently the only AI agent for outbound WorkSync calls.
const DEFAULT_AGENT_ID = "ff331674-74c0-4a75-86ee-566a966d4f09";

async function tick(env) {
  const bolnaKey = env.BOLNA_API_KEY;
  if (!bolnaKey) return { ok: false, error: "BOLNA_API_KEY not set" };

  const win = isInsideWorkingWindow(env);
  if (!win.inside) return { ok: true, dispatched: 0, skipped_reason: win.reason };

  const now = new Date();
  const lookahead = new Date(now.getTime() + 5 * 60_000);

  const dueRows = await pgSelect(env, "contact_activities",
    `next_action_type=eq.ai_callback&ai_callback_triggered_at=is.null&next_action_date=lte.${lookahead.toISOString()}` +
    `&order=next_action_date.asc&limit=50&select=id,org_id,contact_id,next_action_date,next_action_notes`);

  let dispatched = 0, skipped_dnc = 0, failed = 0;

  for (const row of dueRows || []) {
    const contact = await pgSelectOne(env, "contacts", `id=eq.${row.contact_id}&select=id,first_name,last_name,company,job_title,phone,do_not_call,org_id&limit=1`);

    if (!contact) {
      await pgPatch(env, "contact_activities", `id=eq.${row.id}`, { ai_callback_triggered_at: now.toISOString(), next_action_notes: (row.next_action_notes ?? "") + " [contact missing]" });
      continue;
    }
    if (contact.do_not_call) {
      await pgPatch(env, "contact_activities", `id=eq.${row.id}`, { ai_callback_triggered_at: now.toISOString(), next_action_notes: (row.next_action_notes ?? "") + " [skipped: do_not_call]" });
      skipped_dnc++;
      continue;
    }
    if (!contact.phone) {
      await pgPatch(env, "contact_activities", `id=eq.${row.id}`, { ai_callback_triggered_at: now.toISOString(), next_action_notes: (row.next_action_notes ?? "") + " [no phone]" });
      failed++;
      continue;
    }

    let cl;
    try {
      cl = await pgInsertReturning(env, "call_logs", {
        org_id: contact.org_id, contact_id: contact.id, call_type: "outbound", direction: "outbound",
        caller_type: "ai", from_number: null, to_number: contact.phone, status: "queued",
      });
    } catch (e) {
      failed++;
      console.error("[ai-callback-dispatcher] could not create call_logs row", String(e));
      continue;
    }

    const result = await triggerBolnaCall(bolnaKey, { agentId: DEFAULT_AGENT_ID, toNumber: contact.phone, callLogId: cl.id, contact });

    if (result.error) {
      await pgPatch(env, "call_logs", `id=eq.${cl.id}`, { status: "error" });
      await pgPatch(env, "contact_activities", `id=eq.${row.id}`, { ai_callback_triggered_at: now.toISOString(), next_action_notes: (row.next_action_notes ?? "") + ` [dispatch failed: ${result.error}]` });
      failed++;
      continue;
    }

    await pgPatch(env, "call_logs", `id=eq.${cl.id}`, { status: "in_progress", bolna_execution_id: result.execution_id, started_at: now.toISOString() });
    await pgPatch(env, "contact_activities", `id=eq.${row.id}`, { ai_callback_triggered_at: now.toISOString() });
    dispatched++;
  }

  return { ok: true, dispatched, skipped_dnc, failed, scanned: dueRows?.length ?? 0 };
}

export default {
  async scheduled(_event, env, ctx) { ctx.waitUntil(tick(env)); },
  async fetch(_req, env) {
    let out;
    try { out = await tick(env); } catch (e) { out = { ok: false, error: String(e && e.stack || e) }; }
    return new Response(JSON.stringify(out), { headers: { "Content-Type": "application/json" } });
  },
};
