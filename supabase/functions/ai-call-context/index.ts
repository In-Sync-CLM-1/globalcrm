// Called by the shared LiveKit bridge (project "globalcrm") the moment Exotel connects a call to the
// Voicebot Applet. Looks the call up by Exotel call_sid and returns what the agent needs: either just
// the pre-warmed room_name, or the full prompt context. Bearer = AI_CALL_INTERNAL_TOKEN.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireInternalToken, resolveCallContext } from "../_shared/aiCallLivekit.ts";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  const denied = requireInternalToken(req);
  if (denied) return denied;
  const url = new URL(req.url);
  const callSid = url.searchParams.get("call_sid");
  const callId = url.searchParams.get("call_id");
  if (!callSid && !callId) return json({ error: "call_sid or call_id is required" }, 400);

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const q = supabase.from("call_logs").select("id, room_name").eq("caller_type", "ai");
  const { data: log } = await (callSid ? q.eq("exotel_call_sid", callSid) : q.eq("id", callId!)).maybeSingle();
  if (!log) return json({ error: "Unknown call" }, 404);
  if (log.room_name) return json({ room_name: log.room_name });

  const ctx = await resolveCallContext(supabase, log.id as string);
  if (!ctx) return json({ error: "Call has no usable script" }, 404);
  return json(ctx);
});
