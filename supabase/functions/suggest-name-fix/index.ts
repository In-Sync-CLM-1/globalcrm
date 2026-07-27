// Proposes the most likely intended spelling for IEDUP beneficiary names that
// arrived damaged in a CSV — the "?" / replacement-character case, where the
// original characters were destroyed by a non-UTF-8 save and cannot be
// recovered by decoding (mojibake, which CAN be decoded exactly, is repaired
// client-side and never reaches this function).
//
// Every result is a SUGGESTION shown to a human for confirmation. Nothing here
// is auto-applied: these are real beneficiaries of a government scheme, and a
// guessed name would go out in a WhatsApp message or be read aloud by the AI
// caller. Called from the IEDUP upload preview, so it stays authenticated.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MAX_NAMES = 200; // bounds cost/latency on a large damaged upload

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) return done(500, { ok: false, error: "ANTHROPIC_API_KEY missing" });

  let names: string[] = [];
  try {
    const body = await req.json();
    names = Array.isArray(body?.names) ? body.names.filter((n: unknown) => typeof n === "string") : [];
  } catch {
    return done(400, { ok: false, error: "Expected a JSON body with a names array." });
  }
  if (names.length === 0) return done(200, { ok: true, suggestions: [] });
  if (names.length > MAX_NAMES) names = names.slice(0, MAX_NAMES);

  const system = [
    "You repair Indian personal names that were damaged when a spreadsheet was saved in the wrong",
    "character encoding. The damage replaced characters with '?' or the Unicode replacement character.",
    "These are beneficiaries of a government skills scheme in Uttar Pradesh, India, so the names are",
    "common north-Indian names, written either in English (Latin script) or Hindi (Devanagari).",
    "",
    "For each damaged name, propose the single most likely intended spelling. Reconstruct only what the",
    "surviving characters, name length, and common north-Indian naming patterns actually support.",
    "Preserve the script: if the surviving characters are Latin, answer in Latin; if Devanagari, answer",
    "in Devanagari. Keep the same number of words where the damage makes that clear.",
    "",
    "A wrong guess reaches a real person, so report honestly how sure you are:",
    "- high:   the surviving characters leave essentially one plausible name (e.g. 'Ram ?umar' -> 'Ram Kumar')",
    "- medium: a common name fits well, but another is plausible",
    "- low:    too much is destroyed to reconstruct with confidence — a human must retype it",
    "Never inflate confidence. If a name is unrecoverable, still return your best attempt with 'low'.",
  ].join("\n");

  const user = [
    "Propose the intended spelling for each damaged name below.",
    "Return one entry per input, using the same 1-based index shown here.",
    "",
    ...names.map((n, i) => `${i + 1}. ${n}`),
  ].join("\n");

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "claude-opus-5",
        // Thinking is on by default on Opus 5 and shares this budget with the
        // response, so leave headroom well past the JSON itself.
        max_tokens: 8000,
        system,
        messages: [{ role: "user", content: user }],
        output_config: {
          effort: "low",
          format: {
            type: "json_schema",
            schema: {
              type: "object",
              properties: {
                suggestions: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      index: { type: "integer" },
                      suggestion: { type: "string" },
                      confidence: { type: "string", enum: ["high", "medium", "low"] },
                    },
                    required: ["index", "suggestion", "confidence"],
                    additionalProperties: false,
                  },
                },
              },
              required: ["suggestions"],
              additionalProperties: false,
            },
          },
        },
      }),
    });

    if (!r.ok) {
      const detail = await r.text();
      console.error("anthropic error", r.status, detail);
      return done(502, { ok: false, error: "Could not reach the suggestion service." });
    }

    const data = await r.json();
    if (data?.stop_reason === "refusal") {
      return done(502, { ok: false, error: "The suggestion service declined this request." });
    }
    const text = Array.isArray(data?.content)
      ? data.content.filter((b: any) => b?.type === "text").map((b: any) => b.text).join("")
      : "";
    const parsed = JSON.parse(text);
    const raw = Array.isArray(parsed?.suggestions) ? parsed.suggestions : [];

    // Map back to 0-based positions and drop anything that doesn't line up with
    // an input, so a malformed index can never overwrite the wrong person's name.
    const suggestions = raw
      .map((s: any) => ({
        index: Number(s?.index) - 1,
        suggestion: typeof s?.suggestion === "string" ? s.suggestion.trim() : "",
        confidence: ["high", "medium", "low"].includes(s?.confidence) ? s.confidence : "low",
      }))
      .filter(
        (s: any) =>
          Number.isInteger(s.index) && s.index >= 0 && s.index < names.length && s.suggestion.length > 0,
      );

    return done(200, { ok: true, suggestions });
  } catch (err) {
    console.error("suggest-name-fix failed", err);
    return done(500, { ok: false, error: "Could not generate suggestions." });
  }
});

function done(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
