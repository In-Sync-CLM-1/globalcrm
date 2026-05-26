// globalcrm external scheduler — ONE worker per function (no shared invocation,
// so a slow/failing function can't affect the others).
//
// In-database pg_net intermittently fails DNS ("Couldn't resolve host name"),
// so the edge functions its crons trigger barely fire. Each deployed worker
// (see the per-function *.toml configs) sets TARGET_FN and runs its own cron,
// POSTing to that one function. Auths with the service-role key (a Worker
// secret) so it passes verify_jwt where required (ai-bulk-call).
const FN_BASE = "https://ejzjrvazegaxrhqizgaa.supabase.co/functions/v1";
const RPC_BASE = "https://ejzjrvazegaxrhqizgaa.supabase.co/rest/v1/rpc";

async function tick(env) {
  if (!env.TARGET_FN) return new Response("no TARGET_FN configured\n", { status: 500 });
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  let url, headers;
  if (env.TARGET_FN.startsWith("rpc:")) {
    // In-DB SQL cron: call the Postgres function via PostgREST RPC.
    url = `${RPC_BASE}/${env.TARGET_FN.slice(4)}`;
    headers = { "Content-Type": "application/json", apikey: key, Authorization: `Bearer ${key}` };
  } else {
    // Edge function (passes verify_jwt via the service-role key where required).
    url = `${FN_BASE}/${env.TARGET_FN}`;
    headers = { "Content-Type": "application/json", Authorization: `Bearer ${key}` };
  }
  const res = await fetch(url, { method: "POST", headers, body: "{}" }).catch((e) => new Response(String(e), { status: 502 }));
  return new Response(`${env.TARGET_FN}: ${res.status}\n`);
}

export default {
  async scheduled(_event, env, _ctx) { await tick(env); },
  // Manual kick / health check.
  async fetch(_req, env) { return tick(env); },
};
