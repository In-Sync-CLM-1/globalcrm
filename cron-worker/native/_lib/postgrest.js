// Shared PostgREST + Functions-Gateway helpers for native workers.
//
// Two different Supabase keys are needed and MUST NOT be mixed up:
//   env.SUPABASE_SERVICE_ROLE_KEY      - new-format ("sb_secret_...") key,
//                                         bound from the SUPABASE_SERVICE_ROLE_KEY_REST
//                                         repo secret. Works for direct PostgREST
//                                         (/rest/v1/...) calls. Legacy-format keys
//                                         are disabled project-wide and 401 here.
//   env.SUPABASE_FUNCTIONS_KEY         - legacy-format JWT, bound from the shared
//                                         SUPABASE_SERVICE_ROLE_KEY repo secret (the
//                                         same one the thin-dispatcher fleet uses).
//                                         Required to invoke another edge function
//                                         through the Functions Gateway
//                                         (/functions/v1/...) - the new-format key
//                                         is rejected there with "Invalid JWT".
// See project_globalcrm_native_worker_migration memory for how this was found.

export function restHeaders(env, extra) {
  return { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, "Content-Type": "application/json", ...extra };
}

export async function pgSelect(env, table, qs) {
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}?${qs}`, { headers: restHeaders(env) });
  if (!r.ok) { const t = await r.text(); throw new Error(`select ${table} failed: ${r.status} ${t}`); }
  return r.json();
}

export async function pgSelectOne(env, table, qs) {
  const rows = await pgSelect(env, table, qs);
  return rows[0] ?? null;
}

export async function pgRpc(env, fn, args) {
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${fn}`, { method: "POST", headers: restHeaders(env), body: JSON.stringify(args || {}) });
  if (!r.ok) { const t = await r.text(); throw new Error(`rpc ${fn} failed: ${r.status} ${t}`); }
  const text = await r.text();
  return text ? JSON.parse(text) : null;
}

export async function pgInsertReturning(env, table, body) {
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}`, { method: "POST", headers: restHeaders(env, { Prefer: "return=representation" }), body: JSON.stringify(body) });
  if (!r.ok) { const t = await r.text(); throw new Error(`insert ${table} failed: ${r.status} ${t}`); }
  const rows = await r.json();
  return rows[0] ?? null;
}

export async function pgInsert(env, table, body) {
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}`, { method: "POST", headers: restHeaders(env), body: JSON.stringify(body) });
  if (!r.ok) { const t = await r.text(); throw new Error(`insert ${table} failed: ${r.status} ${t}`); }
}

export async function pgPatch(env, table, qs, body) {
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}?${qs}`, { method: "PATCH", headers: restHeaders(env), body: JSON.stringify(body) });
  if (!r.ok) { const t = await r.text(); throw new Error(`patch ${table} failed: ${r.status} ${t}`); }
}

export async function pgDelete(env, table, qs) {
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}?${qs}`, { method: "DELETE", headers: restHeaders(env) });
  if (!r.ok) { const t = await r.text(); throw new Error(`delete ${table} failed: ${r.status} ${t}`); }
}

// Invokes another Supabase edge function through the Functions Gateway.
// Needs the LEGACY-format key (env.SUPABASE_FUNCTIONS_KEY) -- see header note.
export async function invokeFunction(env, slug, body) {
  const r = await fetch(`${env.SUPABASE_URL}/functions/v1/${slug}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.SUPABASE_FUNCTIONS_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  });
  const text = await r.text();
  let data; try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!r.ok) return { data: null, error: { message: `${r.status}: ${text}` } };
  return { data, error: null };
}
