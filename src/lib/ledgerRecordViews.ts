// Opening a single contact, client, invoice or payment record, and every file upload, download and delete, is
// written to the permanent activity ledger.
//
// Every read in the app goes through one data client, so one wrapper around its network
// call covers all screens, including ones added later. A read of a sensitive table that
// is scoped to a record (by its id) is logged under the signed-in person, and so is any
// call to file storage. The log call is fire-and-forget and never affects the screen.
// It only sees activity made through the app, not someone calling the database directly.

const FINANCIAL_TABLES: string[] = [
  "contacts", "clients", "client_invoices", "client_documents", "payment_transactions", "wallet_transactions", "gst_payment_tracking", "organization_subscriptions", "subscription_invoices", "fervent_data_repository",
];
const FINANCIAL = new Set(FINANCIAL_TABLES);
// A financial table nested inside another read, e.g. "id,project_quotations(amount)" or "q:project_quotations!inner(".
const EMBEDDED = FINANCIAL_TABLES.length
  ? new RegExp("(^|[^a-z_])(" + FINANCIAL_TABLES.join("|") + ")[ ]*(![a-z_]+)?[ ]*[(]", "i")
  : /$^/;
const FINANCIAL_RPC = /(invoice|payment|billing|subscription|wallet)/i;
const SCOPE_KEY = /(^|_)id$/;
const SCOPE_VALUE = /^(eq|in)[.]/;

const recentlyLogged = new Map<string, number>();

type Found = { event: string; target: string; details: Record<string, unknown> };

function describe(url: URL, method: string, headers: Headers): Found | null {
  const storage = url.pathname.split("/storage/v1/object/")[1];
  if (storage !== undefined) {
    const path = storage.replace(/^(authenticated|public)\//, "");
    if (path.startsWith("sign/")) return method === "POST" ? { event: "file_link", target: path.slice(5, 305), details: {} } : null;
    if (method === "POST" || method === "PUT") return { event: "file_upload", target: path.slice(0, 300), details: {} };
    if (method === "DELETE") return { event: "file_delete", target: path.slice(0, 300) || "storage", details: {} };
    if (method === "GET") return { event: "file_download", target: path.slice(0, 300), details: {} };
    return null;
  }
  const rest = url.pathname.split("/rest/v1/")[1];
  if (!rest) return null;
  const parts = rest.split("/");
  const root = parts[0];

  if (root === "rpc") {
    const name = parts[1] ?? "";
    if (method === "POST" && FINANCIAL_RPC.test(name) && name !== "ledger_log_access") {
      return { event: "record_view", target: `rpc:${name}`, details: { rpc: name } };
    }
    return null;
  }
  if (method !== "GET") return null;

  const scope: Record<string, string> = {};
  url.searchParams.forEach((value, key) => {
    if (SCOPE_KEY.test(key) && SCOPE_VALUE.test(value)) scope[key] = value.replace(SCOPE_VALUE, "").slice(0, 80);
  });
  const single = (headers.get("Accept") ?? "").includes("pgrst.object");
  const scoped = Object.keys(scope).length > 0 || single;
  if (!scoped) return null;

  const direct = FINANCIAL.has(root);
  const embedded = !direct && EMBEDDED.test(url.searchParams.get("select") ?? "");
  if (!direct && !embedded) return null;

  const label = Object.entries(scope).map(([k, v]) => `${k}=${v}`).join("&") || "single";
  return { event: "record_view", target: `${root}:${label}`, details: { table: root, filters: scope, embedded } };
}

function maybeLog(input: RequestInfo | URL, init: RequestInit | undefined, ok: boolean) {
  if (!ok || typeof window === "undefined") return;
  const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const method = (init?.method ?? (typeof input === "object" && "method" in input ? input.method : "GET")).toUpperCase();
  const headers = new Headers(init?.headers ?? (typeof input === "object" && "headers" in input ? input.headers : undefined));
  const bearer = (headers.get("Authorization") ?? "").replace(/^Bearer[ ]+/i, "");
  const apikey = headers.get("apikey") ?? "";
  if (!bearer || bearer === apikey) return; // not signed in

  const url = new URL(raw, window.location.origin);
  const found = describe(url, method, headers);
  if (!found) return;

  const now = Date.now();
  const dedupeKey = `${found.event}|${found.target}`;
  const last = recentlyLogged.get(dedupeKey);
  if (found.event === "record_view" && last && now - last < 60_000) return;
  recentlyLogged.set(dedupeKey, now);

  void fetch(`${url.origin}/rest/v1/rpc/ledger_log_access`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey, Authorization: `Bearer ${bearer}` },
    body: JSON.stringify({
      p_event: found.event,
      p_target: found.target,
      p_details: { ...found.details, page: window.location.pathname },
    }),
  }).catch(() => undefined);
}

/** A drop-in `fetch` for the data client that logs opens of single financial records. */
export const loggingFetch: typeof fetch = async (input, init) => {
  const response = await fetch(input, init);
  try {
    maybeLog(input, init, response.ok);
  } catch {
    /* never affect the screen */
  }
  return response;
};
