// One-off helper: IEDUP WA template lifecycle (status / create / delete / send).
// Delete after current swap cycle is finished.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

serve(async (req) => {
  const apiKey = Deno.env.get("EXOTEL_API_KEY")!;
  const apiToken = Deno.env.get("EXOTEL_API_TOKEN")!;
  const sid = Deno.env.get("EXOTEL_SID")!;
  const subdomain = Deno.env.get("EXOTEL_SUBDOMAIN") || "api.exotel.com";
  const wabaId = Deno.env.get("EXOTEL_WABA_ID")!;
  const auth = btoa(`${apiKey}:${apiToken}`);

  let body: any = {};
  try { body = await req.json(); } catch { /* default */ }
  const action = body?.action || "status";

  let url: string;
  let init: RequestInit;

  if (action === "create") {
    url = `https://${subdomain}/v2/accounts/${sid}/templates?waba_id=${wabaId}`;
    init = { method: "POST", headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" }, body: JSON.stringify(body.payload) };
  } else if (action === "delete") {
    const name = body?.name as string;
    url = `https://${subdomain}/v2/accounts/${sid}/templates?name=${encodeURIComponent(name)}&waba_id=${wabaId}`;
    init = { method: "DELETE", headers: { Authorization: `Basic ${auth}` } };
  } else if (action === "send") {
    url = `https://${subdomain}/v2/accounts/${sid}/messages`;
    init = { method: "POST", headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" }, body: JSON.stringify(body.payload) };
  } else if (action === "msgstatus") {
    const msgSid = body?.sid as string;
    url = `https://${subdomain}/v2/accounts/${sid}/messages/${encodeURIComponent(msgSid)}`;
    init = { method: "GET", headers: { Authorization: `Basic ${auth}` } };
  } else {
    // status or list
    url = `https://${subdomain}/v2/accounts/${sid}/templates?waba_id=${wabaId}`;
    init = { method: "GET", headers: { Authorization: `Basic ${auth}` } };
  }

  const r = await fetch(url, init);
  const text = await r.text();
  let parsed: any = null;
  try { parsed = JSON.parse(text); } catch { /* keep raw */ }

  if (action === "status") {
    const name = body?.name || "iedup_cmyuva_training_link_v3";
    const templates = parsed?.response?.whatsapp?.templates || [];
    const match = templates.find((t: any) => t?.data?.name === name);
    return new Response(JSON.stringify({
      name, found: !!match,
      status: match?.data?.status || null,
      category: match?.data?.category || null,
      id: match?.data?.id || null,
      rejected_reason: match?.data?.rejected_reason || null,
    }, null, 2), { headers: { "Content-Type": "application/json" } });
  }

  return new Response(JSON.stringify({ action, http_status: r.status, raw: parsed ?? text }, null, 2), {
    headers: { "Content-Type": "application/json" },
  });
});
