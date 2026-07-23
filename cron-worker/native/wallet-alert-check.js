// Native port of supabase/functions/wallet-alert-check/index.ts.
import { pgSelect, pgSelectOne, pgPatch, invokeFunction } from "./_lib/postgrest.js";

const LOW_DEFAULT = 5000;
// A wallet that can't fund even one more action is effectively empty. The
// dispatcher charges before sending and stops at the floor, leaving a sub-rupee
// residual above the minimum — so treat anything within ₹1 of the floor as
// "exhausted" and remind the client to pay; otherwise the reminder never fires.
const EXHAUSTED_BUFFER = 1;

// Per-org WhatsApp sender (WABA from-number). Mirrors the dispatcher / post-call
// override; all numbers sit under the one shared WABA, so the approved admin
// templates work from any of them. Other orgs fall back to EXOTEL_SENDER_NUMBER.
const WA_SENDER_BY_ORG = { "6dcf4229-6902-4cd4-9c7f-2d6ed4a6045d": "+918178798930" }; // IEDUP

const WA_TEMPLATE = { low: "wallet_low_balance_admin_v1", exhausted: "wallet_exhausted_admin_v1" };
const EMAIL_TEMPLATE = { low: "wallet_low_balance", exhausted: "wallet_exhausted" };

function normalizePhone(p) {
  if (!p) return null;
  const trimmed = String(p).trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("+")) return trimmed;
  const digits = trimmed.replace(/\D/g, "");
  if (digits.startsWith("91") && digits.length === 12) return `+${digits}`;
  if (digits.length === 10) return `+91${digits}`;
  return trimmed.startsWith("+") ? trimmed : `+${digits}`;
}

function balanceDisplay(level, balance) {
  const n = level === "exhausted" ? Math.max(0, Math.round(balance)) : Math.round(balance);
  return n.toLocaleString("en-IN");
}

async function sendWhatsApp(env, orgId, toPhone, templateName, bodyParams) {
  const apiKey = env.EXOTEL_API_KEY;
  const apiToken = env.EXOTEL_API_TOKEN;
  const sid = env.EXOTEL_SID;
  const subdomain = env.EXOTEL_SUBDOMAIN || "api.exotel.com";
  const from = WA_SENDER_BY_ORG[orgId] || env.EXOTEL_SENDER_NUMBER || "";
  if (!apiKey || !apiToken || !sid || !from) return { ok: false, error: "Exotel creds/sender not configured" };

  const cleanTo = toPhone.replace(/^\+/, "").replace(/^0+/, "");
  const payload = {
    whatsapp: { messages: [{
      from, to: cleanTo,
      content: { type: "template", template: { name: templateName, language: { code: "en" }, components: [{ type: "body", parameters: bodyParams.map((t) => ({ type: "text", text: t })) }] } },
    }] },
  };

  try {
    const resp = await fetch(`https://${subdomain}/v2/accounts/${sid}/messages`, {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Basic ${btoa(`${apiKey}:${apiToken}`)}` }, body: JSON.stringify(payload),
    });
    const txt = await resp.text();
    let code; try { code = JSON.parse(txt)?.response?.whatsapp?.messages?.[0]?.code; } catch { /* raw */ }
    if (resp.ok && (code === 200 || code === 202)) return { ok: true };
    return { ok: false, error: txt.slice(0, 300) };
  } catch (e) {
    return { ok: false, error: `fetch failed: ${e?.message || e}` };
  }
}

async function alertOrg(env, orgId, level, balance, min) {
  const org = await pgSelectOne(env, "organizations", `id=eq.${orgId}&select=name&limit=1`);
  const orgName = org?.name || "your organization";

  const roles = await pgSelect(env, "user_roles", `org_id=eq.${orgId}&role=in.(admin,super_admin)&select=user_id&limit=1`);
  const adminUserId = roles?.[0]?.user_id;
  let adminPhone = null;
  if (adminUserId) {
    const prof = await pgSelectOne(env, "profiles", `id=eq.${adminUserId}&select=phone&limit=1`);
    adminPhone = normalizePhone(prof?.phone);
  }

  let wa = { ok: false, error: "no admin phone" };
  if (adminPhone) wa = await sendWhatsApp(env, orgId, adminPhone, WA_TEMPLATE[level], [orgName, balanceDisplay(level, balance)]);

  let email = { ok: false };
  try {
    const { error } = await invokeFunction(env, "send-subscription-email", {
      org_id: orgId, template_type: EMAIL_TEMPLATE[level], data: { current_balance: balance, min_balance: min },
    });
    email = error ? { ok: false, error: String(error.message || error) } : { ok: true };
  } catch (e) {
    email = { ok: false, error: String(e?.message || e) };
  }

  return { wa_ok: wa.ok, email_ok: email.ok, wa_error: wa.error, email_error: email.error };
}

async function tick(env) {
  const subs = await pgSelect(env, "organization_subscriptions", "select=org_id,wallet_balance,wallet_minimum_balance,wallet_low_alert_threshold,wallet_alert_level");
  if (!subs || subs.length === 0) return { ok: true, checked: 0 };

  const txnOrgs = await pgSelect(env, "wallet_transactions", "select=org_id");
  const usedWallet = new Set((txnOrgs || []).map((r) => r.org_id));

  const intOrgs = await pgSelect(env, "organizations", "is_internal=eq.true&select=id");
  const internal = new Set((intOrgs || []).map((r) => r.id));

  const results = [];
  for (const s of subs) {
    const orgId = s.org_id;
    const balance = Number(s.wallet_balance ?? 0);
    const min = Number(s.wallet_minimum_balance ?? 0);
    const low = Number(s.wallet_low_alert_threshold ?? LOW_DEFAULT);
    const current = s.wallet_alert_level ?? "none";

    if (internal.has(orgId)) continue;
    if (balance === 0 && min === 0 && !usedWallet.has(orgId)) continue;

    const target = balance <= min + EXHAUSTED_BUFFER ? "exhausted" : (balance <= low ? "low" : "none");
    if (target === current) continue;

    if (target === "none") {
      await pgPatch(env, "organization_subscriptions", `org_id=eq.${orgId}`, { wallet_alert_level: "none", wallet_alert_sent_at: null });
      results.push({ org_id: orgId, action: "rearmed" });
      continue;
    }

    const r = await alertOrg(env, orgId, target, balance, min);
    if (r.wa_ok || r.email_ok) {
      await pgPatch(env, "organization_subscriptions", `org_id=eq.${orgId}`, { wallet_alert_level: target, wallet_alert_sent_at: new Date().toISOString() });
    }
    results.push({ org_id: orgId, level: target, ...r });
  }

  return { ok: true, checked: subs.length, results };
}

export default {
  async scheduled(_event, env, ctx) { ctx.waitUntil(tick(env)); },
  async fetch(_req, env) {
    let out;
    try { out = await tick(env); } catch (e) { out = { ok: false, error: String(e && e.stack || e) }; }
    return new Response(JSON.stringify(out), { headers: { "Content-Type": "application/json" } });
  },
};
