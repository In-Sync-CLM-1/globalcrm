// Transliterates English names to Devanagari (Hindi script) for use by the Bolna
// voice agent. Uses Groq first, Cerebras as fallback — fast, cheap, accurate for
// Indic transliteration. Falls back to the original English on failure so the
// upload still succeeds; user can hand-correct in the preview.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface ReqBody {
  names: string[];
}

const SYSTEM_PROMPT =
  "You transliterate Indian personal names from English (Latin script) to Hindi (Devanagari script). " +
  "You output ONLY a JSON object with one key, \"names\", containing a string array of the same length and order " +
  "as the input. No prose, no markdown, no code fences — just the JSON.";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  if (!Deno.env.get("GROQ_API_KEY") && !Deno.env.get("CEREBRAS_API_KEY")) {
    return json(500, { error: "GROQ_API_KEY / CEREBRAS_API_KEY missing" });
  }

  let body: ReqBody;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "Invalid JSON body" });
  }
  const names = Array.isArray(body?.names) ? body.names : [];
  if (names.length === 0) return json(200, { names_hi: [] });
  if (names.length > 500) return json(400, { error: "Max 500 names per call" });

  const userPrompt = [
    "Transliterate each of these names to Devanagari. Rules:",
    "1. Output Devanagari only. Do not translate. \"Vibhu Dixit\" → \"विभु दीक्षित\".",
    "2. Keep first-name + last-name as separate words with a single space.",
    "3. Use the standard north-Indian Hindi spelling. For ambiguous names, pick the most common Hindi-belt form.",
    "4. If a name is already in Devanagari, return it unchanged.",
    "5. Return strict JSON: {\"names\": [\"...\", \"...\"]} with the same length and order as the input.",
    "",
    "Names:",
    ...names.map((n, i) => `${i + 1}. ${n}`),
  ].join("\n");

  try {
    const text = (await callGroqText(SYSTEM_PROMPT, userPrompt, 4096)) ?? (await callCerebrasText(SYSTEM_PROMPT, userPrompt, 4096));
    if (text === null) {
      return json(200, { names_hi: names.slice() });
    }
    // Strip code fences if the model added them, then parse.
    const cleaned = text
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();
    let parsed: { names?: string[] } = {};
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      console.error("model returned non-JSON:", text);
      return json(200, { names_hi: names.slice() });
    }

    const out = Array.isArray(parsed.names) ? parsed.names : [];
    const aligned: string[] = names.map((src, i) => {
      const v = out[i];
      return typeof v === "string" && v.trim() ? v.trim() : src;
    });

    return json(200, { names_hi: aligned });
  } catch (e) {
    console.error("transliterate exception:", String(e));
    return json(200, { names_hi: names.slice() });
  }
});

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
    if (!resp.ok) {
      console.error("groq error:", resp.status, await resp.text());
      return null;
    }
    const data = await resp.json();
    return data.choices?.[0]?.message?.content ?? null;
  } catch (e) {
    console.error("groq exception:", String(e));
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
    if (!resp.ok) {
      console.error("cerebras error:", resp.status, await resp.text());
      return null;
    }
    const data = await resp.json();
    return data.choices?.[0]?.message?.content ?? null;
  } catch (e) {
    console.error("cerebras exception:", String(e));
    return null;
  }
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
