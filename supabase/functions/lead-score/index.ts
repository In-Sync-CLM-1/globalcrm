// On-demand, cached AI lead scoring with Claude Haiku.
// Called when a contact detail page opens. Gathers the lead's scoring
// parameters, hashes them, and only calls the model when the parameters have
// changed since the last score (or when force=true). Otherwise returns the
// cached score instantly. The cache + input hash live in
// contact_lead_scores.score_breakdown (no schema change needed).
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MODEL = "claude-haiku-4-5";

const SYSTEM_PROMPT = `You are a B2B lead-scoring AI. Score lead quality 0-100, weighting pipeline stage most heavily, then engagement, then business profile and data quality.

Guidance:
- Pipeline stage is the primary signal. Won ~95+, Negotiation (prob>=80) 80+, Proposal (prob>=60) 65+, Demo/Qualified 45-65, Contacted 30-45, New 15-30, Lost <=30.
- Engagement: recent activity, calls connected, meetings/demos done, positive call dispositions raise the score; no-answer / not-interested / DNC lower it.
- Business profile: senior decision-makers (C-suite/VP/Director) and complete, enriched company data raise the score.
- Data quality: warm sources (referral, inbound, demo request) beat cold outreach; complete contact info helps.

Category: 90-100 hot, 75-89 warm, 55-74 cool, 35-54 cold, 0-34 unqualified.

The four breakdown values MUST sum exactly to the total score. Use these caps: Pipeline Stage 0-50, Engagement 0-25, Business Profile 0-15, Data Quality 0-10.

Return ONLY valid JSON, no prose, no markdown fences:
{
  "score": <0-100 integer>,
  "category": "hot|warm|cool|cold|unqualified",
  "breakdown": { "Pipeline Stage": <int>, "Engagement": <int>, "Business Profile": <int>, "Data Quality": <int> },
  "reasoning": "<one or two sentences citing the strongest signals>"
}`;

async function sha256(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function extractJson(text: string): any {
  const t = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  return JSON.parse(t);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { contact_id, force } = await req.json();
    if (!contact_id) throw new Error("contact_id is required");

    const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
    if (!ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not configured");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // --- gather scoring parameters ---
    const { data: contact, error: cErr } = await supabase
      .from("contacts")
      .select("id, org_id, first_name, last_name, company, organization_name, organization_industry, job_title, seniority, headline, status, source, created_at, do_not_call, do_not_email, do_not_whatsapp, pipeline_stage_id, pipeline_stages(name, stage_order, probability)")
      .eq("id", contact_id)
      .maybeSingle();
    if (cErr) throw cErr;
    if (!contact) throw new Error("Contact not found");

    const since = new Date(Date.now() - 1000 * 60 * 60 * 24 * 180).toISOString();
    const [{ data: acts }, { data: calls }] = await Promise.all([
      supabase.from("contact_activities")
        .select("activity_type, completed_at, created_at")
        .eq("contact_id", contact_id).gte("created_at", since).limit(300),
      supabase.from("call_logs")
        .select("status, started_at, analysis_quality_score, disposition_id")
        .eq("contact_id", contact_id).gte("created_at", since).limit(100),
    ]);

    const activities = acts || [];
    const callLogs = calls || [];
    const dateOf = (a: any) => a.completed_at || a.created_at;
    const allDates = [
      ...activities.map(dateOf),
      ...callLogs.map((c: any) => c.started_at),
    ].filter(Boolean).map((d: string) => new Date(d).getTime());
    const lastTs = allDates.length ? Math.max(...allDates) : 0;
    const daysSince = lastTs ? Math.floor((Date.now() - lastTs) / 86400000) : 999;

    const stage = (contact as any).pipeline_stages || {};
    const params = {
      name: `${contact.first_name || ""} ${contact.last_name || ""}`.trim(),
      company: contact.company || contact.organization_name || null,
      industry: contact.organization_industry || null,
      job_title: contact.job_title || null,
      seniority: contact.seniority || null,
      headline: contact.headline || null,
      status: contact.status || null,
      source: contact.source || null,
      do_not_contact: !!(contact.do_not_call && contact.do_not_email && contact.do_not_whatsapp),
      pipeline_stage: { name: stage.name || "Not set", stage_order: stage.stage_order || 0, probability: stage.probability || 0 },
      engagement: {
        total_activities: activities.length + callLogs.length,
        meetings: activities.filter((a: any) => a.activity_type === "meeting").length,
        emails: activities.filter((a: any) => a.activity_type === "email").length,
        calls: callLogs.length,
        connected_calls: callLogs.filter((c: any) => c.status === "completed").length,
        avg_call_quality: callLogs.length
          ? Math.round(callLogs.reduce((s: number, c: any) => s + (c.analysis_quality_score || 0), 0) / callLogs.length)
          : 0,
        days_since_last_activity: daysSince,
      },
    };

    // input hash: changes when any scoring parameter changes (day-granularity recency)
    const hashInput = JSON.stringify({ ...params, engagement: { ...params.engagement, days_since_last_activity: Math.min(params.engagement.days_since_last_activity, 999) } });
    const input_hash = await sha256(hashInput);

    // --- cache check ---
    const { data: existing } = await supabase
      .from("contact_lead_scores")
      .select("id, score, score_category, score_breakdown, last_calculated")
      .eq("contact_id", contact_id)
      .maybeSingle();

    if (!force && existing && (existing.score_breakdown as any)?._input_hash === input_hash) {
      const bd = existing.score_breakdown as any;
      return json({
        score: existing.score,
        category: existing.score_category,
        breakdown: stripMeta(bd),
        reasoning: bd?._reasoning || "",
        last_calculated: existing.last_calculated,
        cached: true,
      });
    }

    // --- score with Claude Haiku ---
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: `Score this lead:\n\n${JSON.stringify(params, null, 2)}` }],
      }),
    });
    if (!resp.ok) {
      const t = await resp.text();
      console.error("anthropic error", resp.status, t);
      return json({ error: resp.status === 429 ? "Rate limited, try again shortly." : "Scoring failed." }, resp.status === 429 ? 429 : 500);
    }
    const data = await resp.json();
    const report = extractJson(data.content[0].text);
    const score = Math.max(0, Math.min(100, Math.round(Number(report.score) || 0)));
    const category = String(report.category || "cold");
    const breakdown = report.breakdown && typeof report.breakdown === "object" ? report.breakdown : {};

    const score_breakdown = { ...breakdown, _reasoning: report.reasoning || "", _input_hash: input_hash, _model: MODEL };
    const now = new Date().toISOString();
    if (existing) {
      await supabase.from("contact_lead_scores")
        .update({ score, score_category: category, score_breakdown, last_calculated: now })
        .eq("id", existing.id);
    } else {
      await supabase.from("contact_lead_scores")
        .insert({ org_id: contact.org_id, contact_id, score, score_category: category, score_breakdown, last_calculated: now });
    }

    return json({ score, category, breakdown, reasoning: report.reasoning || "", last_calculated: now, cached: false });
  } catch (e) {
    console.error("lead-score error:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});

function stripMeta(bd: any): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(bd || {})) {
    if (!k.startsWith("_") && typeof v === "number") out[k] = v;
  }
  return out;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
