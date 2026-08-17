// Shared: classify an AI call transcript into one of the org's outcome keys, and
// apply the resulting disposition. Used by ai-bolna-webhook (live) and the
// backfill function. Classification runs on Groq first, Cerebras as fallback
// (our own keys) — NOT on Bolna's LLM (which only supports gpt-4o-mini).

const GROQ_MODEL = "llama-3.3-70b-versatile";
const CEREBRAS_MODEL = "gemma-4-31b";

// Text-only tier: Groq first, Cerebras as the fallback if Groq is
// unavailable/errors. Both are OpenAI-compatible chat-completions APIs.
async function callGroqText(system: string, userContent: string, maxTokens: number): Promise<string | null> {
  const key = Deno.env.get("GROQ_API_KEY");
  if (!key) return null;
  try {
    const resp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: GROQ_MODEL,
        max_tokens: maxTokens,
        messages: [
          { role: "system", content: system },
          { role: "user", content: userContent },
        ],
      }),
    });
    if (!resp.ok) {
      console.error("classifyCall Groq error:", resp.status, await resp.text());
      return null;
    }
    const data = await resp.json();
    return data.choices?.[0]?.message?.content ?? null;
  } catch (e) {
    console.error("classifyCall Groq fetch error:", String(e));
    return null;
  }
}

async function callCerebrasText(system: string, userContent: string, maxTokens: number): Promise<string | null> {
  const key = Deno.env.get("CEREBRAS_API_KEY");
  if (!key) return null;
  try {
    const resp = await fetch("https://api.cerebras.ai/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: CEREBRAS_MODEL,
        max_tokens: maxTokens,
        messages: [
          { role: "system", content: system },
          { role: "user", content: userContent },
        ],
      }),
    });
    if (!resp.ok) {
      console.error("classifyCall Cerebras error:", resp.status, await resp.text());
      return null;
    }
    const data = await resp.json();
    return data.choices?.[0]?.message?.content ?? null;
  } catch (e) {
    console.error("classifyCall Cerebras fetch error:", String(e));
    return null;
  }
}

export interface CallClassification {
  outcome_key: string;
  demo_date: string | null; // YYYY-MM-DD if a specific demo slot was agreed
  demo_time: string | null; // HH:MM (24h) if a specific demo slot was agreed
  opt_out: boolean;          // prospect asked not to be contacted at all
  summary: string;           // <=240 chars, neutral, for the reminder-call context
}

/**
 * Deterministic guards on what a call may be classified as.
 *
 * Added 2026-08-17 after a real failure: Riya called Mohit Chelani (Torchit) on
 * 13 Aug, reached an answering machine whose only words were "when you have
 * finished recording you may hang up", and the model returned demo_agreed. The
 * pipeline then created a meeting for 16 Aug 3pm, emailed the prospect a
 * confirmation he had never asked for, alerted the owner, and spent a second
 * call reminding him about it.
 *
 * The model is not asked to be more careful — it is not allowed to decide this.
 * A positive outcome now requires evidence that a human actually spoke, and any
 * transcript carrying voicemail wording is forced to a no-contact outcome.
 */

// Phrases that only appear when a machine answered.
const VOICEMAIL_MARKERS = [
  /when you have finished recording/i,
  /(leave|record) (a|your) (message|voicemail)/i,
  /after the (beep|tone)/i,
  /is (not available|unavailable|switched off|busy) (right now|at the moment)?/i,
  /please try (again )?later/i,
  /the number you (have )?(dialled|dialed|called)/i,
  /call has been forwarded/i,
  /voice ?mail/i,
];

// Outcomes that assert the prospect engaged. None may be returned without a
// human turn in the transcript.
const POSITIVE_OUTCOMES = new Set(["demo_agreed", "interested", "callback", "decision_maker"]);

/** The prospect's own turns, i.e. everything the far end actually said. */
export function customerTurns(transcript: string): string[] {
  return (transcript || "")
    .split(/\r?\n+/)
    .filter((l) => /^\s*(user|customer|prospect|human)\s*:/i.test(l))
    .map((l) => l.replace(/^\s*\w+\s*:/, "").trim())
    .filter((l) => l.length > 0);
}

export function looksLikeVoicemail(transcript: string): boolean {
  const said = customerTurns(transcript).join(" ");
  return VOICEMAIL_MARKERS.some((re) => re.test(said));
}

/**
 * Apply the guards to a model classification. Returns the classification it is
 * allowed to be, plus a reason when it was overridden.
 */
export function guardClassification(
  c: CallClassification,
  transcript: string,
  outcomeKeys: string[],
): { result: CallClassification; overridden: string | null } {
  const turns = customerTurns(transcript);
  const meaningful = turns.filter((t) => t.split(/\s+/).length >= 2);
  const fallback = outcomeKeys.includes("no_answer")
    ? "no_answer"
    : outcomeKeys.includes("not_connected") ? "not_connected" : null;

  const demote = (why: string) => {
    if (!fallback) {
      // Nothing safe to fall back to — refuse rather than assert a positive.
      return { result: { ...c, outcome_key: c.outcome_key, demo_date: null, demo_time: null }, overridden: why };
    }
    return {
      result: { ...c, outcome_key: fallback, demo_date: null, demo_time: null, opt_out: false },
      overridden: why,
    };
  };

  if (looksLikeVoicemail(transcript)) return demote("voicemail greeting detected");
  if (POSITIVE_OUTCOMES.has(c.outcome_key) && meaningful.length === 0) {
    return demote("no customer speech in transcript");
  }
  // A demo slot may only survive if the prospect actually spoke.
  if ((c.demo_date || c.demo_time) && meaningful.length === 0) {
    return { result: { ...c, demo_date: null, demo_time: null }, overridden: "demo slot without customer speech" };
  }
  return { result: c, overridden: null };
}

export async function classifyCall(
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

  const text = (await callGroqText(system, user, 350)) ?? (await callCerebrasText(system, user, 350));
  if (text === null) return null;
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const o = JSON.parse(m[0]);
    if (!o.outcome_key || !args.outcomeKeys.includes(o.outcome_key)) return null;
    const classified: CallClassification = {
      outcome_key: o.outcome_key,
      demo_date: o.demo_date || null,
      demo_time: o.demo_time || null,
      opt_out: !!o.opt_out,
      summary: String(o.summary || "").slice(0, 240),
    };
    // The model proposes; the guards decide. See guardClassification above.
    const { result, overridden } = guardClassification(classified, transcript, args.outcomeKeys);
    if (overridden) {
      console.log(`[dispositionClassifier] "${classified.outcome_key}" -> "${result.outcome_key}": ${overridden}`);
    }
    return result;
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
  transcript: string,
  todayIso?: string,
): Promise<ReminderReply> {
  const empty: ReminderReply = { intent: "unclear", reschedule_text: null, reschedule_date: null, reschedule_time: null };
  const t = (transcript || "").trim();
  if (t.length < 5) return empty;
  const today = todayIso || new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
  const system = "You read a short reminder-call transcript and decide if the person confirmed they will JOIN their scheduled demo. If they cannot and propose another time, capture it and resolve it to an absolute date/time. Reply with ONLY a JSON object.";
  const user = `Transcript:\n"""\n${t.slice(0, 6000)}\n"""\n\nToday is ${today}, timezone IST — resolve relative times like "tomorrow" or "Friday 3pm". Return JSON: {"intent":"yes|no|unclear","reschedule_text":"<their words, or null>","reschedule_date":"YYYY-MM-DD or null","reschedule_time":"HH:MM 24h or null"}`;
  try {
    const text = (await callGroqText(system, user, 120)) ?? (await callCerebrasText(system, user, 120));
    if (text === null) return empty;
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
