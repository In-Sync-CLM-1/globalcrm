/**
 * Master off switch for outbound AI (Bolna) calling.
 *
 * Turned OFF on 2026-08-17 at Amit's instruction — "switch off Bolna
 * completely in the Global CRM. I do not know why is it carrying on."
 *
 * This is deliberately a constant and not an environment variable: a missing
 * or mistyped secret would silently mean "enabled", which is the wrong way for
 * this particular default to fail. Every path that can dial out imports this
 * and refuses before any request reaches Bolna:
 *
 *   _shared/aiCalling.ts   → triggerBolnaCall  (ai-bulk-call, ai-bolna-webhook)
 *   _shared/pipelineActions.ts → triggerCall   (pipeline-action-dispatcher,
 *                                               iedup-fire-action)
 *
 * The dialer's own cron (ai-bulk-call, every minute) was removed from
 * cron-worker/jobs.txt and its Worker deleted at the same time, so nothing is
 * even attempting to dial. Inbound webhooks still work: results for calls
 * already placed are still recorded, they just never start a new one.
 *
 * TO RE-ENABLE: set this to true, redeploy, and restore the dialer cron line.
 */
export const AI_CALLING_ENABLED = false;

export const AI_CALLING_DISABLED_REASON =
  "AI calling is switched off for this project (see _shared/aiCallingSwitch.ts)";

/** Log once per attempt so a blocked dial is visible, not silent. */
export function logBlockedCall(where: string, phone?: string | null): void {
  console.log(`[aiCallingSwitch] blocked outbound AI call from ${where}` +
    (phone ? ` to ${String(phone).slice(0, 6)}…` : "") +
    ` — ${AI_CALLING_DISABLED_REASON}`);
}
