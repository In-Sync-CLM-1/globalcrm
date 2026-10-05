// Tells RMPL which project number a won deal belongs to, so incentives can credit
// the person who moved it to Won. Called by the pipeline's Won dialog before the
// stage is changed. Verifies the caller's session and reads the contact with the
// caller's own JWT (RLS), then posts server-to-server to RMPL with a shared key.
interface Env {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  RMPL_WON_URL: string;
  RMPL_WON_API_KEY: string;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const token = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "Not signed in" }, 401);
  const headers = { Authorization: `Bearer ${token}`, apikey: env.SUPABASE_ANON_KEY };

  const who = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, { headers });
  if (!who.ok) return json({ error: "Not signed in" }, 401);
  const user: any = await who.json();

  const body: any = await request.json().catch(() => ({}));
  const contactId = String(body.contact_id || "");
  const projectNumber = String(body.project_number || "");
  if (!contactId || !projectNumber) return json({ error: "contact_id and project_number required" }, 400);

  const c = await fetch(
    `${env.SUPABASE_URL}/rest/v1/contacts?select=first_name,last_name,company&id=eq.${encodeURIComponent(contactId)}&limit=1`,
    { headers },
  );
  const rows: any[] = c.ok ? await c.json() : [];
  if (!rows.length) return json({ error: "Contact not found" }, 404);

  const resp = await fetch(env.RMPL_WON_URL, {
    method: "POST",
    headers: { "x-api-key": env.RMPL_WON_API_KEY, "Content-Type": "application/json", "User-Agent": "globalcrm-sync" },
    body: JSON.stringify({
      contact_id: contactId,
      project_number: projectNumber,
      won_by_email: user.email,
      contact_name: [rows[0].first_name, rows[0].last_name].filter(Boolean).join(" "),
      company: rows[0].company,
    }),
  });
  if (!resp.ok) {
    const err: any = await resp.json().catch(() => ({}));
    return json({ error: err.error || "Could not record the project with RMPL" }, 502);
  }
  return json({ success: true });
};
