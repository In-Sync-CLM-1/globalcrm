import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.58.0";
import {
  INSYNC_DEMO_ORG_ID,
  isInsideWorkingWindow,
  triggerBolnaCall,
  createBolnaAgent,
  normalizePhone,
  ScriptRow,
  DAILY_CONNECTED_TARGET,
  CONNECTED_THRESHOLD_SEC,
  QUEUE_DEPTH,
} from "../_shared/aiCalling.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const bolnaKey = Deno.env.get("BOLNA_API_KEY");
  if (!bolnaKey) {
    return done(500, { ok: false, error: "BOLNA_API_KEY missing" });
  }

  // Optional one-off test call — bypasses window + untouched-contact filter
  let testCall: { phone?: string; first_name?: string; last_name?: string; company?: string } | null = null;
  if (req.method === "POST") {
    try {
      const body = await req.json();
      if (body?.action === "test_call" && body?.phone) {
        testCall = {
          phone: body.phone,
          first_name: body.first_name || "there",
          last_name: body.last_name || "",
          company: body.company || "your company",
        };
      }
    } catch (_e) { /* no body */ }
  }

  // 0. Stale-call sweep: any AI call sitting in_progress >10 min is treated as a lost-webhook ghost
  //    and force-closed. Runs every invocation (window-independent) so an overnight stuck row
  //    clears itself before next morning's window opens. Chain unjams within one cron tick.
  const staleCutoff = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const { data: staleRows } = await supabase
    .from("call_logs")
    .update({
      status: "failed",
      ended_at: new Date().toISOString(),
      notes: "Auto-closed: in_progress >10min without webhook close (lost-webhook safety sweep).",
    })
    .eq("org_id", INSYNC_DEMO_ORG_ID)
    .eq("caller_type", "ai")
    .eq("status", "in_progress")
    .lt("started_at", staleCutoff)
    .select("id");
  const staleClosed = (staleRows || []).length;

  // 1. Working window check (function-side time gate so the cron can fire every 5 min unconditionally)
  const workWindow = isInsideWorkingWindow();
  if (!testCall) {
    if (!workWindow.inside) {
      return done(200, { ok: true, acted: false, reason: workWindow.reason, stale_closed: staleClosed });
    }
  }

  // 2. Pull active script
  const { data: script } = await supabase
    .from("ai_call_scripts")
    .select("*")
    .eq("org_id", INSYNC_DEMO_ORG_ID)
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!script) {
    return done(200, { ok: true, acted: false, reason: "no active script" });
  }

  // 3. Provision Bolna agent if not yet cached
  let agentId = (script as ScriptRow).bolna_agent_id;
  if (!agentId) {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const webhookUrl = `${supabaseUrl}/functions/v1/ai-bolna-webhook`;
    try {
      agentId = await createBolnaAgent(bolnaKey, { script: script as ScriptRow, webhookUrl });
      await supabase
        .from("ai_call_scripts")
        .update({ bolna_agent_id: agentId, updated_at: new Date().toISOString() })
        .eq("id", (script as ScriptRow).id);
    } catch (e: any) {
      return done(500, { ok: false, error: `Bolna agent provision failed: ${e?.message || String(e)}` });
    }
  }

  // 3b. One-off test call branch — skip queue logic, dial once
  if (testCall) {
    const toNumber = normalizePhone(testCall.phone!) || testCall.phone!;
    const { data: inserted, error: insertErr } = await supabase
      .from("call_logs")
      .insert({
        org_id: INSYNC_DEMO_ORG_ID,
        caller_type: "ai",
        ai_script_id: (script as ScriptRow).id,
        status: "queued",
        call_type: "outbound",
        direction: "outbound",
        from_number: "+911169323462",
        to_number: toNumber,
        created_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (insertErr || !inserted) {
      return done(500, { ok: false, error: `Failed to insert test call_logs row: ${insertErr?.message || "unknown"}` });
    }

    const result = await triggerBolnaCall(bolnaKey, {
      agentId,
      toNumber,
      callLogId: inserted.id,
      contact: {
        id: inserted.id,
        first_name: testCall.first_name,
        last_name: testCall.last_name,
        company: testCall.company,
      },
    });

    if (result.error) {
      await supabase.from("call_logs").update({ status: "error" }).eq("id", inserted.id);
      return done(500, { ok: false, test_call: true, error: result.error });
    }

    await supabase
      .from("call_logs")
      .update({
        status: "in_progress",
        bolna_execution_id: result.execution_id,
        started_at: new Date().toISOString(),
      })
      .eq("id", inserted.id);

    return done(200, {
      ok: true,
      test_call: true,
      call_log_id: inserted.id,
      bolna_execution_id: result.execution_id,
      to_number: toNumber,
      agent_id: agentId,
      voice: (script as ScriptRow).voice_name,
    });
  }

  // 4. Daily target check — stop if we've hit it
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);
  const { count: connectedTodayCount } = await supabase
    .from("call_logs")
    .select("id", { count: "exact", head: true })
    .eq("org_id", INSYNC_DEMO_ORG_ID)
    .eq("caller_type", "ai")
    .gte("created_at", todayStart.toISOString())
    .gte("conversation_duration", CONNECTED_THRESHOLD_SEC);
  const connectedToday = connectedTodayCount || 0;

  if (connectedToday >= DAILY_CONNECTED_TARGET) {
    return done(200, {
      ok: true,
      acted: false,
      reason: `daily target met (${connectedToday}/${DAILY_CONNECTED_TARGET})`,
      connected_today: connectedToday,
    });
  }

  // 5. Is there already an in-flight AI call? Then the webhook chain is alive — top up queue, do not dispatch.
  const { count: inFlightCount } = await supabase
    .from("call_logs")
    .select("id", { count: "exact", head: true })
    .eq("org_id", INSYNC_DEMO_ORG_ID)
    .eq("caller_type", "ai")
    .eq("status", "in_progress");

  const { count: queuedCount } = await supabase
    .from("call_logs")
    .select("id", { count: "exact", head: true })
    .eq("org_id", INSYNC_DEMO_ORG_ID)
    .eq("caller_type", "ai")
    .eq("status", "queued");

  const inFlight = inFlightCount || 0;
  const queued = queuedCount || 0;
  const needToQueue = Math.max(0, QUEUE_DEPTH - queued);

  // 6. Refill the queue if depth is low — pick fresh, untouched contacts
  let queuedNow = 0;
  if (needToQueue > 0) {
    const queuedRows = await queueUntouchedContacts(supabase, {
      script: script as ScriptRow,
      agentId,
      limit: needToQueue,
    });
    queuedNow = queuedRows.length;
  }

  // 7. If no in-flight call AND we have queued calls, kick off the next one to start the chain
  let dispatched = false;
  if (inFlight === 0) {
    const { data: nextRow } = await supabase
      .from("call_logs")
      .select("id, contact_id, to_number")
      .eq("org_id", INSYNC_DEMO_ORG_ID)
      .eq("caller_type", "ai")
      .eq("status", "queued")
      .order("bolna_queue_position", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (nextRow) {
      const { data: contact } = await supabase
        .from("contacts")
        .select("id, first_name, last_name, company, job_title")
        .eq("id", nextRow.contact_id)
        .maybeSingle();

      if (contact) {
        const result = await triggerBolnaCall(bolnaKey, {
          agentId,
          toNumber: nextRow.to_number,
          callLogId: nextRow.id,
          contact,
        });

        if (result.error) {
          await supabase.from("call_logs").update({ status: "error" }).eq("id", nextRow.id);
        } else {
          await supabase
            .from("call_logs")
            .update({
              status: "in_progress",
              bolna_execution_id: result.execution_id,
              started_at: new Date().toISOString(),
            })
            .eq("id", nextRow.id);
          dispatched = true;
        }
      }
    }
  }

  return done(200, {
    ok: true,
    acted: true,
    window: workWindow.window,
    connected_today: connectedToday,
    target: DAILY_CONNECTED_TARGET,
    in_flight: inFlight,
    queued_before: queued,
    queued_now: queuedNow,
    dispatched_new_chain: dispatched,
    stale_closed: staleClosed,
  });
});

async function queueUntouchedContacts(
  supabase: any,
  args: { script: ScriptRow; agentId: string; limit: number },
): Promise<Array<{ id: string }>> {
  const { script, agentId, limit } = args;

  // Find Won/Lost stage IDs so we can exclude them
  const { data: stages } = await supabase
    .from("pipeline_stages")
    .select("id, name")
    .eq("org_id", INSYNC_DEMO_ORG_ID);

  const terminalStageIds = (stages || [])
    .filter((s: any) => ["won", "lost"].includes((s.name || "").toLowerCase()))
    .map((s: any) => s.id);

  // Find contacts in this org that have a phone and have NEVER had a call_log
  // We rely on the absence of any call_logs row keyed by contact_id.
  let q = supabase
    .from("contacts")
    .select("id, first_name, last_name, phone, company, job_title")
    .eq("org_id", INSYNC_DEMO_ORG_ID)
    .not("phone", "is", null)
    .neq("phone", "")
    .order("created_at", { ascending: false })
    .limit(Math.max(limit * 50, 600)); // over-fetch generously — recent contacts may be mostly already-called

  if (terminalStageIds.length > 0) {
    q = q.not("pipeline_stage_id", "in", `(${terminalStageIds.join(",")})`);
  }

  const { data: candidateContacts } = await q;
  if (!candidateContacts || candidateContacts.length === 0) return [];

  // Filter out contacts that already have any call_log row (human or AI)
  const candidateIds = candidateContacts.map((c: any) => c.id);
  const { data: existingCallContacts } = await supabase
    .from("call_logs")
    .select("contact_id")
    .in("contact_id", candidateIds);

  const touchedSet = new Set((existingCallContacts || []).map((r: any) => r.contact_id));
  const untouched = candidateContacts.filter((c: any) => !touchedSet.has(c.id)).slice(0, limit);

  if (untouched.length === 0) return [];

  // Get current queue tail position
  const { data: maxRow } = await supabase
    .from("call_logs")
    .select("bolna_queue_position")
    .eq("org_id", INSYNC_DEMO_ORG_ID)
    .eq("caller_type", "ai")
    .order("bolna_queue_position", { ascending: false })
    .limit(1)
    .maybeSingle();
  const startPos = ((maxRow?.bolna_queue_position as number) || 0) + 1;

  // Reuse a single batch_id for this dispatch cycle
  const batchId = crypto.randomUUID();

  const rows = untouched.map((c: any, idx: number) => ({
    org_id: INSYNC_DEMO_ORG_ID,
    contact_id: c.id,
    caller_type: "ai",
    ai_script_id: script.id,
    status: "queued",
    call_type: "outbound",
    direction: "outbound",
    from_number: "+911169323462",
    to_number: normalizePhone(c.phone),
    bolna_batch_id: batchId,
    bolna_queue_position: startPos + idx,
    created_at: new Date().toISOString(),
  }));

  const { data: inserted } = await supabase
    .from("call_logs")
    .insert(rows)
    .select("id");

  return (inserted || []) as Array<{ id: string }>;
}

function done(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
