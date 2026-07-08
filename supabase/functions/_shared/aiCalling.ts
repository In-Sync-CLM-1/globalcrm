// Shared helpers for AI calling: working-window gate, Bolna agent provisioning, call dispatch.

export const INSYNC_DEMO_ORG_ID = "61f7f96d-e80c-4d9b-a765-8eb32bd3c70d";
export const IEDUP_ORG_ID = "6dcf4229-6902-4cd4-9c7f-2d6ed4a6045d";
// Orgs whose AI-call minutes are billed to the wallet (₹3/min). Internal/demo
// orgs (e.g. In-Sync Demo) are intentionally excluded.
export const BILLABLE_CALL_ORG_IDS = new Set<string>([IEDUP_ORG_ID]);
// Internal / demo orgs. Their AI minutes are not billed, so the dialer must
// never halt them on subscription status or wallet balance. Marked internal
// 2026-05-26 to stop the wallet gate freezing In-Sync Demo's calling.
export const INTERNAL_ORG_IDS = new Set<string>([INSYNC_DEMO_ORG_ID]);
export const BOLNA = "https://api.bolna.ai";
// Exotel "Agentic Call" ExoPhone — required as from_phone_number; Exotel routes channels automatically.
export const DEFAULT_FROM_NUMBER = "+911169323462";
// Targets
export const DAILY_CONNECTED_TARGET = 80;
// Connected = call duration above this threshold (seconds). Below = no-answer / hangup.
export const CONNECTED_THRESHOLD_SEC = 5;
// How many calls to keep queued ahead of the in-flight ones
export const QUEUE_DEPTH = 25;
// How many concurrent calls to keep in flight (read from env so it can be raised for a burst day without redeploy)
export function getConcurrency(): number {
  const v = parseInt(Deno.env.get("AI_CONCURRENCY") ?? "1", 10);
  return Number.isFinite(v) && v >= 1 ? Math.min(v, 20) : 1;
}

export interface WindowSlot {
  start_min: number;
  end_min: number;
}

/**
 * Org-aware window check. `windows` is an array of {start_min, end_min} entries
 * in IST minutes since midnight. Sunday is always a no-call day across all orgs.
 */
export function isInsideCustomWindow(
  windows: WindowSlot[] | null | undefined,
  now: Date = new Date(),
): { inside: boolean; reason: string } {
  if (nowIstDayOfWeek(now) === 0) {
    return { inside: false, reason: "Sunday — no calling" };
  }
  const list = Array.isArray(windows) ? windows : [];
  if (list.length === 0) {
    return { inside: false, reason: "no calling windows configured" };
  }
  const m = nowIstMinutesSinceMidnight(now);
  for (const w of list) {
    const s = Number(w?.start_min);
    const e = Number(w?.end_min);
    if (!Number.isFinite(s) || !Number.isFinite(e)) continue;
    if (m >= s && m < e) {
      return {
        inside: true,
        reason: `inside window ${formatIstMin(s)}-${formatIstMin(e)} IST`,
      };
    }
  }
  const summary = list
    .map((w) => `${formatIstMin(Number(w.start_min))}-${formatIstMin(Number(w.end_min))}`)
    .join(", ");
  return { inside: false, reason: `outside configured windows (${summary}) IST` };
}

/**
 * Returns true if the current moment is inside the AI calling window in IST.
 * Window: 11:00–13:30 IST (window 1), 15:00–17:00 IST (window 2). Lunch break in between.
 * Mon–Sat only — no calling on Sunday.
 * Equivalent UTC: 05:30–08:00 (window 1), 09:30–11:30 (window 2).
 */
export function isInsideWorkingWindow(now: Date = new Date()): { inside: boolean; window: 1 | 2 | null; reason: string } {
  if (nowIstDayOfWeek(now) === 0) {
    return { inside: false, window: null, reason: "Sunday — no calling" };
  }
  const istMinutes = nowIstMinutesSinceMidnight(now);
  // Window 1: 11:00 (660) – 13:30 (810)
  if (istMinutes >= 660 && istMinutes < 810) {
    return { inside: true, window: 1, reason: "inside window 1 (11:00-13:30 IST)" };
  }
  // Window 2 end is env-tunable so we can extend on short notice (default 17:00 = 1020).
  const win2End = parseInt(Deno.env.get("AI_WINDOW2_END_MIN") ?? "1020", 10);
  const win2EndMin = Number.isFinite(win2End) && win2End >= 900 && win2End <= 1440 ? win2End : 1020;
  if (istMinutes >= 900 && istMinutes < win2EndMin) {
    return { inside: true, window: 2, reason: `inside window 2 (15:00-${formatIstMin(win2EndMin)} IST)` };
  }
  if (istMinutes >= 810 && istMinutes < 900) {
    return { inside: false, window: null, reason: "lunch break (13:30-15:00 IST)" };
  }
  return { inside: false, window: null, reason: `outside business hours (11:00-${formatIstMin(win2EndMin)} IST)` };
}

function formatIstMin(m: number): string {
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

export function nowIstMinutesSinceMidnight(now: Date = new Date()): number {
  // IST = UTC + 5:30
  const utcMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  return (utcMinutes + 5 * 60 + 30) % (24 * 60);
}

// 0 = Sunday, 1 = Monday, … 6 = Saturday, in IST.
export function nowIstDayOfWeek(now: Date = new Date()): number {
  const utcMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  const istTotal = utcMinutes + 5 * 60 + 30;
  const dayShift = Math.floor(istTotal / (24 * 60));
  return (now.getUTCDay() + dayShift) % 7;
}

export function normalizePhone(p: string | null | undefined): string | null {
  if (!p) return null;
  const trimmed = p.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("+")) return trimmed;
  const digits = trimmed.replace(/\D/g, "");
  if (digits.startsWith("91") && digits.length === 12) return `+${digits}`;
  if (digits.length === 10) return `+91${digits}`;
  return trimmed;
}

export function bolnaHeaders(key: string): HeadersInit {
  return { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
}

export interface ScriptRow {
  id: string;
  org_id: string;
  name: string;
  objective: string;
  opening: string;
  key_points: unknown;
  objection_handling: unknown;
  closing: string | null;
  product_name: string | null;
  owner_id: string | null;
  product_notes: string | null;
  voice_id: string | null;
  voice_name: string | null;
  language: string | null;
  max_duration_seconds: number | null;
  bolna_agent_id: string | null;
  behavioral_guidelines?: string | null;
}

export function composeSystemPrompt(script: ScriptRow): string {
  const keyPoints = Array.isArray(script.key_points) ? (script.key_points as string[]) : [];
  const objections = (script.objection_handling && typeof script.objection_handling === "object")
    ? (script.objection_handling as Record<string, string>)
    : {};

  const productLabel = script.product_name || "our product";
  const parts: string[] = [
    `You are an AI sales agent for ${productLabel}, calling {first_name} {last_name} from {company}.`,
    `Your objective: ${script.objective}`,
    "",
    "Opening line:",
    script.opening,
    "",
  ];

  if (keyPoints.length > 0) {
    parts.push("Key talking points (weave these in naturally):");
    for (const p of keyPoints) parts.push(`- ${p}`);
    parts.push("");
  }

  const objKeys = Object.keys(objections);
  if (objKeys.length > 0) {
    parts.push("If they raise objections, here is how to respond:");
    for (const k of objKeys) parts.push(`\n${k}:\n${objections[k]}`);
    parts.push("");
  }

  if (script.closing) {
    parts.push("Closing:");
    parts.push(script.closing);
    parts.push("");
  }

  if (script.product_notes) {
    parts.push("=== Product Reference (use this to answer detailed questions during the call. Treat these facts as authoritative; never invent pricing, features, or customer names outside this section.) ===");
    parts.push(script.product_notes);
    parts.push("=== End Product Reference ===");
    parts.push("");
  }

  if (script.behavioral_guidelines) {
    parts.push("=== Behavioral guidelines (how to handle the call, not what to say) ===");
    parts.push(script.behavioral_guidelines);
    parts.push("=== End behavioral guidelines ===");
    parts.push("");
  }

  parts.push(
    "=== Speaking style ===",
    "Speak naturally and conversationally, like a warm, professional sales rep — not a script reader.",
    "Listen actively. Imagine you are talking to a busy operations head.",
    "End each thought clearly so the prospect has a chance to respond.",
    "",
    "=== Ending the call ===",
    "Once the conversation has clearly wrapped up, say goodbye ONCE and then stop talking — do not keep responding.",
    "If the other party only repeats short closings ('bye', 'goodbye', 'ok', silence) and adds nothing new, do not reply again; let the call end. Never trade goodbyes back and forth.",
    "",
    "=== Pronunciation rules (the synthesizer reads your text literally) ===",
    "Say \"WorkSync\" as one word.",
    "Say \"H R\" letter by letter — write \"H R\" with a space.",
    "Say \"rupees\" always. Never write \"Rs\".",
    "Say \"WhatsApp\" as one word.",
    "For amounts and numbers, prefer spoken form.",
    "",
    `Speak in clear, natural ${script.language === "hi" ? "Hindi" : "English"}.`,
  );

  return parts.join("\n");
}

export interface AgentCreateInput {
  script: ScriptRow;
  webhookUrl: string;
}

export async function createBolnaAgent(bolnaKey: string, input: AgentCreateInput): Promise<string> {
  const { script, webhookUrl } = input;
  const systemPrompt = composeSystemPrompt(script);
  const welcomeMessage = script.opening || "Hello, do you have a moment to talk?";

  const agentBody = {
    agent_config: {
      agent_name: `gcrm-${script.id.slice(0, 8)}-${Date.now()}`,
      agent_welcome_message: welcomeMessage,
      webhook_url: webhookUrl,
      tasks: [{
        task_type: "conversation",
        toolchain: { execution: "parallel", pipelines: [["transcriber", "llm", "synthesizer"]] },
        tools_config: {
          input: { provider: "exotel", format: "wav", samples_per_second: 8000 },
          output: { provider: "exotel", format: "wav", samples_per_second: 8000 },
          llm_agent: {
            agent_type: "simple_llm_agent",
            agent_flow_type: "streaming",
            llm_config: {
              family: "openai",
              model: "gpt-4o-mini",
              temperature: 0.4,
              // Cap responses tight so the AI stays in two-sentence territory
              // and doesn't go on after the prospect agrees.
              max_tokens: 150,
            },
          },
          transcriber: {
            provider: "deepgram",
            model: "nova-2",
            language: script.language || "en",
            stream: true,
            encoding: "linear16",
            endpointing: 400,
          },
          synthesizer: {
            provider: "elevenlabs",
            stream: true,
            // Bolna's default 40-char buffer is too small for ElevenLabs streaming
            // — produces audible mid-sentence pauses on bursty LLM tokens.
            buffer_size: 250,
            provider_config: {
              voice: script.voice_name || "Riya Rao - Professional Voice",
              voice_id: script.voice_id || "vYENaCJHl4vFKNDYPr8y",
              model: "eleven_turbo_v2_5",
            },
          },
        },
        task_config: {
          hangup_after_silence: 10,
          call_terminate: script.max_duration_seconds || 240,
          backchanneling: false,
          check_if_user_online: false,
        },
      }],
    },
    agent_prompts: {
      task_1: { system_prompt: systemPrompt },
    },
  };

  const res = await fetch(`${BOLNA}/v2/agent`, {
    method: "POST",
    headers: bolnaHeaders(bolnaKey),
    body: JSON.stringify(agentBody),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Bolna agent create failed: ${res.status} ${text}`);
  let json: { agent_id?: string; id?: string };
  try { json = JSON.parse(text); } catch { throw new Error(`Bolna agent response not JSON: ${text}`); }
  const id = json.agent_id ?? json.id;
  if (!id) throw new Error(`Bolna agent response missing id: ${text}`);
  return id;
}

export interface TriggerCallInput {
  agentId: string;
  toNumber: string;
  fromNumber?: string;
  contact: {
    id: string;
    first_name?: string | null;
    last_name?: string | null;
    name_hi?: string | null;
    company?: string | null;
    job_title?: string | null;
  };
  callLogId: string;
}

export async function triggerBolnaCall(
  bolnaKey: string,
  input: TriggerCallInput,
): Promise<{ execution_id?: string; error?: string }> {
  // When name_hi is set, the Bolna agent's prompt is in Devanagari and the
  // synthesizer needs the same script — pass name_hi as first_name so the
  // LLM produces Hindi-pronunciation tokens for ElevenLabs.
  const firstNameForBolna = input.contact.name_hi
    ? input.contact.name_hi
    : (input.contact.first_name ?? "");
  const callBody = {
    agent_id: input.agentId,
    recipient_phone_number: input.toNumber,
    from_phone_number: input.fromNumber || DEFAULT_FROM_NUMBER,
    user_data: {
      contact_id: input.contact.id,
      call_log_id: input.callLogId,
      first_name: firstNameForBolna,
      last_name: input.contact.last_name ?? "",
      company: input.contact.company ?? "your company",
      job_title: input.contact.job_title ?? "",
    },
  };

  const res = await fetch(`${BOLNA}/call`, {
    method: "POST",
    headers: bolnaHeaders(bolnaKey),
    body: JSON.stringify(callBody),
  });
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try { json = JSON.parse(text); } catch { /* keep raw */ }
  if (!res.ok) return { error: `${res.status}: ${text}` };
  const execId = (json.execution_id as string) ?? (json.run_id as string);
  if (!execId) return { error: `No execution_id in Bolna response: ${text}` };
  return { execution_id: execId };
}
