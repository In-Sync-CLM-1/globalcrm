// Safety net for process-bulk-import's self-continuation (see
// FERVENT_TIME_BUDGET_MS in supabase/functions/process-bulk-import/index.ts).
// A large import checkpoints itself and fires a fresh invocation to keep
// going past the platform's per-call execution limit; if that fire-and-forget
// kick is ever lost (network blip, worker recycled mid-flight), the job would
// otherwise sit at status=processing forever with no failure path. This sweep
// re-kicks anything that's gone quiet for a while so it always finishes (or
// fails loud) instead of hanging silently.
import { pgSelect, invokeFunction } from "./_lib/postgrest.js";

const STALE_MINUTES = 3;
const MAX_PER_TICK = 20;
const IN_FLIGHT_STAGES = "downloading,validating,parsing,inserting,finalizing";

async function tick(env) {
  const cutoff = new Date(Date.now() - STALE_MINUTES * 60 * 1000).toISOString();
  const stuck = await pgSelect(
    env,
    "import_jobs",
    `status=eq.processing&current_stage=in.(${IN_FLIGHT_STAGES})&updated_at=lt.${cutoff}&select=id,file_name,current_stage,processed_rows,total_rows,updated_at&order=updated_at.asc&limit=${MAX_PER_TICK}`
  );
  if (!stuck || stuck.length === 0) return { ok: true, resumed: 0 };

  const results = [];
  for (const job of stuck) {
    const { error } = await invokeFunction(env, "process-bulk-import", { importJobId: job.id });
    results.push({
      job_id: job.id,
      file_name: job.file_name,
      stalled_at: `${job.processed_rows ?? 0}/${job.total_rows ?? "?"}`,
      last_update: job.updated_at,
      kicked: !error,
      error: error ? String(error.message || error) : undefined,
    });
  }
  return { ok: true, resumed: results.length, results };
}

export default {
  async scheduled(_event, env, ctx) { ctx.waitUntil(tick(env)); },
  async fetch(_req, env) {
    let out;
    try { out = await tick(env); } catch (e) { out = { ok: false, error: String((e && e.stack) || e) }; }
    return new Response(JSON.stringify(out), { headers: { "Content-Type": "application/json" } });
  },
};
