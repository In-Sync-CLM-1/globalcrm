import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.58.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type Field =
  | "opening"
  | "objective"
  | "closing"
  | "key_points"
  | "behavioral_guidelines"
  | "objection_handling";

// Text-only tier: Groq first, Cerebras as the fallback if Groq is
// unavailable/errors. Both are OpenAI-compatible chat-completions APIs.
async function callGroqText(userContent: string, maxTokens: number): Promise<string | null> {
  const key = Deno.env.get("GROQ_API_KEY");
  if (!key) return null;
  try {
    const resp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        max_tokens: maxTokens,
        messages: [{ role: "user", content: userContent }],
      }),
    });
    if (!resp.ok) {
      console.error("Groq call failed:", resp.status, await resp.text());
      return null;
    }
    const data = await resp.json();
    return data.choices?.[0]?.message?.content ?? null;
  } catch (e) {
    console.error("Groq call error:", e);
    return null;
  }
}

async function callCerebrasText(userContent: string, maxTokens: number): Promise<string | null> {
  const key = Deno.env.get("CEREBRAS_API_KEY");
  if (!key) return null;
  try {
    const resp = await fetch("https://api.cerebras.ai/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: "gemma-4-31b",
        max_tokens: maxTokens,
        messages: [{ role: "user", content: userContent }],
      }),
    });
    if (!resp.ok) {
      console.error("Cerebras call failed:", resp.status, await resp.text());
      return null;
    }
    const data = await resp.json();
    return data.choices?.[0]?.message?.content ?? null;
  } catch (e) {
    console.error("Cerebras call error:", e);
    return null;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  if (!Deno.env.get("GROQ_API_KEY") && !Deno.env.get("CEREBRAS_API_KEY")) {
    return new Response(JSON.stringify({ ok: false, error: "GROQ_API_KEY / CEREBRAS_API_KEY missing" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  let proposalId: string | undefined;
  let field: Field | undefined;
  let index: number | undefined;
  let key: string | undefined;
  try {
    const body = await req.json();
    proposalId = body.proposal_id;
    field = body.field;
    index = typeof body.index === "number" ? body.index : undefined;
    key = typeof body.key === "string" ? body.key : undefined;
  } catch {
    return new Response(JSON.stringify({ ok: false, error: "Invalid JSON body" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
  if (!proposalId || !field) {
    return new Response(JSON.stringify({ ok: false, error: "proposal_id and field required" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const { data: proposal, error: pErr } = await supabase
    .from("ai_script_proposals")
    .select("*")
    .eq("id", proposalId)
    .maybeSingle();
  if (pErr || !proposal) {
    return new Response(JSON.stringify({ ok: false, error: "Proposal not found" }),
      { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const { data: script } = await supabase
    .from("ai_call_scripts")
    .select("opening, objective, key_points, closing, objection_handling, behavioral_guidelines")
    .eq("id", (proposal as any).script_id)
    .maybeSingle();

  const { data: insight } = await supabase
    .from("ai_daily_insights")
    .select("insights, completed_count, for_date")
    .eq("for_date", (proposal as any).based_on_date)
    .maybeSingle();

  const tweaks = (insight as any)?.insights?.tweaks || [];
  const wins = (insight as any)?.insights?.wins || [];
  const losses = (insight as any)?.insights?.losses || [];

  // Build a focused prompt for the specific item
  const currentProposed = (() => {
    if (field === "opening") return (proposal as any).proposed_opening || "";
    if (field === "objective") return (proposal as any).proposed_objective || "";
    if (field === "closing") return (proposal as any).proposed_closing || "";
    if (field === "key_points") {
      const arr = Array.isArray((proposal as any).proposed_key_points) ? (proposal as any).proposed_key_points : [];
      return index != null ? arr[index] || "" : arr.join("\n");
    }
    if (field === "behavioral_guidelines") {
      const lines = ((proposal as any).proposed_behavioral_guidelines || "").split("\n").filter((s: string) => s.trim());
      return index != null ? lines[index] || "" : lines.join("\n");
    }
    if (field === "objection_handling") {
      const dict = (proposal as any).proposed_objection_handling || {};
      return key ? dict[key] || "" : JSON.stringify(dict);
    }
    return "";
  })();

  const fieldLabel: Record<Field, string> = {
    opening: "opening line (a single spoken sentence)",
    objective: "objective (one short sentence)",
    closing: "closing line",
    key_points: index != null ? `key point #${index + 1} (single talking-point bullet)` : "key points list",
    behavioral_guidelines: index != null ? `behavioral guideline line #${index + 1} (one operating rule)` : "behavioral guidelines block",
    objection_handling: key ? `objection-handling response for trigger "${key}" (one-line rebuttal)` : "objection-handling block",
  };

  const prompt = `You previously drafted an updated playbook for Riya, an AI sales agent pitching WorkSync to Indian operations heads. The user does NOT want the current suggestion for ONE specific item. Generate a DIFFERENT, equally good alternative.

CONTEXT — call analysis findings:
Wins: ${wins.map((w: any) => `${w.title} (${w.detail})`).join("; ") || "(none)"}
Losses: ${losses.map((l: any) => `${l.title} (${l.detail})`).join("; ") || "(none)"}
Tweaks: ${tweaks.map((t: any) => `${t.title}: ${t.change}`).join("; ") || "(none)"}

CURRENT ACTIVE PLAYBOOK (for context):
- Opening: ${(script as any)?.opening || "(none)"}
- Objective: ${(script as any)?.objective || "(none)"}
- Closing: ${(script as any)?.closing || "(none)"}

ITEM TO REGENERATE: ${fieldLabel[field]}
The version you previously proposed (and that the user rejected): "${currentProposed}"

TASK: Produce a clearly different alternative. Match the same intent and constraints, but try a different angle, structure, or wording. Be concrete — no placeholders.

Return ONLY this JSON (no markdown, no commentary):
{ "value": "<the new alternative>" }`;

  const text = (await callGroqText(prompt, 800)) ?? (await callCerebrasText(prompt, 800));
  if (text === null) {
    return new Response(JSON.stringify({ ok: false, error: "Both Groq and Cerebras calls failed" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
  let parsed: { value?: string } = {};
  try {
    const m = text.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(m ? m[0] : text);
  } catch {
    return new Response(JSON.stringify({ ok: false, error: "Could not parse model output", raw: text.slice(0, 500) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
  const newValue = (parsed.value ?? "").toString().trim();
  if (!newValue) {
    return new Response(JSON.stringify({ ok: false, error: "Model returned empty value" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  // Write back to the proposal row
  const update: any = {};
  if (field === "opening") update.proposed_opening = newValue;
  else if (field === "objective") update.proposed_objective = newValue;
  else if (field === "closing") update.proposed_closing = newValue;
  else if (field === "key_points") {
    const arr = Array.isArray((proposal as any).proposed_key_points) ? [...(proposal as any).proposed_key_points] : [];
    if (index != null && index >= 0 && index < arr.length) arr[index] = newValue;
    else arr.push(newValue);
    update.proposed_key_points = arr;
  }
  else if (field === "behavioral_guidelines") {
    const lines = ((proposal as any).proposed_behavioral_guidelines || "").split("\n").map((s: string) => s.trim()).filter(Boolean);
    if (index != null && index >= 0 && index < lines.length) lines[index] = newValue;
    else lines.push(newValue);
    update.proposed_behavioral_guidelines = lines.join("\n");
  }
  else if (field === "objection_handling") {
    const dict = { ...((proposal as any).proposed_objection_handling || {}) };
    if (key) dict[key] = newValue;
    update.proposed_objection_handling = dict;
  }

  const { error: uErr } = await supabase
    .from("ai_script_proposals")
    .update(update)
    .eq("id", proposalId);
  if (uErr) {
    return new Response(JSON.stringify({ ok: false, error: uErr.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  return new Response(JSON.stringify({ ok: true, value: newValue }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
