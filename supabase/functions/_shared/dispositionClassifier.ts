// Shared: classify an AI call transcript into one of the org's outcome keys, and
// apply the resulting disposition. Used by ai-bolna-webhook (live) and the
// backfill function. Classification runs on Claude Haiku (our own key) — NOT on
// Bolna's LLM (which only supports gpt-4o-mini).

const HAIKU_MODEL = "claude-haiku-4-5-20251001";

export interface CallClassification {
  outcome_key: string;
  demo_date: string | null; // YYYY-MM-DD if a specific demo slot was agreed
  demo_time: string | null; // HH:MM (24h) if a specific demo slot was agreed
  opt_out: boolean;          // prospect asked not to be contacted at all
  summary: string;           // <=240 chars, neutral, for the reminder-call context
}

export async function classifyCall(
  anthropicKey: string,
  args: { transcript: string; productLabel: string; outcomeKeys: string[]; todayIso?: string },
): Promise<CallClassification | null> {
  const transcript = (args.transcript || "").trim();
  if (transcript.length < 10) return null;
  const today = args.todayIso || new Date().toISOString().slice(0, 10);
  const allowed = args.outcomeKeys.join(", ");

  const system = `You classify the outcome of an outbound sales call for ${args.productLabel}. Reply with ONLY a JSON object, no prose.`;
  const user =
    `Call transcript:\n"""\n${transcript.slice(0, 12000)}\n"""\n\n` +
    `Pick exactly one outcome_key from this list: [${allowed}].\n` +
    `Meanings: demo_agreed = agreed to a demo/meeting; callback = asked to be called back later; ` +
    `decision_maker = needs another decision-maker involved; interested = positive but no demo yet; ` +
    `not_interested = declined; not_qualified = not a fit; wrong_person = wrong number/person; ` +
    `do_not_call = asked to be removed / never contacted.\n` +
    `Also return: demo_date (YYYY-MM-DD) and demo_time (24h HH:MM) ONLY if a specific slot was clearly agreed, else null. ` +
    `Today is ${today}, timezone IST — resolve relative dates ("tomorrow", "Friday 3pm"). ` +
    `opt_out = true only if they asked not to be contacted at all. ` +
    `summary = max 240 chars, neutral, capturing what was discussed (used to brief a later reminder call).\n` +
    `JSON shape: {"outcome_key":"...","demo_date":null,"demo_time":null,"opt_out":false,"summary":"..."}`;

  let resp: Response;
  try {
    resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": anthropicKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: HAIKU_MODEL, max_tokens: 350, system, messages: [{ role: "user", content: user }] }),
    });
  } catch (e) {
    console.error("classifyCall fetch error:", String(e));
    return null;
  }
  if (!resp.ok) {
    console.error("classifyCall anthropic error:", resp.status, await resp.text());
    return null;
  }
  const data = await resp.json();
  const text = (data?.content || []).find((b: any) => b.type === "text")?.text ?? "";
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const o = JSON.parse(m[0]);
    if (!o.outcome_key || !args.outcomeKeys.includes(o.outcome_key)) return null;
    return {
      outcome_key: o.outcome_key,
      demo_date: o.demo_date || null,
      demo_time: o.demo_time || null,
      opt_out: !!o.opt_out,
      summary: String(o.summary || "").slice(0, 240),
    };
  } catch {
    return null;
  }
}

/**
 * Apply a classified outcome to the call. Maps the outcome to a disposition via
 * ai_outcome_disposition_map, sets call_logs.disposition_id, applies opt-out flags,
 * and (when fireAutomation) inserts a contact_activities row — which fires the
 * demo-booked trigger (calendar + host notify). Backfill passes fireAutomation=false
 * so old calls get a disposition WITHOUT re-creating meetings or sending messages.
 */
export async function applyDisposition(
  supabase: any,
  args: {
    orgId: string;
    callLogId: string;
    contactId: string | null;
    outcomeKey: string;
    demoDate: string | null;
    demoTime: string | null;
    optOut: boolean;
    summary: string | null;
    callDuration: number | null;
    fireAutomation: boolean;
  },
): Promise<{ dispositionId: string | null; isDemo: boolean; outcomeKey: string }> {
  const { data: map } = await supabase
    .from("ai_outcome_disposition_map")
    .select("disposition_id, sets_opt_out")
    .eq("org_id", args.orgId)
    .ilike("outcome_key", args.outcomeKey)
    .maybeSingle();
  if (!map) return { dispositionId: null, isDemo: false, outcomeKey: args.outcomeKey };

  const dispositionId = map.disposition_id as string;
  const { data: disp } = await supabase.from("call_dispositions").select("name").eq("id", dispositionId).maybeSingle();
  const isDemo = disp?.name === "Demo Booked";

  await supabase.from("call_logs").update({ disposition_id: dispositionId }).eq("id", args.callLogId);

  if ((args.optOut || map.sets_opt_out) && args.contactId) {
    await supabase.from("contacts").update({
      do_not_call: true,
      do_not_whatsapp: true,
      do_not_email: true,
      opted_out: true,
      opt_out_reason: "Requested removal on AI call",
      opt_out_at: new Date().toISOString(),
    }).eq("id", args.contactId);
  }

  if (args.fireAutomation && args.contactId) {
    await supabase.from("contact_activities").insert({
      org_id: args.orgId,
      contact_id: args.contactId,
      activity_type: "call",
      subject: "AI call outcome",
      call_disposition_id: dispositionId,
      demo_date: isDemo ? args.demoDate : null,
      demo_time: isDemo ? args.demoTime : null,
      call_duration: args.callDuration,
      next_action_notes: args.summary,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
  }

  return { dispositionId, isDemo, outcomeKey: args.outcomeKey };
}

// Read a reminder-call transcript: did they confirm they'll join, and if not, what
// new day/time did they ask to reschedule to (resolved to an absolute date/time)?
export interface ReminderReply {
  intent: "yes" | "no" | "unclear";
  reschedule_text: string | null;
  reschedule_date: string | null; // YYYY-MM-DD (IST) if resolvable
  reschedule_time: string | null; // HH:MM 24h (IST) if resolvable
}
export async function classifyJoinIntent(
  anthropicKey: string,
  transcript: string,
  todayIso?: string,
): Promise<ReminderReply> {
  const empty: ReminderReply = { intent: "unclear", reschedule_text: null, reschedule_date: null, reschedule_time: null };
  const t = (transcript || "").trim();
  if (t.length < 5) return empty;
  const today = todayIso || new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
  try {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": anthropicKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: HAIKU_MODEL, max_tokens: 120,
        system: "You read a short reminder-call transcript and decide if the person confirmed they will JOIN their scheduled demo. If they cannot and propose another time, capture it and resolve it to an absolute date/time. Reply with ONLY a JSON object.",
        messages: [{ role: "user", content: `Transcript:\n"""\n${t.slice(0, 6000)}\n"""\n\nToday is ${today}, timezone IST — resolve relative times like "tomorrow" or "Friday 3pm". Return JSON: {"intent":"yes|no|unclear","reschedule_text":"<their words, or null>","reschedule_date":"YYYY-MM-DD or null","reschedule_time":"HH:MM 24h or null"}` }],
      }),
    });
    if (!resp.ok) return empty;
    const data = await resp.json();
    const text = ((data?.content || []).find((b: any) => b.type === "text")?.text || "");
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return empty;
    const o = JSON.parse(m[0]);
    const intent = ["yes", "no", "unclear"].includes(o.intent) ? o.intent : "unclear";
    if (intent !== "no") return { intent, reschedule_text: null, reschedule_date: null, reschedule_time: null };
    const clean = (v: any) => (v && String(v).toLowerCase() !== "null") ? String(v) : null;
    return {
      intent,
      reschedule_text: clean(o.reschedule_text)?.slice(0, 120) ?? null,
      reschedule_date: clean(o.reschedule_date),
      reschedule_time: clean(o.reschedule_time),
    };
  } catch {
    return empty;
  }
}
