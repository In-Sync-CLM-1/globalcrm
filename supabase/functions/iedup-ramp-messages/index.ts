// Called by the UP RAMP portal's staff Message log (TASK-0168, AVG org).
// Read-only: returns the IEDUP org's WhatsApp and email send records for a date range, with their delivery status
// (WhatsApp: queued / sent / delivered / read / failed from Exotel's callbacks; email: sent / failed).
// RAMP matches the rows to its trainees by mobile / email, so nothing here knows about RAMP participants.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.58.0";

const IEDUP_ORG_ID = "6dcf4229-6902-4cd4-9c7f-2d6ed4a6045d";
const MAX_DAYS = 31;
const PAGE = 1000;
const MAX_ROWS = 30000;
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

// deno-lint-ignore no-explicit-any
async function all(q: () => any) {
  const out: unknown[] = [];
  for (let from = 0; from < MAX_ROWS; from += PAGE) {
    const { data, error } = await q().range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

serve(async (req) => {
  if (req.method !== "POST") return json(405, { error: "POST only" });
  const secret = Deno.env.get("RAMP_NOTIFY_SECRET");
  if (!secret || req.headers.get("x-ramp-secret") !== secret) return json(401, { error: "Unauthorized" });
  const body = await req.json().catch(() => ({})) as { from?: string; to?: string };
  const from = new Date(body.from ?? ""), to = new Date(body.to ?? "");
  if (isNaN(+from) || isNaN(+to) || to <= from) return json(400, { error: "from and to dates are needed" });
  if (+to - +from > MAX_DAYS * 86400000) return json(400, { error: `At most ${MAX_DAYS} days at a time` });
  try {
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const [whatsapp, email] = await Promise.all([
      all(() => db.from("whatsapp_logs").select("id,to_number,template_name,status,error_text,sent_at,delivered_at,read_at,failed_at,created_at")
        .eq("org_id", IEDUP_ORG_ID).gte("created_at", from.toISOString()).lt("created_at", to.toISOString()).order("created_at", { ascending: false })),
      all(() => db.from("pipeline_email_log").select("id,to_email,subject,status,error_text,sent_at,failed_at,created_at")
        .eq("org_id", IEDUP_ORG_ID).gte("created_at", from.toISOString()).lt("created_at", to.toISOString()).order("created_at", { ascending: false })),
    ]);
    return json(200, { ok: true, whatsapp, email });
  } catch (e) {
    return json(500, { error: String((e as Error)?.message ?? e).slice(0, 200) });
  }
});
