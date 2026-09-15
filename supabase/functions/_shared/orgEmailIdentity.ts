// Per-org fixed sender/reply-to override. Overrides the default per-agent
// resolution (which otherwise leaks whichever AI-persona or staff profile
// triggered the send) so replies for that org land in one shared inbox.
export const ORG_EMAIL_IDENTITY_OVERRIDE: Record<string, { fromEmail: string; replyToEmail: string }> = {
  "61f7f96d-e80c-4d9b-a765-8eb32bd3c70d": { fromEmail: "a@in-sync.co.in", replyToEmail: "a@in-sync.co.in" }, // In-Sync Demo
};

// Per-org Resend account override. An org's `email_settings.sending_domain`
// is normally verified on the shared "fmamit" account (env RESEND_API_KEY),
// but some orgs' domains live on a separate Resend account -- sending or
// checking domain status with the wrong key 404s/400s even though the
// domain really is verified. Value names an env var holding that account's
// key; an org not listed here (or an unset env var) falls back to the
// default RESEND_API_KEY, so this can never reach an unrelated secret.
const RESEND_ACCOUNT_ENV_BY_ORG: Record<string, string> = {
  "9b3528ad-8946-4f31-a1ca-1c8d3d782fb9": "RESEND_API_KEY_REDEFINE", // RMPL -- redefine.in is verified on the Redefine/RMPL Resend account, not fmamit
};

export function resolveResendApiKey(orgId: string | null | undefined): string | undefined {
  const envName = orgId ? RESEND_ACCOUNT_ENV_BY_ORG[orgId] : undefined;
  return (envName && Deno.env.get(envName)) || Deno.env.get("RESEND_API_KEY");
}
