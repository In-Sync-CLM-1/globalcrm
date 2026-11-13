// Admin-only control surface for AI calling (called from the AI Calling screen):
//   enqueue        {script_id, contact_ids[] | stage_id + limit}   queue leads for AI calls
//   test           {script_id, first_name, phone}                  create a test lead on an approved number and queue it
//   cancel         {}                                               cancel every pending item
//   save_settings  {settings, confirm_live?}                        update organizations.settings.ai_calling
// Nothing here dials: the ai-call-advance cron places the calls, subject to every guardrail.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { loadAiConfig, normalizeToE164 } from "../_shared/aiCallLivekit.ts";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const url = Deno.env.get("SUPABASE_URL")!;
  const service = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: { user } } = await service.auth.getUser(token);
  if (!user) return json({ success: false, error: "Unauthorized" }, 401);

  const { data: profile } = await service.from("profiles").select("org_id").eq("id", user.id).maybeSingle();
  const orgId = profile?.org_id as string | undefined;
  if (!orgId) return json({ success: false, error: "No organisation" }, 403);
  const { data: roles } = await service.from("user_roles").select("role").eq("user_id", user.id).eq("org_id", orgId).eq("is_active", true);
  if (!(roles ?? []).some((r: { role: string }) => r.role === "admin" || r.role === "super_admin")) {
    return json({ success: false, error: "Only admins can control AI calling" }, 403);
  }

  const body = await req.json().catch(() => ({}));
  const action = String(body.action ?? "enqueue");
  const cfg = await loadAiConfig(service, orgId);

  if (action === "save_settings") {
    const s = (body.settings ?? {}) as Record<string, unknown>;
    if (s.mode === "live" && cfg.mode !== "live" && body.confirm_live !== true) {
      return json({ success: false, error: "Switching to live mode needs explicit confirmation" }, 400);
    }
    const next = { ...cfg, ...s };
    next.test_numbers = ((next.test_numbers as string[]) ?? []).map(normalizeToE164);
    const { data: org } = await service.from("organizations").select("settings").eq("id", orgId).maybeSingle();
    await service.from("organizations").update({ settings: { ...(org?.settings ?? {}), ai_calling: next } }).eq("id", orgId);
    return json({ success: true, settings: next });
  }

  if (action === "cancel") {
    const { data } = await service.from("ai_call_queue").update({ status: "cancelled", updated_at: new Date().toISOString() }).eq("org_id", orgId).eq("status", "pending").select("id");
    return json({ success: true, cancelled: data?.length ?? 0 });
  }

  const scriptId = String(body.script_id ?? cfg.default_script_id ?? "");
  const { data: script } = await service.from("ai_call_scripts").select("id").eq("id", scriptId).eq("org_id", orgId).eq("is_active", true).maybeSingle();
  if (!script) return json({ success: false, error: "Choose an active script" }, 400);

  let contactIds: string[] = [];
  if (action === "test") {
    const phone = normalizeToE164(String(body.phone ?? ""));
    if (!/^\+91\d{10}$/.test(phone)) return json({ success: false, error: "Enter a 10-digit Indian mobile number" }, 400);
    const { data: lead, error } = await service.from("contacts").insert({
      org_id: orgId, first_name: String(body.first_name ?? "Test").slice(0, 60) || "Test", last_name: "(AI test)", phone, source: "AI test", created_by: user.id,
    }).select("id").single();
    if (error || !lead) return json({ success: false, error: "Could not create the test lead" }, 500);
    contactIds = [lead.id as string];
    if (!cfg.test_numbers.includes(phone)) {
      const { data: org } = await service.from("organizations").select("settings").eq("id", orgId).maybeSingle();
      await service.from("organizations").update({ settings: { ...(org?.settings ?? {}), ai_calling: { ...cfg, test_numbers: [...cfg.test_numbers, phone] } } }).eq("id", orgId);
    }
  } else if (Array.isArray(body.contact_ids) && body.contact_ids.length) {
    contactIds = (body.contact_ids as string[]).slice(0, 500);
  } else if (body.stage_id) {
    const { data } = await service.from("contacts").select("id").eq("org_id", orgId).eq("pipeline_stage_id", body.stage_id).eq("do_not_call", false).not("phone", "is", null).limit(Math.min(Number(body.limit) || 100, 500));
    contactIds = (data ?? []).map((c: { id: string }) => c.id);
  }
  if (!contactIds.length) return json({ success: false, error: "No leads selected" }, 400);

  const { data: open } = await service.from("ai_call_queue").select("contact_id").eq("org_id", orgId).in("status", ["pending", "calling"]).in("contact_id", contactIds);
  const openSet = new Set((open ?? []).map((o: { contact_id: string }) => o.contact_id));
  const fresh = contactIds.filter((id) => !openSet.has(id));
  if (fresh.length) {
    await service.from("ai_call_queue").insert(fresh.map((id) => ({ org_id: orgId, contact_id: id, script_id: scriptId, created_by: user.id })));
  }
  return json({ success: true, queued: fresh.length, already_queued: contactIds.length - fresh.length, mode: cfg.mode });
});
