// Discovered during e2e testing: the DB's operation_queue_operation_type_check
// constraint only allows ('bulk_whatsapp','template_sync','contact_import',
// 'webhook_lead','bulk_email'), but the original code's switch-cases check
// for 'bulk_whatsapp_send' and 'webhook_lead_processing' instead -- neither
// of which can ever pass the DB constraint. Those two branches were already
// dead/unreachable in production before this migration touched anything;
// ported the exact same (mismatched) strings faithfully rather than quietly
// fixing business logic during an infra migration. Only 'template_sync' and
// 'contact_import' can ever actually run. This is a lightweight connectivity
// check rather than a synthetic-job test, since a safe test of the
// contact_import path would need queue-manager's exact expected payload
// shape, which is its own function to research separately.
function assert(cond, msg) { if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`); }

export async function run(env) {
  const res = await fetch(env.WORKER_URL);
  if (!res.ok) throw new Error(`worker invoke failed: ${res.status} ${await res.text()}`);
  const body = await res.json();
  assert(body.success === true, `expected success:true, got ${JSON.stringify(body)}`);
  assert(typeof body.processed === "number" && typeof body.failed === "number", `expected numeric processed/failed counts, got ${JSON.stringify(body)}`);
  return { name: "queue-processor", ok: true };
}
