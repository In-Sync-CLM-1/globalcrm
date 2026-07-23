// Lightweight check: this function reads/updates only internal status flags
// (no external send of any kind), so a real invoke against production carries
// no extra risk beyond what the cron already does every night. Just proves
// auth + query shape are correct.
function assert(cond, msg) { if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`); }

export async function run(env) {
  const res = await fetch(env.WORKER_URL);
  if (!res.ok) throw new Error(`worker invoke failed: ${res.status} ${await res.text()}`);
  const body = await res.json();
  assert(body.success === true, `expected success:true, got ${JSON.stringify(body)}`);
  assert(typeof body.checked === "number" && body.checked > 0, `expected checked > 0 (real active orgs should exist), got ${body.checked}`);
  return { name: "subscription-status-checker", ok: true };
}
