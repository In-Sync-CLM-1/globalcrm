// The E2E test org is marked is_internal=true (matching every other e2e
// fixture in this directory), which this function deliberately exempts from
// billing alerts -- so a synthetic low-balance row on it would just be
// silently skipped, not a real test. Verifying the WhatsApp/email send paths
// safely would need a second, non-internal fixture org, which isn't worth
// the added surface area here -- this proves connectivity + query shape,
// matching the same bar as subscription-status-checker.
function assert(cond, msg) { if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`); }

export async function run(env) {
  const res = await fetch(env.WORKER_URL);
  if (!res.ok) throw new Error(`worker invoke failed: ${res.status} ${await res.text()}`);
  const body = await res.json();
  assert(body.ok === true, `expected ok:true, got ${JSON.stringify(body)}`);
  assert(typeof body.checked === "number", `expected a numeric checked count, got ${JSON.stringify(body)}`);
  return { name: "wallet-alert-check", ok: true };
}
