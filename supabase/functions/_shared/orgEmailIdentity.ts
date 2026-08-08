// Per-org fixed sender/reply-to override. Overrides the default per-agent
// resolution (which otherwise leaks whichever AI-persona or staff profile
// triggered the send) so replies for that org land in one shared inbox.
export const ORG_EMAIL_IDENTITY_OVERRIDE: Record<string, { fromEmail: string; replyToEmail: string }> = {
  "61f7f96d-e80c-4d9b-a765-8eb32bd3c70d": { fromEmail: "a@in-sync.co.in", replyToEmail: "a@in-sync.co.in" }, // In-Sync Demo
};
