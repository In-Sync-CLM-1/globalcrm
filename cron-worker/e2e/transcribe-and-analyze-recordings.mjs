// Scoped to In-Sync Demo org only and idempotent (only touches rows with no
// transcript yet) -- safe to invoke directly, same as the cron does.
function assert(cond, msg) { if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`); }

export async function run(env) {
  const res = await fetch(env.WORKER_URL);
  if (!res.ok) throw new Error(`worker invoke failed: ${res.status} ${await res.text()}`);
  const body = await res.json();
  assert(body.ok === true, `expected ok:true, got ${JSON.stringify(body)}`);
  return { name: "transcribe-and-analyze-recordings", ok: true };
}
