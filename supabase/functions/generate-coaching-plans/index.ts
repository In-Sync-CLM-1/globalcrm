import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.58.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const INSYNC_DEMO_ORG_ID = "61f7f96d-e80c-4d9b-a765-8eb32bd3c70d";
const GROQ_MODEL = "llama-3.3-70b-versatile";
const CEREBRAS_MODEL = "gemma-4-31b";
const MIN_CALLS = 5;
const LOOKBACK_DAYS = 60;
const MAX_CALLS_PER_AGENT = 30; // most recent N to keep prompt size in check
const TRANSCRIPT_SAMPLE_CHARS = 600; // per call snippet

const COACHING_SYSTEM_PROMPT = `You are a sales coach for an Indian B2B SaaS team. You review a portfolio of an SDR's recent outbound calls (each with a quality score 1–10, tone classification, summary, objections raised, and a transcript snippet) and produce a personalized coaching plan.

# Your goals
- Identify what this SDR does well so the team can reinforce those behaviors.
- Identify the 2–4 most important things this SDR needs to fix, grounded in concrete patterns visible in their actual calls.
- Convert those into practical drills and role-play scenarios the SDR can rehearse with a peer or manager.
- Be specific. Reference call patterns and objections that you actually see in the data — not generic sales advice.
- Be respectful and constructive. The plan will be shown to the SDR.

# Field guidance

## strengths (array of 2–3 short bullets)
Things this SDR consistently does well across their calls. Each bullet is one sentence, concrete. Examples:
- "Opens calls with a clear, confident greeting and self-identification."
- "Handles 'send me an email' objection by getting commitment to a follow-up call first."

## weaknesses (array of 3 objects, each {pattern, evidence, fix})
The 3 most important things to work on. For each:
- pattern: one-sentence description of the behavior. e.g. "Cuts the discovery question short when the prospect pushes back on pricing."
- evidence: one sentence pointing to what you saw in the calls. e.g. "Visible in 4 of 12 calls — all dropped to score 3–4 once 'too expensive' came up."
- fix: one or two sentences of concrete behavior change. e.g. "Acknowledge the price concern, then ask 'before we get there, can I understand what tools you're using today?' Re-route to discovery before defending price."

## drills (array of 3–5 short bullets)
Tactical things the SDR should practice this week. Each is one sentence — a script line to memorize, a specific question to land, a habit to break. Examples:
- "Memorize and use this opener: 'Hi <name>, this is <X> from In-Sync — quick reason for my call, do you have 30 seconds?'"
- "End every call with one of these three explicit next steps: demo booked, callback scheduled, or opt-out confirmed."
- "Stop saying 'just checking in' — replace with a specific reason for the follow-up."

## role_play_scenarios (array of 3 objects, each {scenario, why, success_criteria})
Three concrete prospect scenarios the SDR should role-play, drawn from objections or call types they actually struggled with.
- scenario: 2–3 sentences describing what the role-play partner should do/say as the prospect.
- why: one sentence on why this matters for this SDR — point to the call evidence.
- success_criteria: one sentence on what a "passing" outcome looks like.

# Format
- Respond ONLY with JSON matching the schema. No prose around it.
- Ground every claim in patterns visible in the data. If you can't find evidence for a weakness, drop it — don't pad to three.
- Keep total content tight. The whole plan should be readable in 2 minutes.`;

interface CallRow {
  id: string;
  agent_id: string;
  analysis_quality_score: number;
  analysis_tone: string;
  analysis_summary: string;
  analysis_objections: string[];
  analysis_script_adherence: string;
  analysis_next_step: string;
  transcript: string;
  created_at: string;
}

interface CoachingPlan {
  strengths: string[];
  weaknesses: Array<{ pattern: string; evidence: string; fix: string }>;
  drills: string[];
  role_play_scenarios: Array<{ scenario: string; why: string; success_criteria: string }>;
}

function dominant<T>(items: T[]): T | null {
  if (items.length === 0) return null;
  const counts = new Map<T, number>();
  for (const x of items) counts.set(x, (counts.get(x) || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

function topObjections(allObjections: string[], n: number): Array<{ objection: string; count: number }> {
  const counts = new Map<string, number>();
  for (const o of allObjections) {
    const k = o.trim();
    if (!k) continue;
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([objection, count]) => ({ objection, count }));
}

function buildUserMessage(calls: CallRow[]): string {
  const lines: string[] = [];
  lines.push(`This SDR has ${calls.length} analyzed calls in the last ${LOOKBACK_DAYS} days.`);
  lines.push("");
  lines.push("Here are the individual call analyses (most recent first):");
  lines.push("");
  calls.forEach((c, idx) => {
    lines.push(`---`);
    lines.push(`Call ${idx + 1} — score ${c.analysis_quality_score}/10, tone: ${c.analysis_tone}`);
    lines.push(`Summary: ${c.analysis_summary}`);
    if (c.analysis_objections && c.analysis_objections.length > 0) {
      lines.push(`Objections raised: ${c.analysis_objections.join(", ")}`);
    }
    lines.push(`Script adherence: ${c.analysis_script_adherence}`);
    lines.push(`Next step recorded: ${c.analysis_next_step}`);
    const snippet = (c.transcript || "").replace(/\s+/g, " ").slice(0, TRANSCRIPT_SAMPLE_CHARS);
    if (snippet) {
      lines.push(`Transcript snippet: ${snippet}${(c.transcript || "").length > TRANSCRIPT_SAMPLE_CHARS ? "…" : ""}`);
    }
    lines.push("");
  });
  lines.push("Generate the coaching plan as structured JSON per the schema.");
  return lines.join("\n");
}

// Text-only tier: Groq first, Cerebras as the fallback if Groq is
// unavailable/errors. Both are OpenAI-compatible chat-completions APIs.
async function callGroqText(userContent: string): Promise<string | null> {
  const key = Deno.env.get("GROQ_API_KEY");
  if (!key) return null;
  const resp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: GROQ_MODEL,
      max_tokens: 2048,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: COACHING_SYSTEM_PROMPT },
        { role: "user", content: userContent },
      ],
    }),
  });
  if (!resp.ok) {
    console.error(`Groq coaching failed: ${resp.status} ${await resp.text()}`);
    return null;
  }
  const data = await resp.json();
  return data.choices?.[0]?.message?.content ?? null;
}

async function callCerebrasText(userContent: string): Promise<string | null> {
  const key = Deno.env.get("CEREBRAS_API_KEY");
  if (!key) return null;
  const resp = await fetch("https://api.cerebras.ai/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: CEREBRAS_MODEL,
      max_tokens: 2048,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: COACHING_SYSTEM_PROMPT },
        { role: "user", content: userContent },
      ],
    }),
  });
  if (!resp.ok) {
    console.error(`Cerebras coaching failed: ${resp.status} ${await resp.text()}`);
    return null;
  }
  const data = await resp.json();
  return data.choices?.[0]?.message?.content ?? null;
}

async function generatePlan(calls: CallRow[]): Promise<CoachingPlan> {
  const userContent = buildUserMessage(calls);
  const text = (await callGroqText(userContent)) ?? (await callCerebrasText(userContent));
  if (text === null) {
    throw new Error("Both Groq and Cerebras coaching calls failed");
  }
  return JSON.parse(text) as CoachingPlan;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  if (!Deno.env.get("GROQ_API_KEY") && !Deno.env.get("CEREBRAS_API_KEY")) {
    return new Response(
      JSON.stringify({ error: "GROQ_API_KEY / CEREBRAS_API_KEY missing" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  // Optional: regenerate for a single agent if specified
  let targetAgentId: string | null = null;
  if (req.method === "POST") {
    try {
      const body = await req.json();
      if (body?.agent_id) targetAgentId = body.agent_id;
    } catch (_e) {
      // no body or bad JSON — ignore
    }
  }

  const sinceISO = new Date(Date.now() - LOOKBACK_DAYS * 86400000).toISOString();

  let query = supabase
    .from("call_logs")
    .select(`
      id, agent_id, created_at,
      analysis_quality_score, analysis_tone, analysis_summary,
      analysis_objections, analysis_script_adherence, analysis_next_step,
      transcript
    `)
    .eq("org_id", INSYNC_DEMO_ORG_ID)
    .eq("analysis_status", "ok")
    .gte("created_at", sinceISO)
    .not("agent_id", "is", null)
    .order("created_at", { ascending: false });

  if (targetAgentId) query = query.eq("agent_id", targetAgentId);

  const { data: allCalls, error: callsErr } = await query;
  if (callsErr) {
    return new Response(
      JSON.stringify({ error: callsErr.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  // Group by agent
  const byAgent: Record<string, CallRow[]> = {};
  for (const c of (allCalls || []) as CallRow[]) {
    if (!c.agent_id) continue;
    (byAgent[c.agent_id] ||= []).push(c);
  }

  const results: Array<{ agent_id: string; status: string; error?: string }> = [];

  for (const [agentId, calls] of Object.entries(byAgent)) {
    if (calls.length < MIN_CALLS) {
      results.push({ agent_id: agentId, status: "skipped_too_few_calls" });
      continue;
    }

    const sampled = calls.slice(0, MAX_CALLS_PER_AGENT);
    const avg =
      sampled.reduce((s, c) => s + (c.analysis_quality_score || 0), 0) / sampled.length;
    const tones = sampled.map((c) => c.analysis_tone).filter(Boolean);
    const tone = dominant(tones);
    const objections = sampled.flatMap((c) => c.analysis_objections || []);
    const topObj = topObjections(objections, 8);

    try {
      const plan = await generatePlan(sampled);

      await supabase
        .from("agent_coaching_plans")
        .upsert(
          {
            org_id: INSYNC_DEMO_ORG_ID,
            agent_id: agentId,
            calls_analyzed: sampled.length,
            avg_quality_score: Number(avg.toFixed(1)),
            dominant_tone: tone,
            top_objections: topObj,
            strengths: plan.strengths,
            weaknesses: plan.weaknesses,
            drills: plan.drills,
            role_play_scenarios: plan.role_play_scenarios,
            generated_at: new Date().toISOString(),
            generation_error: null,
          },
          { onConflict: "org_id,agent_id" },
        );
      results.push({ agent_id: agentId, status: "ok" });
    } catch (err: any) {
      const msg = err?.message || String(err);
      await supabase
        .from("agent_coaching_plans")
        .upsert(
          {
            org_id: INSYNC_DEMO_ORG_ID,
            agent_id: agentId,
            calls_analyzed: sampled.length,
            avg_quality_score: Number(avg.toFixed(1)),
            dominant_tone: tone,
            top_objections: topObj,
            generation_error: msg.slice(0, 500),
            generated_at: new Date().toISOString(),
          },
          { onConflict: "org_id,agent_id" },
        );
      results.push({ agent_id: agentId, status: "failed", error: msg });
    }
  }

  return new Response(
    JSON.stringify({
      ok: true,
      agents_processed: results.length,
      results,
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
