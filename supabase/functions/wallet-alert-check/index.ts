// Wallet alert sweep (cron, every ~10 min via cron-worker).
// For every org that uses the wallet, compares balance to two thresholds and
// alerts the org admin once per crossing (WhatsApp + email):
//   - LOW       : balance <= wallet_low_alert_threshold (default ₹5000), above min
//   - EXHAUSTED : balance <= wallet_minimum_balance (portal actions have halted)
// State lives in organization_subscriptions.wallet_alert_level and re-arms when the
// balance recovers, so admins are never pinged repeatedly for the same condition.
// Failure-only spirit: nothing is sent while the balance is healthy.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.58.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const LOW_DEFAULT = 5000;

// A wallet that can't fund even one more action is effectively empty. The
// dispatcher charges before sending and stops at the floor, leaving a sub-rupee
// residual above the minimum — so treat anything within ₹1 of the floor as
// "exhausted" and remind the client to pay; otherwise the reminder never fires.
const EXHAUSTED_BUFFER = 1;

// Per-org WhatsApp sender (WABA from-number). Mirrors the dispatcher / post-call
// override; all numbers sit under the one shared WABA, so the approved admin
// templates work from any of them. Other orgs fall back to EXOTEL_SENDER_NUMBER.
const WA_SENDER_BY_ORG: Record<string, string> = {
  "6dcf4229-6902-4cd4-9c7f-2d6ed4a6045d": "+918808359820", // IEDUP
};

const WA_TEMPLATE: Record<"low" | "exhausted", string> = {
  low: "wallet_low_balance_admin_v1",
  exhausted: "wallet_exhausted_admin_v1",
};
const EMAIL_TEMPLATE: Record<"low" | "exhausted", string> = {
  low: "wallet_low_balance",
  exhausted: "wallet_exhausted",
};

type Level = "none" | "low" | "exhausted";

function normalizePhone(p: string | null | undefined): string | null {
  if (!p) return null;
  const trimmed = String(p).trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("+")) return trimmed;
  const digits = trimmed.replace(/\D/g, "");
  if (digits.startsWith("91") && digits.length === 12) return `+${digits}`;
  if (digits.length === 10) return `+91${digits}`;
  return trimmed.startsWith("+") ? trimmed : `+${digits}`;
}

// "12,345" for display; exhausted clamps to "0" so a negative balance never shows.
function balanceDisplay(level: "low" | "exhausted", balance: number): string {
  const n = level === "exhausted" ? Math.max(0, Math.round(balance)) : Math.round(balance);
  return n.toLocaleString("en-IN");
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: subs } = await supabase
    .from("organization_subscriptions")
    .select("org_id, wallet_balance, wallet_minimum_balance, wallet_low_alert_threshold, wallet_alert_level");

  if (!subs || subs.length === 0) {
    return done(200, { ok: true, checked: 0 });
  }

  // Orgs that have ever transacted on the wallet — used to skip pristine 0/0 orgs
  // that don't use wallet billing at all (avoids false "exhausted" alerts).
  const { data: txnOrgs } = await supabase
    .from("wallet_transactions")
    .select("org_id");
  const usedWallet = new Set<string>((txnOrgs || []).map((r: any) => r.org_id as string));

  // Internal/demo orgs are never billed (the spend gate exempts them), so they
  // can never be "out of funds" — don't pester them with payment reminders.
  const { data: intOrgs } = await supabase
    .from("organizations")
    .select("id")
    .eq("is_internal", true);
  const internal = new Set<string>((intOrgs || []).map((r: any) => r.id as string));

  const results: unknown[] = [];
  for (const s of subs as any[]) {
    const orgId = s.org_id as string;
    const balance = Number(s.wallet_balance ?? 0);
    const min = Number(s.wallet_minimum_balance ?? 0);
    const low = Number(s.wallet_low_alert_threshold ?? LOW_DEFAULT);
    const current = (s.wallet_alert_level ?? "none") as Level;

    // Skip internal/demo orgs and orgs that don't use the wallet at all.
    if (internal.has(orgId)) continue;
    if (balance === 0 && min === 0 && !usedWallet.has(orgId)) continue;

    const target: Level = balance <= min + EXHAUSTED_BUFFER ? "exhausted" : (balance <= low ? "low" : "none");
    if (target === current) continue;

    if (target === "none") {
      // Recovered — re-arm without messaging.
      await supabase.from("organization_subscriptions")
        .update({ wallet_alert_level: "none", wallet_alert_sent_at: null })
        .eq("org_id", orgId);
      results.push({ org_id: orgId, action: "rearmed" });
      continue;
    }

    const r = await alertOrg(supabase, orgId, target, balance, min);
    // Advance state only if at least one channel delivered, so a transient failure
    // is retried next tick rather than silently swallowed.
    if (r.wa_ok || r.email_ok) {
      await supabase.from("organization_subscriptions")
        .update({ wallet_alert_level: target, wallet_alert_sent_at: new Date().toISOString() })
        .eq("org_id", orgId);
    }
    results.push({ org_id: orgId, level: target, ...r });
  }

  return done(200, { ok: true, checked: subs.length, results });
});

async function alertOrg(
  supabase: any,
  orgId: string,
  level: "low" | "exhausted",
  balance: number,
  min: number,
): Promise<{ wa_ok: boolean; email_ok: boolean; wa_error?: string; email_error?: string }> {
  const { data: org } = await supabase.from("organizations").select("name").eq("id", orgId).maybeSingle();
  const orgName = org?.name || "your organization";

  // Resolve the org admin (for the WhatsApp number; email fn does its own lookup).
  const { data: roles } = await supabase
    .from("user_roles")
    .select("user_id")
    .eq("org_id", orgId)
    .in("role", ["admin", "super_admin"])
    .limit(1);
  const adminUserId = roles?.[0]?.user_id as string | undefined;
  let adminPhone: string | null = null;
  if (adminUserId) {
    const { data: prof } = await supabase.from("profiles").select("phone").eq("id", adminUserId).maybeSingle();
    adminPhone = normalizePhone(prof?.phone);
  }

  // --- WhatsApp -------------------------------------------------------------
  let wa: { ok: boolean; error?: string } = { ok: false, error: "no admin phone" };
  if (adminPhone) {
    wa = await sendWhatsApp(orgId, adminPhone, WA_TEMPLATE[level], [orgName, balanceDisplay(level, balance)]);
  }

  // --- Email (delegated; reuses admin lookup + Resend + logging) ------------
  let email: { ok: boolean; error?: string } = { ok: false };
  try {
    const { error } = await supabase.functions.invoke("send-subscription-email", {
      body: {
        org_id: orgId,
        template_type: EMAIL_TEMPLATE[level],
        data: { current_balance: balance, min_balance: min },
      },
    });
    email = error ? { ok: false, error: String(error.message || error) } : { ok: true };
  } catch (e: any) {
    email = { ok: false, error: String(e?.message || e) };
  }

  return { wa_ok: wa.ok, email_ok: email.ok, wa_error: wa.error, email_error: email.error };
}

async function sendWhatsApp(
  orgId: string,
  toPhone: string,
  templateName: string,
  bodyParams: string[],
): Promise<{ ok: boolean; error?: string }> {
  const apiKey = Deno.env.get("EXOTEL_API_KEY");
  const apiToken = Deno.env.get("EXOTEL_API_TOKEN");
  const sid = Deno.env.get("EXOTEL_SID");
  const subdomain = Deno.env.get("EXOTEL_SUBDOMAIN") || "api.exotel.com";
  const from = WA_SENDER_BY_ORG[orgId] || Deno.env.get("EXOTEL_SENDER_NUMBER") || "";
  if (!apiKey || !apiToken || !sid || !from) return { ok: false, error: "Exotel creds/sender not configured" };

  const cleanTo = toPhone.replace(/^\+/, "").replace(/^0+/, "");
  const payload = {
    whatsapp: {
      messages: [{
        from,
        to: cleanTo,
        content: {
          type: "template",
          template: {
            name: templateName,
            language: { code: "en" },
            components: [{ type: "body", parameters: bodyParams.map((t) => ({ type: "text", text: t })) }],
          },
        },
      }],
    },
  };

  try {
    const resp = await fetch(`https://${subdomain}/v2/accounts/${sid}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Basic ${btoa(`${apiKey}:${apiToken}`)}` },
      body: JSON.stringify(payload),
    });
    const txt = await resp.text();
    let code: number | undefined;
    try { code = JSON.parse(txt)?.response?.whatsapp?.messages?.[0]?.code; } catch { /* raw */ }
    if (resp.ok && (code === 200 || code === 202)) return { ok: true };
    return { ok: false, error: txt.slice(0, 300) };
  } catch (e: any) {
    return { ok: false, error: `fetch failed: ${e?.message || e}` };
  }
}

function done(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
