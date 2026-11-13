// Shared helpers for the the CRM "launch" endpoint -- one-click sign-in
// into Work-Sync for staff who already have an account there. Identity is
// the CRM's own session; Work-Sync keeps its own separate user table, so
// we only look accounts up by email and mint a one-time login link -- never
// create accounts there. Same pattern as RMPL's fleet launcher
// (see ~/.claude/memory/reference_fleet_sso.md).

export interface Env {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  WORKSYNC_SUPABASE_URL: string;
  WORKSYNC_SUPABASE_SERVICE_ROLE_KEY: string;
}

export async function getUserFromJwt(env: Env, jwt: string): Promise<{ id: string; email?: string } | null> {
  if (!jwt) return null;
  try {
    const resp = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
      headers: {
        Authorization: `Bearer ${jwt}`,
        apikey: env.SUPABASE_ANON_KEY,
      },
    });
    if (!resp.ok) return null;
    const user = await resp.json();
    return user?.id ? { id: user.id, email: user.email } : null;
  } catch {
    return null;
  }
}

export function extractJwt(request: Request): string {
  const auth = request.headers.get("Authorization") || "";
  return auth.replace(/^Bearer\s+/i, "");
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// Read-only lookup -- admin/users?filter= does a substring search, so the
// result is re-checked for an exact (case-insensitive) email match before
// trusting it. Callers must never pass an unmatched email to generate_link
// (it silently creates a new account instead of failing).
export async function findUserIdByEmail(
  projectUrl: string,
  serviceRoleKey: string,
  email: string
): Promise<string | null> {
  const resp = await fetch(
    `${projectUrl}/auth/v1/admin/users?filter=${encodeURIComponent(email)}&per_page=5`,
    { headers: { Authorization: `Bearer ${serviceRoleKey}`, apikey: serviceRoleKey } }
  );
  if (!resp.ok) return null;
  const data: { users?: { id: string; email?: string }[] } = await resp.json();
  const match = (data.users || []).find((u) => (u.email || "").toLowerCase() === email.toLowerCase());
  return match?.id ?? null;
}

// Only organisation admins get the Work-Sync launcher. Read with the caller's
// own JWT so row-level security applies (a user can only see their own role row).
export async function isOrgAdmin(env: Env, jwt: string, userId: string): Promise<boolean> {
  try {
    const resp = await fetch(
      `${env.SUPABASE_URL}/rest/v1/user_roles?user_id=eq.${encodeURIComponent(userId)}&is_active=eq.true&select=role`,
      { headers: { Authorization: `Bearer ${jwt}`, apikey: env.SUPABASE_ANON_KEY } }
    );
    if (!resp.ok) return false;
    const rows: { role: string }[] = await resp.json();
    return rows.some((r) => r.role === "admin" || r.role === "super_admin");
  } catch {
    return false;
  }
}
