// WhatsApp "Thank you for your interest" (template iedup_ramp_interest_v1) to the IEDUP contacts
// uploaded from the FIEO exporter list (source 'fieo_exporters'), one number at a time.
// Safe by default: it only reports what it would do unless the body says { "send": true },
// and it refuses to send until Meta has approved the template. One message per distinct
// mobile number, never twice, charged to the IEDUP wallet by sendWhatsAppTemplate.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.58.0";
import { orgServiceGate } from "../_shared/billingGate.ts";
import { WA_SENDER_BY_ORG, sendWhatsAppTemplate } from "../_shared/pipelineActions.ts";

const IEDUP_ORG_ID = "6dcf4229-6902-4cd4-9c7f-2d6ed4a6045d";
const SOURCE = "fieo_exporters";
const TEMPLATE = "iedup_ramp_interest_v1";
const COURSE = "Supply Chain Management (SCM)";
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

serve(async (req) => {
  if (req.method !== "POST") return json(405, { error: "POST only" });
  const secret = Deno.env.get("RAMP_NOTIFY_SECRET");
  if (!secret || req.headers.get("x-ramp-secret") !== secret) return json(401, { error: "Unauthorized" });
  const body = await req.json().catch(() => ({}));
  const send = body.send === true;
  const max = Math.min(Math.max(Number(body.max) || 100, 1), 300);

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: tpl } = await db.from("communication_templates").select("status")
    .eq("org_id", IEDUP_ORG_ID).eq("template_name", TEMPLATE).maybeSingle();
  const approved = String(tpl?.status ?? "").toLowerCase() === "approved";

  const page = async (build: (from: number, to: number) => any) => {
    const rows: any[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await build(from, from + 999);
      if (error) throw new Error(error.message);
      rows.push(...(data ?? []));
      if (!data || data.length < 1000) break;
    }
    return rows;
  };
  const logs = await page((f, t) => db.from("whatsapp_logs").select("id, to_number").eq("org_id", IEDUP_ORG_ID).eq("template_name", TEMPLATE).order("id").range(f, t));
  const handled = new Set(logs.map((r: { to_number: string }) => String(r.to_number).slice(-10)));
  const pool = await page((f, t) => db.from("contacts")
    .select("id, first_name, phone, do_not_whatsapp, opted_out").eq("org_id", IEDUP_ORG_ID).eq("source", SOURCE)
    .not("phone", "is", null).order("created_at").order("id").range(f, t));

  // One contact per distinct valid Indian mobile number.
  const seen = new Set<string>();
  const todo: any[] = [];
  for (const c of pool) {
    const m = String(c.phone ?? "").replace(/\D/g, "").slice(-10);
    if (!/^[6-9]\d{9}$/.test(m) || c.do_not_whatsapp || c.opted_out || handled.has(m) || seen.has(m)) continue;
    seen.add(m);
    todo.push({ ...c, mobile: m });
  }
  if (!send) return json(200, { template_approved: approved, remaining: todo.length });
  if (!approved) return json(409, { error: "template not approved yet", status: tpl?.status ?? null });

  const gate = await orgServiceGate(db, IEDUP_ORG_ID);
  if (!gate.allowed) return json(402, { error: gate.reason });
  const floor = typeof gate.floor === "number" ? gate.floor : null;

  const started = Date.now();
  let sent = 0, failed = 0, stopped = "";
  for (const c of todo.slice(0, max)) {
    if (Date.now() - started > 110_000) { stopped = "time budget"; break; }
    const name = String(c.first_name ?? "").replace(/\s+/g, " ").trim().slice(0, 60) || "Sir/Madam";
    const r = await sendWhatsAppTemplate(db, {
      orgId: IEDUP_ORG_ID, sender: WA_SENDER_BY_ORG[IEDUP_ORG_ID], contact: c, phone: `+91${c.mobile}`,
      templateName: TEMPLATE, languageCode: "en", floor, bodyParams: [name, COURSE],
    });
    if (r.ok) sent++;
    else {
      failed++;
      if (r.insufficientFunds) { stopped = "wallet balance too low"; break; }
    }
    await sleep(300);
  }
  return json(200, { sent, failed, remaining: todo.length - sent - failed, stopped });
});
