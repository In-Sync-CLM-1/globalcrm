// Shared billing gate for paid actions (AI calls, WhatsApp, email, SMS).
//
// "No money, no service" for every EXTERNAL org:
//   - subscription locked/cancelled  → blocked (account has no access at all)
//   - wallet at/under the ₹500 floor → blocked (out of funds)
// Internal/demo orgs (organizations.is_internal = true) are never gated.
//
// Use this as a PRE-send check so an empty wallet never gets a free send.

// Platform wallet floor (₹). External orgs cannot spend below this reserve.
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
  const floor = Math.max(Number(sub.wallet_minimum_balance ?? 0), WALLET_FLOOR);
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
