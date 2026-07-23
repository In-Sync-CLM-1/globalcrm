// Premium demo seed for the In-Sync CRM promo:
//  1) Distribute a healthy cross-channel pipeline (Event / Website / Google Ads /
//     LinkedIn / Organic / Email / WhatsApp / Referral) across stages so AI Insights,
//     pipeline health, stage velocity and source attribution look alive.
//  2) A showcase Apollo-enriched "hot lead" (lead score 92, enriched fields, journey).
//  3) A few upcoming calendar activities + reminders.
import { loadEnv } from './lib/env.mjs';
const env = loadEnv(new URL('../.env', import.meta.url));
const U = env.SUPABASE_URL, K = env.SUPABASE_SERVICE_ROLE_KEY;
const ORG = '61f7f96d-e80c-4d9b-a765-8eb32bd3c70d';
const H = { apikey: K, Authorization: 'Bearer ' + K, 'Content-Type': 'application/json' };
const g = async (p) => { const r = await fetch(U + '/rest/v1/' + p, { headers: H }); return r.ok ? r.json() : { err: r.status, t: await r.text() }; };
const patch = async (p, body) => { const r = await fetch(U + '/rest/v1/' + p, { method: 'PATCH', headers: { ...H, Prefer: 'return=minimal' }, body: JSON.stringify(body) }); if (!r.ok) console.log('  PATCH', p, r.status, (await r.text()).slice(0, 120)); return r.ok; };
const post = async (p, body) => { const r = await fetch(U + '/rest/v1/' + p, { method: 'POST', headers: { ...H, Prefer: 'return=minimal,resolution=merge-duplicates' }, body: JSON.stringify(body) }); if (!r.ok) console.log('  POST', p, r.status, (await r.text()).slice(0, 160)); return r.ok; };

const S = {
  New: 'cdfd18e3-69b8-4cdc-993d-0bfa037362d6', Contacted: '7dd70bba-bb67-4630-acef-e3431d58d95b',
  Qualified: '23d4a458-1f4d-4dca-ab0e-f659cde2b302', Proposal: 'a97b6ec7-3716-42c1-a181-a65b4ea985f6',
  Negotiation: '6b844290-06c6-4c54-8345-95bea0c4dedd', Won: '3c015d58-f687-4096-a13b-bfe37b88b1c3',
  Lost: '2ebaf5a2-293d-4b01-a2bc-36ea65ddee8d', Demo: '40fce782-7f59-443b-87a9-e648b276b76c',
};
// channel -> patch payload builder (source + utm attribution)
const CH = [
  ['Event · SaaSBoomi 2026', { utm_source: 'saasboomi', utm_medium: 'event', utm_campaign: 'saasboomi-2026' }],
  ['Website Form', { utm_source: 'website', utm_medium: 'organic', source_url: 'https://crm.in-sync.co.in/demo' }],
  ['Google Ads', { utm_source: 'google', utm_medium: 'cpc', utm_campaign: 'q3-brand-search', gclid: 'Cj0KCQjw' + Math.random().toString(36).slice(2, 10) }],
  ['LinkedIn', { utm_source: 'linkedin', utm_medium: 'paid-social', utm_campaign: 'abm-mid-market' }],
  ['Organic Search', { utm_source: 'google', utm_medium: 'organic' }],
  ['Email Campaign', { utm_source: 'in-sync-email', utm_medium: 'email', utm_campaign: 'aug-newsletter' }],
  ['WhatsApp', { utm_source: 'in-sync-wa', utm_medium: 'whatsapp', utm_campaign: 'reengage' }],
  ['Referral', { utm_source: 'referral', utm_medium: 'word-of-mouth' }],
];
// funnel: how many contacts to move into each stage from New
const FUNNEL = [['Contacted', 60], ['Qualified', 45], ['Demo', 35], ['Proposal', 30], ['Negotiation', 20], ['Won', 35], ['Lost', 15]];

const prof = await g('profiles?org_id=eq.' + ORG + '&select=id&limit=1');
const CREATED_BY = Array.isArray(prof) && prof[0] ? prof[0].id : null;
console.log('created_by:', CREATED_BY);

// pull New-stage contacts to redistribute
const need = FUNNEL.reduce((a, [, n]) => a + n, 0) + 5;
const pool = await g(`contacts?org_id=eq.${ORG}&pipeline_stage_id=eq.${S.New}&select=id,first_name,last_name,company,email&limit=${need}`);
console.log('pool size:', pool.length);
let i = 0, ci = 0;
for (const [stage, n] of FUNNEL) {
  for (let k = 0; k < n && i < pool.length; k++, i++) {
    const [source, utm] = CH[ci++ % CH.length];
    await patch(`contacts?id=eq.${pool[i].id}`, { pipeline_stage_id: S[stage], source, ...utm });
  }
  console.log(`  -> ${stage}: ${n}`);
}
console.log('pipeline distributed:', i, 'contacts across channels');

// ── showcase enriched hot lead ────────────────────────────────────────────────
const hero = pool[i] || pool[0];
console.log('hero contact:', hero.first_name, hero.last_name, '-', hero.company);
await patch(`contacts?id=eq.${hero.id}`, {
  job_title: 'VP of Sales', headline: 'VP Sales @ ' + hero.company + ' · scaling revenue with modern GTM',
  seniority: 'vp', organization_name: hero.company, organization_industry: 'Information Technology & Services',
  organization_founded_year: 2016, industry_type: 'SaaS', team_size: '51-200',
  linkedin_url: 'https://www.linkedin.com/in/' + (hero.first_name || 'lead').toLowerCase(),
  employment_history: [
    { title: 'VP of Sales', organization_name: hero.company, current: true, start_date: '2022-04' },
    { title: 'Regional Sales Manager', organization_name: 'Freshworks', current: false, start_date: '2018-01', end_date: '2022-03' },
  ],
  education: [{ school: 'IIM Bangalore', degree: 'MBA, Marketing', end_date: '2015' }],
  apollo_person_id: 'apollo_' + Math.random().toString(36).slice(2, 12),
  last_enriched_at: new Date().toISOString(), enrichment_status: 'completed',
  pipeline_stage_id: S.Demo, source: 'Event · SaaSBoomi 2026', utm_source: 'saasboomi', utm_medium: 'event',
});
await post('contact_lead_scores', {
  org_id: ORG, contact_id: hero.id, score: 92, score_category: 'Hot', last_calculated: new Date().toISOString(),
  score_breakdown: { engagement: 34, fit: 30, intent: 28, signals: ['Opened proposal 3x', 'Booked demo from event', 'Senior decision-maker', 'Replied on WhatsApp within 5 min'] },
});
// journey (past) + calendar (future)
const now = Date.now(), day = 86400000;
const acts = [
  { activity_type: 'note', subject: 'Met at SaaSBoomi 2026 booth', description: 'Stopped by after the keynote — running a 40-rep sales team on spreadsheets.', completed_at: new Date(now - 6 * day).toISOString() },
  { activity_type: 'call', subject: 'Discovery call — strong interest', description: 'Pain: no visibility into rep activity. Wants AI call coaching + enrichment.', completed_at: new Date(now - 4 * day).toISOString(), call_duration: 720 },
  { activity_type: 'email', subject: 'Sent proposal + ROI one-pager', description: 'Proposal for 40 seats, Professional plan.', completed_at: new Date(now - 2 * day).toISOString() },
  { activity_type: 'meeting', subject: 'Product demo — ' + hero.company, description: 'Full walkthrough: pipeline, AI coaching, enrichment, real-time reporting.', scheduled_at: new Date(now + 1 * day + 15 * 3600000).toISOString(), priority: 'high', meeting_platform: 'google_meet' },
];
for (const a of acts) await post('contact_activities', { org_id: ORG, contact_id: hero.id, created_by: CREATED_BY, ...a });

// ── calendar: a handful of upcoming activities + reminders (other contacts) ────
const cal = pool.slice(1, 7);
const titles = [
  ['meeting', 'Demo — Proposal review', 1, 11], ['call', 'Negotiation call — pricing', 1, 16],
  ['meeting', 'Product demo', 2, 10], ['task', 'Send contract for signature', 2, 14],
  ['call', 'Follow-up — decision timeline', 3, 15], ['meeting', 'Quarterly business review', 4, 12],
];
for (let j = 0; j < cal.length && j < titles.length; j++) {
  const [type, subject, d, hr] = titles[j];
  const dt = new Date(now + d * day); dt.setHours(hr, 0, 0, 0);
  await post('contact_activities', { org_id: ORG, contact_id: cal[j].id, created_by: CREATED_BY, activity_type: type, subject: subject + ' — ' + (cal[j].company || cal[j].first_name), scheduled_at: dt.toISOString(), priority: j % 2 ? 'high' : 'medium', meeting_platform: type === 'meeting' ? 'google_meet' : null });
}
console.log('seeded hero enrichment + journey + calendar. DONE.');
