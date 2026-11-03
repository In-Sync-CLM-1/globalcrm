import { Env, extractJwt, getUserFromJwt, jsonResponse, findUserIdByEmail, isOrgAdmin } from "./_shared";

// Whether the caller has a Work-Sync account is the whole authorization
// check -- accounts are provisioned per org (Ajimos), so this scopes the
// launcher to the people who should see it, and only admins qualify.
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const jwt = extractJwt(request);
  const user = await getUserFromJwt(env, jwt);
  if (!user?.email) return jsonResponse({ error: "Unauthorized" }, 401);
  if (!(await isOrgAdmin(env, jwt, user.id))) return jsonResponse({ worksync: false });

  const userId = await findUserIdByEmail(env.WORKSYNC_SUPABASE_URL, env.WORKSYNC_SUPABASE_SERVICE_ROLE_KEY, user.email);
  return jsonResponse({ worksync: !!userId });
};
