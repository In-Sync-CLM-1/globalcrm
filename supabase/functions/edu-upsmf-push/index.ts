// edu-upsmf-push — pushes captured biometric punches to the UPSMF SQL Server.
//
// Flow (exactly-once):
//   1. Atomically claim a batch of un-pushed punches (claim_edu_punches RPC).
//   2. INSERT each into UPSMF Biomatric_Punch_Details_Combined, capturing the
//      server-assigned EntryId (OUTPUT INSERTED.EntryId).
//   3. Mark the row 'synced' with its upsmf_entry_id (or 'failed' + last_error).
//
// UPSMF is insert-only (no dedup/delete), so a row is only ever pushed once:
// the claim flips it out of 'pending' before we touch UPSMF.
//
// Alerts are FAILURE-ONLY (per ops standard) — no success pings.

import { createClient } from "npm:@supabase/supabase-js@2";
import sql from "npm:mssql@11";
import { Buffer } from "node:buffer";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const OPS_EMAIL = "a@in-sync.co.in";
const ALERT_FROM = "In-Sync Attendance <notifications@globalcrm.in-sync.co.in>";

const BATCH = 200;

function mssqlConfig() {
  return {
    server: Deno.env.get("UPSMF_SQL_HOST")!,
    port: Number(Deno.env.get("UPSMF_SQL_PORT")!),
    database: Deno.env.get("UPSMF_SQL_DATABASE"),
    user: Deno.env.get("UPSMF_SQL_USER_2"),
    password: Deno.env.get("UPSMF_SQL_PASS_2"),
    options: { encrypt: false, trustServerCertificate: true, enableArithAbort: true },
    connectionTimeout: 15000,
    requestTimeout: 30000,
    pool: { max: 4, min: 0, idleTimeoutMillis: 10000 },
  };
}

// UPSMF stores PunchTime as a tz-less datetime expected in IST wall-clock.
// Render the stored instant in IST and bind as a canonical literal so SQL Server
// stores the face value (no UTC shift).
function toIstLiteral(ts: string): string {
  const ist = new Date(new Date(ts).getTime() + 5.5 * 3600 * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${ist.getUTCFullYear()}-${p(ist.getUTCMonth() + 1)}-${p(ist.getUTCDate())} ` +
         `${p(ist.getUTCHours())}:${p(ist.getUTCMinutes())}:${p(ist.getUTCSeconds())}`;
}

// bytea comes back from PostgREST as a hex string "\\x..." — convert to Buffer.
function toPhotoBuffer(photo: unknown): Buffer | null {
  if (!photo) return null;
  if (typeof photo === "string") {
    const hex = photo.startsWith("\\x") ? photo.slice(2) : photo;
    try { return Buffer.from(hex, "hex"); } catch { return null; }
  }
  return null;
}

async function alertFailure(failed: number, sample: string) {
  if (!RESEND_API_KEY) return;
  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${RESEND_API_KEY}` },
    body: JSON.stringify({
      from: ALERT_FROM,
      to: [OPS_EMAIL],
      subject: `[UPSMF push] ${failed} attendance punch(es) failed to sync`,
      html: `<p>${failed} biometric punch(es) failed to push to the UPSMF server.</p><pre>${sample}</pre>`,
    }),
  }).catch(() => {});
}

Deno.serve(async () => {
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  const { data: rows, error } = await supabase.rpc("claim_edu_punches", { _limit: BATCH });
  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { "content-type": "application/json" } });
  }
  if (!rows || rows.length === 0) {
    return new Response(JSON.stringify({ claimed: 0, pushed: 0, failed: 0 }), { headers: { "content-type": "application/json" } });
  }

  let pushed = 0, failed = 0;
  let lastError = "";
  let pool: sql.ConnectionPool | null = null;

  try {
    pool = await new sql.ConnectionPool(mssqlConfig()).connect();

    for (const r of rows) {
      try {
        const res = await pool.request()
          .input("en", sql.VarChar(50), r.upsmf_identifier)
          .input("dev", sql.VarChar(20), r.device_id)
          .input("pt", sql.VarChar(19), toIstLiteral(r.punch_time))
          .input("photo", sql.VarBinary(sql.MAX), toPhotoBuffer(r.photo))
          .query(`DECLARE @ids TABLE (EntryId BIGINT);
                  INSERT INTO Biomatric_Punch_Details_Combined (EnrollmentNo, DeviceId, PunchTime, Photo, EntryDate)
                  OUTPUT INSERTED.EntryId INTO @ids
                  VALUES (@en, @dev, @pt, @photo, GETDATE());
                  SELECT EntryId FROM @ids;`);
        const entryId = res.recordset?.[0]?.EntryId ?? null;
        await supabase.from("edu_attendance_punches")
          .update({ sync_status: "synced", upsmf_entry_id: entryId, pushed_at: new Date().toISOString(), last_error: null })
          .eq("id", r.id);
        pushed++;
      } catch (e) {
        lastError = (e as Error).message;
        await supabase.from("edu_attendance_punches")
          .update({ sync_status: "failed", last_error: lastError.slice(0, 500) })
          .eq("id", r.id);
        failed++;
      }
    }
  } catch (e) {
    // Connection-level failure: release the whole claimed batch back to 'failed'.
    lastError = (e as Error).message;
    const ids = rows.map((r: { id: string }) => r.id);
    await supabase.from("edu_attendance_punches")
      .update({ sync_status: "failed", last_error: lastError.slice(0, 500) })
      .in("id", ids).eq("sync_status", "processing");
    failed = ids.length - pushed;
  } finally {
    if (pool) await pool.close();
  }

  if (failed > 0) await alertFailure(failed, lastError);

  return new Response(JSON.stringify({ claimed: rows.length, pushed, failed }), { headers: { "content-type": "application/json" } });
});
