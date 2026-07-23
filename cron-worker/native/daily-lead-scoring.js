// Native port of supabase/functions/daily-lead-scoring/index.ts.
// (Dropped the original's fetch of contact_lead_scores.last_calculated -- its
// result was never actually used to filter, per that file's own "TEMPORARILY
// PROCESS ALL" comment, so it was a pure wasted query.)
// Parallelized in batches (was strictly sequential in the original) -- up to
// 100 contacts x 1 analyze-lead/Claude call each took 100+ seconds serially,
// which Cloudflare's synchronous request path can't wait out (measured a
// real 502 during e2e testing at ~115s). Same PARALLEL_BATCH_SIZE pattern
// already used by automation-email-sender in this same codebase; total work
// and per-contact behavior are unchanged, just concurrent instead of serial.
import { pgSelect } from "./_lib/postgrest.js";
import { invokeFunction } from "./_lib/postgrest.js";

const PARALLEL_BATCH_SIZE = 10;

async function upsertScore(env, body) {
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/contact_lead_scores?on_conflict=contact_id`, {
    method: "POST",
    headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`upsert contact_lead_scores failed: ${r.status} ${await r.text()}`);
}

async function scoreContact(env, contact) {
  const activities = await pgSelect(env, "contact_activities",
    `contact_id=eq.${contact.id}&order=created_at.desc&limit=20&select=activity_type,created_at,completed_at`);

  const now = new Date();
  const lastActivity = activities?.[0]?.created_at ? new Date(activities[0].created_at) : null;
  const daysSinceLastActivity = lastActivity ? Math.floor((now.getTime() - lastActivity.getTime()) / (1000 * 60 * 60 * 24)) : 999;

  const activityCounts = (activities || []).reduce((acc, act) => { acc[act.activity_type] = (acc[act.activity_type] || 0) + 1; return acc; }, {});

  const { data: scoreData, error: scoreError } = await invokeFunction(env, "analyze-lead", {
    contact: {
      id: contact.id, first_name: contact.first_name, last_name: contact.last_name, email: contact.email,
      phone: contact.phone, company: contact.company, job_title: contact.job_title, status: contact.status,
      source: contact.source, city: contact.city, state: contact.state, country: contact.country,
      website: contact.website, notes: contact.notes, created_at: contact.created_at,
      pipeline_stage: contact.pipeline_stages,
      engagement_metrics: {
        total_activities: activities?.length || 0, last_activity_date: lastActivity?.toISOString(),
        days_since_last_activity: daysSinceLastActivity,
        meetings_count: activityCounts["meeting"] || 0, calls_count: activityCounts["call"] || 0, emails_count: activityCounts["email"] || 0,
      },
    },
  });

  if (scoreError) { console.error(`Error scoring contact ${contact.id}:`, String(scoreError.message || scoreError)); return "failed"; }
  if (!scoreData?.score) { console.error(`Invalid score data for contact ${contact.id}`); return "failed"; }

  await upsertScore(env, {
    contact_id: contact.id, org_id: contact.org_id, score: scoreData.score,
    score_category: scoreData.category?.toLowerCase() || "cold", score_breakdown: scoreData.breakdown || {},
    last_calculated: new Date().toISOString(),
  });
  return "processed";
}

async function tick(env) {
  const contacts = await pgSelect(env, "contacts",
    "limit=100&select=id,org_id,first_name,last_name,email,phone,company,job_title,status,source,city,state,country,website,notes,created_at,pipeline_stage_id,pipeline_stages!inner(id,name,stage_order,probability)");

  if (!contacts || contacts.length === 0) return { message: "No contacts need scoring", processed: 0 };

  let processed = 0, failed = 0;

  for (let i = 0; i < contacts.length; i += PARALLEL_BATCH_SIZE) {
    const batch = contacts.slice(i, i + PARALLEL_BATCH_SIZE);
    const results = await Promise.allSettled(batch.map((contact) => scoreContact(env, contact)));
    for (const r of results) {
      if (r.status === "fulfilled" && r.value === "processed") processed++;
      else { failed++; if (r.status === "rejected") console.error("Batch scoring error:", String(r.reason)); }
    }
  }

  return { message: "Daily lead scoring complete", processed, failed, total: contacts.length };
}

export default {
  async scheduled(_event, env, ctx) { ctx.waitUntil(tick(env)); },
  async fetch(_req, env) {
    let out;
    try { out = await tick(env); } catch (e) { out = { error: String(e && e.stack || e) }; }
    return new Response(JSON.stringify(out), { headers: { "Content-Type": "application/json" } });
  },
};
