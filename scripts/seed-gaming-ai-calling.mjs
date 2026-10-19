// Switches AI calling on for the "Gaming CRM Demo" org (in test mode, no phone line connected, so nothing
// can dial) and seeds: three call scripts, the outcome -> disposition mapping, the feature flag, and about
// 220 demo AI calls over the last 14 days with transcripts so the AI Calling screen has history.
// Run: node scripts/seed-gaming-ai-calling.mjs [--calls-only]
import { randomUUID } from 'node:crypto';
import { loadEnv } from './lib/env.mjs';

const env = loadEnv(new URL('../.env', import.meta.url));
const U = env.SUPABASE_URL, K = env.SUPABASE_SERVICE_ROLE_KEY;
const H = { apikey: K, Authorization: 'Bearer ' + K, 'Content-Type': 'application/json', 'User-Agent': 'curl/8' };
const ORG = 'f07a3fa9-3a30-43bb-af2a-4c35bda2fce8';
const rest = async (method, path, body, prefer = 'return=representation') => {
  const r = await fetch(U + '/rest/v1/' + path, { method, headers: { ...H, Prefer: prefer }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text();
  if (!r.ok) throw new Error(`${method} ${path} ${r.status} ${t.slice(0, 300)}`);
  return t ? JSON.parse(t) : null;
};
let seed = 20261019;
const rnd = () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const int = (a, b) => Math.floor(a + rnd() * (b - a + 1));
const pick = (a) => a[Math.floor(rnd() * a.length)];
const weighted = (items) => { const total = items.reduce((s, [, w]) => s + w, 0); let x = rnd() * total; for (const [v, w] of items) { x -= w; if (x <= 0) return v; } return items.at(-1)[0]; };

const SCRIPTS = [
  {
    name: 'New lead: registration invite', language: 'hinglish', max_duration_seconds: 240,
    objective: 'Invite the lead to create a free account on the platform today, and answer questions about how it works.',
    opening: '{greeting}, {first_name}. This is the AI assistant from the platform. You showed interest in our games, do you have two minutes?',
    key_points: ['Registration is free and takes about two minutes.', 'New players get a welcome reward in their account after registering.', 'There are skill and casual games to try, including the one they showed interest in.', 'We can send the registration link on WhatsApp right away.'],
    objection_handling: { 'I already play on another app': 'That is fine. Many players use more than one. Offer the welcome reward as a reason to try it once.', 'Is it safe?': 'Explain that accounts are verified, personal details are encrypted, and the team never asks for OTPs or passwords on calls.', 'I am busy now': 'Offer a callback at a time that suits them and note it.' },
    closing: 'Thank them, confirm the WhatsApp link or callback time, and wish them a good day.',
    product_name: 'the platform',
    product_notes: 'Registration is free. A welcome reward is added to a new account after sign-up. Players must be 18 or older. Never quote rewards or amounts beyond this note.',
    behavioral_guidelines: 'Be warm and brief. Do not push after a clear no. If the lead prefers Hindi, switch to Hindi.',
  },
  {
    name: 'Interested lead: registration follow-up', language: 'hinglish', max_duration_seconds: 180,
    objective: 'Follow up with a lead who said they would register, and help them finish signing up.',
    opening: '{greeting}, {first_name}. This is the AI assistant from the platform, following up on the registration you were thinking about.',
    key_points: ['The link was shared on WhatsApp; we can resend it.', 'Signing up takes about two minutes.', 'The welcome reward is added right after registration.'],
    objection_handling: { 'I have not had time': 'No problem. Offer to resend the link and ask when a quick call back would suit.', 'I changed my mind': 'Thank them and respect the decision.' },
    closing: 'Confirm what happens next and thank them.',
    product_name: 'the platform', product_notes: 'Registration is free. A welcome reward is added after sign-up. Players must be 18 or older.',
    behavioral_guidelines: 'One gentle nudge only.',
  },
  {
    name: 'Registered player: activation nudge', language: 'hinglish', max_duration_seconds: 150,
    objective: 'Encourage a newly registered player to play their first game and claim the welcome reward.',
    opening: '{greeting}, {first_name}. This is the AI assistant from the platform. Thanks for registering with us!',
    key_points: ['Their welcome reward is waiting in their account.', 'Their first game takes only a couple of minutes.', 'Inviting a friend is optional.'],
    objection_handling: { 'I will try later': 'Great. Remind them the reward is waiting and offer help if anything is unclear.' },
    closing: 'Thank them and say the team is available on WhatsApp for help.',
    product_name: 'the platform', product_notes: 'A welcome reward is added to new accounts. Never quote amounts.',
    behavioral_guidelines: 'Keep it under two minutes.',
  },
];

// outcome key -> [disposition, sub-disposition | null, sets_opt_out]
const MAP = {
  interested_register_today: ['Interested', 'Will Register Today'], interested_register_week: ['Interested', 'Will Register This Week'],
  link_requested: ['Interested', 'Link Sent on WhatsApp'], callback: ['Callback Requested', 'Specific Time Given'],
  not_interested_elsewhere: ['Not Interested', 'Already Plays Elsewhere'], not_interested_no_games: ['Not Interested', 'Does Not Play Online Games'],
  not_interested_trust: ['Not Interested', 'Trust or Safety Concern'], not_interested_no_time: ['Not Interested', 'No Time'], not_interested_other: ['Not Interested', null],
  already_registered: ['Already Registered', 'Existing Active Player'], wrong_number: ['Wrong Number', 'Not the Lead'],
  do_not_call: ['Do Not Call', 'Customer Request', true], language_barrier: ['Language Barrier', 'Needs Regional Language Caller'], unclear: ['Not Connected', 'No Answer'],
};

const COMMON = ['hindi', 'english'];
const DIALOGUE = {
  link_requested: (n) => `agent: Hello ${n}, this is the AI assistant from the platform. Do you have two minutes?\nuser: Haan, bolo.\nagent: You showed interest in our games. Registration is free and takes two minutes.\nuser: Okay, WhatsApp pe link bhej do.\nagent: Sure, I will send the link on WhatsApp right now.\nuser: Thanks.\nagent: Thank you, have a good day.`,
  interested_register_today: (n) => `agent: Good afternoon ${n}, I am the AI assistant from the platform.\nuser: Haan, I was going to register.\nagent: Great. It is free and you get a welcome reward after signing up.\nuser: Okay, I will do it today evening.\nagent: Wonderful. I will send you the link as well. Thank you.`,
  interested_register_week: (n) => `agent: Hello ${n}, calling from the platform. Do you have a minute?\nuser: Yes, but I am travelling this week.\nagent: No problem. Would you like to register once you are back?\nuser: Yes, I will sign up this weekend.\nagent: Perfect, I will share the link on WhatsApp. Thank you.`,
  callback: (n) => `agent: Hello ${n}, this is the AI assistant from the platform.\nuser: I am in a meeting, call me tomorrow morning.\nagent: Sure, I will note that and call tomorrow morning.\nuser: Okay.\nagent: Thank you.`,
  not_interested_elsewhere: (n) => `agent: Hello ${n}, calling from the platform about our games.\nuser: I already play on another app, not interested.\nagent: Understood. The welcome reward may be worth a try, but I will not trouble you. Thank you.\nuser: Ok bye.`,
  not_interested_no_games: (n) => `agent: Hello ${n}, calling from the platform.\nuser: I do not play online games at all.\nagent: Understood, thank you for your time.`,
  not_interested_trust: (n) => `agent: Hello ${n}, calling from the platform.\nuser: Is this safe? I do not want to give my details.\nagent: Accounts are verified and details are encrypted, and we never ask for OTPs or passwords.\nuser: No, I am not comfortable.\nagent: I respect that. Thank you.`,
  not_interested_no_time: (n) => `agent: Hello ${n}, calling from the platform.\nuser: I do not have time for this, not interested.\nagent: No problem, thank you.`,
  not_interested_other: (n) => `agent: Hello ${n}, calling from the platform.\nuser: No, not interested.\nagent: Thank you for your time.`,
  already_registered: (n) => `agent: Hello ${n}, calling from the platform about registration.\nuser: I already have an account with you.\nagent: Wonderful, thank you. Enjoy the games.`,
  wrong_number: (n) => `agent: Hello, am I speaking with ${n}?\nuser: No, wrong number.\nagent: Sorry for the trouble.`,
  do_not_call: (n) => `agent: Hello ${n}, calling from the platform.\nuser: Please do not call me again.\nagent: I am sorry. I will remove your number. Thank you.`,
  language_barrier: (n) => `agent: Hello ${n}, this is the AI assistant from the platform.\nuser: Mujhe Tamil mein baat karni hai.\nagent: I am sorry, I can speak English or Hindi. A team member will call you.\nuser: Okay.`,
};
const SUMMARY = {
  link_requested: 'Wants the registration link on WhatsApp.', interested_register_today: 'Plans to register this evening.', interested_register_week: 'Will register this weekend.',
  callback: 'Asked for a call back tomorrow morning.', not_interested_elsewhere: 'Plays on another platform.', not_interested_no_games: 'Does not play online games.',
  not_interested_trust: 'Worried about safety of personal details.', not_interested_no_time: 'No time, declined.', not_interested_other: 'Declined.', already_registered: 'Already has an account.',
  wrong_number: 'Wrong number.', do_not_call: 'Asked not to be called again; opted out.', language_barrier: 'Needs a Tamil speaker.',
};

// ── scripts ──────────────────────────────────────────────────────────────────
let scripts = await rest('GET', `ai_call_scripts?org_id=eq.${ORG}&select=id,name`);
if (!scripts.length) scripts = await rest('POST', 'ai_call_scripts', SCRIPTS.map((s) => ({ ...s, org_id: ORG, is_active: true })));
console.log('scripts:', scripts.length);

const dispos = await rest('GET', `call_dispositions?org_id=eq.${ORG}&select=id,name`);
const subs = await rest('GET', `call_sub_dispositions?org_id=eq.${ORG}&select=id,name,disposition_id`);
const dId = Object.fromEntries(dispos.map((d) => [d.name, d.id]));
const sId = (dn, sn) => (sn ? subs.find((s) => s.disposition_id === dId[dn] && s.name === sn)?.id ?? null : null);

if (!process.argv.includes('--calls-only')) {
  await rest('DELETE', `ai_outcome_disposition_map?org_id=eq.${ORG}`, null, 'return=minimal');
  await rest('POST', 'ai_outcome_disposition_map', Object.entries(MAP).map(([key, [dn, sn, opt]]) => ({ org_id: ORG, outcome_key: key, disposition_id: dId[dn], sub_disposition_id: sId(dn, sn), sets_opt_out: !!opt })), 'return=minimal');
  console.log('outcome map:', Object.keys(MAP).length);

  const [org] = await rest('GET', `organizations?id=eq.${ORG}&select=settings`);
  const cfg = { enabled: true, mode: 'test', test_numbers: [], windows: [{ start_min: 600, end_min: 1200 }], max_attempts: 3, max_concurrent: 3, retry_gap_hours: 3, exotel_app_id: null, caller_id: null, default_script_id: scripts[0].id };
  await rest('PATCH', `organizations?id=eq.${ORG}`, { settings: { ...(org.settings ?? {}), ai_calling: { ...cfg, ...(org.settings?.ai_calling ?? {}), default_script_id: org.settings?.ai_calling?.default_script_id ?? scripts[0].id } } }, 'return=minimal');
  const flag = await rest('GET', `org_feature_access?org_id=eq.${ORG}&feature_key=eq.ai_calling&select=id`);
  if (!flag.length) await rest('POST', 'org_feature_access', [{ org_id: ORG, feature_key: 'ai_calling', is_enabled: true, notes: 'AI calling module' }], 'return=minimal');
  else await rest('PATCH', `org_feature_access?id=eq.${flag[0].id}`, { is_enabled: true }, 'return=minimal');
  console.log('settings + feature flag set (test mode, no phone line)');
}

// ── demo AI call history ─────────────────────────────────────────────────────
await rest('DELETE', `call_logs?org_id=eq.${ORG}&caller_type=eq.ai&exotel_call_sid=like.seed-gaming-ai-*`, null, 'return=minimal');
const stages = await rest('GET', `pipeline_stages?org_id=eq.${ORG}&select=id,name`);
const stage = Object.fromEntries(stages.map((s) => [s.name, s.id]));
const leads = await rest('GET', `contacts?org_id=eq.${ORG}&pipeline_stage_id=eq.${stage.New}&source=neq.AI%20test&select=id,first_name,phone&limit=400`);
const OUT = [['no_answer', 90], ['link_requested', 28], ['interested_register_week', 16], ['interested_register_today', 12], ['callback', 17], ['not_interested_elsewhere', 11], ['not_interested_no_games', 8], ['not_interested_trust', 6], ['not_interested_no_time', 6], ['not_interested_other', 3], ['already_registered', 8], ['wrong_number', 6], ['do_not_call', 3], ['language_barrier', 6]];
const now = Date.now(), calls = [], stageUpdates = new Map();
const used = new Set(), optOuts = [];
for (let i = 0; i < 220 && i < leads.length; i++) {
  const lead = leads[i]; if (used.has(lead.id)) continue; used.add(lead.id);
  const outcome = weighted(OUT);
  const day = int(0, 13);
  const start = new Date(now - day * 864e5); start.setUTCHours(4 + int(0, 8), int(0, 59), int(0, 59), 0); // ~10:00-19:00 IST
  if (start.getTime() > now) start.setTime(now - int(1, 6) * 3600e3);
  if (new Date(start.getTime() + 330 * 60000).getUTCDay() === 0) start.setTime(start.getTime() - 864e5); // no Sunday calls
  const connected = outcome !== 'no_answer';
  const talk = connected ? int(outcome === 'wrong_number' || outcome === 'do_not_call' ? 12 : 35, outcome.startsWith('interested') || outcome === 'link_requested' ? 170 : 95) : 0;
  const ring = int(8, 28);
  let dn, sn, status = 'completed';
  if (connected) [dn, sn] = MAP[outcome]; else { dn = 'Not Connected'; sn = pick(['No Answer', 'No Answer', 'No Answer', 'Busy', 'Switched Off', 'Out of Coverage']); status = sn === 'Busy' ? 'busy' : 'no-answer'; }
  calls.push({
    id: randomUUID(), org_id: ORG, contact_id: lead.id, agent_id: null, caller_type: 'ai', call_type: 'outbound', direction: 'outbound', status,
    exotel_call_sid: `seed-gaming-ai-${i}`, from_number: '+911169960919', to_number: lead.phone, ai_script_id: pick(scripts).id,
    call_duration: connected ? talk + ring : ring, conversation_duration: talk, ring_duration: ring,
    disposition_id: dId[dn], sub_disposition_id: sId(dn, sn), started_at: start.toISOString(), created_at: start.toISOString(),
    answered_at: connected ? new Date(start.getTime() + ring * 1000).toISOString() : null, ended_at: new Date(start.getTime() + (ring + talk) * 1000).toISOString(),
    transcript: connected ? DIALOGUE[outcome](lead.first_name) : null, transcript_status: connected ? 'completed' : null,
    analysis_summary: connected ? SUMMARY[outcome] : null, analysis_status: connected ? 'completed' : null,
  });
  const target = connected ? (outcome.startsWith('interested') || outcome === 'link_requested' || outcome === 'callback' ? 'Interested' : ['wrong_number', 'do_not_call'].includes(outcome) || outcome.startsWith('not_interested') ? 'Lost' : 'Contacted') : 'Contacted';
  stageUpdates.set(lead.id, target);
  if (outcome === 'do_not_call') optOuts.push(lead.id);
}
for (let i = 0; i < calls.length; i += 200) await rest('POST', 'call_logs', calls.slice(i, i + 200), 'return=minimal');
console.log('AI calls inserted:', calls.length);
const byStage = {};
for (const [id, name] of stageUpdates) (byStage[name] ??= []).push(id);
for (const [name, ids] of Object.entries(byStage)) for (let i = 0; i < ids.length; i += 100) await rest('PATCH', `contacts?id=in.(${ids.slice(i, i + 100).join(',')})`, { pipeline_stage_id: stage[name] }, 'return=minimal');
if (optOuts.length) await rest('PATCH', `contacts?id=in.(${optOuts.join(',')})`, { do_not_call: true, do_not_whatsapp: true, do_not_email: true, opted_out: true, opt_out_reason: 'Asked not to be called again on an AI call' }, 'return=minimal');
console.log('lead stages updated:', Object.fromEntries(Object.entries(byStage).map(([k, v]) => [k, v.length])));
