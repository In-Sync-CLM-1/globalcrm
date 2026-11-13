// Tamper-evident activity ledger: scheduled guard.
//
//   every 5 minutes   seal new ledger entries into a block and copy new sign-ins
//   nightly           1. seal
//                     2. verify the whole chain inside the database
//                     3. match the database against the full copy kept in Cloudflare R2
//                     4. copy blocks sealed since the last run to R2 and read them back
//                     5. match / add the fingerprint copy kept in Google Drive
//                     6. record the result, and email OPS_EMAIL only if something does not match
//
// R2 layout (private bucket binding LEDGER_BUCKET, under ledger-copy/):
//   manifests/<from>-<to>.json     one per nightly segment: block headers + the part files
//   entries/<from>-<to>-<n>.json   the entries of those blocks, in chain order
// The copy is only ever added to.
//
// Secrets: SUPABASE_SERVICE_ROLE_KEY_REST (new-format secret key, needed by PostgREST),
//          RESEND_API_KEY, GOOGLE_DRIVE_CLIENT_ID / _CLIENT_SECRET / _REFRESH_TOKEN,
//          GOOGLE_DRIVE_ANCHOR_FOLDER_ID. Vars: SUPABASE_URL, PROJECT_LABEL, OPS_EMAIL, ALERT_FROM.
import { createHash } from "node:crypto";

const PREFIX = "ledger-copy/";
const PART_SIZE = 5000;
const FILE_PREFIX = "ledger-anchor-";
const enc = new TextEncoder();
const dec = new TextDecoder();

const sha256 = (s) => createHash("sha256").update(s).digest("hex");
const pad = (n, w) => String(n).padStart(w, "0");
// Same recipe as ledger_block_hash() in the database.
const blockHash = (b) => sha256(`${b.prev_hash}|${b.block_no}|${b.from_xid}|${b.up_to_xid}|${b.entry_count}|${b.rows_hash}`);

async function rpc(env, fn, args = {}) {
  const key = env.SUPABASE_SERVICE_ROLE_KEY_REST;
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: key, Authorization: `Bearer ${key}` },
    body: JSON.stringify(args),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${fn}: HTTP ${r.status} ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}

async function insertRow(env, table, row) {
  const key = env.SUPABASE_SERVICE_ROLE_KEY_REST;
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: key, Authorization: `Bearer ${key}`, Prefer: "return=minimal" },
    body: JSON.stringify(row),
  });
  if (!r.ok) throw new Error(`insert ${table}: HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
}

async function r2ListAll(bucket, prefix) {
  const keys = [];
  let cursor;
  do {
    const page = await bucket.list({ prefix, cursor, limit: 1000 });
    keys.push(...page.objects.map((o) => o.key));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return keys;
}

async function r2Bytes(bucket, key) {
  const o = await bucket.get(key);
  if (!o) throw new Error(`R2 object missing: ${key}`);
  return new Uint8Array(await o.arrayBuffer());
}

async function driveAccessToken(env) {
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GOOGLE_DRIVE_CLIENT_ID,
      client_secret: env.GOOGLE_DRIVE_CLIENT_SECRET,
      refresh_token: env.GOOGLE_DRIVE_REFRESH_TOKEN,
      grant_type: "refresh_token",
    }),
  });
  const j = await r.json();
  if (!j.access_token) throw new Error(`Drive login failed: ${j.error_description || j.error || r.status}`);
  return j.access_token;
}

async function driveList(token, folder) {
  const out = [];
  let pageToken = "";
  do {
    const q = encodeURIComponent(`'${folder}' in parents and trashed=false and name contains '${FILE_PREFIX}'`);
    const r = await fetch(
      `https://www.googleapis.com/drive/v3/files?q=${q}&fields=nextPageToken,files(id,name)&pageSize=1000${pageToken ? `&pageToken=${pageToken}` : ""}`,
      { headers: { authorization: `Bearer ${token}` } },
    );
    const j = await r.json();
    if (!r.ok) throw new Error(`Drive list failed: ${JSON.stringify(j).slice(0, 200)}`);
    out.push(...(j.files || []));
    pageToken = j.nextPageToken || "";
  } while (pageToken);
  return out;
}

async function driveRead(token, id) {
  const r = await fetch(`https://www.googleapis.com/drive/v3/files/${id}?alt=media`, { headers: { authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error(`Drive read failed (${r.status})`);
  return await r.json();
}

async function driveUpload(token, folder, name, body) {
  const boundary = "ledgeranchor";
  const payload =
    `--${boundary}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify({ name, parents: [folder] })}\r\n` +
    `--${boundary}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(body, null, 2)}\r\n--${boundary}--`;
  const r = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": `multipart/related; boundary=${boundary}` },
    body: payload,
  });
  const j = await r.json();
  if (!r.ok || !j.id) throw new Error(`Drive upload failed: ${JSON.stringify(j).slice(0, 200)}`);
  return j.id;
}

async function sendAlert(env, subject, html) {
  if (!env.RESEND_API_KEY || !env.OPS_EMAIL) return { skipped: "no RESEND_API_KEY / OPS_EMAIL" };
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json", "User-Agent": "curl/8" },
    body: JSON.stringify({ from: env.ALERT_FROM, to: [env.OPS_EMAIL], subject, html }),
  });
  return { status: r.status };
}

// Every 5 minutes.
async function sealAndCapture(env) {
  const out = {};
  out.logins = await rpc(env, "ledger_capture_logins");
  out.sealed = await rpc(env, "ledger_seal_block");
  return out;
}

// Nightly.
async function nightly(env) {
  const bucket = env.LEDGER_BUCKET;
  const problems = [];
  const dest = {};
  let sealed = null;
  let verify = null;
  let dbBlocks = [];

  try { sealed = await rpc(env, "ledger_seal_block"); } catch (e) { problems.push(`Sealing failed: ${e.message}`); }
  try {
    verify = await rpc(env, "ledger_verify_chain");
    if (!verify?.ok) problems.push(`Chain broken at block ${verify?.first_bad_block}: ${verify?.reason}`);
  } catch (e) { problems.push(`Verification failed to run: ${e.message}`); }
  try { dbBlocks = (await rpc(env, "ledger_blocks_for_copy", { p_from_block: 1 })) || []; }
  catch (e) { problems.push(`Could not read blocks: ${e.message}`); }
  const head = dbBlocks.length ? dbBlocks[dbBlocks.length - 1] : null;
  const byNo = new Map(dbBlocks.map((b) => [Number(b.block_no), b]));

  // 3-4. R2: match what is there, then copy what is new
  try {
    const manifestKeys = (await r2ListAll(bucket, `${PREFIX}manifests/`)).sort();
    let lastCopied = 0;
    let matched = 0;
    let prevHash = "0".repeat(64);
    for (const k of manifestKeys) {
      const m = JSON.parse(dec.decode(await r2Bytes(bucket, k)));
      for (const b of m.blocks) {
        const no = Number(b.block_no);
        if (no !== lastCopied + 1) problems.push(`The copy in R2 skips from block ${lastCopied} to ${no} (${k})`);
        if (b.prev_hash !== prevHash) problems.push(`Block ${no} in the R2 copy does not link to the block before it`);
        if (blockHash(b) !== b.block_hash) problems.push(`Block ${no} in the R2 copy does not match its own fingerprint`);
        prevHash = b.block_hash;
        lastCopied = no;
        const have = byNo.get(no);
        if (!have) problems.push(`Block ${no} is in the R2 copy but missing from the database`);
        else if (have.block_hash !== b.block_hash || have.rows_hash !== b.rows_hash || Number(have.entry_count) !== Number(b.entry_count)) {
          problems.push(`Block ${no} in the database no longer matches the R2 copy`);
        } else matched++;
      }
    }
    dest.r2_blocks_matched = matched;

    const from = lastCopied + 1;
    const to = head ? Number(head.block_no) : 0;
    if (problems.length === 0 && to >= from) {
      const segBlocks = dbBlocks.filter((b) => Number(b.block_no) >= from && Number(b.block_no) <= to);
      const rowsHash = new Map();
      const counts = new Map();
      for (const b of segBlocks) { rowsHash.set(Number(b.block_no), createHash("sha256")); counts.set(Number(b.block_no), 0); }

      const parts = [];
      const range = `${pad(from, 6)}-${pad(to, 6)}`;
      let after = { block: 0, txid: "0", seq: 0 };
      let buf = [];
      const flush = async () => {
        if (!buf.length) return;
        const key = `${PREFIX}entries/${range}-${pad(parts.length + 1, 4)}.json`;
        const bytes = enc.encode(JSON.stringify(buf));
        await bucket.put(key, bytes, { httpMetadata: { contentType: "application/json" } });
        parts.push({ key, entries: buf.length, sha256: sha256(bytes) });
        buf = [];
      };
      for (;;) {
        const rows = (await rpc(env, "ledger_blocks_export", {
          p_from_block: from, p_to_block: to, p_after_block: after.block, p_after_txid: after.txid, p_after_seq: after.seq, p_limit: PART_SIZE,
        })) || [];
        if (!rows.length) break;
        for (const r of rows) {
          const no = Number(r.block_no);
          rowsHash.get(no).update(r.h);
          counts.set(no, (counts.get(no) || 0) + 1);
          buf.push({ block_no: no, h: r.h, e: r.e });
        }
        const last = rows[rows.length - 1];
        after = { block: Number(last.block_no), txid: String(last.txid), seq: Number(last.seq) };
        if (buf.length >= PART_SIZE) await flush();
        if (rows.length < PART_SIZE) break;
      }
      await flush();

      // the entries just read must reproduce each block's fingerprint
      for (const b of segBlocks) {
        const no = Number(b.block_no);
        if (counts.get(no) !== Number(b.entry_count) || rowsHash.get(no).digest("hex") !== b.rows_hash) {
          problems.push(`Block ${no}: the entries read from the database do not match the sealed fingerprint, so it was not copied`);
        }
      }
      if (problems.length === 0) {
        for (const p of parts) {
          if (sha256(await r2Bytes(bucket, p.key)) !== p.sha256) problems.push(`R2 copy read-back differs for ${p.key}`);
        }
      }
      if (problems.length === 0) {
        const mKey = `${PREFIX}manifests/${range}.json`;
        if (await bucket.head(mKey)) throw new Error(`${mKey} already exists; the copy is not overwritten`);
        await bucket.put(mKey, enc.encode(JSON.stringify({
          saved_at: new Date().toISOString(), from_block: from, to_block: to, blocks: segBlocks, parts,
        }, null, 1)), { httpMetadata: { contentType: "application/json" } });
        dest.r2_manifest = mKey;
        dest.r2_new_blocks = segBlocks.length;
        dest.r2_new_entries = parts.reduce((s, p) => s + p.entries, 0);
      }
    } else if (to < from) {
      dest.r2_note = "no new blocks since the last copy";
    }
  } catch (e) {
    problems.push(`R2 copy failed: ${e?.message || e}`);
  }

  // 5. Google Drive: fingerprints only, kept apart from Cloudflare
  let lastAnchored = 0;
  try {
    const folder = env.GOOGLE_DRIVE_ANCHOR_FOLDER_ID;
    if (!folder) throw new Error("GOOGLE_DRIVE_ANCHOR_FOLDER_ID not set");
    const token = await driveAccessToken(env);
    const files = await driveList(token, folder);
    let compared = 0;
    for (const f of files) {
      const j = await driveRead(token, f.id);
      for (const b of j.blocks || []) {
        const no = Number(b.block_no);
        lastAnchored = Math.max(lastAnchored, no);
        const have = byNo.get(no)?.block_hash;
        compared++;
        if (have === undefined) problems.push(`Block ${no} (saved in Drive ${f.name}) is missing from the database`);
        else if (have !== b.block_hash) problems.push(`Block ${no} no longer matches the fingerprint saved in Drive (${f.name})`);
      }
    }
    dest.drive_compared_blocks = compared;
    const fresh = dbBlocks.filter((b) => Number(b.block_no) > lastAnchored);
    if (fresh.length) {
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      dest.drive_file_id = await driveUpload(token, folder, `${FILE_PREFIX}${stamp}.json`, {
        saved_at: new Date().toISOString(),
        chain_verified: !!verify?.ok,
        head_block_no: head ? Number(head.block_no) : null,
        head_block_hash: head?.block_hash ?? null,
        blocks: fresh.map((b) => ({ block_no: Number(b.block_no), block_hash: b.block_hash, entries: Number(b.entry_count), sealed_at: b.sealed_at })),
      });
      dest.drive_new_blocks = fresh.length;
    } else {
      dest.drive_note = "no new blocks since the last saved fingerprint";
    }
  } catch (e) {
    problems.push(`Google Drive copy failed: ${e?.message || e}`);
  }

  const ok = problems.length === 0;

  // 6. record, and alert on failure only
  try {
    await insertRow(env, "ledger_verifications", {
      ok, blocks_checked: Number(verify?.blocks_checked || 0), detail: { verify, problems, sealed },
    });
    if (head) await insertRow(env, "ledger_anchors", { block_no: head.block_no, block_hash: head.block_hash, destinations: dest });
  } catch (e) {
    problems.push(`Could not record the result: ${e.message}`);
  }
  if (problems.length) {
    const day = new Date().toISOString().slice(0, 10);
    dest.email = await sendAlert(
      env,
      `[${env.PROJECT_LABEL}] ALERT - activity ledger check failed ${day}`,
      `<p>The nightly activity ledger check for ${env.PROJECT_LABEL} found a problem:</p><ul>${problems.map((p) => `<li>${p}</li>`).join("")}</ul>` +
        `<p>Do not delete anything. Ask for the ledger to be investigated.</p>`,
    );
  }
  return { ok: problems.length === 0, problems, sealed, verify, head, destinations: dest };
}

async function run(cron, env) {
  try {
    return cron === "30 20 * * *" ? await nightly(env) : await sealAndCapture(env);
  } catch (e) {
    // A failed 5-minute run is retried by the next one; the nightly run reports its own problems.
    const msg = `${cron}: ${e?.message || e}`;
    if (cron === "30 20 * * *") await sendAlert(env, `[${env.PROJECT_LABEL}] ALERT - activity ledger job crashed`, `<p>${msg}</p>`);
    console.error(msg);
    return { ok: false, error: msg };
  }
}

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(run(event.cron, env));
  },
  // Manual run, for the operator: POST ?job=seal|nightly with the service key as Bearer token.
  async fetch(req, env) {
    const auth = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    if (!env.SUPABASE_SERVICE_ROLE_KEY_REST || auth !== env.SUPABASE_SERVICE_ROLE_KEY_REST) return new Response("Not found", { status: 404 });
    const job = new URL(req.url).searchParams.get("job") === "nightly" ? "30 20 * * *" : "*/5 * * * *";
    return new Response(JSON.stringify(await run(job, env), null, 2), { headers: { "Content-Type": "application/json" } });
  },
};
