// Native port of supabase/functions/queue-processor/index.ts.
import { pgSelect, pgPatch, pgInsert, invokeFunction } from "./_lib/postgrest.js";

async function executeOperation(env, job) {
  console.log(`Executing ${job.operation_type} for job ${job.id}`);
  switch (job.operation_type) {
    case "bulk_whatsapp_send": {
      const { campaign_id } = job.payload;
      const { data, error } = await invokeFunction(env, "bulk-whatsapp-sender", { campaign_id, skip_rate_limit: true });
      if (error) throw new Error(String(error.message || error));
      return data;
    }
    case "template_sync": {
      const { data, error } = await invokeFunction(env, "sync-gupshup-templates", { skip_rate_limit: true });
      if (error) throw new Error(String(error.message || error));
      return data;
    }
    case "contact_import": {
      const { data, error } = await invokeFunction(env, "queue-manager", { ...job.payload, skip_rate_limit: true });
      if (error) throw new Error(String(error.message || error));
      return data;
    }
    case "webhook_lead_processing": {
      const { contact_data } = job.payload;
      return await (async () => {
        const r = await fetch(`${env.SUPABASE_URL}/rest/v1/contacts`, {
          method: "POST",
          headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, "Content-Type": "application/json", Prefer: "return=representation" },
          body: JSON.stringify(contact_data),
        });
        if (!r.ok) throw new Error(`insert contacts failed: ${r.status} ${await r.text()}`);
        const rows = await r.json();
        return rows[0];
      })();
    }
    default:
      throw new Error(`Unknown operation type: ${job.operation_type}`);
  }
}

async function tick(env) {
  const jobs = await pgSelect(env, "operation_queue",
    `status=eq.queued&scheduled_at=lte.${new Date().toISOString()}&order=priority.desc,scheduled_at.asc&limit=50&select=*`);

  let processed = 0, failed = 0;

  for (const job of jobs || []) {
    try {
      await pgPatch(env, "operation_queue", `id=eq.${job.id}`, { status: "processing", started_at: new Date().toISOString() });

      const result = await executeOperation(env, job);

      await pgPatch(env, "operation_queue", `id=eq.${job.id}`, { status: "completed", completed_at: new Date().toISOString(), result });
      await pgInsert(env, "rate_limit_log", { user_id: job.user_id, org_id: job.org_id, operation: job.operation_type });

      processed++;
    } catch (error) {
      console.error(`Job ${job.id} failed:`, String(error));
      await pgPatch(env, "operation_queue", `id=eq.${job.id}`, { status: "failed", completed_at: new Date().toISOString(), error_message: error.message || "Unknown error" });
      failed++;
    }
  }

  return { success: true, total_jobs: jobs?.length || 0, processed, failed };
}

export default {
  async scheduled(_event, env, ctx) { ctx.waitUntil(tick(env)); },
  async fetch(_req, env) {
    let out;
    try { out = await tick(env); } catch (e) { out = { success: false, error: String(e && e.stack || e) }; }
    return new Response(JSON.stringify(out), { headers: { "Content-Type": "application/json" } });
  },
};
