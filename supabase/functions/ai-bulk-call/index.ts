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
  getConcurrency,
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
  let testCall:
    | { phone?: string; first_name?: string; last_name?: string; company?: string; script_id?: string }
    | null = null;
  if (req.method === "POST") {
    try {
      const body = await req.json();
      if (body?.action === "test_call" && body?.phone) {
        testCall = {
          phone: body.phone,
          first_name: body.first_name || "there",
          last_name: body.last_name || "",
          company: body.company || "your company",
          script_id: body.script_id,
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

  // 1. Working window check
  const workWindow = isInsideWorkingWindow();
  if (!testCall && !workWindow.inside) {
    return done(200, { ok: true, acted: false, reason: workWindow.reason, stale_closed: staleClosed });
  }

  // 2. Pull every active script for this org. Each represents a product-specific AI dialer
  //    (Riya/Worksync, Anushree/Vendor Verification, etc.). They run in parallel, each with
  //    its own contact pool (filtered by contacts.product = script.product_name) and queue.
  const { data: activeScripts } = await supabase
    .from("ai_call_scripts")
    .select("*")
    .eq("org_id", INSYNC_DEMO_ORG_ID)
    .eq("is_active", true);

  if (!activeScripts || activeScripts.length === 0) {
    return done(200, { ok: true, acted: false, reason: "no active scripts", stale_closed: staleClosed });
  }

  // 3a. Test call branch — needs an explicit script (caller picks which product to test)
  if (testCall) {
    const script = (activeScripts as ScriptRow[]).find((s) => s.id === testCall!.script_id)
      ?? (activeScripts[0] as ScriptRow);
    const agentId = await ensureBolnaAgent(supabase, bolnaKey, script);
    if (!agentId) return done(500, { ok: false, error: "Bolna agent provision failed" });

    const toNumber = normalizePhone(testCall.phone!) || testCall.phone!;
    const { data: inserted, error: insertErr } = await supabase
      .from("call_logs")
      .insert({
        org_id: INSYNC_DEMO_ORG_ID,
        caller_type: "ai",
        ai_script_id: script.id,
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
      script: script.name,
      voice: script.voice_name,
    });
  }

  // 4. Global daily-target check (sum across all products)
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
      stale_closed: staleClosed,
    });
  }

  const concurrency = getConcurrency();

  // 5. Per-script loop: top up queue and dispatch up to `concurrency` in-flight, scoped to this script
  const perScript: any[] = [];
  for (const s of activeScripts as ScriptRow[]) {
    const agentId = await ensureBolnaAgent(supabase, bolnaKey, s);
    if (!agentId) {
      perScript.push({ script: s.name, product: s.product_name, error: "agent provision failed" });
      continue;
    }

    // Count in-flight + queued FOR THIS SCRIPT
    const { count: inFlightCount } = await supabase
      .from("call_logs")
      .select("id", { count: "exact", head: true })
      .eq("org_id", INSYNC_DEMO_ORG_ID)
      .eq("caller_type", "ai")
      .eq("ai_script_id", s.id)
      .eq("status", "in_progress");

    const { count: queuedCount } = await supabase
      .from("call_logs")
      .select("id", { count: "exact", head: true })
      .eq("org_id", INSYNC_DEMO_ORG_ID)
      .eq("caller_type", "ai")
      .eq("ai_script_id", s.id)
      .eq("status", "queued");

    const inFlight = inFlightCount || 0;
    const queued = queuedCount || 0;
    const needToQueue = Math.max(0, QUEUE_DEPTH - queued);

    let queuedNow = 0;
    if (needToQueue > 0) {
      const queuedRows = await queueUntouchedContacts(supabase, { script: s, limit: needToQueue });
      queuedNow = queuedRows.length;
    }

    const slotsToFill = Math.max(0, concurrency - inFlight);
    let dispatched = 0;
    for (let i = 0; i < slotsToFill; i++) {
      const { data: nextRow } = await supabase
        .from("call_logs")
        .select("id, contact_id, to_number")
        .eq("org_id", INSYNC_DEMO_ORG_ID)
        .eq("caller_type", "ai")
        .eq("ai_script_id", s.id)
        .eq("status", "queued")
        .order("created_at", { ascending: true })
        .order("bolna_queue_position", { ascending: true })
        .limit(1)
        .maybeSingle();

      if (!nextRow) break;

      const { data: contact } = await supabase
        .from("contacts")
        .select("id, first_name, last_name, company, job_title")
        .eq("id", nextRow.contact_id)
        .maybeSingle();

      if (!contact) {
        await supabase.from("call_logs").update({ status: "error" }).eq("id", nextRow.id);
        continue;
      }

      const result = await triggerBolnaCall(bolnaKey, {
        agentId,
        toNumber: nextRow.to_number,
        callLogId: nextRow.id,
        contact,
      });

      if (result.error) {
        await supabase.from("call_logs").update({ status: "error" }).eq("id", nextRow.id);
        continue;
      }

      await supabase
        .from("call_logs")
        .update({
          status: "in_progress",
          bolna_execution_id: result.execution_id,
          started_at: new Date().toISOString(),
        })
        .eq("id", nextRow.id);
      dispatched++;
    }

    perScript.push({
      script: s.name,
      product: s.product_name,
      in_flight_before: inFlight,
      queued_before: queued,
      queued_now: queuedNow,
      dispatched,
    });
  }

  return done(200, {
    ok: true,
    acted: true,
    window: workWindow.window,
    connected_today: connectedToday,
    target: DAILY_CONNECTED_TARGET,
    concurrency,
    stale_closed: staleClosed,
    scripts: perScript,
  });
});

async function ensureBolnaAgent(
  supabase: any,
  bolnaKey: string,
  script: ScriptRow,
): Promise<string | null> {
  if (script.bolna_agent_id) return script.bolna_agent_id;

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const webhookUrl = `${supabaseUrl}/functions/v1/ai-bolna-webhook`;
  try {
    const agentId = await createBolnaAgent(bolnaKey, { script, webhookUrl });
    await supabase
      .from("ai_call_scripts")
      .update({ bolna_agent_id: agentId, updated_at: new Date().toISOString() })
      .eq("id", script.id);
    script.bolna_agent_id = agentId;
    return agentId;
  } catch (e: any) {
    console.error("Bolna agent provision failed:", e?.message || e);
    return null;
  }
}

async function queueUntouchedContacts(
  supabase: any,
  args: { script: ScriptRow; limit: number },
): Promise<Array<{ id: string }>> {
  const { script, limit } = args;

  // Server-side candidate selection (RPC). Rules:
  //   - has phone, not in Won/Lost, not do_not_call
  //   - phone/name does not match a profile in the same org (don't call colleagues)
  //   - fewer than 3 actually-dialed AI attempts ever
  //   - last attempt was on an earlier IST calendar day (no same-day retry)
  //   - contacts.product matches the script's product_name (case-insensitive)
  const { data: untouched, error: rpcErr } = await supabase.rpc("get_ai_call_candidates", {
    p_org: INSYNC_DEMO_ORG_ID,
    p_limit: limit,
    p_product: script.product_name,
  });
  if (rpcErr || !untouched || untouched.length === 0) {
    if (rpcErr) console.error("get_ai_call_candidates rpc error:", rpcErr);
    return [];
  }

  const { data: maxRow } = await supabase
    .from("call_logs")
    .select("bolna_queue_position")
    .eq("org_id", INSYNC_DEMO_ORG_ID)
    .eq("caller_type", "ai")
    .eq("ai_script_id", script.id)
    .order("bolna_queue_position", { ascending: false })
    .limit(1)
    .maybeSingle();
  const startPos = ((maxRow?.bolna_queue_position as number) || 0) + 1;

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
