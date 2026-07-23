// Native port of supabase/functions/ai-bolna-daily-insights/index.ts.
import { pgSelect } from "./_lib/postgrest.js";

const ALL = "__all__"; // sentinel product for the org-wide lump (Dashboard Overview)

async function analyze(anthropicKey, label, isLump, completed) {
  const groups = {};
  for (const r of completed) {
    const o = r.extracted_data?.General?.outcome?.objective || "unknown";
    (groups[o] ||= []).push({
      dur: r.conversation_duration || 0,
      product: r.product,
      notes: r.extracted_data?.General?.notes?.subjective || "",
      transcript: (r.transcript || "").slice(0, 1200),
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

async function upsertInsight(env, body) {
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/ai_daily_insights?on_conflict=org_id,for_date,product`, {
    method: "POST",
    headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`upsert ai_daily_insights failed: ${r.status} ${await r.text()}`);
}

async function tick(env, forDateOverride) {
  if (!env.ANTHROPIC_API_KEY) return { ok: false, error: "ANTHROPIC_API_KEY missing" };

  const istNow = new Date(Date.now() + 5.5 * 3600 * 1000);
  const forDate = forDateOverride || istNow.toISOString().slice(0, 10);

  const [y, m, d] = forDate.split("-").map(Number);
  const startUTC = new Date(Date.UTC(y, m - 1, d, 0, 0, 0) - 5.5 * 3600 * 1000).toISOString();
  const endUTC = new Date(Date.UTC(y, m - 1, d, 23, 59, 59, 999) - 5.5 * 3600 * 1000).toISOString();

  const raw = await pgSelect(env, "call_logs",
    `caller_type=eq.ai&created_at=gte.${startUTC}&created_at=lte.${endUTC}` +
    `&select=org_id,status,conversation_duration,extracted_data,transcript,contacts(product)`);

  const rows = (raw || []).map((r) => ({
    org_id: r.org_id, status: r.status, conversation_duration: r.conversation_duration,
    extracted_data: r.extracted_data, transcript: r.transcript,
    product: (r.contacts?.product || "(unassigned)").toString(),
  }));

  const orgId = rows[0]?.org_id;
  if (!orgId) return { ok: true, message: "No AI calls to analyze", date: forDate, total: 0 };

  const completedAll = rows.filter((r) => r.status === "completed");

  const byProduct = {};
  for (const r of rows) (byProduct[r.product] ||= []).push(r);

  const jobs = [
    { product: ALL, all: rows, completed: completedAll },
    ...Object.entries(byProduct).map(([product, all]) => ({ product, all, completed: all.filter((r) => r.status === "completed") })),
  ];

  const results = {};
  for (const job of jobs) {
    if (job.completed.length === 0) { results[job.product] = "skipped (no completed calls)"; continue; }
    const insights = await analyze(env.ANTHROPIC_API_KEY, job.product, job.product === ALL, job.completed);
    if (!insights) { results[job.product] = "analysis failed"; continue; }
    try {
      await upsertInsight(env, {
        org_id: orgId, for_date: forDate, product: job.product,
        call_count: job.all.length, completed_count: job.completed.length,
        insights, generated_at: new Date().toISOString(),
      });
      results[job.product] = "ok";
    } catch (e) {
      results[job.product] = `upsert error: ${String(e)}`;
    }
  }

  return { ok: true, date: forDate, total: rows.length, completed: completedAll.length, results };
}

export default {
  async scheduled(_event, env, ctx) { ctx.waitUntil(tick(env)); },
  async fetch(req, env) {
    let forDate = null;
    try { const body = req.method === "POST" ? await req.json() : {}; if (typeof body.for_date === "string") forDate = body.for_date; } catch { /* default */ }
    let out;
    try { out = await tick(env, forDate); } catch (e) { out = { ok: false, error: String(e && e.stack || e) }; }
    return new Response(JSON.stringify(out), { headers: { "Content-Type": "application/json" } });
  },
};
