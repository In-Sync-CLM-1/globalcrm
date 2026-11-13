// Seed a realistic month of multi-channel activity so the dashboard's ECharts
// read as a living business rather than a one-day spike:
//   • call_logs spread across the month with a varied disposition mix
//   • email_conversations + whatsapp_messages (the marketing engine timeline)
import { loadEnv } from './lib/env.mjs';
const env = loadEnv(new URL('../.env', import.meta.url));
const U = env.SUPABASE_URL, K = env.SUPABASE_SERVICE_ROLE_KEY;
const ORG = '61f7f96d-e80c-4d9b-a765-8eb32bd3c70d';
const AGENT = '1d9bf35f-f548-4952-8496-dede5b2475e9';
const H = { apikey: K, Authorization: 'Bearer ' + K, 'Content-Type': 'application/json' };
const g = async (p) => { const r = await fetch(U + '/rest/v1/' + p, { headers: H }); return r.ok ? r.json() : []; };
const post = async (t, rows) => {
  const r = await fetch(U + '/rest/v1/' + t, { method: 'POST', headers: { ...H, Prefer: 'return=minimal' }, body: JSON.stringify(rows) });
  if (!r.ok) { console.log('  POST', t, r.status, (await r.text()).slice(0, 180)); return 0; }
  return rows.length;
};

const dispos = await g(`call_dispositions?org_id=eq.${ORG}&select=id,name`);
const contacts = await g(`contacts?org_id=eq.${ORG}&select=id,phone&limit=400`);
console.log('dispositions:', dispos.length, '| contacts:', contacts.length);

// weighted disposition mix — a believable sales week
const MIX = [
  ['Follow Up — Interested', 26], ['Did Not Pick Up', 22], ['Call Back Requested', 14],
  ['Not Interested', 16], ['Demo Scheduled', 8], ['Wrong Number / DND', 8], ['Switched Off', 6],
];
const byName = Object.fromEntries(dispos.map((d) => [d.name, d.id]));
const weighted = [];
for (const [name, w] of MIX) { const id = byName[name]; if (id) for (let i = 0; i < w; i++) weighted.push(id); }
if (!weighted.length) dispos.forEach((d) => weighted.push(d.id));
console.log('weighted pool:', weighted.length, '(matched', new Set(weighted).size, 'dispositions)');

// mulberry32 — deterministic so re-runs look the same
let s = 20260724;
const rnd = () => { s |= 0; s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const pick = (a) => a[Math.floor(rnd() * a.length)];

const DAYS = 24; // Jul 1 .. today
const now = new Date();
const dayOf = (back, hour) => { const d = new Date(now); d.setDate(d.getDate() - back); d.setHours(hour, Math.floor(rnd() * 59), 0, 0); return d.toISOString(); };

// ── calls: 18-46/day, business hours, weekday-weighted ────────────────────────
const calls = [];
for (let back = DAYS; back >= 0; back--) {
  const d = new Date(now); d.setDate(d.getDate() - back);
  const dow = d.getDay();
  const base = dow === 0 ? 6 : dow === 6 ? 12 : 26;
  const n = Math.round(base + rnd() * 18);
  for (let i = 0; i < n; i++) {
    const c = pick(contacts);
    const dur = Math.round(30 + rnd() * 420);
    const at = dayOf(back, 9 + Math.floor(rnd() * 9));
    calls.push({
      org_id: ORG, contact_id: c.id, agent_id: AGENT, caller_type: 'human',
      call_type: 'outbound', direction: 'outbound', status: 'completed',
      exotel_call_sid: 'seed-' + back + '-' + i + '-' + Math.floor(rnd() * 1e9).toString(36),
      from_number: '+918046805555',
      to_number: c.phone || '+91' + (9000000000 + Math.floor(rnd() * 99999999)),
      call_duration: dur, conversation_duration: Math.max(0, dur - 12),
      disposition_id: pick(weighted),
      started_at: at, created_at: at,
    });
  }
}
let n = 0;
for (let i = 0; i < calls.length; i += 200) n += await post('call_logs', calls.slice(i, i + 200));
console.log('call_logs inserted:', n);

// ── email + whatsapp: the marketing engine timeline ───────────────────────────
const emails = [], was = [];
for (let back = DAYS; back >= 0; back--) {
  const d = new Date(now); d.setDate(d.getDate() - back);
  const dow = d.getDay();
  const em = dow === 0 || dow === 6 ? Math.round(4 + rnd() * 8) : Math.round(18 + rnd() * 26);
  const wa = dow === 0 || dow === 6 ? Math.round(3 + rnd() * 6) : Math.round(12 + rnd() * 20);
  const SUBJ = ['Your WorkSync demo — next steps', 'Quick question about your sales stack', 'Proposal inside: 40 seats', 'Following up on our call', 'Case study: 3x pipeline in 90 days'];
  const WABODY = ['Hi! Sharing the demo recording as promised.', 'Following up — shall we lock a slot this week?', 'Your proposal is ready. Want a quick walkthrough?', 'Reminder: demo tomorrow at 3 PM.'];
  for (let i = 0; i < em; i++) {
    const c = pick(contacts);
    const at = dayOf(back, 9 + Math.floor(rnd() * 10));
    emails.push({
      org_id: ORG, contact_id: c.id, sent_by: AGENT, direction: 'outbound',
      conversation_id: crypto.randomUUID(),
      from_email: 'sales@in-sync.co.in', from_name: 'In-Sync Sales', to_email: 'lead' + i + '@example.in',
      subject: pick(SUBJ), email_content: 'Sent from In-Sync CRM.', status: 'sent',
      sent_at: at, created_at: at,
    });
  }
  for (let i = 0; i < wa; i++) {
    const c = pick(contacts);
    const at = dayOf(back, 9 + Math.floor(rnd() * 10));
    was.push({
      org_id: ORG, contact_id: c.id, sent_by: AGENT, direction: 'outbound',
      phone_number: c.phone || '+919000000000', message_content: pick(WABODY),
      status: 'delivered', sent_at: at, delivered_at: at, created_at: at,
    });
  }
}
let ne = 0, nw = 0;
for (let i = 0; i < emails.length; i += 200) ne += await post('email_conversations', emails.slice(i, i + 200));
for (let i = 0; i < was.length; i += 200) nw += await post('whatsapp_messages', was.slice(i, i + 200));
console.log('email_conversations:', ne, '| whatsapp_messages:', nw);
console.log('DONE');
