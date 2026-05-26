import { createClient } from "https://esm.sh/@supabase/supabase-js@2.58.0";
import { classifyCall, applyDisposition } from "../_shared/dispositionClassifier.ts";

// One-off (re-runnable) backfill: set dispositions on In-Sync Demo AI calls from the
// last 14 days that have none. SILENT — fireAutomation=false, so no meetings/messages
// are created for old calls. Processes a capped batch per invocation; call again to drain.

const INSYNC_DEMO = "61f7f96d-e80c-4d9b-a765-8eb32bd3c70d";
const BATCH = 40;

Deno.serve(async () => {
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
  const since = new Date(Date.now() - 14 * 24 * 3600 * 1000).toISOString();

  const { data: calls } = await supabase
    .from("call_logs")
    .select("id, contact_id, status, call_duration, conversation_duration, transcript, disposition_id, created_at")
    .eq("org_id", INSYNC_DEMO)
    .eq("caller_type", "ai")
    .is("disposition_id", null)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(BATCH);

  const { data: keyRows } = await supabase.from("ai_outcome_disposition_map").select("outcome_key").eq("org_id", INSYNC_DEMO);
  const keys = (keyRows || []).map((r: any) => r.outcome_key);

  let processed = 0, classified = 0, statusOnly = 0, optedOut = 0;
  const byOutcome: Record<string, number> = {};

  for (const c of calls || []) {
    if (c.disposition_id) continue;
    const dur = Number(c.conversation_duration ?? c.call_duration ?? 0);
    const transcript = c.transcript || "";
    const connected = dur > 0 && /(?:^|\n)\s*user\s*:/i.test(transcript);

    let outcomeKey: string, demoDate: string | null = null, demoTime: string | null = null, optOut = false, summary: string | null = null;

    if (!connected) {
      outcomeKey = (c.status === "no-answer" || c.status === "busy") ? "no_answer" : "not_connected";
      statusOnly++;
    } else {
      let productLabel = "WorkSync";
      if (c.contact_id) {
        const { data: cc } = await supabase.from("contacts").select("product").eq("id", c.contact_id).maybeSingle();
        if (String(cc?.product || "").toLowerCase() === "vendorverification") productLabel = "Vendor Verification";
      }
      const cls = anthropicKey ? await classifyCall(anthropicKey, { transcript, productLabel, outcomeKeys: keys }) : null;
      if (cls) {
        outcomeKey = cls.outcome_key; demoDate = cls.demo_date; demoTime = cls.demo_time; optOut = cls.opt_out; summary = cls.summary;
        classified++;
      } else {
        outcomeKey = "interested"; statusOnly++;
      }
    }

    await applyDisposition(supabase, {
      orgId: INSYNC_DEMO, callLogId: c.id, contactId: c.contact_id, outcomeKey,
      demoDate, demoTime, optOut, summary, callDuration: dur, fireAutomation: false,
    });
    if (optOut) optedOut++;
    byOutcome[outcomeKey] = (byOutcome[outcomeKey] || 0) + 1;
    processed++;
  }

  return new Response(JSON.stringify({
    ok: true, candidates_this_run: (calls || []).length, processed, classified, statusOnly, optedOut, byOutcome,
    note: (calls || []).length === BATCH ? "More may remain — invoke again to continue." : "Drained for this window.",
  }, null, 2), { headers: { "Content-Type": "application/json" } });
});
