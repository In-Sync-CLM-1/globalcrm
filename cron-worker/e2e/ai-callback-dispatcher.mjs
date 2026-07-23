// Same risk profile whether triggered by this check or by the cron moments
// later -- the working-window gate already guards real dispatch, so this
// just proves the worker deploys and responds correctly.
function assert(cond, msg) { if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`); }

export async function run(env) {
  const res = await fetch(env.WORKER_URL);
  if (!res.ok) throw new Error(`worker invoke failed: ${res.status} ${await res.text()}`);
  const body = await res.json();
  assert(body.ok === true, `expected ok:true, got ${JSON.stringify(body)}`);
  return { name: "ai-callback-dispatcher", ok: true };
}
