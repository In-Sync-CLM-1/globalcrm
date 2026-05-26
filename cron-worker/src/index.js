// globalcrm external scheduler — ONE worker per function (no shared invocation,
// so a slow/failing function can't affect the others).
//
// In-database pg_net intermittently fails DNS ("Couldn't resolve host name"),
// so the edge functions its crons trigger barely fire. Each deployed worker
// (see the per-function *.toml configs) sets TARGET_FN and runs its own cron,
// POSTing to that one function. Auths with the service-role key (a Worker
// secret) so it passes verify_jwt where required (ai-bulk-call).
const BASE = "https://ejzjrvazegaxrhqizgaa.supabase.co/functions/v1";

async function tick(env) {
  if (!env.TARGET_FN) return new Response("no TARGET_FN configured\n", { status: 500 });
  const res = await fetch(`${BASE}/${env.TARGET_FN}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` },
    body: "{}",
  }).catch((e) => new Response(String(e), { status: 502 }));
  return new Response(`${env.TARGET_FN}: ${res.status}\n`);
}

export default {
  async scheduled(_event, env, _ctx) { await tick(env); },
  // Manual kick / health check.
  async fetch(_req, env) { return tick(env); },
};
