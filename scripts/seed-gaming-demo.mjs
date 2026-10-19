// Seeds the "Gaming CRM Demo" org: telecaller workflow for a gaming company.
//   org + billing, users (admin, manager, 6 callers), designations, attendance policy,
//   pipeline stages, dispositions + sub-dispositions, ~9,000 leads, ~2 weeks of calls,
//   attendance, and scheduled callbacks.
// Run: node scripts/seed-gaming-demo.mjs [--reset]
// --reset deletes this org's contacts / calls / attendance / activities first and rebuilds them.
import { randomBytes, randomUUID } from 'node:crypto';
import { appendFileSync, readFileSync } from 'node:fs';
import { loadEnv } from './lib/env.mjs';

const envUrl = new URL('../.env', import.meta.url);
let env = loadEnv(envUrl);
if (!env.GAMING_DEMO_PASSWORD) {
  const pw = 'Gm!' + randomBytes(6).toString('hex');
  appendFileSync(envUrl, `\nGAMING_DEMO_PASSWORD=${pw}\n`);
  env = loadEnv(envUrl);
}
const U = env.SUPABASE_URL, K = env.SUPABASE_SERVICE_ROLE_KEY, PASSWORD = env.GAMING_DEMO_PASSWORD;
const H = { apikey: K, Authorization: 'Bearer ' + K, 'Content-Type': 'application/json', 'User-Agent': 'curl/8' };
const ORG = 'f07a3fa9-3a30-43bb-af2a-4c35bda2fce8';
const RESET = process.argv.includes('--reset');

const rest = async (method, path, body, prefer = 'return=representation') => {
  const r = await fetch(U + '/rest/v1/' + path, { method, headers: { ...H, Prefer: prefer }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text();
  if (!r.ok) throw new Error(`${method} ${path} ${r.status} ${t.slice(0, 300)}`);
  return t ? JSON.parse(t) : null;
};
const get = (p) => rest('GET', p);
const insert = (t, rows, prefer) => rest('POST', t, rows, prefer);
const batchInsert = async (t, rows, size = 400) => {
  for (let i = 0; i < rows.length; i += size) await insert(t, rows.slice(i, i + size), 'return=minimal');
};

// ── deterministic randomness ─────────────────────────────────────────────────
let seed = 20261019;
const rnd = () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const between = (a, b) => a + rnd() * (b - a);
const int = (a, b) => Math.floor(between(a, b + 1));
const pick = (a) => a[Math.floor(rnd() * a.length)];
const weighted = (items) => { // items: [value, weight][]
  const total = items.reduce((s, [, w]) => s + w, 0);
  let x = rnd() * total;
  for (const [v, w] of items) { x -= w; if (x <= 0) return v; }
  return items[items.length - 1][0];
};

// ── IST helpers ──────────────────────────────────────────────────────────────
const IST = 5.5 * 3600e3;
const istDate = (d) => new Date(d.getTime() + IST).toISOString().slice(0, 10);
const atIst = (day, secs) => new Date(Date.parse(day + 'T00:00:00Z') + secs * 1000 - IST);
const dowOf = (day) => new Date(day + 'T00:00:00Z').getUTCDay();
const isWorkingDay = (day) => {
  const dow = dowOf(day);
  if (dow === 0) return false;
  if (dow === 6) { const wk = Math.ceil(Number(day.slice(8)) / 7); if (wk === 2 || wk === 4) return false; }
  return true;
};
const addDays = (day, n) => new Date(Date.parse(day + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);

// ── reference data ───────────────────────────────────────────────────────────
const STAGES = [
  ['New', 1, 5, '#8AD4EB'], ['Contacted', 2, 15, '#01B8AA'], ['Interested', 3, 40, '#F2C80F'],
  ['Registered', 4, 70, '#A66999'], ['Activated', 5, 100, '#168980'], ['Lost', 6, 0, '#FD625E'],
];
// name, category, [[sub, weight]] — weight is the share of ALL calls (percent)
const DISPOS = [
  ['Not Connected', 'neutral', 'Call dialled but nobody spoke', [['No Answer', 17], ['Busy', 8], ['Switched Off', 8], ['Out of Coverage', 4]]],
  ['Wrong Number', 'neutral', 'Number does not belong to the lead', [['Invalid Number', 2.5], ['Not the Lead', 1]]],
  ['Do Not Call', 'negative', 'Lead asked not to be called again', [['Customer Request', 0.5], ['DND Registered', 0.3]]],
  ['Language Barrier', 'neutral', 'Caller and lead could not converse', [['Needs Hindi Caller', 1], ['Needs Regional Language Caller', 1]]],
  ['Callback Requested', 'follow_up', 'Lead asked to be called again', [['Call Later Today', 3], ['Call Tomorrow', 2], ['Specific Time Given', 1.5], ['Busy Right Now', 0.5]]],
  ['Not Interested', 'negative', 'Lead declined to register', [['Already Plays Elsewhere', 6], ['Does Not Play Online Games', 5], ['Not Eligible (Under 18 / Restricted State)', 2], ['Trust or Safety Concern', 3], ['No Time', 4]]],
  ['Already Registered', 'neutral', 'Lead already has an account', [['Existing Active Player', 2.5], ['Existing Inactive Player', 1.5]]],
  ['Interested', 'positive', 'Lead wants to register but has not yet', [['Link Sent on WhatsApp', 5], ['Wants Welcome Reward Details', 2.5], ['Will Register Today', 1.5], ['Will Register This Week', 1]]],
  ['Registered', 'positive', 'Lead created an account during the call', [['New Signup', 4.5], ['Registered via Link Sent', 2], ['Returning Player Re-registered', 1]]],
  ['Activated', 'positive', 'Registered player took a first meaningful action', [['Played First Game', 1], ['Claimed Welcome Reward', 1], ['Invited a Friend', 1]]],
];
const ACT_SUBS = [['Played First Game', 5], ['Claimed Welcome Reward', 4], ['Invited a Friend', 1.5]];
const NOTES = {
  Interested: ['Asked about the welcome reward.', 'Will sign up after dinner, sent the link.', 'Plays Ludo daily, keen on tournaments.', 'Wants to check with a friend first.'],
  'Callback Requested': ['In a meeting, asked for a call after 6 pm.', 'Travelling today, call tomorrow morning.', 'Asked to call on weekend.'],
  'Not Interested': ['Plays on a rival app and is happy there.', 'Does not want to install another app.', 'Worried about data safety.'],
  Registered: ['Signed up on the call, OTP verified.', 'Registered with referral code from a friend.', 'Created account and chose username.'],
  Activated: ['Played the first game during the call.', 'Claimed welcome reward after registration.', 'Invited two friends.'],
};

const CALLERS = [
  ['Kabir', 'Shah', 1.28, 1.05], ['Ishita', 'Rao', 1.12, 0.98], ['Nikhil', 'Verma', 1.0, 1.0],
  ['Pooja', 'Iyer', 0.9, 1.08], ['Sahil', 'Khan', 0.82, 0.95], ['Tanya', 'Bose', 1.05, 1.1],
]; // first, last, skill (conversion multiplier), tempo (calls/hour multiplier)
const FIRST = ['Aarav', 'Aditya', 'Akash', 'Ananya', 'Anjali', 'Arjun', 'Aryan', 'Deepak', 'Divya', 'Gaurav', 'Harshita', 'Ishaan', 'Karan', 'Kavya', 'Kunal', 'Manish', 'Meera', 'Mohit', 'Nisha', 'Nitin', 'Pooja', 'Priya', 'Rahul', 'Raj', 'Rohit', 'Sanjay', 'Sara', 'Shivani', 'Sneha', 'Sumit', 'Suresh', 'Tanvi', 'Varun', 'Vikram', 'Vishal', 'Yash', 'Zara', 'Imran', 'Farhan', 'Gurpreet', 'Harpreet', 'Lakshmi', 'Murali', 'Senthil', 'Abhishek', 'Debasish', 'Rituparna', 'Jayesh', 'Hetal', 'Mihir'];
const LAST = ['Agarwal', 'Bhatia', 'Chopra', 'Desai', 'Gupta', 'Iyer', 'Jain', 'Kapoor', 'Kumar', 'Malhotra', 'Mehta', 'Mishra', 'Nair', 'Patel', 'Pillai', 'Rao', 'Reddy', 'Sharma', 'Singh', 'Srivastava', 'Tiwari', 'Verma', 'Shah', 'Joshi', 'Saxena', 'Khan', 'Ansari', 'Sethi', 'Gill', 'Banerjee', 'Das', 'Ghosh', 'Naidu', 'Menon', 'Kulkarni', 'Pawar'];
const CITIES = [['Mumbai', 'Maharashtra'], ['Pune', 'Maharashtra'], ['Delhi', 'Delhi'], ['Gurugram', 'Haryana'], ['Bengaluru', 'Karnataka'], ['Hyderabad', 'Telangana'], ['Chennai', 'Tamil Nadu'], ['Kolkata', 'West Bengal'], ['Ahmedabad', 'Gujarat'], ['Jaipur', 'Rajasthan'], ['Lucknow', 'Uttar Pradesh'], ['Indore', 'Madhya Pradesh'], ['Patna', 'Bihar'], ['Chandigarh', 'Chandigarh']];
const SOURCES = [['Facebook Ads', 22], ['Instagram Ads', 20], ['Google Ads', 14], ['YouTube Influencer', 12], ['Referral', 9], ['Affiliate Partner', 10], ['Telegram Group', 8], ['Old Player Database', 5]];
const GAMES = ['Ludo', 'Carrom', 'Chess', 'Quiz Battles', 'Puzzle Duels', 'Word Games', 'Cricket Strategy'];

// ── 1. reset (this org only) ─────────────────────────────────────────────────
if (RESET) {
  for (const t of ['notifications', 'contact_activities', 'call_logs', 'attendance_records', 'contacts']) {
    await rest('DELETE', `${t}?org_id=eq.${ORG}`, null, 'return=minimal');
    console.log('reset', t);
  }
}

// ── 2. org, billing, policy, designations ────────────────────────────────────
const existing = await get(`organizations?id=eq.${ORG}&select=id`);
if (!existing.length) {
  await insert('organizations', [{
    id: ORG, name: 'Gaming CRM Demo', slug: 'gaming-crm-demo', industry: 'Gaming', is_internal: true,
    subscription_active: true, smart_import_enabled: true, services_enabled: true,
    settings: { timezone: 'Asia/Kolkata' }, usage_limits: { users: 50, storage_gb: 10 }, primary_color: '#7C3AED',
  }], 'return=minimal');
  await insert('organization_subscriptions', [{
    org_id: ORG, subscription_status: 'active', user_count: 8, monthly_subscription_amount: 0,
    wallet_balance: 25000, wallet_lock_exempt: true, billing_period: 'quarterly',
    billing_cycle_start: '2026-10-01', next_billing_date: '2027-01-01',
  }], 'return=minimal');
  await insert('attendance_policies', [{ org_id: ORG, policy_name: 'Default', working_hours_per_day: 8, grace_period_minutes: 15, half_day_threshold_hours: 4, overtime_start_after_hours: 8, is_active: true }], 'return=minimal');
  console.log('org created');
}
let designations = await get(`designations?org_id=eq.${ORG}&select=id,name`);
if (!designations.length) {
  designations = await insert('designations', [
    { org_id: ORG, name: 'Admin', role: 'admin' }, { org_id: ORG, name: 'Calling Manager', role: 'admin' }, { org_id: ORG, name: 'Caller', role: 'sales_agent' },
  ]);
}
const desig = Object.fromEntries(designations.map((d) => [d.name, d.id]));

// ── 3. users ─────────────────────────────────────────────────────────────────
const PEOPLE = [
  ['Rohan', 'Malhotra', 'admin', 'Admin'], ['Sneha', 'Kulkarni', 'admin', 'Calling Manager'],
  ...CALLERS.map(([f, l]) => [f, l, 'sales_agent', 'Caller']),
];
const users = {}; // key "First Last" -> id
for (const [f, l, role, dn] of PEOPLE) {
  const email = `${f}.${l}@gaming-demo.in-sync.co.in`.toLowerCase();
  let prof = (await get(`profiles?org_id=eq.${ORG}&email=eq.${encodeURIComponent(email)}&select=id`))[0];
  if (!prof) {
    const r = await fetch(U + '/auth/v1/admin/users', { method: 'POST', headers: H, body: JSON.stringify({ email, password: PASSWORD, email_confirm: true, user_metadata: { first_name: f, last_name: l, org_id: ORG } }) });
    const j = await r.json();
    if (!r.ok) throw new Error('create user ' + email + ' ' + JSON.stringify(j));
    prof = { id: j.id };
  }
  await rest('PATCH', `profiles?id=eq.${prof.id}`, { first_name: f, last_name: l, org_id: ORG, email, designation_id: desig[dn], calling_enabled: true, is_active: true, onboarding_completed: true, phone: '+9190000' + String(int(10000, 99999)) }, 'return=minimal');
  await rest('DELETE', `user_roles?user_id=eq.${prof.id}&org_id=eq.${ORG}`, null, 'return=minimal');
  await insert('user_roles', [{ user_id: prof.id, org_id: ORG, role, is_active: true }], 'return=minimal');
  users[`${f} ${l}`] = prof.id;
}
const callerIds = CALLERS.map(([f, l]) => users[`${f} ${l}`]);
const adminId = users['Rohan Malhotra'];
console.log('users ready:', Object.keys(users).length);

// ── 4. pipeline stages, dispositions ─────────────────────────────────────────
let stages = await get(`pipeline_stages?org_id=eq.${ORG}&select=id,name`);
if (!stages.length) stages = await insert('pipeline_stages', STAGES.map(([name, stage_order, probability, color]) => ({ org_id: ORG, name, stage_order, probability, color, is_active: true })));
const stageId = Object.fromEntries(stages.map((s) => [s.name, s.id]));

let dispRows = await get(`call_dispositions?org_id=eq.${ORG}&select=id,name`);
if (!dispRows.length) dispRows = await insert('call_dispositions', DISPOS.map(([name, category, description]) => ({ org_id: ORG, name, category, description, is_active: true })));
const dispId = Object.fromEntries(dispRows.map((d) => [d.name, d.id]));
let subRows = await get(`call_sub_dispositions?org_id=eq.${ORG}&select=id,name,disposition_id`);
if (!subRows.length) {
  const subs = [];
  for (const [name, , , list] of DISPOS) for (const [sub] of (name === 'Activated' ? ACT_SUBS : list)) subs.push({ org_id: ORG, disposition_id: dispId[name], name: sub, is_active: true });
  subRows = await insert('call_sub_dispositions', subs);
}
const subId = Object.fromEntries(subRows.map((s) => [`${s.disposition_id}|${s.name}`, s.id]));
const subOf = (dname, sname) => subId[`${dispId[dname]}|${sname}`];
console.log('workflow ready:', Object.keys(stageId).length, 'stages,', dispRows.length, 'dispositions,', subRows.length, 'sub-dispositions');

// ── 5. simulate lead uploads, calling days, attendance ───────────────────────
const nowIst = new Date(Date.now() + IST);
const todayIst = istDate(new Date());
const lastDay = (() => {
  let d = nowIst.getUTCHours() >= 19 && isWorkingDay(todayIst) ? todayIst : addDays(todayIst, -1);
  while (!isWorkingDay(d)) d = addDays(d, -1);
  return d;
})();
const DAYS = [];
for (let n = 20; n >= 0; n--) { const d = addDays(lastDay, -n); if (isWorkingDay(d)) DAYS.push(d); }
DAYS.splice(0, DAYS.length - 15);
const firstDay = DAYS[0];
console.log('calling days:', DAYS.length, firstDay, '→', lastDay);

// lead uploads: three batches, each lands at 09:00 IST on its day
const BATCHES = [[0, 4800], [5, 2600], [9, 1600]];
const leads = [];
const usedPhones = new Set();
BATCHES.forEach(([dayIdx, n], bi) => {
  const day = DAYS[Math.min(dayIdx, DAYS.length - 1)];
  for (let i = 0; i < n; i++) {
    let phone; do { phone = '+9190000' + String(int(0, 99999)).padStart(5, '0'); } while (usedPhones.has(phone)); usedPhones.add(phone);
    const [city, state] = pick(CITIES);
    leads.push({
      id: randomUUID(), first: pick(FIRST), last: pick(LAST), phone, city, state, source: weighted(SOURCES), game: pick(GAMES),
      batch: bi + 1, availableFrom: day, createdAt: atIst(day, 9 * 3600 + int(0, 300)).toISOString(),
      caller: callerIds[leads.length % callerIds.length],
      state_: 'fresh', attempts: 0, nextEligible: 0, lastOutcome: null, lastCallAt: null,
    });
  }
});
console.log('leads simulated:', leads.length);
const byCaller = new Map(callerIds.map((id) => [id, leads.filter((l) => l.caller === id)]));

// per caller-day sessions: each caller dials back-to-back until logout, with scheduled breaks
const sessions = []; const attendance = [];
const absentPlan = new Map(); // callerIdx -> Set(days)
const earlyPlan = new Map();
CALLERS.forEach((_, i) => { absentPlan.set(i, new Set()); earlyPlan.set(i, new Set()); });
[[1, 4], [3, 8], [4, 2], [4, 11], [5, 6]].forEach(([ci, di]) => absentPlan.get(ci).add(DAYS[di]));
[[0, 7], [2, 3], [3, 12]].forEach(([ci, di]) => earlyPlan.get(ci).add(DAYS[di]));

DAYS.forEach((day) => {
  CALLERS.forEach(([, , skill, tempo], ci) => {
    const callerId = callerIds[ci];
    const city = 'Mumbai';
    if (absentPlan.get(ci).has(day)) { attendance.push({ org_id: ORG, user_id: callerId, date: day, status: 'absent', notes: 'Absent', sync_status: 'synced' }); return; }
    const early = earlyPlan.get(ci).has(day);
    const loginSec = Math.round(Math.min(10 * 3600 + 40 * 60, Math.max(9 * 3600 + 35 * 60, 9.97 * 3600 + (rnd() - 0.4) * 2100)));
    const spanSec = early ? int(4.6 * 3600, 6.2 * 3600) : int(8.12 * 3600, 9.1 * 3600);
    const logoutSec = loginSec + spanSec;
    // break plan (seconds of day, duration)
    const breaks = early ? [] : [[11 * 3600 + 30 * 60 + int(-900, 900), int(480, 900)], [13 * 3600 + 30 * 60 + int(-900, 1500), int(1800, 3300)], [16 * 3600 + 30 * 60 + int(-900, 900), int(480, 900)]];
    if (early) breaks.push([11 * 3600 + 40 * 60, int(480, 780)]);
    for (let k = int(0, 2); k > 0; k--) breaks.push([loginSec + int(2 * 3600, spanSec - 3600), int(360, 720)]);
    breaks.sort((a, b) => a[0] - b[0]);
    sessions.push({ day, callerId, skill, tempo, logoutSec, breaks: breaks.map((x) => [...x]), cursor: loginSec + int(180, 720) });
    attendance.push({ _planned: atIst(day, logoutSec).getTime(), _early: early, org_id: ORG, user_id: callerId, date: day, sign_in_time: atIst(day, loginSec).toISOString(), sign_out_time: null, status: 'present', sign_in_location_city: city, sign_in_location_state: 'Maharashtra', sign_out_location_city: city, sign_out_location_state: 'Maharashtra', network_status: 'online', sync_status: 'synced' });
  });
});

// outcome weights (percent of calls)
const BASE = DISPOS.filter(([n]) => n !== 'Activated').map(([name, , , subs]) => [name, subs.reduce((s, [, w]) => s + w, 0), subs]);
const DUR = { // [shortProb, short range, clean range]
  'Not Connected': [1, [3, 28], [3, 28]], 'Wrong Number': [1, [5, 22], [5, 22]], 'Do Not Call': [1, [12, 45], [12, 45]], 'Language Barrier': [1, [20, 55], [20, 55]],
  'Callback Requested': [0.3, [25, 58], [60, 150]], 'Not Interested': [0.74, [14, 58], [60, 140]], 'Already Registered': [0.35, [25, 58], [60, 120]],
  Interested: [0.1, [45, 58], [70, 240]], Registered: [0, [0, 0], [150, 420]], Activated: [0, [0, 0], [90, 300]],
};
const P_ACT = 0.079;
const pendingByCaller = new Map(callerIds.map((id) => [id, []]));
const calls = [];
const dayGroups = DAYS.map((d) => sessions.filter((x) => x.day === d));
for (const group of dayGroups) while (true) {
  const sess = group.filter((x) => x.cursor < x.logoutSec - 200).sort((a, b) => a.cursor - b.cursor)[0];
  if (!sess) break;
  const ev = { day: sess.day, callerId: sess.callerId, skill: sess.skill, startSec: sess.cursor };
  const wrap = Math.min(290, Math.round(int(60, 280) / sess.tempo)); // wrap-up between calls stays under the 5 minute idle threshold
  sess.cursor += wrap + 30; // moves on even if no lead is available
  const L = byCaller.get(ev.callerId);
  const evMs = atIst(ev.day, ev.startSec).getTime();
  const pending = pendingByCaller.get(ev.callerId);
  let lead, dname, sname, activationAttempt = false;
  if (pending.length && rnd() < P_ACT) {
    activationAttempt = true;
    const idx = Math.floor(rnd() * pending.length); lead = pending[idx];
    dname = weighted([['Activated', 0.55 * ev.skill], ['Not Connected', 0.25], ['Callback Requested', 0.12], ['Interested', 0.08]]);
    if (dname === 'Activated') pending.splice(idx, 1);
  } else {
    // choose a lead: warm/retry that is due, otherwise a fresh uploaded lead
    const due = (l) => (l.state_ === 'retry' || l.state_ === 'warm') && l.nextEligible <= evMs;
    const wantRetry = rnd() < 0.3;
    const fresh = () => { for (let k = 0; k < 40; k++) { const l = L[Math.floor(rnd() * L.length)]; if (l.state_ === 'fresh' && l.availableFrom <= ev.day) return l; } return null; };
    const retry = () => { for (let k = 0; k < 60; k++) { const l = L[Math.floor(rnd() * L.length)]; if (due(l)) return l; } return null; };
    lead = wantRetry ? (retry() || fresh()) : (fresh() || retry());
    if (!lead) continue;
    const s = ev.skill;
    dname = weighted(BASE.map(([n, w]) => [n, w * (n === 'Registered' ? s : n === 'Interested' ? Math.sqrt(s) : n === 'Not Interested' ? 1 / Math.sqrt(s) : 1)]));
  }
  const def = DISPOS.find(([n]) => n === dname);
  sname = weighted(dname === 'Activated' ? ACT_SUBS : def[3]);
  const [shortP, shortR, cleanR] = DUR[dname];
  const dur = rnd() < shortP ? int(...shortR) : int(...cleanR);
  const connected = !['Not Connected', 'Wrong Number'].includes(dname);
  const ring = int(4, 22);
  const started = new Date(evMs);
  const note = rnd() < 0.55 && NOTES[dname] ? pick(NOTES[dname]) : null;
  calls.push({
    org_id: ORG, contact_id: lead.id, agent_id: ev.callerId, caller_type: 'human', call_type: 'outbound', direction: 'outbound',
    status: dname === 'Not Connected' ? (sname === 'Busy' ? 'busy' : 'no-answer') : 'completed',
    exotel_call_sid: 'seed-gaming-' + calls.length, from_number: '+918046805555', to_number: lead.phone,
    call_duration: dur, conversation_duration: connected ? Math.max(0, dur - ring) : 0, ring_duration: connected ? ring : dur,
    disposition_id: dispId[dname], sub_disposition_id: subOf(dname, sname), notes: note,
    started_at: started.toISOString(), answered_at: connected ? new Date(evMs + ring * 1000).toISOString() : null,
    ended_at: new Date(evMs + dur * 1000).toISOString(), created_at: started.toISOString(),
  });
  sess.cursor = ev.startSec + dur + wrap;
  for (const br of sess.breaks) if (!br.done && sess.cursor >= br[0]) { br.done = true; sess.cursor = Math.max(sess.cursor, br[0] + br[1]) + int(10, 60); }
  // state transitions
  lead.attempts++; lead.lastOutcome = dname; lead.lastCallAt = started.toISOString();
  if (dname === 'Registered') { lead.state_ = 'registered'; pending.push(lead); }
  else if (dname === 'Activated') lead.state_ = 'activated';
  else if (['Not Interested', 'Do Not Call', 'Wrong Number', 'Already Registered', 'Language Barrier'].includes(dname)) lead.state_ = 'closed';
  else if (activationAttempt) lead.state_ = 'registered';
  else if (['Callback Requested', 'Interested'].includes(dname)) { lead.state_ = 'warm'; lead.nextEligible = evMs + 20 * 3600e3; lead.callback = dname === 'Callback Requested'; }
  else if (lead.attempts >= 4) lead.state_ = 'closed';
  else { lead.state_ = 'retry'; lead.nextEligible = evMs + 3 * 3600e3; }
}

// sign-out follows the real last call; a full day is never shorter than the planned 8h+ span
const lastEndMs = new Map();
for (const c of calls) { const k = c.agent_id + '|' + istDate(new Date(c.started_at)); lastEndMs.set(k, Math.max(lastEndMs.get(k) || 0, Date.parse(c.ended_at))); }
for (const a of attendance) {
  if (a.status === 'absent') continue;
  const end = (lastEndMs.get(a.user_id + '|' + a.date) || Date.parse(a.sign_in_time)) + int(120, 420) * 1000;
  a.sign_out_time = new Date(a._early ? end : Math.max(end, a._planned)).toISOString();
  delete a._planned; delete a._early;
}

// stats check
const nc = calls.length, clean = calls.filter((c) => c.call_duration >= 60).length;
const regs = calls.filter((c) => c.disposition_id === dispId.Registered).length, acts = calls.filter((c) => c.disposition_id === dispId.Activated).length;
console.log(`calls ${nc} | clean ${clean} (${(100 * clean / nc).toFixed(1)}%) | registrations ${regs} (${(100 * regs / clean).toFixed(1)}% of clean) | activations ${acts} (${(100 * acts / regs).toFixed(1)}% of regs)`);
if (process.argv.includes('--dry')) process.exit(0);

// ── 6. write contacts, calls, attendance, callbacks ──────────────────────────
const stageOf = (l) => {
  if (l.lastOutcome == null) return stageId.New;
  if (l.state_ === 'activated') return stageId.Activated;
  if (l.state_ === 'registered') return stageId.Registered;
  if (['Interested', 'Callback Requested'].includes(l.lastOutcome)) return stageId.Interested;
  if (['Not Interested', 'Do Not Call', 'Wrong Number'].includes(l.lastOutcome)) return stageId.Lost;
  return stageId.Contacted;
};
const contactRows = leads.map((l) => ({
  id: l.id, org_id: ORG, first_name: l.first, last_name: l.last, phone: l.phone, city: l.city, state: l.state, country: 'India',
  source: l.source, product: l.game, notes: `Plays ${l.game}. Lead batch ${l.batch}.`, pipeline_stage_id: stageOf(l),
  assigned_to: l.caller, created_by: adminId, do_not_call: l.lastOutcome === 'Do Not Call', created_at: l.createdAt, updated_at: l.lastCallAt || l.createdAt,
}));
await batchInsert('contacts', contactRows);
console.log('contacts inserted:', contactRows.length);
await batchInsert('call_logs', calls);
console.log('call_logs inserted:', calls.length);
const ATT_KEYS = ['org_id', 'user_id', 'date', 'status', 'notes', 'sync_status', 'sign_in_time', 'sign_out_time', 'sign_in_location_city', 'sign_in_location_state', 'sign_out_location_city', 'sign_out_location_state', 'network_status'];
await batchInsert('attendance_records', attendance.map((a) => Object.fromEntries(ATT_KEYS.map((k) => [k, a[k] ?? null]))));
console.log('attendance_records inserted:', attendance.length);

let nextDay = addDays(lastDay > todayIst ? lastDay : todayIst, 1); // callbacks are always in the future
while (!isWorkingDay(nextDay)) nextDay = addDays(nextDay, 1);
let dayAfter = addDays(nextDay, 1);
while (!isWorkingDay(dayAfter)) dayAfter = addDays(dayAfter, 1);
const callbacks = leads.filter((l) => l.state_ === 'warm' && l.callback).slice(0, 180).map((l, i) => ({
  org_id: ORG, contact_id: l.id, created_by: l.caller, activity_type: 'call', subject: `Callback — ${l.first} ${l.last}`,
  description: 'Lead asked for a call back.', scheduled_at: atIst(i % 3 === 0 ? dayAfter : nextDay, (10 + (i % 8)) * 3600 + int(0, 3000)).toISOString(), priority: i % 5 === 0 ? 'important' : 'normal',
}));
await batchInsert('contact_activities', callbacks);
console.log('callbacks scheduled:', callbacks.length);
console.log('DONE. Logins: <first>.<last>@gaming-demo.in-sync.co.in (password in .env: GAMING_DEMO_PASSWORD)');
