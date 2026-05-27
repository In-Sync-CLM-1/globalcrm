import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.58.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ALL = "__all__"; // sentinel product for the org-wide lump (Dashboard Overview)

interface CallRow {
  org_id: string;
  status: string;
  conversation_duration: number | null;
  extracted_data: any;
  transcript: string | null;
  product: string;
}

// Build the analysis prompt for one product (or the lump) and call Claude.
async function analyze(anthropicKey: string, label: string, isLump: boolean, completed: CallRow[]): Promise<any | null> {
  // Group by Bolna outcome for prompt structure.
  const groups: Record<string, any[]> = {};
  for (const r of completed) {
    const o = r.extracted_data?.General?.outcome?.objective || "unknown";
    (groups[o] ||= []).push({
      dur: r.conversation_duration || 0,
      product: r.product,
      notes: r.extracted_data?.General?.notes?.subjective || "",
      transcript: ((r.transcript as string) || "").slice(0, 1200),
    });
  }

  const subject = isLump
    ? `today's outbound AI sales calls across ALL products (a combined view; calls span multiple products and AI agents)`
    : `today's outbound AI sales calls for the product "${label}" (made by its dedicated AI agent)`;

  let promptText = `You are analyzing ${subject}. Distill what was learned today.

Return ONLY a JSON object with this exact shape (no markdown fences, no commentary):
{
  "wins": [ { "title": "short label, max 6 words", "detail": "one concrete sentence with a name or quote" } ],
  "losses": [ { "title": "short label", "detail": "one concrete sentence" } ],
  "objections": [ { "label": "short phrase", "count": <number>, "issue": "one-sentence interpretation" } ],
  "tweaks": [ { "title": "verb-led action, max 6 words", "change": "concrete one-line change to the script or behavior" } ]
}

Max 4 items per array. Be specific (cite Bolna's extraction or transcript snippets). No filler.

`;
  for (const [outcome, arr] of Object.entries(groups)) {
    promptText += `===== Outcome: ${outcome} (${arr.length} calls) =====\n`;
    for (const c of arr.slice(0, 15)) {
      promptText += `[dur ${c.dur}s${isLump ? `, ${c.product}` : ""}] ${c.notes}\n`;
      if (c.transcript) promptText += `Transcript: ${c.transcript}\n`;
      promptText += `---\n`;
    }
  }

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": anthropicKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 2000, messages: [{ role: "user", content: promptText }] }),
  });
  if (!res.ok) { console.error(`anthropic ${label}:`, (await res.text()).slice(0, 300)); return null; }
  const json = await res.json();
  const text = json.content?.[0]?.text || "{}";
  try {
    const m = text.match(/\{[\s\S]*\}/);
    return JSON.parse(m ? m[0] : text);
  } catch { console.error(`parse fail ${label}:`, text.slice(0, 300)); return null; }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!anthropicKey) {
    return new Response(JSON.stringify({ ok: false, error: "ANTHROPIC_API_KEY missing" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  let forDate: string | null = null;
  try {
    const body = req.method === "POST" ? await req.json() : {};
    if (typeof body.for_date === "string") forDate = body.for_date;
  } catch { /* default */ }
  const istNow = new Date(Date.now() + 5.5 * 3600 * 1000);
  if (!forDate) forDate = istNow.toISOString().slice(0, 10);

  const [y, m, d] = forDate.split("-").map(Number);
  const startUTC = new Date(Date.UTC(y, m - 1, d, 0, 0, 0) - 5.5 * 3600 * 1000).toISOString();
  const endUTC = new Date(Date.UTC(y, m - 1, d, 23, 59, 59, 999) - 5.5 * 3600 * 1000).toISOString();

  // All AI calls for the day, with each contact's product.
  const { data: raw, error } = await supabase
    .from("call_logs")
    .select("org_id, status, conversation_duration, extracted_data, transcript, contacts(product)")
    .eq("caller_type", "ai")
    .gte("created_at", startUTC)
    .lte("created_at", endUTC);

  if (error) {
    return new Response(JSON.stringify({ ok: false, error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const rows: CallRow[] = (raw || []).map((r: any) => ({
    org_id: r.org_id,
    status: r.status,
    conversation_duration: r.conversation_duration,
    extracted_data: r.extracted_data,
    transcript: r.transcript,
    product: (r.contacts?.product || "(unassigned)").toString(),
  }));

  const orgId = rows[0]?.org_id;
  if (!orgId) {
    return new Response(JSON.stringify({ ok: true, message: "No AI calls to analyze", date: forDate, total: 0 }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const completedAll = rows.filter((r) => r.status === "completed");

  // One job per product that has completed calls, plus the org-wide lump.
  const byProduct: Record<string, CallRow[]> = {};
  for (const r of rows) (byProduct[r.product] ||= []).push(r);

  const jobs: { product: string; all: CallRow[]; completed: CallRow[] }[] = [
    { product: ALL, all: rows, completed: completedAll },
    ...Object.entries(byProduct).map(([product, all]) => ({
      product,
      all,
      completed: all.filter((r) => r.status === "completed"),
    })),
  ];

  const results: Record<string, string> = {};
  for (const job of jobs) {
    if (job.completed.length === 0) { results[job.product] = "skipped (no completed calls)"; continue; }
    const insights = await analyze(anthropicKey, job.product, job.product === ALL, job.completed);
    if (!insights) { results[job.product] = "analysis failed"; continue; }
    const { error: uerr } = await supabase.from("ai_daily_insights").upsert({
      org_id: orgId,
      for_date: forDate,
      product: job.product,
      call_count: job.all.length,
      completed_count: job.completed.length,
      insights,
      generated_at: new Date().toISOString(),
    }, { onConflict: "org_id,for_date,product" });
    results[job.product] = uerr ? `upsert error: ${uerr.message}` : "ok";
  }

  return new Response(JSON.stringify({ ok: true, date: forDate, total: rows.length, completed: completedAll.length, results }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
