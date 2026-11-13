import { Env, extractJwt, getUserFromJwt, jsonResponse, findUserIdByEmail, isOrgAdmin } from "./_shared";

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const jwt = extractJwt(request);
  const user = await getUserFromJwt(env, jwt);
  if (!user?.email) return jsonResponse({ error: "Unauthorized" }, 401);
  if (!(await isOrgAdmin(env, jwt, user.id))) return jsonResponse({ error: "Work-Sync sign-in is for admins only" }, 403);

  // Never mint a link for an email that doesn't already have an account in
  // Work-Sync -- generate_link silently creates one otherwise, which would
  // turn this into an unintended account-provisioning path.
  const userId = await findUserIdByEmail(env.WORKSYNC_SUPABASE_URL, env.WORKSYNC_SUPABASE_SERVICE_ROLE_KEY, user.email);
  if (!userId) return jsonResponse({ error: "You don't have an account in Work-Sync yet" }, 403);

  const resp = await fetch(`${env.WORKSYNC_SUPABASE_URL}/auth/v1/admin/generate_link`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.WORKSYNC_SUPABASE_SERVICE_ROLE_KEY}`,
      apikey: env.WORKSYNC_SUPABASE_SERVICE_ROLE_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      type: "magiclink",
      email: user.email,
      options: { redirect_to: "https://work.in-sync.co.in/" },
    }),
  });
  if (!resp.ok) return jsonResponse({ error: "Couldn't sign you in" }, 502);

  const data: { action_link?: string } = await resp.json();
  if (!data.action_link) return jsonResponse({ error: "Couldn't sign you in" }, 502);

  return jsonResponse({ url: data.action_link });
};
