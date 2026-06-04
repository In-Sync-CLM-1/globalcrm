import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.58.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SCRIPT_COLS =
  "id, org_id, product_name, opening, objective, key_points, closing, objection_handling, behavioral_guidelines, language";

// Compact a product name to a join key. "Vendor Verification" (ai_call_scripts)
// and "Vendorverification" (contacts / ai_daily_insights) both collapse to the
// same key, so each script pairs with its OWN product's learnings.
const norm = (p: string | null | undefined) => (p || "").toLowerCase().replace(/\s+/g, "");

type ScriptRow = {
  id: string;
  org_id: string;
  product_name: string | null;
  opening: string | null;
  objective: string | null;
  key_points: unknown;
  closing: string | null;
  objection_handling: unknown;
  behavioral_guidelines: string | null;
  language: string | null;
};

type Result = {
  script_id: string;
  product: string | null;
  ok: boolean;
  skipped?: boolean;
  error?: string;
  proposal_id?: string;
  based_on_date?: string;
  rationale?: string;
};

// Generate (and persist) one script proposal for a single agent's script,
// based on that product's most recent daily learnings.
async function generateForScript(
  supabase: ReturnType<typeof createClient>,
  anthropicKey: string,
  script: ScriptRow,
  forDate: string | null,
): Promise<Result> {
  const base: Result = { script_id: script.id, product: script.product_name, ok: false };
  const productKey = norm(script.product_name);

  // Latest learnings for THIS product (newest first), org-scoped.
  let insQuery = supabase
    .from("ai_daily_insights")
    .select("for_date, insights, completed_count, product")
    .eq("org_id", script.org_id)
    .order("for_date", { ascending: false })
    .limit(60);
  if (forDate) insQuery = insQuery.eq("for_date", forDate);
  const { data: insRows, error: insErr } = await insQuery;
  if (insErr) return { ...base, error: insErr.message };

  const insightRow = (insRows || []).find(
    (r: any) => r.product !== "__all__" && norm(r.product) === productKey,
  );
  if (!insightRow) {
    return { ...base, skipped: true, error: `No learnings yet for ${script.product_name || "this agent"} to propose from` };
  }

  const basedOnDate = (insightRow as any).for_date;
  const tweaks = ((insightRow as any).insights)?.tweaks || [];
  const wins = ((insightRow as any).insights)?.wins || [];
  const losses = ((insightRow as any).insights)?.losses || [];

  const objHandlingObj = script.objection_handling && typeof script.objection_handling === "object"
    ? script.objection_handling as Record<string, string>
    : {};
  const objHandlingLines = Object.entries(objHandlingObj).map(([k, v]) => `  • ${k} → ${v}`).join("\n") || "  (none)";

  const prompt = `You are editing a sales-call playbook used by an AI voice agent. The playbook has three layers:
1) Script content — what to say (opening, objective, key points, closing)
2) Objection handling — keyed rebuttals: "if prospect raises X, respond with Y"
3) Behavioral guidelines — how to conduct the call (timing, tone, exit rules, what NOT to do). NOT the words to say.

CURRENT PLAYBOOK (active):
- Opening line: ${script.opening || "(none)"}
- Objective: ${script.objective || "(none)"}
- Key points:
${(Array.isArray(script.key_points) ? script.key_points : []).map((p: string) => `  • ${p}`).join("\n") || "  (none)"}
- Closing: ${script.closing || "(none)"}
- Objection handling:
${objHandlingLines}
- Behavioral guidelines:
${script.behavioral_guidelines || "(none)"}

TODAY'S CALL-ANALYSIS FINDINGS (based on ${(insightRow as any).completed_count} completed calls on ${basedOnDate}):

What worked:
${wins.map((w: any, i: number) => `${i + 1}. ${w.title} — ${w.detail}`).join("\n") || "(none)"}

What leaked:
${losses.map((l: any, i: number) => `${i + 1}. ${l.title} — ${l.detail}`).join("\n") || "(none)"}

Suggested tweaks (in priority order):
${tweaks.map((t: any, i: number) => `${i + 1}. ${t.title}: ${t.change}`).join("\n") || "(none)"}

TASK: Produce an updated playbook that integrates the tweaks while preserving what's working. Decide for each tweak which layer it belongs to:
- Wording changes → opening / key_points / closing
- "If they say X, say Y" → objection_handling
- "When situation X, do Y" / call-flow rules / exit conditions / timing → behavioral_guidelines

Be concrete. No placeholders. Keep the same product intent.

Return ONLY this JSON (no markdown, no commentary):
{
  "proposed": {
    "opening": "<rewritten opening, single spoken sentence>",
    "objective": "<rewritten objective, one short sentence>",
    "key_points": ["<3 to 6 bullets>"],
    "closing": "<rewritten closing>",
    "objection_handling": { "<objection_key>": "<one-line response>", "...": "..." },
    "behavioral_guidelines": "<plain-text, one rule per line, max 8 lines>"
  },
  "rationale": "<2-3 plain-English lines explaining what you changed and which layer each change went to>"
}`;

  const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": anthropicKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 2000,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!anthropicRes.ok) {
    const err = await anthropicRes.text();
    return { ...base, error: `Anthropic error: ${err.slice(0, 500)}` };
  }
  const anthropicJson = await anthropicRes.json();
  const text = anthropicJson.content?.[0]?.text || "{}";
  let parsed: any = {};
  try {
    const m = text.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(m ? m[0] : text);
  } catch {
    return { ...base, error: "Could not parse model output as JSON" };
  }

  const proposed = parsed.proposed || {};
  const rationale: string = parsed.rationale || "";

  // Supersede any earlier pending proposal for this script.
  await supabase
    .from("ai_script_proposals")
    .update({ status: "superseded" })
    .eq("script_id", script.id)
    .eq("status", "pending");

  const { data: row, error: upErr } = await supabase
    .from("ai_script_proposals")
    .upsert({
      org_id: script.org_id,
      script_id: script.id,
      based_on_date: basedOnDate,
      proposed_opening: proposed.opening || null,
      proposed_objective: proposed.objective || null,
      proposed_key_points: Array.isArray(proposed.key_points) ? proposed.key_points : null,
      proposed_closing: proposed.closing || null,
      proposed_objection_handling: proposed.objection_handling && typeof proposed.objection_handling === "object" ? proposed.objection_handling : null,
      proposed_behavioral_guidelines: typeof proposed.behavioral_guidelines === "string" ? proposed.behavioral_guidelines : null,
      rationale,
      status: "pending",
      generated_at: new Date().toISOString(),
    }, { onConflict: "script_id,based_on_date" })
    .select()
    .maybeSingle();

  if (upErr) return { ...base, error: upErr.message };

  return { ...base, ok: true, proposal_id: (row as any)?.id, based_on_date: basedOnDate, rationale };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!anthropicKey) {
    return new Response(JSON.stringify({ ok: false, error: "ANTHROPIC_API_KEY missing" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  let scriptId: string | null = null;
  let orgId: string | null = null;
  let forDate: string | null = null;
  try {
    const body = req.method === "POST" ? await req.json() : {};
    if (typeof body.script_id === "string") scriptId = body.script_id;
    if (typeof body.org_id === "string") orgId = body.org_id;
    if (typeof body.for_date === "string") forDate = body.for_date;
  } catch { /* default */ }

  const json = (obj: unknown, status = 200) =>
    new Response(JSON.stringify(obj), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  // --- Single agent (UI "Generate proposal" / "Regenerate") ---
  if (scriptId) {
    const { data: script, error } = await supabase
      .from("ai_call_scripts")
      .select(SCRIPT_COLS)
      .eq("id", scriptId)
      .maybeSingle();
    if (error || !script) return json({ ok: false, error: "Script not found" }, 404);
    const result = await generateForScript(supabase, anthropicKey, script as ScriptRow, forDate);
    // 200 even for "no learnings yet" so the UI can surface the friendly message.
    return json(result, result.ok || result.skipped ? 200 : 500);
  }

  // --- Batch (daily cron): one proposal per active agent, from its own learnings ---
  let sq = supabase.from("ai_call_scripts").select(SCRIPT_COLS).eq("is_active", true);
  if (orgId) sq = sq.eq("org_id", orgId);
  const { data: allScripts, error: listErr } = await sq;
  if (listErr) return json({ ok: false, error: listErr.message }, 500);

  const results: Result[] = [];
  for (const s of (allScripts || []) as ScriptRow[]) {
    results.push(await generateForScript(supabase, anthropicKey, s, forDate));
  }

  return json({
    ok: true,
    generated: results.filter((r) => r.ok).length,
    skipped: results.filter((r) => r.skipped).length,
    results,
  });
});
