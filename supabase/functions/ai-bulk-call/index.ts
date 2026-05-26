import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.58.0";
import {
  INSYNC_DEMO_ORG_ID,
  INTERNAL_ORG_IDS,
  isInsideCustomWindow,
  triggerBolnaCall,
  createBolnaAgent,
  normalizePhone,
  ScriptRow,
  DAILY_CONNECTED_TARGET,
  CONNECTED_THRESHOLD_SEC,
  QUEUE_DEPTH,
  getConcurrency,
  WindowSlot,
} from "../_shared/aiCalling.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Orgs that opted into the per-org daily connected-call target. Other orgs (e.g.
// IEDUP) are notification-style and dial until the queue empties.
const ORGS_WITH_DAILY_TARGET = new Set<string>([INSYNC_DEMO_ORG_ID]);

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

  // Parse optional POST body. Supports:
  //   action=test_call → one-off call bypassing window + queue (used by "Dial now" UI)
  //   action=start     → flip dialing_active=true for the given org
  //   action=stop      → flip dialing_active=false for the given org
  //   no action        → cron tick: loop every org with dialing_active=true
  let action: string | null = null;
  let body: any = null;
  if (req.method === "POST") {
    try {
      body = await req.json();
      action = (body?.action as string) || null;
    } catch (_e) { /* no body */ }
  }

  if (action === "start" || action === "stop") {
    const targetOrgId = (body?.org_id as string) || null;
    if (!targetOrgId) return done(400, { ok: false, error: "org_id required" });
    const { error: upErr } = await supabase
      .from("organization_settings")
      .upsert(
        { org_id: targetOrgId, dialing_active: action === "start", updated_at: new Date().toISOString() },
        { onConflict: "org_id" },
      );
    if (upErr) return done(500, { ok: false, error: upErr.message });
    return done(200, { ok: true, org_id: targetOrgId, dialing_active: action === "start" });
  }

  // Bulk-enqueue: caller (UI) passes a list of contact_ids; we insert queued
  // call_logs rows for them and immediately trigger the cron path so dialing
  // starts right away (subject to window + dialing_active + wallet checks).
  if (action === "enqueue") {
    const orgId = (body?.org_id as string) || INSYNC_DEMO_ORG_ID;
    const contactIds = Array.isArray(body?.contact_ids) ? (body.contact_ids as string[]) : [];
    if (contactIds.length === 0) return done(400, { ok: false, error: "contact_ids required" });

    const { data: scripts } = await supabase
      .from("ai_call_scripts")
      .select("*")
      .eq("org_id", orgId)
      .eq("is_active", true);
    if (!scripts || scripts.length === 0) {
      return done(404, { ok: false, error: "no active ai_call_scripts for this org" });
    }
    const script = (scripts as ScriptRow[]).find((s) => s.id === body?.script_id) ?? (scripts[0] as ScriptRow);

    const { data: contacts } = await supabase
      .from("contacts")
      .select("id, phone, do_not_call")
      .eq("org_id", orgId)
      .in("id", contactIds);
    let valid = (contacts || []).filter((c: any) => c.phone && !c.do_not_call);

    // Enforce per-contact cap: skip anyone already connected, or already attempted 3+ times.
    if (valid.length > 0) {
      const ids = valid.map((c: any) => c.id);
      const { data: stats } = await supabase.rpc("contact_ai_call_stats", { p_contact_ids: ids });
      const byId = new Map<string, { attempts: number; connected: number }>();
      for (const s of (stats || []) as Array<{ contact_id: string; attempts: number; connected: number }>) {
        byId.set(s.contact_id, { attempts: s.attempts, connected: s.connected });
      }
      valid = valid.filter((c: any) => {
        const st = byId.get(c.id) || { attempts: 0, connected: 0 };
        return st.connected === 0 && st.attempts < 3;
      });
    }

    if (valid.length === 0) return done(200, { ok: true, queued: 0, reason: "no valid contacts (already connected or 3-attempt cap)" });

    const { data: maxRow } = await supabase
      .from("call_logs")
      .select("bolna_queue_position")
      .eq("org_id", orgId)
      .eq("caller_type", "ai")
      .eq("ai_script_id", script.id)
      .order("bolna_queue_position", { ascending: false })
      .limit(1)
      .maybeSingle();
    const startPos = ((maxRow?.bolna_queue_position as number) || 0) + 1;
    const batchId = crypto.randomUUID();

    const rows = valid.map((c: any, idx: number) => ({
      org_id: orgId,
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

    const { data: inserted, error: insErr } = await supabase
      .from("call_logs")
      .insert(rows)
      .select("id");
    if (insErr) return done(500, { ok: false, error: insErr.message });

    // Auto-enable dialing for the org so the cron picks up the new queue
    await supabase
      .from("organization_settings")
      .upsert(
        { org_id: orgId, dialing_active: true, updated_at: new Date().toISOString() },
        { onConflict: "org_id" },
      );

    return done(200, {
      ok: true,
      queued: (inserted || []).length,
      batch_id: batchId,
      skipped: contactIds.length - valid.length,
    });
  }

  if (action === "test_call") {
    const orgId = (body?.org_id as string) || INSYNC_DEMO_ORG_ID;
    const phone = body?.phone as string;
    if (!phone) return done(400, { ok: false, error: "phone required" });

    const { data: scripts } = await supabase
      .from("ai_call_scripts")
      .select("*")
      .eq("org_id", orgId)
      .eq("is_active", true);
    if (!scripts || scripts.length === 0) {
      return done(404, { ok: false, error: "no active ai_call_scripts for this org" });
    }
    const script = (scripts as ScriptRow[]).find((s) => s.id === body?.script_id) ?? (scripts[0] as ScriptRow);
    const agentId = await ensureBolnaAgent(supabase, bolnaKey, script);
    if (!agentId) return done(500, { ok: false, error: "Bolna agent provision failed" });

    const toNumber = normalizePhone(phone) || phone;

    const { data: liveCall } = await supabase
      .from("call_logs")
      .select("id, started_at")
      .eq("org_id", orgId)
      .eq("caller_type", "ai")
      .eq("status", "in_progress")
      .eq("to_number", toNumber)
      .maybeSingle();
    if (liveCall) {
      return done(409, {
        ok: false,
        error: `An AI call to ${toNumber} is already in progress (call ${liveCall.id}, started ${liveCall.started_at}).`,
      });
    }

    // Per-contact cap: never call again once connected, otherwise max 3 attempts.
    if (body?.contact_id) {
      const { data: stats } = await supabase.rpc("contact_ai_call_stats", {
        p_contact_ids: [body.contact_id as string],
      });
      const st = (Array.isArray(stats) && stats[0]) || { attempts: 0, connected: 0 };
      if (Number(st.connected) > 0) {
        return done(409, { ok: false, error: "This contact has already been connected — no further calls allowed." });
      }
      if (Number(st.attempts) >= 3) {
        return done(409, { ok: false, error: "This contact has reached the 3-attempt cap." });
      }
    }

    let nameHi: string | null = null;
    let firstName = (body?.first_name as string) || "there";
    let lastName = (body?.last_name as string) || "";
    let company = (body?.company as string) || "";
    if (body?.contact_id) {
      const { data: c } = await supabase
        .from("contacts")
        .select("first_name, last_name, name_hi, company")
        .eq("id", body.contact_id)
        .maybeSingle();
      if (c) {
        firstName = c.first_name || firstName;
        lastName = c.last_name || lastName;
        company = c.company || company;
        nameHi = (c as any).name_hi || null;
      }
    }

    const { data: inserted, error: insertErr } = await supabase
      .from("call_logs")
      .insert({
        org_id: orgId,
        caller_type: "ai",
        ai_script_id: script.id,
        contact_id: body?.contact_id || null,
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
      return done(500, { ok: false, error: `Failed to insert call_logs row: ${insertErr?.message || "unknown"}` });
    }

    const result = await triggerBolnaCall(bolnaKey, {
      agentId,
      toNumber,
      callLogId: inserted.id,
      contact: {
        id: body?.contact_id || inserted.id,
        first_name: firstName,
        last_name: lastName,
        company,
        name_hi: nameHi,
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
      org_id: orgId,
      call_log_id: inserted.id,
      bolna_execution_id: result.execution_id,
      to_number: toNumber,
      agent_id: agentId,
      script: script.name,
    });
  }

  // Cron tick: loop all enabled orgs
  const { data: enabledOrgs } = await supabase
    .from("organization_settings")
    .select("org_id, calling_windows")
    .eq("dialing_active", true);

  if (!enabledOrgs || enabledOrgs.length === 0) {
    return done(200, { ok: true, acted: false, reason: "no orgs with dialing_active=true" });
  }

  const concurrency = getConcurrency();
  const perOrgResults: any[] = [];
  for (const row of enabledOrgs as Array<{ org_id: string; calling_windows: WindowSlot[] }>) {
    perOrgResults.push(await processOrg(supabase, bolnaKey, row.org_id, row.calling_windows, concurrency));
  }

  return done(200, { ok: true, acted: true, orgs: perOrgResults });
});

async function processOrg(
  supabase: any,
  bolnaKey: string,
  orgId: string,
  windows: WindowSlot[],
  concurrency: number,
): Promise<any> {
  const staleCutoff = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const { data: staleRows } = await supabase
    .from("call_logs")
    .update({
      status: "failed",
      ended_at: new Date().toISOString(),
      notes: "Auto-closed: in_progress >10min without webhook close.",
    })
    .eq("org_id", orgId)
    .eq("caller_type", "ai")
    .eq("status", "in_progress")
    .lt("started_at", staleCutoff)
    .select("id");
  const staleClosed = (staleRows || []).length;

  const window = isInsideCustomWindow(windows);
  if (!window.inside) {
    return { org_id: orgId, acted: false, reason: window.reason, stale_closed: staleClosed };
  }

  const { data: activeScripts } = await supabase
    .from("ai_call_scripts")
    .select("*")
    .eq("org_id", orgId)
    .eq("is_active", true);
  if (!activeScripts || activeScripts.length === 0) {
    return { org_id: orgId, acted: false, reason: "no active scripts", stale_closed: staleClosed };
  }

  // Internal / demo orgs (In-Sync Demo) are not billed for AI minutes, so they
  // must never be halted on subscription status or wallet balance.
  const isInternal = INTERNAL_ORG_IDS.has(orgId);

  const { data: sub } = await supabase
    .from("organization_subscriptions")
    .select("subscription_status, wallet_balance, wallet_minimum_balance, last_payment_date, next_billing_date")
    .eq("org_id", orgId)
    .maybeSingle();
  if (!isInternal && sub && (sub.subscription_status === "suspended_locked" || sub.subscription_status === "cancelled")) {
    return { org_id: orgId, acted: false, reason: `subscription ${sub.subscription_status}`, stale_closed: staleClosed };
  }

  // Wallet enforcement: outside of the free trial, halt dialing when the wallet
  // has dropped below its minimum. Trial = no payment yet AND next billing date
  // is still in the future.
  if (!isInternal && sub) {
    const today = new Date().toISOString().slice(0, 10);
    const inTrial = !sub.last_payment_date
      && typeof sub.next_billing_date === "string"
      && sub.next_billing_date >= today;
    const balance = Number(sub.wallet_balance ?? 0);
    const minBalance = Number(sub.wallet_minimum_balance ?? 0);
    if (!inTrial && balance <= minBalance) {
      return {
        org_id: orgId,
        acted: false,
        reason: `wallet exhausted (balance ${balance.toFixed(2)} <= min ${minBalance.toFixed(2)})`,
        stale_closed: staleClosed,
      };
    }
  }

  if (ORGS_WITH_DAILY_TARGET.has(orgId)) {
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);
    const { count: connectedTodayCount } = await supabase
      .from("call_logs")
      .select("id", { count: "exact", head: true })
      .eq("org_id", orgId)
      .eq("caller_type", "ai")
      .gte("created_at", todayStart.toISOString())
      .gte("conversation_duration", CONNECTED_THRESHOLD_SEC);
    const connectedToday = connectedTodayCount || 0;
    if (connectedToday >= DAILY_CONNECTED_TARGET) {
      return {
        org_id: orgId,
        acted: false,
        reason: `daily target met (${connectedToday}/${DAILY_CONNECTED_TARGET})`,
        stale_closed: staleClosed,
      };
    }
  }

  const perScript: any[] = [];
  for (const s of activeScripts as ScriptRow[]) {
    const agentId = await ensureBolnaAgent(supabase, bolnaKey, s);
    if (!agentId) {
      perScript.push({ script: s.name, product: s.product_name, error: "agent provision failed" });
      continue;
    }

    const { count: inFlightCount } = await supabase
      .from("call_logs")
      .select("id", { count: "exact", head: true })
      .eq("org_id", orgId)
      .eq("caller_type", "ai")
      .eq("ai_script_id", s.id)
      .eq("status", "in_progress");

    const { count: queuedCount } = await supabase
      .from("call_logs")
      .select("id", { count: "exact", head: true })
      .eq("org_id", orgId)
      .eq("caller_type", "ai")
      .eq("ai_script_id", s.id)
      .eq("status", "queued");

    const inFlight = inFlightCount || 0;
    const queued = queuedCount || 0;
    const needToQueue = Math.max(0, QUEUE_DEPTH - queued);

    let queuedNow = 0;
    if (needToQueue > 0) {
      queuedNow = (await queueUntouchedContacts(supabase, { orgId, script: s, limit: needToQueue })).length;
    }

    const slotsToFill = Math.max(0, concurrency - inFlight);
    let dispatched = 0;
    for (let i = 0; i < slotsToFill; i++) {
      const { data: nextRow } = await supabase
        .from("call_logs")
        .select("id, contact_id, to_number")
        .eq("org_id", orgId)
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
        .select("id, first_name, last_name, name_hi, company, job_title")
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

  return {
    org_id: orgId,
    acted: true,
    window: window.reason,
    stale_closed: staleClosed,
    scripts: perScript,
  };
}

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
  args: { orgId: string; script: ScriptRow; limit: number },
): Promise<Array<{ id: string }>> {
  const { orgId, script, limit } = args;

  // Owner-based routing: each agent (script owner) only gets the leads they own.
  // A script with no owner queues nothing.
  if (!script.owner_id) return [];

  const { data: untouched, error: rpcErr } = await supabase.rpc("get_ai_call_candidates", {
    p_org: orgId,
    p_limit: limit,
    p_owner: script.owner_id,
  });
  if (rpcErr || !untouched || untouched.length === 0) {
    if (rpcErr) console.error("get_ai_call_candidates rpc error:", rpcErr);
    return [];
  }

  const { data: maxRow } = await supabase
    .from("call_logs")
    .select("bolna_queue_position")
    .eq("org_id", orgId)
    .eq("caller_type", "ai")
    .eq("ai_script_id", script.id)
    .order("bolna_queue_position", { ascending: false })
    .limit(1)
    .maybeSingle();
  const startPos = ((maxRow?.bolna_queue_position as number) || 0) + 1;

  const batchId = crypto.randomUUID();
  const rows = untouched.map((c: any, idx: number) => ({
    org_id: orgId,
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
