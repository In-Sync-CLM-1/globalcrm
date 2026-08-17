// One-off: create the two demo login users for the walkthrough and wire them
// into the In-Sync Demo org. Idempotent. Run: node scripts/walkthrough/_setup-users.mjs
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync(new URL('../../.env', import.meta.url), 'utf8').split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const URL_ = env.SUPABASE_URL;
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY;
const REF = env.SUPABASE_PROJECT_REF;
const TOKEN = env.SUPABASE_ACCESS_TOKEN;
const DEMO = '61f7f96d-e80c-4d9b-a765-8eb32bd3c70d';

async function sql(query) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json', 'User-Agent': 'curl/8' },
    body: JSON.stringify({ query }),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`SQL ${r.status}: ${t}`);
  return t ? JSON.parse(t) : [];
}
const Q = (s) => (s == null ? 'null' : `'${String(s).replace(/'/g, "''")}'`);

async function ensureUser(email, password) {
  // try create
  const res = await fetch(`${URL_}/auth/v1/admin/users`, {
    method: 'POST', headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  if (res.ok) { const j = await res.json(); return j.id; }
  // already exists -> look up id, then reset password to the known value
  const rows = await sql(`select id from auth.users where email=${Q(email)} limit 1`);
  if (!rows.length) throw new Error(`could not create or find ${email}: ${await res.text()}`);
  const id = rows[0].id;
  await fetch(`${URL_}/auth/v1/admin/users/${id}`, {
    method: 'PUT', headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ password, email_confirm: true }),
  });
  return id;
}

async function wire(id, email, first, last, role) {
  await sql(`
    insert into profiles (id, org_id, first_name, last_name, email, is_active, onboarding_completed, calling_enabled, whatsapp_enabled, email_enabled)
    values (${Q(id)}, ${Q(DEMO)}, ${Q(first)}, ${Q(last)}, ${Q(email)}, true, true, true, true, true)
    on conflict (id) do update set org_id=${Q(DEMO)}, first_name=${Q(first)}, last_name=${Q(last)}, email=${Q(email)},
      is_active=true, onboarding_completed=true, calling_enabled=true, whatsapp_enabled=true, email_enabled=true;
    delete from user_roles where user_id=${Q(id)} and org_id=${Q(DEMO)};
    insert into user_roles (id, user_id, org_id, role, is_active) values (gen_random_uuid(), ${Q(id)}, ${Q(DEMO)}, ${Q(role)}::app_role, true);
  `);
}

const priya = await ensureUser('priya.nair@demo.in-sync.co.in', 'GcDemo#2026');
await wire(priya, 'priya.nair@demo.in-sync.co.in', 'Priya', 'Nair', 'sales_agent');
const arjun = await ensureUser('arjun.rao@demo.in-sync.co.in', 'GcDemo#2026');
await wire(arjun, 'arjun.rao@demo.in-sync.co.in', 'Arjun', 'Rao', 'admin');

console.log('PRIYA_ID=' + priya);
console.log('ARJUN_ID=' + arjun);
console.log('done.');
