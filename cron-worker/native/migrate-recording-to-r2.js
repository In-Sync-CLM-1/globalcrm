// Native port of supabase/functions/migrate-recording-to-r2/index.ts.
import { pgSelect, pgSelectOne, pgPatch } from "./_lib/postgrest.js";

const INSYNC_DEMO_ORG_ID = "61f7f96d-e80c-4d9b-a765-8eb32bd3c70d";
const BATCH_LIMIT = 50;

function r2KeyFor(row) {
  const created = new Date(row.created_at);
  const yyyy = created.getUTCFullYear();
  const mm = String(created.getUTCMonth() + 1).padStart(2, "0");
  return `${row.org_id}/${yyyy}/${mm}/${row.id}.mp3`;
}

async function tick(env) {
  const workerUrl = env.R2_RECORDINGS_WORKER_URL;
  const workerSecret = env.R2_RECORDINGS_SECRET;
  if (!workerUrl || !workerSecret) return { error: "R2 worker config missing" };

  const pending = await pgSelect(env, "call_logs",
    `org_id=eq.${INSYNC_DEMO_ORG_ID}&recording_url=not.is.null&recording_url=neq.&r2_key=is.null&order=created_at.asc&limit=${BATCH_LIMIT}` +
    `&select=id,org_id,recording_url,created_at`);

  if (!pending || pending.length === 0) return { ok: true, processed: 0, message: "Nothing to migrate" };

  const exotelSettings = await pgSelectOne(env, "exotel_settings", `org_id=eq.${INSYNC_DEMO_ORG_ID}&select=api_key,api_token&limit=1`);
  if (!exotelSettings) return { error: "Exotel settings not found for org" };
  const exotelAuth = "Basic " + btoa(`${exotelSettings.api_key}:${exotelSettings.api_token}`);

  let uploaded = 0, failed = 0;
  const errors = [];

  for (const row of pending) {
    try {
      const key = r2KeyFor(row);
      const exotelResp = await fetch(row.recording_url, { headers: { Authorization: exotelAuth } });
      if (!exotelResp.ok) throw new Error(`Exotel fetch failed: ${exotelResp.status}`);
      const contentType = exotelResp.headers.get("content-type") || "audio/mpeg";
      const audioBuffer = await exotelResp.arrayBuffer();

      const putResp = await fetch(`${workerUrl}/${key}`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${workerSecret}`, "Content-Type": contentType },
        body: audioBuffer,
      });
      if (!putResp.ok) throw new Error(`R2 PUT failed: ${putResp.status} ${await putResp.text()}`);

      await pgPatch(env, "call_logs", `id=eq.${row.id}`, { r2_key: key, r2_uploaded_at: new Date().toISOString(), r2_upload_error: null });
      uploaded += 1;
    } catch (err) {
      failed += 1;
      const msg = err?.message || String(err);
      errors.push({ id: row.id, error: msg });
      await pgPatch(env, "call_logs", `id=eq.${row.id}`, { r2_upload_error: msg.slice(0, 500) });
    }
  }

  return { ok: true, processed: pending.length, uploaded, failed, errors: errors.slice(0, 10) };
}

export default {
  async scheduled(_event, env, ctx) { ctx.waitUntil(tick(env)); },
  async fetch(_req, env) {
    let out;
    try { out = await tick(env); } catch (e) { out = { ok: false, error: String(e && e.stack || e) }; }
    return new Response(JSON.stringify(out), { headers: { "Content-Type": "application/json" } });
  },
};
