// Native port of supabase/functions/subscription-status-checker/index.ts.
import { pgSelect, pgSelectOne, pgRpc } from "./_lib/postgrest.js";

async function tick(env) {
  const orgs = await pgSelect(env, "organizations", "subscription_active=eq.true&select=id,name");

  let checkedCount = 0;
  let updatedCount = 0;

  for (const org of orgs || []) {
    try {
      await pgRpc(env, "check_and_update_subscription_status", { _org_id: org.id });
      checkedCount++;
      const sub = await pgSelectOne(env, "organization_subscriptions", `org_id=eq.${org.id}&select=subscription_status&limit=1`);
      if (sub && sub.subscription_status !== "active") updatedCount++;
    } catch (e) {
      console.error(`Error processing org ${org.id}:`, String(e));
    }
  }

  return { success: true, checked: checkedCount, updated: updatedCount };
}

export default {
  async scheduled(_event, env, ctx) { ctx.waitUntil(tick(env)); },
  async fetch(_req, env) {
    let out;
    try { out = await tick(env); } catch (e) { out = { success: false, error: String(e && e.stack || e) }; }
    return new Response(JSON.stringify(out), { headers: { "Content-Type": "application/json" } });
  },
};
