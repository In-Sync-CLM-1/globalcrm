// Applies to organisation: Ajimos only. Reads the call history from the Dialixa portal with the organisation's own
// login (signs in, reads, signs out; never forces anyone out) and hands it to dialixa_ingest_calls.
// Called every 5 minutes by dialixa-sync-worker. Does nothing until organizations.settings.dialixa.reports is on.
// Body {"check": true}: signs in and reports only counts and field names; saves nothing.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.58.0";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** The project's legacy keys are disabled; use the current secret key when the platform provides it. */
function serverKey(): string {
  try {
    const keys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}");
    if (keys.default) return keys.default;
  } catch { /* fall through */ }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
}

const BASE = (Deno.env.get("DIALIXA_API_BASE_URL") ?? "").replace(/\/+$/, "") + "/api/v1";
const WANTED = ["id", "userId", "direction", "from", "to", "status", "startedAt", "durationSec", "talkTimeSec",
  "disconnectedBy", "hangupCause", "hangupCauseText", "recordingUrl"];

async function portal(path: string, token?: string, body?: unknown) {
  const res = await fetch(BASE + path, {
    method: body ? "POST" : "GET",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) {
    await res.body?.cancel();
    throw new Error(`Dialixa answered ${res.status} on ${path.split("?")[0]}`);
  }
  return await res.json();
}

async function readPortal(since: Date) {
  const login = await portal("/auth/login", undefined, {
    email: Deno.env.get("DIALIXA_PORTAL_EMAIL"), password: Deno.env.get("DIALIXA_PORTAL_PASSWORD"),
  });
  if (!login.accessToken) throw new Error("Dialixa sign-in gave no session");
  try {
    const users = (await portal("/users?page=1&limit=100", login.accessToken)).data;
    const calls: Record<string, unknown>[] = [];
    const range = `dateFrom=${encodeURIComponent(since.toISOString())}&dateTo=${encodeURIComponent(new Date().toISOString())}`;
    for (let page = 1; page <= 100; page++) {
      const r = await portal(`/calls?page=${page}&limit=100&${range}`, login.accessToken);
      if (!Array.isArray(r.data)) throw new Error("Dialixa changed its call list");
      calls.push(...r.data);
      if (!r.data.length || calls.length >= Number(r.total ?? 0)) return { users, calls };
    }
    throw new Error("Too many calls to read in one run");
  } finally {
    await portal("/auth/logout", login.accessToken, { refreshToken: login.refreshToken }).catch(() => undefined);
  }
}

async function tellOwner(error: string) {
  const key = Deno.env.get("RESEND_API_KEY");
  if (!key) return;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: "In-Sync Alerts <notifications@in-sync.co.in>", to: ["a@in-sync.co.in"],
      subject: "Ajimos: Dialixa call reports have stopped updating",
      text: `The CRM could not read the Dialixa call history three times in a row.\n\nReason: ${error}\n\nCalls already in the CRM are safe. Missed calls are picked up when reading works again (up to 30 days back).`,
    }),
  }).catch(() => null);
  if (!res?.ok) console.error("dialixa-sync alert email not sent", res?.status);
}

Deno.serve(async (req) => {
  const token = Deno.env.get("DIALIXA_SYNC_TOKEN") ?? "";
  if (!token || req.headers.get("x-sync-token") !== token) return json({ error: "Not allowed" }, 401);
  const body = await req.json().catch(() => ({}));
  const db = createClient(Deno.env.get("SUPABASE_URL")!, serverKey(), { auth: { persistSession: false, autoRefreshToken: false } });

  const { data: from, error: fromError } = await db.rpc("dialixa_sync_from");
  if (fromError) return json({ error: "Database not reachable", detail: fromError.message }, 500);

  if (body.check) {
    try {
      const { users, calls } = await readPortal(new Date(Date.now() - 2 * 86400e3));
      return json({ ok: true, on: !!from, users: users.length, calls: calls.length, fields: calls[0] ? Object.keys(calls[0]) : [] });
    } catch (e) {
      return json({ ok: false, error: e instanceof Error ? e.message : "failed" });
    }
  }
  if (!from) return json({ off: true });

  try {
    const { users, calls } = await readPortal(new Date(from));
    const people = users.map((u: Record<string, unknown>) => ({ id: u.id, email: u.email, sipExtension: u.sipExtension }));
    const totals: Record<string, number> = {};
    for (let i = 0; i < calls.length; i += 200) {
      const part = calls.slice(i, i + 200).map((c) => Object.fromEntries(WANTED.map((k) => [k, c[k] ?? null])));
      const { data, error } = await db.rpc("dialixa_ingest_calls", { _calls: part, _users: people });
      if (error) throw new Error(`Calls could not be saved: ${error.message}`);
      for (const [k, v] of Object.entries(data ?? {})) totals[k] = (totals[k] ?? 0) + Number(v);
    }
    await db.rpc("dialixa_sync_result", { _error: null });
    return json({ ok: true, read: calls.length, ...totals });
  } catch (e) {
    const error = e instanceof Error ? e.message : "failed";
    console.error("dialixa-sync", error);
    const { data: tell } = await db.rpc("dialixa_sync_result", { _error: error });
    if (tell) await tellOwner(error);
    return json({ ok: false, error });
  }
});
