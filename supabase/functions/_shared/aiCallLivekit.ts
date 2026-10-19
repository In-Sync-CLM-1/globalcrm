// AI calling on the in-house LiveKit stack: Exotel dials the lead and connects the call to a
// Voicebot Applet, which streams audio to the shared bridge (insync-exotel-bridge, project
// "globalcrm"), which asks `ai-call-context` for the prompt and dispatches the LiveKit agent.
// The agent posts the result back to `ai-call-webhook`.
//
// Everything that can place a call goes through placeAiCall() so no path can skip a guardrail.
// An org is switched on through organizations.settings.ai_calling (see loadAiConfig); until it
// is `enabled` and has an Exotel Voicebot app + caller id, nothing dials.

export interface AiCallingConfig {
  enabled: boolean;
  /** "test": only numbers in test_numbers may be dialled. "live": any lead. */
  mode: "test" | "live";
  test_numbers: string[];
  /** IST minutes since midnight. Sunday is never dialled. */
  windows: { start_min: number; end_min: number }[];
  max_attempts: number;
  max_concurrent: number;
  /** Hours between attempts to the same lead. */
  retry_gap_hours: number;
  exotel_app_id: string | null;
  caller_id: string | null;
  default_script_id: string | null;
}

const DEFAULTS: AiCallingConfig = {
  enabled: false, mode: "test", test_numbers: [], windows: [{ start_min: 600, end_min: 1200 }],
  max_attempts: 3, max_concurrent: 3, retry_gap_hours: 3, exotel_app_id: null, caller_id: null, default_script_id: null,
};

// deno-lint-ignore no-explicit-any
export async function loadAiConfig(supabase: any, orgId: string): Promise<AiCallingConfig> {
  const { data } = await supabase.from("organizations").select("settings").eq("id", orgId).maybeSingle();
  const raw = (data?.settings?.ai_calling ?? {}) as Partial<AiCallingConfig>;
  return { ...DEFAULTS, ...raw, test_numbers: (raw.test_numbers ?? []).map(normalizeToE164) };
}

export function normalizeToE164(num: string): string {
  const digits = (num || "").replace(/\D/g, "");
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 12 && digits.startsWith("91")) return `+${digits}`;
  if (digits.length === 11 && digits.startsWith("0")) return `+91${digits.slice(1)}`;
  return num.startsWith("+") ? num : `+${digits}`;
}

function istParts(now: Date = new Date()) {
  const ist = new Date(now.getTime() + 330 * 60000);
  return { minutes: ist.getUTCHours() * 60 + ist.getUTCMinutes(), dow: ist.getUTCDay() };
}

export function insideCallingWindow(cfg: AiCallingConfig, now: Date = new Date()): { inside: boolean; reason: string } {
  const { minutes, dow } = istParts(now);
  if (dow === 0) return { inside: false, reason: "Sunday: no calling" };
  const ok = cfg.windows.some((w) => minutes >= w.start_min && minutes < w.end_min);
  return ok ? { inside: true, reason: "inside the calling window" } : { inside: false, reason: "outside the calling window" };
}

export function istGreeting(now: Date = new Date()): string {
  const h = Math.floor(istParts(now).minutes / 60);
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

export interface AiScript {
  id: string; org_id: string; name: string; objective: string; opening: string;
  key_points: unknown; objection_handling: unknown; closing: string | null;
  product_name: string | null; product_notes: string | null; behavioral_guidelines: string | null;
  language: string | null; max_duration_seconds: number | null; voice_id: string | null;
}

/** Gaming-platform prompt: a registration / activation caller with hard safety rules. */
export function composeGamingPrompt(script: AiScript, contact: { first_name?: string | null; last_name?: string | null; city?: string | null; product?: string | null }): string {
  const points = Array.isArray(script.key_points) ? (script.key_points as string[]) : [];
  const objections = script.objection_handling && typeof script.objection_handling === "object" ? (script.objection_handling as Record<string, string>) : {};
  const name = [contact.first_name, contact.last_name].filter(Boolean).join(" ") || "there";
  const platform = script.product_name || "our gaming platform";
  const parts: string[] = [
    `You are a friendly AI calling assistant for ${platform}. You are calling ${name}${contact.city ? ` from ${contact.city}` : ""}${contact.product ? `, who showed interest in ${contact.product}` : ""}.`,
    `Time of day greeting: ${istGreeting()}.`,
    `Your objective: ${script.objective}`,
    "",
    "Opening line:", script.opening.replace(/\{first_name\}/g, contact.first_name || "there").replace(/\{greeting\}/g, istGreeting()), "",
  ];
  if (points.length) { parts.push("Key points (weave in naturally):"); points.forEach((p) => parts.push(`- ${p}`)); parts.push(""); }
  const keys = Object.keys(objections);
  if (keys.length) { parts.push("If they raise objections:"); keys.forEach((k) => parts.push(`\n${k}:\n${objections[k]}`)); parts.push(""); }
  if (script.closing) parts.push("Closing:", script.closing, "");
  if (script.product_notes) parts.push("=== Platform reference (authoritative; never invent offers, rewards or numbers beyond this) ===", script.product_notes, "=== End reference ===", "");
  if (script.behavioral_guidelines) parts.push("=== Behavioural guidelines ===", script.behavioral_guidelines, "=== End guidelines ===", "");
  parts.push(
    "=== Hard safety rules (never break these) ===",
    "Never ask for or accept an OTP, password, PIN, card number, bank details or any payment over the call.",
    "Never promise winnings, guaranteed rewards or money. Only describe the welcome reward exactly as written in the reference.",
    "If the person sounds under 18, stop the pitch politely and end the call.",
    "If they ask whether you are a person, say plainly that you are an AI assistant.",
    "If they ask not to be called again, apologise, confirm you will remove them, and end the call.",
    "Never pressure. One gentle follow-up at most, then accept the answer.",
    "",
    "=== Speaking style (the voice engine reads your text literally) ===",
    "Very short sentences. At most two sentences per turn, then pause and let them speak.",
    "Warm, natural and relaxed. Use full stops for breath pauses, not dashes.",
    "Say amounts in rupees, never Rs. Say WhatsApp as one word.",
    "Once the call has clearly wrapped up, say goodbye once and stop talking.",
    `Speak in clear, natural ${script.language === "hi" ? "Hindi" : script.language === "hinglish" ? "Hinglish (Hindi mixed with English)" : "English"}.`,
  );
  return parts.join("\n");
}

export const OUTCOME_KEYS = [
  "interested_register_today", "interested_register_week", "link_requested", "callback",
  "not_interested_elsewhere", "not_interested_no_games", "not_interested_trust", "not_interested_no_time", "not_interested_other",
  "already_registered", "wrong_number", "do_not_call", "language_barrier", "unclear",
] as const;
export type OutcomeKey = typeof OUTCOME_KEYS[number];

/** A call counts as connected when the contact actually spoke (a "user:" turn in the transcript). */
export function isConnected(transcript: string | null | undefined): boolean {
  return /^user:/im.test(transcript || "");
}

export async function classifyOutcome(transcript: string): Promise<{ outcome: OutcomeKey; summary: string }> {
  const clean = (transcript || "").trim();
  if (clean.length < 30 || !isConnected(clean)) return { outcome: "unclear", summary: "No meaningful conversation." };
  const key = Deno.env.get("GROQ_API_KEY");
  if (!key) return { outcome: "unclear", summary: "Outcome could not be classified (no model key)." };
  const system = [
    "You read a short outbound phone call between an AI assistant and a lead for an online gaming platform and decide the outcome.",
    "Judge only by what the lead (the 'user' turns) actually said. A polite goodbye is not interest.",
    `Return JSON only: {"outcome": one of ${JSON.stringify(OUTCOME_KEYS)}, "summary": "max 25 words"}.`,
    "interested_register_today: agreed to register today. interested_register_week: will register within the week.",
    "link_requested: wants the registration link on WhatsApp. callback: asked to be called at another time.",
    "not_interested_elsewhere: declined because they play on another platform. not_interested_no_games: does not play online games.",
    "not_interested_trust: declined over trust, safety or data worries. not_interested_no_time: declined for lack of time. not_interested_other: declined for another reason.",
    "already_registered: already has an account. wrong_number: not the person or number.",
    "do_not_call: asked not to be called again. language_barrier: could not converse in the available language. unclear: cannot tell.",
  ].join("\n");
  try {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: Deno.env.get("GROQ_MODEL") || "openai/gpt-oss-120b", temperature: 0, max_tokens: 200,
        response_format: { type: "json_object" },
        messages: [{ role: "system", content: system }, { role: "user", content: clean.slice(0, 8000) }],
      }),
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) return { outcome: "unclear", summary: "Outcome could not be classified." };
    const j = await res.json();
    const o = JSON.parse(j?.choices?.[0]?.message?.content ?? "{}");
    const outcome = (OUTCOME_KEYS as readonly string[]).includes(o.outcome) ? (o.outcome as OutcomeKey) : "unclear";
    return { outcome, summary: String(o.summary ?? "").slice(0, 300) };
  } catch {
    return { outcome: "unclear", summary: "Outcome could not be classified." };
  }
}

export interface CallContext {
  system_prompt: string; call_id: string; webhook_url: string; webhook_auth_token: string;
  max_duration_seconds: number | null; language: string | null; tts_voice_id?: string | null;
}

// deno-lint-ignore no-explicit-any
export async function resolveCallContext(supabase: any, callLogId: string): Promise<CallContext | null> {
  const { data: log } = await supabase.from("call_logs").select("id, contact_id, ai_script_id").eq("id", callLogId).maybeSingle();
  if (!log?.ai_script_id) return null;
  const { data: script } = await supabase.from("ai_call_scripts").select("*").eq("id", log.ai_script_id).maybeSingle();
  if (!script) return null;
  const { data: contact } = log.contact_id
    ? await supabase.from("contacts").select("first_name, last_name, city, product").eq("id", log.contact_id).maybeSingle()
    : { data: null };
  return {
    system_prompt: composeGamingPrompt(script as AiScript, contact ?? {}),
    call_id: callLogId,
    webhook_url: `${Deno.env.get("SUPABASE_URL")}/functions/v1/ai-call-webhook`,
    webhook_auth_token: Deno.env.get("AI_CALL_INTERNAL_TOKEN") ?? "",
    max_duration_seconds: (script as AiScript).max_duration_seconds ?? 240,
    language: (script as AiScript).language,
    tts_voice_id: (script as AiScript).voice_id,
  };
}

export function requireInternalToken(req: Request): Response | null {
  const expected = Deno.env.get("AI_CALL_INTERNAL_TOKEN");
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const got = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (got && ((expected && got === expected) || (service && got === service))) return null;
  return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { "Content-Type": "application/json" } });
}

export interface PlaceResult { success: boolean; call_log_id?: string; call_sid?: string; error?: string; skip?: boolean }

/** Applies every guardrail, logs the call, tells the bridge to warm up, then dials through Exotel. */
// deno-lint-ignore no-explicit-any
export async function placeAiCall(supabase: any, params: { orgId: string; contactId: string; scriptId: string; initiatedBy: string | null }): Promise<PlaceResult> {
  const { orgId, contactId, scriptId } = params;
  const cfg = await loadAiConfig(supabase, orgId);
  if (!cfg.enabled) return { success: false, skip: true, error: "AI calling is not switched on for this org" };
  const win = insideCallingWindow(cfg);
  if (!win.inside) return { success: false, error: win.reason };

  const { data: contact } = await supabase.from("contacts").select("id, phone, first_name, do_not_call, opted_out").eq("id", contactId).eq("org_id", orgId).maybeSingle();
  if (!contact?.phone) return { success: false, skip: true, error: "Lead not found or has no phone number" };
  if (contact.do_not_call || contact.opted_out) return { success: false, skip: true, error: "Lead is on the do-not-call list" };

  const callee = normalizeToE164(contact.phone);
  const isTest = cfg.test_numbers.includes(callee);
  if (cfg.mode === "test" && !isTest) return { success: false, skip: true, error: "Test mode: only approved test numbers can be called" };

  if (!cfg.exotel_app_id) return { success: false, error: "The AI phone line is not connected yet (no Exotel Voicebot app set)" };
  const { data: ex } = await supabase.from("exotel_settings").select("api_key, api_token, account_sid, subdomain, caller_id").eq("org_id", orgId).eq("is_active", true).maybeSingle();
  const callerId = cfg.caller_id || ex?.caller_id;
  if (!ex?.api_key || !ex?.api_token || !ex?.account_sid || !callerId) return { success: false, error: "Exotel is not configured for this org" };

  // Self-heal calls stuck in progress, then apply the per-lead rules.
  await supabase.from("call_logs").update({ status: "error" }).eq("contact_id", contactId).eq("caller_type", "ai").in("status", ["initiated", "in-progress"]).lt("created_at", new Date(Date.now() - 15 * 60000).toISOString());
  const { data: prior } = await supabase.from("call_logs").select("status, conversation_duration").eq("contact_id", contactId).eq("caller_type", "ai");
  const calls = prior ?? [];
  if (calls.some((c: { status: string }) => ["initiated", "in-progress"].includes(c.status))) return { success: false, skip: true, error: "An AI call to this lead is already in progress" };
  if (!isTest && calls.some((c: { conversation_duration: number | null }) => (c.conversation_duration ?? 0) >= 5)) return { success: false, skip: true, error: "This lead already connected on an AI call; a human follows up" };
  if (!isTest && calls.length >= cfg.max_attempts) return { success: false, skip: true, error: `Already had ${cfg.max_attempts} AI call attempts` };

  const { data: log, error: insErr } = await supabase.from("call_logs").insert({
    org_id: orgId, contact_id: contactId, caller_type: "ai", call_type: "outbound", direction: "outbound",
    from_number: callerId, to_number: callee, status: "initiated", ai_script_id: scriptId, agent_id: null,
    started_at: new Date().toISOString(),
  }).select("id").single();
  if (insErr || !log) return insErr?.code === "23505" ? { success: false, skip: true, error: "An AI call to this lead is already in progress" } : { success: false, error: "Could not create the call log" };

  // Warm the agent during ring time (best effort; the bridge falls back to asking ai-call-context).
  const bridge = Deno.env.get("VOICE_BRIDGE_URL"); const prep = Deno.env.get("GLOBALCRM_PREPARE_CALL_TOKEN");
  if (bridge && prep) {
    try {
      const ctx = await resolveCallContext(supabase, log.id);
      if (ctx) {
        const r = await fetch(`${bridge}/globalcrm/prepare-call`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${prep}` }, body: JSON.stringify(ctx), signal: AbortSignal.timeout(8000) });
        if (r.ok) { const { room_name } = await r.json(); if (room_name) await supabase.from("call_logs").update({ room_name }).eq("id", log.id); }
      }
    } catch (e) { console.warn("prepare-call failed, bridge will resolve on answer:", e); }
  }

  const sub = ex.subdomain || "api.in.exotel.com";
  const res = await fetch(`https://${sub}/v1/Accounts/${ex.account_sid}/Calls/connect.json`, {
    method: "POST",
    headers: { Authorization: `Basic ${btoa(`${ex.api_key}:${ex.api_token}`)}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ From: callee, CallerId: callerId, Url: `http://my.exotel.com/${ex.account_sid}/exoml/start_voice/${cfg.exotel_app_id}` }).toString(),
    signal: AbortSignal.timeout(20000),
  }).catch((e) => e as Error);
  if (res instanceof Error) { await supabase.from("call_logs").update({ status: "error" }).eq("id", log.id); return { success: false, error: String(res.message) }; }
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.Call?.Sid) {
    await supabase.from("call_logs").update({ status: "error", exotel_raw_data: body }).eq("id", log.id);
    return { success: false, error: body?.RestException?.Message || "Exotel could not start the call" };
  }
  await supabase.from("call_logs").update({ exotel_call_sid: body.Call.Sid, status: "in-progress", exotel_raw_data: body }).eq("id", log.id);
  return { success: true, call_log_id: log.id, call_sid: body.Call.Sid };
}
