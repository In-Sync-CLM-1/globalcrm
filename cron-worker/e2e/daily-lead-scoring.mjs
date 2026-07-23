// Not org-scoped -- processes up to 100 real contacts system-wide, same as
// the nightly cron already does at the same real cost (one analyze-lead /
// Claude call per contact). This is the same operation, just invoked once
// more; proves the query + Functions Gateway path end to end without
// needing synthetic fixtures.
//
// Deliberately does NOT assert processed >= 1: analyze-lead (a separate,
// pre-existing edge function, unmodified here) has its own known bug --
// it doesn't enforce JSON-mode on Claude's reply, so an occasional
// markdown-fenced response fails to parse and the whole call errors.
// Confirmed pre-existing (contact_lead_scores had only 1 successful score
// in the last 3 days, before this migration touched anything) -- not
// something to silently paper over here. This check only asserts what this
// migration is responsible for: the worker runs to completion (no timeout/
// 502, fixed by batching -- see native/daily-lead-scoring.js) and returns a
// well-formed, fully-accounted-for response.
function assert(cond, msg) { if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`); }

export async function run(env) {
  const res = await fetch(env.WORKER_URL);
  if (!res.ok) throw new Error(`worker invoke failed: ${res.status} ${await res.text()}`);
  const body = await res.json();
  assert(!body.error, `unexpected error: ${JSON.stringify(body)}`);
  assert(typeof body.processed === "number", `expected a numeric processed count, got ${JSON.stringify(body)}`);
  assert(typeof body.failed === "number", `expected a numeric failed count, got ${JSON.stringify(body)}`);
  assert(body.processed + body.failed === body.total, `processed+failed should account for every scanned contact, got ${JSON.stringify(body)}`);
  return { name: "daily-lead-scoring", ok: true };
}
