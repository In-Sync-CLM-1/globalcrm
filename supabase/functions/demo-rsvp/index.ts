import { getSupabaseClient } from "../_shared/supabaseClient.ts";

// Public endpoint hit by the "Yes, I am attending" button in the demo-confirmation
// email and WhatsApp. Identified by the per-meeting rsvp_token. No auth (verify_jwt=false).

function page(title: string, body: string): Response {
  const html = `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f6f8fa;margin:0">
<div style="max-width:480px;margin:60px auto;background:#fff;border-radius:12px;padding:40px 32px;text-align:center;box-shadow:0 1px 4px rgba(0,0,0,.08)">
<div style="font-size:46px;margin-bottom:10px">&#9989;</div>
<h1 style="font-size:22px;color:#0D9488;margin:0 0 12px">${title}</h1>
<p style="color:#444;font-size:15px;line-height:1.6;margin:0">${body}</p>
</div></body></html>`;
  return new Response(html, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
}

Deno.serve(async (req) => {
  const token = new URL(req.url).searchParams.get("token");
  if (!token) {
    return page("Link not valid", "This confirmation link is missing its code. Please use the button in your message.");
  }
  try {
    const supabase = getSupabaseClient();
    const { data: mtg } = await supabase
      .from("contact_activities")
      .select("id, subject, scheduled_at, demo_rsvp_status, created_by, org_id, contact_id")
      .eq("rsvp_token", token)
      .eq("activity_type", "meeting")
      .maybeSingle();

    if (!mtg) {
      return page("Demo not found", "We could not find this demo — it may have been rescheduled. Please reply to your message and we'll help.");
    }

    const whenStr = mtg.scheduled_at
      ? new Date(mtg.scheduled_at).toLocaleString("en-IN", { dateStyle: "full", timeStyle: "short", timeZone: "Asia/Kolkata" })
      : "";

    if (mtg.demo_rsvp_status !== "accepted") {
      await supabase.from("contact_activities")
        .update({ demo_rsvp_status: "accepted", demo_rsvp_at: new Date().toISOString() })
        .eq("id", mtg.id);
      await supabase.from("activity_participants")
        .update({ response_status: "accepted", updated_at: new Date().toISOString() })
        .eq("activity_id", mtg.id);

      // Let the host know the prospect confirmed.
      if (mtg.created_by) {
        await supabase.from("notifications").insert({
          org_id: mtg.org_id,
          user_id: mtg.created_by,
          type: "demo_rsvp",
          title: "Prospect confirmed attendance",
          message: `${mtg.subject || "Demo"}${whenStr ? ` — ${whenStr} IST` : ""}`,
          entity_type: "contact_activity",
          entity_id: mtg.id,
          action_url: mtg.contact_id ? `/contacts/${mtg.contact_id}` : null,
          metadata: { rsvp: "accepted" },
          expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        });
      }
    }

    return page(
      "You're confirmed!",
      `Thank you for confirming your attendance${whenStr ? ` for <strong>${whenStr} IST</strong>` : ""}. ` +
      `We've let the team know and look forward to seeing you on the call.`,
    );
  } catch (_e) {
    return page("Something went wrong", "We couldn't record your response just now. Please try again, or reply to your message.");
  }
});
