// Converts IEDUP beneficiary names to Devanagari AFTER upload (so the upload
// itself is instant). Finds contacts whose name_hi isn't yet Hindi, converts
// them in batches via the transliterate-names function, and writes them back.
// Invoked right after an import (fire-and-forget from the UI) and on a 5-min
// cron as a backstop. Public (cron calls it unauthenticated) -> verify_jwt=false.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.58.0";
import { IEDUP_ORG_ID } from "../_shared/aiCalling.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BATCH = 100;          // keep the AI response well under max_tokens (500 truncates → JSON fails)
const MAX_PER_RUN = 500;    // ~5 AI calls/invocation; stay within the function time budget

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceKey);
  if (!Deno.env.get("GROQ_API_KEY") && !Deno.env.get("CEREBRAS_API_KEY")) {
    return done(500, { ok: false, error: "GROQ_API_KEY / CEREBRAS_API_KEY missing" });
  }

  // Allow an explicit org override; default to IEDUP (the only Hindi-name org).
  let orgId = IEDUP_ORG_ID;
  try { const b = await req.json(); if (b?.org_id) orgId = b.org_id as string; } catch { /* no body */ }

  let processed = 0, converted = 0, batches = 0;
  while (processed < MAX_PER_RUN) {
    const { data: pending, error } = await supabase
      .rpc("get_contacts_needing_translit", { p_org: orgId, p_limit: BATCH });
    if (error) return done(500, { ok: false, error: error.message, processed, converted });
    const rows = (pending || []) as Array<{ id: string; name_en: string }>;
    if (rows.length === 0) break;

    // Convert via the existing transliterate-names fn (service-role auth).
    const namesHi = await transliterateBatch(rows.map((r) => r.name_en));

    // Only write rows we actually converted to Devanagari (skip fallbacks so a
    // failed batch is retried next run rather than stuck on English).
    const ids: string[] = [];
    const hi: string[] = [];
    for (let i = 0; i < rows.length; i++) {
      const v = (namesHi[i] || "").trim();
      if (v && hasDevanagari(v)) { ids.push(rows[i].id); hi.push(v); }
    }
    if (ids.length > 0) {
      const { data: n, error: upErr } = await supabase.rpc("apply_name_hi", { p_ids: ids, p_names: hi });
      if (upErr) return done(500, { ok: false, error: upErr.message, processed, converted });
      converted += (n as number) ?? ids.length;
    }

    processed += rows.length;
    batches++;
    // If a whole batch fell back (none converted), stop to avoid a hot loop.
    if (ids.length === 0) break;
  }

  return done(200, { ok: true, org_id: orgId, batches, processed, converted });
});

// True if the string contains any Devanagari character (block U+0900-U+097F).
// Uses char codes (pure ASCII source) so it survives any deploy encoding.
function hasDevanagari(s: string): boolean {
  for (const ch of s) {
    const c = ch.charCodeAt(0);
    if (c >= 0x900 && c <= 0x97f) return true;
  }
  return false;
}

// Transliterate English names to Devanagari, Groq first with Cerebras as
// fallback (same approach as the transliterate-names fn). Returns one entry
// per input; falls back to the English name on any failure so a bad batch is
// retried (not written) later.
async function transliterateBatch(names: string[]): Promise<string[]> {
  if (names.length === 0) return [];
  const system =
    "You transliterate Indian personal names from English (Latin script) to Hindi (Devanagari script). " +
    "Output ONLY a JSON object with one key, \"names\", a string array of the same length and order as the input. " +
    "No prose, no markdown, no code fences.";
  const user = [
    "Transliterate each name to Devanagari. Do not translate. Keep first + last name as separate words.",
    "Use standard north-Indian Hindi spelling. If already Devanagari, return unchanged.",
    "Return strict JSON: {\"names\": [\"...\"]} same length/order as input.",
    "",
    "Names:",
    ...names.map((n, i) => `${i + 1}. ${n}`),
  ].join("\n");
  try {
    const text = (await callGroqText(system, user, 4096)) ?? (await callCerebrasText(system, user, 4096));
    if (text === null) return names.slice();
    const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
    const parsed = JSON.parse(cleaned);
    const out = Array.isArray(parsed?.names) ? parsed.names : [];
    return names.map((src, i) => (typeof out[i] === "string" && out[i].trim() ? out[i].trim() : src));
  } catch {
    return names.slice();
  }
}

// Text-only tier: Groq first, Cerebras as the fallback if Groq is
// unavailable/errors. Both are OpenAI-compatible chat-completions APIs.
async function callGroqText(system: string, userContent: string, maxTokens: number): Promise<string | null> {
  const key = Deno.env.get("GROQ_API_KEY");
  if (!key) return null;
  try {
    const resp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        max_tokens: maxTokens,
        temperature: 0,
        messages: [
          { role: "system", content: system },
          { role: "user", content: userContent },
        ],
      }),
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    return data.choices?.[0]?.message?.content ?? null;
  } catch {
    return null;
  }
}

async function callCerebrasText(system: string, userContent: string, maxTokens: number): Promise<string | null> {
  const key = Deno.env.get("CEREBRAS_API_KEY");
  if (!key) return null;
  try {
    const resp = await fetch("https://api.cerebras.ai/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gemma-4-31b",
        max_tokens: maxTokens,
        temperature: 0,
        messages: [
          { role: "system", content: system },
          { role: "user", content: userContent },
        ],
      }),
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    return data.choices?.[0]?.message?.content ?? null;
  } catch {
    return null;
  }
}

function done(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
