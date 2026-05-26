import { getSupabaseClient } from "../_shared/supabaseClient.ts";

// Public page reached from the dateless-demo slot-request (email + WhatsApp button).
// GET  ?c=<contact_id>  -> shows Mon-Fri slots in the next 2 working days + a free-text option.
// POST (form)           -> a chosen slot sets the demo date (creates the meeting + confirmation);
//                          a free-text suggestion is recorded and the host is notified to set it.

const PROPOSED_TIMES = [["11:30", "11:30 AM"], ["16:00", "4:00 PM"]];

function istToday(): Date {
  const n = new Date();
  return new Date(n.getTime() + 5.5 * 3600 * 1000);
}
function ymd(d: Date): string { return d.toISOString().slice(0, 10); }
function nextWorkingDays(count: number): { date: string; label: string }[] {
  const out: { date: string; label: string }[] = [];
  const d = istToday();
  while (out.length < count) {
    d.setUTCDate(d.getUTCDate() + 1);
    const dow = d.getUTCDay(); // 0 Sun .. 6 Sat
    if (dow === 0 || dow === 6) continue; // Mon-Fri only
    out.push({ date: ymd(d), label: d.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "short", timeZone: "UTC" }) });
  }
  return out;
}
function page(title: string, inner: string): Response {
  return new Response(
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f6f8fa;margin:0;color:#222">
<div style="max-width:480px;margin:40px auto;background:#fff;border-radius:12px;padding:32px 28px;box-shadow:0 1px 4px rgba(0,0,0,.08)">${inner}</div></body></html>`,
    { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const supabase = getSupabaseClient();

  // Resolve contact (from query on GET, from form on POST)
  let contactId = url.searchParams.get("c") || "";
  let form: FormData | null = null;
  if (req.method === "POST") {
    form = await req.formData();
    contactId = (form.get("c") as string) || contactId;
  }
  if (!contactId) return page("Invalid link", `<p>This scheduling link is missing its code. Please use the button in your message.</p>`);

  const { data: contact } = await supabase
    .from("contacts")
    .select("id, org_id, first_name, product, opted_out")
    .eq("id", contactId).maybeSingle();
  if (!contact) return page("Not found", `<p>We couldn't find your record. Please reply to your message and we'll help.</p>`);
  if (contact.opted_out) return page("Removed", `<p>You've been removed from our outreach. No further messages will be sent.</p>`);

  const productLabel = String(contact.product || "").toLowerCase() === "vendorverification" ? "Vendor Verification" : "WorkSync";

  // ---- POST: record the prospect's choice ----
  if (req.method === "POST" && form) {
    const slot = (form.get("slot") as string) || "";        // "YYYY-MM-DD|HH:MM"
    const freeText = ((form.get("free_text") as string) || "").trim();

    const { data: disp } = await supabase.from("call_dispositions")
      .select("id").eq("org_id", contact.org_id).eq("name", "Demo Booked").maybeSingle();
    const demoBookedId = disp?.id;

    if (slot && slot.includes("|")) {
      const [dDate, dTime] = slot.split("|");
      // Insert a Demo Booked activity with the chosen slot -> trigger creates the dated meeting + host notify.
      if (demoBookedId) {
        await supabase.from("contact_activities").insert({
          org_id: contact.org_id, contact_id: contact.id, activity_type: "call",
          subject: "Demo slot chosen by prospect", call_disposition_id: demoBookedId,
          demo_date: dDate, demo_time: dTime,
          next_action_notes: "Prospect selected this slot via the scheduling link.",
          created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
        });
      }
      // Send the confirmation by re-running the post-call sender on the latest call (now dated).
      const { data: cl } = await supabase.from("call_logs")
        .select("id").eq("contact_id", contact.id).order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (cl && demoBookedId) {
        await supabase.from("call_logs").update({ disposition_id: demoBookedId, customer_message_sent_at: null }).eq("id", cl.id);
        fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/send-post-call-message`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` },
          body: JSON.stringify({ call_log_id: cl.id }),
        }).catch(() => {});
      }
      const when = new Date(`${dDate}T${dTime}:00+05:30`).toLocaleString("en-IN", { dateStyle: "full", timeStyle: "short", timeZone: "Asia/Kolkata" });
      return page("Demo confirmed!", `<div style="text-align:center"><div style="font-size:44px">&#9989;</div><h2 style="color:#0D9488">You're booked!</h2><p>Your ${productLabel} demo is set for <strong>${when} IST</strong>. A confirmation with the meeting link is on its way.</p></div>`);
    }

    if (freeText) {
      // Record the suggestion and alert the host to set it manually.
      await supabase.from("contact_activities").insert({
        org_id: contact.org_id, contact_id: contact.id, activity_type: "note",
        subject: "Preferred demo time (prospect suggestion)", description: freeText,
        created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      });
      const { data: os } = await supabase.from("organization_settings").select("demo_host_user_id").eq("org_id", contact.org_id).maybeSingle();
      if (os?.demo_host_user_id) {
        await supabase.from("notifications").insert({
          org_id: contact.org_id, user_id: os.demo_host_user_id, type: "demo_slot_suggestion",
          title: "Prospect suggested a demo time",
          message: `${contact.first_name || "A prospect"} suggested: "${freeText.slice(0, 160)}" for their ${productLabel} demo. Please confirm and set it.`,
          entity_type: "contact", entity_id: contact.id, action_url: `/contacts/${contact.id}`,
          metadata: { suggestion: freeText.slice(0, 300) }, expires_at: new Date(Date.now() + 30 * 864e5).toISOString(),
        });
      }
      return page("Thank you!", `<div style="text-align:center"><div style="font-size:44px">&#128197;</div><h2 style="color:#0D9488">Got it</h2><p>Thanks — we've noted your preferred time and will confirm your ${productLabel} demo shortly.</p></div>`);
    }
    return page("Please choose", `<p>Please pick a slot or suggest a time.</p>`);
  }

  // ---- GET: render the picker ----
  const days = nextWorkingDays(2);
  let slotsHtml = "";
  for (const d of days) {
    for (const [val, lbl] of PROPOSED_TIMES) {
      const v = `${d.date}|${val}`;
      slotsHtml += `<label style="display:block;border:1px solid #e2e8f0;border-radius:8px;padding:12px 14px;margin:8px 0;cursor:pointer">
        <input type="radio" name="slot" value="${v}" style="margin-right:10px"> ${d.label} &middot; ${lbl}</label>`;
    }
  }
  const inner = `
    <h2 style="margin-top:0;color:#0D9488">Pick your ${productLabel} demo time</h2>
    <p>Hi ${contact.first_name || "there"}, choose a slot in the next couple of working days:</p>
    <form method="POST">
      <input type="hidden" name="c" value="${contact.id}">
      ${slotsHtml}
      <p style="margin-top:18px;font-size:14px;color:#555">Prefer another time? Tell us:</p>
      <input type="text" name="free_text" placeholder="e.g. Friday after 3 PM" style="width:100%;box-sizing:border-box;padding:11px;border:1px solid #cbd5e1;border-radius:8px">
      <button type="submit" style="margin-top:16px;width:100%;background:#0D9488;color:#fff;border:0;padding:14px;border-radius:8px;font-size:16px;font-weight:600;cursor:pointer">Confirm my slot</button>
    </form>`;
  return page("Pick your demo time", inner);
});
