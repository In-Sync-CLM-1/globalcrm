// Read-only list of RMPL projects for the "project number" picker shown when a
// RMPL contact is moved to Won. Pattern: verify the caller's globalcrm session,
// then call RMPL's read-only public-api server-to-server with an isk_live_ key.
interface Env {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  RMPL_PUBLIC_API_URL: string;
  RMPL_PUBLIC_API_KEY: string;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const token = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "Not signed in" }, 401);

  const who = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${token}`, apikey: env.SUPABASE_ANON_KEY },
  });
  if (!who.ok) return json({ error: "Not signed in" }, 401);

  const resp = await fetch(env.RMPL_PUBLIC_API_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.RMPL_PUBLIC_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ action: "list_projects" }),
  });
  if (!resp.ok) return json({ error: "Could not load projects from RMPL" }, 502);
  const body: any = await resp.json();
  if (!body.success) return json({ error: "Could not load projects from RMPL" }, 502);

  const projects = (body.data as any[])
    .filter((p) => p.project_number && !/-999$/.test(p.project_number)) // 999 = internal marker
    .map((p) => ({ id: p.id, project_number: p.project_number, project_name: p.project_name, status: p.status }));
  return json({ projects });
};
