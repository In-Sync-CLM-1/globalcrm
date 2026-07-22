import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.58.0";
import {
  isInsideWorkingWindow,
  triggerBolnaCall,
} from "../_shared/aiCalling.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Riya is currently the only AI agent for outbound WorkSync calls.
const DEFAULT_AGENT_ID = "ff331674-74c0-4a75-86ee-566a966d4f09";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const bolnaKey = Deno.env.get("BOLNA_API_KEY");
  if (!bolnaKey) {
    return json({ ok: false, error: "BOLNA_API_KEY not set" });
  }

  // Working-window guard — re-uses the same business hours check as the batch dialer
  const win = isInsideWorkingWindow();
  if (!win.inside) {
    return json({ ok: true, dispatched: 0, skipped_reason: win.reason });
  }

  const now = new Date();
  const lookahead = new Date(now.getTime() + 5 * 60_000); // dispatch anything due in the next 5 min

  const { data: dueRows, error } = await supabase
    .from("contact_activities")
    .select("id, org_id, contact_id, next_action_date, next_action_notes")
    .eq("next_action_type", "ai_callback")
    .is("ai_callback_triggered_at", null)
    .lte("next_action_date", lookahead.toISOString())
    .order("next_action_date", { ascending: true })
    .limit(50);

  if (error) return json({ ok: false, error: error.message });

  let dispatched = 0;
  let skipped_dnc = 0;
  let failed = 0;

  for (const row of dueRows || []) {
    const { data: contact } = await supabase
      .from("contacts")
      .select("id, first_name, last_name, company, job_title, phone, do_not_call, org_id")
      .eq("id", row.contact_id)
      .maybeSingle();

    if (!contact) {
      await supabase.from("contact_activities")
        .update({ ai_callback_triggered_at: now.toISOString(), next_action_notes: (row.next_action_notes ?? "") + " [contact missing]" })
        .eq("id", row.id);
      continue;
    }

    if (contact.do_not_call) {
      await supabase.from("contact_activities")
        .update({ ai_callback_triggered_at: now.toISOString(), next_action_notes: (row.next_action_notes ?? "") + " [skipped: do_not_call]" })
        .eq("id", row.id);
      skipped_dnc++;
      continue;
    }

    if (!contact.phone) {
      await supabase.from("contact_activities")
        .update({ ai_callback_triggered_at: now.toISOString(), next_action_notes: (row.next_action_notes ?? "") + " [no phone]" })
        .eq("id", row.id);
      failed++;
      continue;
    }

    // Create a call_logs row so the webhook can correlate via context_details.call_log_id
    const { data: cl, error: clErr } = await supabase
      .from("call_logs")
      .insert({
        org_id: contact.org_id,
        contact_id: contact.id,
        call_type: "outbound",
        direction: "outbound",
        caller_type: "ai",
        from_number: null,
        to_number: contact.phone,
        status: "queued",
      })
      .select("id")
      .single();

    if (clErr || !cl) {
      failed++;
      console.error("[ai-callback-dispatcher] could not create call_logs row", clErr);
      continue;
    }

    const result = await triggerBolnaCall(bolnaKey, {
      agentId: DEFAULT_AGENT_ID,
      toNumber: contact.phone,
      callLogId: cl.id,
      contact,
    });

    if (result.error) {
      await supabase.from("call_logs").update({ status: "error" }).eq("id", cl.id);
      await supabase.from("contact_activities")
        .update({ ai_callback_triggered_at: now.toISOString(), next_action_notes: (row.next_action_notes ?? "") + ` [dispatch failed: ${result.error}]` })
        .eq("id", row.id);
      failed++;
      continue;
    }

    await supabase.from("call_logs").update({
      status: "in_progress",
      bolna_execution_id: result.execution_id,
      started_at: now.toISOString(),
    }).eq("id", cl.id);

    await supabase.from("contact_activities")
      .update({ ai_callback_triggered_at: now.toISOString() })
      .eq("id", row.id);

    dispatched++;
  }

  return json({ ok: true, dispatched, skipped_dnc, failed, scanned: dueRows?.length ?? 0 });
});

function json(body: any) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
