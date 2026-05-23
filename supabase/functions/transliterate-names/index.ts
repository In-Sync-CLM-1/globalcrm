// Transliterates English names to Devanagari (Hindi script) for use by the Bolna
// voice agent. Uses Anthropic Claude Haiku — fast, cheap, accurate for Indic
// transliteration. Falls back to the original English on failure so the upload
// still succeeds; user can hand-correct in the preview.
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

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) return json(500, { error: "ANTHROPIC_API_KEY missing" });

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
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5",
        max_tokens: 4096,
        temperature: 0,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userPrompt }],
      }),
    });

    if (!r.ok) {
      const text = await r.text();
      console.error("anthropic error:", r.status, text);
      return json(200, { names_hi: names.slice() });
    }

    const data = await r.json();
    // Claude returns content as an array of blocks; concatenate text blocks.
    const text = Array.isArray(data?.content)
      ? data.content.filter((b: any) => b?.type === "text").map((b: any) => b.text).join("")
      : "";
    // Strip code fences if the model added them, then parse.
    const cleaned = text
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();
    let parsed: { names?: string[] } = {};
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      console.error("anthropic returned non-JSON:", text);
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

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
