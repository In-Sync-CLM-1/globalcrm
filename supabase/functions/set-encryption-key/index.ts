// Bring-your-own-key for an org that has PII protection on. Admin only.
//   check  {}                      is a key configured
//   save   {encryption_key}        replace the key and re-encrypt every protected value in one transaction
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const service = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: { user } } = await service.auth.getUser(token);
  if (!user) return json({ error: "Unauthorized" }, 401);

  const { data: profile } = await service.from("profiles").select("org_id").eq("id", user.id).maybeSingle();
  const orgId = profile?.org_id as string | undefined;
  if (!orgId) return json({ error: "No organisation" }, 403);
  const { data: roles } = await service.from("user_roles").select("role").eq("user_id", user.id).eq("org_id", orgId).eq("is_active", true);
  if (!(roles ?? []).some((r: { role: string }) => r.role === "admin" || r.role === "super_admin")) return json({ error: "Only admins can manage the encryption key" }, 403);

  const body = await req.json().catch(() => ({}));
  if (body.action === "check") {
    const { data } = await service.rpc("pii_key_configured");
    return json({ configured: !!data });
  }

  const key = body.encryption_key;
  if (typeof key !== "string" || key.length < 16) return json({ error: "Encryption key must be at least 16 characters" }, 400);
  const { data, error } = await service.rpc("rotate_pii_key", { _new_key: key });
  if (error) return json({ error: error.message }, 400);
  return json({ success: true, re_encrypted: data });
});
