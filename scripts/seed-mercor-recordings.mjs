// Seeds the "Mercor Recordings" org: pipeline stages from "Jan-Mar 2027 Stage Calibration.xlsx"
// (probabilities 10/20/30/40/50 plus Won and Lost) and 1,000 contacts spread across them.
// Run: node scripts/seed-mercor-recordings.mjs [--reset]
import { randomBytes, randomUUID } from 'node:crypto';
import { appendFileSync } from 'node:fs';
import { loadEnv } from './lib/env.mjs';

const envUrl = new URL('../.env', import.meta.url);
let env = loadEnv(envUrl);
if (!env.MERCOR_DEMO_PASSWORD) {
  appendFileSync(envUrl, `\nMERCOR_DEMO_PASSWORD=${'Mc!' + randomBytes(6).toString('hex')}\n`);
  env = loadEnv(envUrl);
}
const U = env.SUPABASE_URL, K = env.SUPABASE_SERVICE_ROLE_KEY, PASSWORD = env.MERCOR_DEMO_PASSWORD;
const H = { apikey: K, Authorization: 'Bearer ' + K, 'Content-Type': 'application/json', 'User-Agent': 'curl/8' };
const SLUG = 'mercor-recordings';

const rest = async (method, path, body, prefer = 'return=representation') => {
  const r = await fetch(U + '/rest/v1/' + path, { method, headers: { ...H, Prefer: prefer }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text();
  if (!r.ok) throw new Error(`${method} ${path} ${r.status} ${t.slice(0, 300)}`);
  return t ? JSON.parse(t) : null;
};
let seed = 20270101;
const rnd = () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const int = (a, b) => Math.floor(a + rnd() * (b - a + 1));
const pick = (a) => a[Math.floor(rnd() * a.length)];

// name, order, probability %, colour, number of the 1,000 records
// Open stages follow the workbook's reached counts (100/110/110/100/100) over 700 records;
// the 300 closed records follow its overall win rate (123 won / 397 lost of 520).
const STAGES = [
  ['New', 1, 10, '#8AD4EB', 133], ['Contacted', 2, 20, '#01B8AA', 148], ['Qualified', 3, 30, '#F2C80F', 148],
  ['Proposal', 4, 40, '#A66999', 135], ['Negotiation', 5, 50, '#E66C37', 136],
  ['Won', 6, 100, '#168980', 71], ['Lost', 7, 0, '#FD625E', 229],
];
const FIRST = ['Aarav', 'Aditya', 'Ananya', 'Arjun', 'Divya', 'Gaurav', 'Ishaan', 'Karan', 'Kavya', 'Manish', 'Meera', 'Nisha', 'Priya', 'Rahul', 'Rohit', 'Sanjay', 'Sneha', 'Suresh', 'Varun', 'Vikram', 'Imran', 'Gurpreet', 'Lakshmi', 'Murali', 'Hetal', 'Mihir'];
const LAST = ['Agarwal', 'Bhatia', 'Chopra', 'Desai', 'Gupta', 'Iyer', 'Jain', 'Kapoor', 'Kumar', 'Mehta', 'Nair', 'Patel', 'Rao', 'Reddy', 'Sharma', 'Singh', 'Verma', 'Shah', 'Joshi', 'Khan', 'Gill', 'Menon'];
const CITIES = [['Mumbai', 'Maharashtra'], ['Pune', 'Maharashtra'], ['Delhi', 'Delhi'], ['Bengaluru', 'Karnataka'], ['Hyderabad', 'Telangana'], ['Chennai', 'Tamil Nadu'], ['Ahmedabad', 'Gujarat'], ['Jaipur', 'Rajasthan']];
const SOURCES = ['Website', 'Referral', 'Trade Show', 'LinkedIn', 'Cold Outreach', 'Partner'];

let org = (await rest('GET', `organizations?slug=eq.${SLUG}&select=id`))[0];
if (!org) {
  org = (await rest('POST', 'organizations', [{
    name: 'Mercor Recordings', slug: SLUG, industry: 'Services', is_internal: true, subscription_active: true,
    smart_import_enabled: true, services_enabled: true, settings: { timezone: 'Asia/Kolkata' },
    usage_limits: { users: 10, storage_gb: 10 }, primary_color: '#2563EB',
  }]))[0];
  await rest('POST', 'organization_subscriptions', [{
    org_id: org.id, subscription_status: 'active', user_count: 1, monthly_subscription_amount: 0, wallet_balance: 25000,
    wallet_lock_exempt: true, billing_period: 'quarterly', billing_cycle_start: '2026-10-01', next_billing_date: '2027-01-01',
  }], 'return=minimal');
  await rest('POST', 'attendance_policies', [{ org_id: org.id, policy_name: 'Default', working_hours_per_day: 8, grace_period_minutes: 15, half_day_threshold_hours: 4, overtime_start_after_hours: 8, is_active: true }], 'return=minimal');
  console.log('org created');
}
const ORG = org.id;

let desig = (await rest('GET', `designations?org_id=eq.${ORG}&select=id`))[0];
if (!desig) desig = (await rest('POST', 'designations', [{ org_id: ORG, name: 'Admin', role: 'admin' }]))[0];

const email = 'admin@mercor-recordings.in-sync.co.in';
let prof = (await rest('GET', `profiles?org_id=eq.${ORG}&email=eq.${encodeURIComponent(email)}&select=id`))[0];
if (!prof) {
  const r = await fetch(U + '/auth/v1/admin/users', { method: 'POST', headers: H, body: JSON.stringify({ email, password: PASSWORD, email_confirm: true, user_metadata: { first_name: 'Mercor', last_name: 'Admin', org_id: ORG } }) });
  const j = await r.json();
  if (!r.ok) throw new Error('create user ' + JSON.stringify(j));
  prof = { id: j.id };
}
await rest('PATCH', `profiles?id=eq.${prof.id}`, { first_name: 'Mercor', last_name: 'Admin', org_id: ORG, email, designation_id: desig.id, is_active: true, onboarding_completed: true }, 'return=minimal');
await rest('DELETE', `user_roles?user_id=eq.${prof.id}&org_id=eq.${ORG}`, null, 'return=minimal');
await rest('POST', 'user_roles', [{ user_id: prof.id, org_id: ORG, role: 'admin', is_active: true }], 'return=minimal');

if (process.argv.includes('--reset')) { await rest('DELETE', `contacts?org_id=eq.${ORG}`, null, 'return=minimal'); console.log('contacts cleared'); }

let stages = await rest('GET', `pipeline_stages?org_id=eq.${ORG}&select=id,name`);
if (!stages.length) stages = await rest('POST', 'pipeline_stages', STAGES.map(([name, stage_order, probability, color]) => ({ org_id: ORG, name, stage_order, probability, color, is_active: true })));
const stageId = Object.fromEntries(stages.map((s) => [s.name, s.id]));

const existing = await rest('GET', `contacts?org_id=eq.${ORG}&select=id&limit=1`);
if (existing.length) { console.log('contacts already present; use --reset to rebuild'); process.exit(0); }

const now = Date.now();
const rows = [];
const used = new Set();
for (const [name, , , , n] of STAGES) for (let i = 0; i < n; i++) {
  let phone; do { phone = '+9190001' + String(int(0, 99999)).padStart(5, '0'); } while (used.has(phone)); used.add(phone);
  const [city, state] = pick(CITIES);
  const first = pick(FIRST), last = pick(LAST), created = new Date(now - int(1, 80) * 864e5);
  rows.push({
    id: randomUUID(), org_id: ORG, first_name: first, last_name: last, phone, email: `${first}.${last}${rows.length}@example.com`.toLowerCase(),
    city, state, country: 'India', source: pick(SOURCES), pipeline_stage_id: stageId[name], assigned_to: prof.id, created_by: prof.id,
    created_at: created.toISOString(), updated_at: new Date(created.getTime() + int(0, 20) * 864e5).toISOString(),
  });
}
for (let i = rows.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [rows[i], rows[j]] = [rows[j], rows[i]]; }
for (let i = 0; i < rows.length; i += 250) await rest('POST', 'contacts', rows.slice(i, i + 250), 'return=minimal');
console.log('contacts inserted:', rows.length, '| login:', email, '(password in .env: MERCOR_DEMO_PASSWORD)');
