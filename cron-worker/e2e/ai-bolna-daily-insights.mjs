// Invoke for a guaranteed-empty far-future date so it proves the query/auth
// path without ever spending on a real Anthropic call.
function assert(cond, msg) { if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`); }

export async function run(env) {
  const res = await fetch(env.WORKER_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ for_date: "2099-01-01" }) });
  if (!res.ok) throw new Error(`worker invoke failed: ${res.status} ${await res.text()}`);
  const body = await res.json();
  assert(body.ok === true, `expected ok:true, got ${JSON.stringify(body)}`);
  assert(body.total === 0, `expected 0 calls for a far-future date, got ${JSON.stringify(body)}`);
  return { name: "ai-bolna-daily-insights", ok: true };
}
