import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.58.0";
import { BILLABLE_CALL_ORG_IDS } from "../_shared/aiCalling.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BOLNA_BASE = "https://api.bolna.ai";
const CALL_COST_PER_MINUTE = 3.0;
const TERMINAL_STATUSES = new Set([
  "completed", "failed", "no-answer", "busy", "canceled",
  "stopped", "balance-low", "error", "call-disconnected",
]);

// Re-fetch any Bolna call we have not yet seen reach "completed" — caught webhook-drop
// stragglers and updates to call_logs to mirror Bolna's own view.
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const bolnaKey = Deno.env.get("BOLNA_API_KEY");
  if (!bolnaKey) {
    return new Response(JSON.stringify({ ok: false, error: "BOLNA_API_KEY missing" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  let lookbackHours = 24;
  let maxRows = 200;
  try {
    const body = req.method === "POST" ? await req.json() : {};
    if (typeof body.lookback_hours === "number") lookbackHours = body.lookback_hours;
    if (typeof body.max_rows === "number") maxRows = body.max_rows;
  } catch { /* defaults */ }

  const cutoff = new Date(Date.now() - lookbackHours * 3600 * 1000).toISOString();

  // Rows worth re-checking: have a Bolna execution id, created in window, not yet completed.
  const { data: rows, error } = await supabase
    .from("call_logs")
    .select("id, bolna_execution_id, status, call_duration")
    .not("bolna_execution_id", "is", null)
    .gte("created_at", cutoff)
    .neq("status", "completed")
    .order("created_at", { ascending: false })
    .limit(maxRows);

  if (error) {
    return new Response(JSON.stringify({ ok: false, error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  let updated = 0;
  let unchanged = 0;
  let errors = 0;
  const changes: Array<Record<string, unknown>> = [];

  for (const row of rows ?? []) {
    try {
      const res = await fetch(`${BOLNA_BASE}/executions/${row.bolna_execution_id}`, {
        headers: { "Authorization": `Bearer ${bolnaKey}` },
      });
      if (!res.ok) { errors++; continue; }
      const exec = await res.json();

      const rawStatus = (exec.status as string) || "unknown";
      const telephony = (exec.telephony_data as Record<string, unknown>) || {};
      const telDur = telephony.duration != null ? Number(telephony.duration) : null;
      const convDur = exec.conversation_duration != null ? Number(exec.conversation_duration) : null;
      const dur = telDur ?? convDur;
      const recordingUrl = (telephony.recording_url as string) || null;
      const providerCallSid = (telephony.provider_call_id as string) || null;
      const transcript = (exec.transcript as string) || null;

      // Mirror the webhook's normalization rules (raw Bolna outcome — no threshold reclass).
      let normalizedStatus = rawStatus;
      if (rawStatus === "in-progress" || rawStatus === "ringing" || rawStatus === "initiated") {
        normalizedStatus = "in_progress";
      } else if (rawStatus === "call-disconnected") {
        normalizedStatus = "completed";
      }

      const isTerminal = TERMINAL_STATUSES.has(rawStatus);

      // Skip if Bolna's still in flight and we already have an in_progress row.
      if (normalizedStatus === row.status && (dur == null || (row.call_duration || 0) >= dur)) {
        unchanged++;
        continue;
      }

      const update: Record<string, unknown> = { status: normalizedStatus };
      if (dur != null) {
        update.call_duration = dur;
        update.conversation_duration = dur;
      }
      if (recordingUrl) update.recording_url = recordingUrl;
      if (providerCallSid) update.exotel_call_sid = providerCallSid;
      if (isTerminal) update.ended_at = new Date().toISOString();
      if (transcript && isTerminal) {
        update.transcript = transcript;
        update.transcribed_at = new Date().toISOString();
      }

      const { error: uerr } = await supabase
        .from("call_logs")
        .update(update)
        .eq("id", row.id);
      if (uerr) { errors++; continue; }
      updated++;
      changes.push({ id: row.id, from: row.status, to: normalizedStatus, dur });
    } catch (_e) {
      errors++;
    }
  }

  // Billing safety-net: charge any AI call that had talk-time but never got a
  // 'call' usage row. The terminal Bolna webhook frequently arrives WITHOUT a
  // duration (it's finalized later by reconcile / exotel-sync), so the webhook's
  // billing branch is skipped and the call is never deducted. This sweep closes
  // that gap. Idempotent on (org, 'call', call_log.id) — never double-charges.
  const billing = await billUnbilledCalls(supabase, cutoff);

  return new Response(JSON.stringify({
    ok: true,
    scanned: rows?.length || 0,
    updated, unchanged, errors,
    lookback_hours: lookbackHours,
    billed_calls: billing.billed,
    changes: changes.slice(0, 20),
  }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
});

async function billUnbilledCalls(
  supabase: any,
  cutoff: string,
): Promise<{ billed: number }> {
  // AI calls in the window that actually connected (talk-time > 0).
  // Scoped to billable orgs only — internal/demo orgs are not charged.
  const billableOrgs = [...BILLABLE_CALL_ORG_IDS];
  if (billableOrgs.length === 0) return { billed: 0 };
  const { data: calls } = await supabase
    .from("call_logs")
    .select("id, org_id, conversation_duration")
    .eq("caller_type", "ai")
    .in("org_id", billableOrgs)
    .gt("conversation_duration", 0)
    .gte("created_at", cutoff);
  if (!calls || calls.length === 0) return { billed: 0 };

  // Which of these already have a 'call' usage row?
  const ids = calls.map((c: any) => c.id);
  const { data: existing } = await supabase
    .from("service_usage_logs")
    .select("reference_id")
    .eq("service_type", "call")
    .in("reference_id", ids);
  const billed = new Set((existing || []).map((r: any) => r.reference_id));

  let count = 0;
  for (const c of calls) {
    if (billed.has(c.id)) continue;
    const minutes = Math.ceil(Number(c.conversation_duration) / 60);
    if (minutes <= 0) continue;
    await recordUsage(supabase, {
      orgId: c.org_id as string,
      serviceType: "call",
      referenceId: c.id as string,
      quantity: minutes,
      cost: +(minutes * CALL_COST_PER_MINUTE).toFixed(2),
      description: `AI call ${c.id} — ${minutes} min × Rs ${CALL_COST_PER_MINUTE}/min (reconciled)`,
    });
    count++;
  }
  return { billed: count };
}

// Records a usage row and atomically decrements the wallet. Idempotent on
// (service_type, reference_id). Mirrors recordUsage in ai-bolna-webhook.
async function recordUsage(
  supabase: any,
  args: { orgId: string; serviceType: "call" | "whatsapp" | "email"; referenceId: string; quantity: number; cost: number; description: string },
): Promise<void> {
  try {
    const { data: existing } = await supabase
      .from("service_usage_logs")
      .select("id")
      .eq("org_id", args.orgId)
      .eq("service_type", args.serviceType)
      .eq("reference_id", args.referenceId)
      .maybeSingle();
    if (existing) return;

    const { data: usageRow } = await supabase
      .from("service_usage_logs")
      .insert({ org_id: args.orgId, service_type: args.serviceType, reference_id: args.referenceId, quantity: args.quantity, cost: args.cost, wallet_deducted: false })
      .select("id")
      .single();
    if (!usageRow) return;

    const { data: sub } = await supabase
      .from("organization_subscriptions")
      .select("wallet_balance")
      .eq("org_id", args.orgId)
      .maybeSingle();
    if (!sub) return;

    const balanceBefore = Number(sub.wallet_balance || 0);
    const balanceAfter = balanceBefore - args.cost;

    const { data: walletTxn } = await supabase
      .from("wallet_transactions")
      .insert({
        org_id: args.orgId,
        transaction_type: `deduction_${args.serviceType}`,
        amount: -args.cost,
        balance_before: balanceBefore,
        balance_after: balanceAfter,
        reference_id: args.referenceId,
        reference_type: args.serviceType,
        quantity: args.quantity,
        unit_cost: args.cost / Math.max(1, args.quantity),
        description: args.description,
      })
      .select("id")
      .single();

    await supabase.from("organization_subscriptions")
      .update({ wallet_balance: balanceAfter, updated_at: new Date().toISOString() })
      .eq("org_id", args.orgId);
    await supabase.from("service_usage_logs")
      .update({ wallet_deducted: true, wallet_transaction_id: walletTxn?.id })
      .eq("id", usageRow.id);
  } catch (e) {
    console.error("recordUsage exception:", String(e));
  }
}
