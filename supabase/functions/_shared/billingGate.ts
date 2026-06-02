// Shared billing gate for paid actions (AI calls, WhatsApp, email, SMS).
//
// "No money, no service" for every EXTERNAL org:
//   - subscription locked/cancelled       → blocked (account has no access at all)
//   - wallet at/under the org's floor      → blocked (out of funds)
// Internal/demo orgs (organizations.is_internal = true) are never gated.
//
// The floor is the org's own wallet_minimum_balance. It defaults to the ₹500
// platform reserve when the org has never had one set explicitly, but an admin
// action CAN lower it: recording an offline payment (record-offline-payment)
// sets wallet_minimum_balance = 0, so an offline-billed org runs with NO reserve
// (any positive balance counts as "in service"). Honour that 0 — do not clamp
// it back up to ₹500, or the offline-payment rule silently never takes effect.
//
// Use this as a PRE-send check so an empty wallet never gets a free send.

// Default platform wallet floor (₹), used only when an org has no minimum set.
export const WALLET_FLOOR = 500;

export interface GateResult {
  allowed: boolean;
  reason: string;
  locked: boolean;      // true = subscription lockout (not just low wallet)
  balance?: number;
  floor?: number;
}

export async function orgServiceGate(supabase: any, orgId: string): Promise<GateResult> {
  if (!orgId) return { allowed: false, reason: "missing org_id", locked: false };

  // Internal/demo orgs are never billed or gated.
  const { data: org } = await supabase
    .from("organizations")
    .select("is_internal")
    .eq("id", orgId)
    .maybeSingle();
  if (org?.is_internal) return { allowed: true, reason: "internal org", locked: false };

  const { data: sub } = await supabase
    .from("organization_subscriptions")
    .select("subscription_status, wallet_balance, wallet_minimum_balance")
    .eq("org_id", orgId)
    .maybeSingle();

  // External org with no subscription/wallet on file → not funded, block paid use.
  if (!sub) return { allowed: false, reason: "no subscription/wallet on file", locked: false };

  if (sub.subscription_status === "suspended_locked" || sub.subscription_status === "cancelled") {
    return { allowed: false, reason: `account locked (${sub.subscription_status})`, locked: true };
  }

  const balance = Number(sub.wallet_balance ?? 0);
  // Honour the org's configured minimum (0 for offline-billed orgs). Fall back to
  // the ₹500 platform reserve only when no minimum is on file (null/undefined).
  const floor = Number(sub.wallet_minimum_balance ?? WALLET_FLOOR);
  if (balance <= floor) {
    return {
      allowed: false,
      reason: `wallet exhausted (balance ₹${balance.toFixed(2)} ≤ reserve ₹${floor.toFixed(2)})`,
      locked: false,
      balance,
      floor,
    };
  }
  return { allowed: true, reason: "ok", locked: false, balance, floor };
}
