// Applies to organisation: Ajimos only (checked in dialixa_begin_call).
// Starts a Dialixa call: the caller's softphone rings, then Dialixa dials the player.
// The player's number and the Dialixa key never leave the server.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.58.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const reply = (body: unknown) =>
  new Response(JSON.stringify(body), { headers: { ...cors, "Content-Type": "application/json" } });

const MESSAGES: Record<number, string> = {
  400: "Dialixa did not accept this call. Check that you are not already on a call and that the number is valid.",
  401: "Dialixa refused the CRM's key. Tell your administrator.",
  403: "Calling is switched off or suspended in Dialixa. Tell your administrator.",
  404: "Your extension was not found in Dialixa. Tell your administrator.",
  429: "Too many calls were started this minute. Wait a little and try again.",
};

/** The project's legacy keys are disabled; use the current ones when the platform provides them. */
function key(list: string, legacy: string): string {
  try {
    const keys = JSON.parse(Deno.env.get(list) ?? "{}");
    if (keys.default) return keys.default;
  } catch { /* fall through */ }
  return Deno.env.get(legacy)!;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const auth = req.headers.get("Authorization") ?? "";
  const asUser = createClient(Deno.env.get("SUPABASE_URL")!, key("SUPABASE_PUBLISHABLE_KEYS", "SUPABASE_ANON_KEY"), {
    global: { headers: { Authorization: auth } },
  });
  const service = createClient(Deno.env.get("SUPABASE_URL")!, key("SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY"));

  let callId: string | null = null;
  const fail = async (error: string, http: number | null = null) => {
    if (callId) {
      await service.from("dialixa_calls").update({ status: "failed", failure: error, http_status: http }).eq("id", callId);
    }
    return reply({ ok: false, error });
  };

  try {
    const { data: { user } } = await asUser.auth.getUser(auth.replace(/^Bearer\s+/i, ""));
    if (!user) return reply({ ok: false, error: "Please sign in again" });

    const { contactId } = await req.json();
    const { data: begun, error: beginError } = await asUser.rpc("dialixa_begin_call", { _contact_id: contactId });
    if (beginError) return reply({ ok: false, error: beginError.message });
    callId = begun as string;

    const base = (Deno.env.get("DIALIXA_API_BASE_URL") ?? "").replace(/\/+$/, "");
    const apiKey = Deno.env.get("DIALIXA_CLICK_TO_CALL_API_KEY") ?? "";
    if (!base || !apiKey) return await fail("Dialixa is not connected yet. Tell your administrator.");

    const { data: target, error: targetError } = await service.rpc("dialixa_call_target", { _call_id: callId, _user_id: user.id });
    if (targetError || !target) return await fail("The call could not be prepared");
    if (!target.number) return await fail("This contact has no callable number on file");

    let res: Response;
    try {
      res = await fetch(`${base}/api/v1/public/click-to-call`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-API-Key": apiKey },
        body: JSON.stringify({ extension: target.extension, number: target.number, contactName: target.name || undefined }),
        signal: AbortSignal.timeout(15000),
      });
    } catch (_e) {
      return await fail("Dialixa did not answer. Try again in a moment.");
    }
    if (!res.ok) {
      await res.body?.cancel();
      console.error("dialixa-call refused", res.status);
      return await fail(MESSAGES[res.status] ?? "Dialixa could not start the call", res.status);
    }
    await res.body?.cancel();
    await service.from("dialixa_calls").update({ status: "accepted", http_status: res.status }).eq("id", callId);
    return reply({ ok: true, callId });
  } catch (e) {
    console.error("dialixa-call", e instanceof Error ? e.message : e);
    return await fail("The call could not be started");
  }
});
