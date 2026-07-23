// Native port of supabase/functions/automation-email-sender/index.ts.
import { pgSelect, pgSelectOne, pgPatch, pgRpc, invokeFunction } from "./_lib/postgrest.js";
import { replaceVariables } from "./_lib/templateVariables.js";

const PARALLEL_BATCH_SIZE = 10;

async function processExecution(env, execution, templatesMap, orgSettingsMap) {
  try {
    const rule = execution.email_automation_rules;
    const contact = execution.contacts;

    if (!contact?.email) throw new Error("Contact has no email address");

    const orgSettings = orgSettingsMap.get(contact.org_id);
    const maxPerDay = orgSettings?.max_automation_emails_per_day || 3;

    const canSend = await pgRpc(env, "check_and_increment_daily_limit", { _org_id: contact.org_id, _contact_id: contact.id, _max_per_day: maxPerDay });
    if (!canSend) {
      await pgPatch(env, "email_automation_executions", `id=eq.${execution.id}`, { status: "failed", error_message: `Daily email limit reached (${maxPerDay} emails per day)` });
      return "failed";
    }

    const isUnsubscribed = await pgRpc(env, "is_email_unsubscribed", { _org_id: contact.org_id, _email: contact.email });
    if (isUnsubscribed) {
      await pgPatch(env, "email_automation_executions", `id=eq.${execution.id}`, { status: "failed", error_message: "Recipient has unsubscribed from automation emails" });
      return "failed";
    }

    const isSuppressed = await pgRpc(env, "is_email_suppressed", { _org_id: contact.org_id, _email: contact.email });
    if (isSuppressed) {
      await pgPatch(env, "email_automation_executions", `id=eq.${execution.id}`, { status: "failed", error_message: "Email is on suppression list" });
      return "failed";
    }

    if (rule.enforce_business_hours) {
      const withinHours = await pgRpc(env, "is_within_business_hours", { _org_id: contact.org_id, _check_time: new Date().toISOString() });
      if (!withinHours) {
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        tomorrow.setHours(9, 0, 0, 0);
        await pgPatch(env, "email_automation_executions", `id=eq.${execution.id}`, { status: "scheduled", scheduled_for: tomorrow.toISOString() });
        return "skipped";
      }
    }

    await pgPatch(env, "email_automation_executions", `id=eq.${execution.id}`, { status: "pending" });

    let templateId = execution.email_template_id;
    let subjectOverride = null;

    if (rule.ab_test_enabled) {
      const abTest = await pgSelectOne(env, "automation_ab_tests", `rule_id=eq.${rule.id}&status=eq.active&select=*&limit=1`);
      if (abTest) {
        const variants = abTest.variants;
        const totalWeight = variants.reduce((sum, v) => sum + (v.weight || 0), 0);
        const random = Math.random() * totalWeight;
        let cumulativeWeight = 0;
        for (const variant of variants) {
          cumulativeWeight += variant.weight || 0;
          if (random <= cumulativeWeight) {
            templateId = variant.template_id;
            subjectOverride = variant.subject;
            await pgPatch(env, "email_automation_executions", `id=eq.${execution.id}`, { ab_test_id: abTest.id, ab_variant_name: variant.name });
            break;
          }
        }
      }
    }

    const template = templatesMap.get(templateId);
    if (!template) {
      await pgPatch(env, "email_automation_executions", `id=eq.${execution.id}`, { status: "failed", error_message: "Template not found" });
      return "failed";
    }

    const subjectTemplate = subjectOverride || template.subject;
    const personalizedSubject = await replaceVariables(env, subjectTemplate, contact, execution.trigger_data);

    const trackingPixelId = `${execution.id}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const unsubscribeToken = crypto.randomUUID();

    let personalizedHtml = await replaceVariables(env, template.html_content, contact, execution.trigger_data);

    const unsubscribeUrl = `${env.SUPABASE_URL}/functions/v1/unsubscribe?token=${unsubscribeToken}`;
    const unsubscribeLink = `
      <div style="margin: 40px 0 20px; padding-top: 20px; border-top: 1px solid #e5e7eb; text-align: center;">
        <p style="margin: 0; font-size: 12px; color: #6b7280; line-height: 1.5;">
          You're receiving this email because of your interaction with our platform.<br>
          <a href="${unsubscribeUrl}" style="color: #6b7280; text-decoration: underline;">Unsubscribe</a> from automated emails
        </p>
      </div>
    `;
    personalizedHtml = personalizedHtml.replace("</body>", `${unsubscribeLink}</body>`);

    const trackingPixel = `<img src="${env.SUPABASE_URL}/functions/v1/email-tracking/open?id=${trackingPixelId}" width="1" height="1" style="display:none" alt="" />`;
    personalizedHtml = personalizedHtml.replace("</body>", `${trackingPixel}</body>`);

    personalizedHtml = personalizedHtml.replace(
      /<a\s+([^>]*href=["']([^"']+)["'][^>]*)>([^<]+)<\/a>/gi,
      (match, attrs, url, linkText) => {
        if (url.includes("unsubscribe")) return match;
        const isCTAButton = attrs.includes("padding:") && attrs.includes("background-color");
        if (isCTAButton) {
          const buttonId = `btn-${linkText.trim().toLowerCase().replace(/\s+/g, "-")}`;
          const trackedUrl = `${env.SUPABASE_URL}/functions/v1/email-tracking/cta-click?id=${trackingPixelId}&button_id=${buttonId}&button_text=${encodeURIComponent(linkText.trim())}&url=${encodeURIComponent(url)}`;
          return `<a ${attrs.replace(url, trackedUrl)}>${linkText}</a>`;
        } else {
          const trackedUrl = `${env.SUPABASE_URL}/functions/v1/email-tracking/click?id=${trackingPixelId}&url=${encodeURIComponent(url)}`;
          return `<a ${attrs.replace(url, trackedUrl)}>${linkText}</a>`;
        }
      },
    );

    const { error: sendError } = await invokeFunction(env, "send-email", {
      to: contact.email, subject: personalizedSubject, html: personalizedHtml,
      contactId: execution.contact_id, trackingPixelId, unsubscribeToken,
    });
    if (sendError) throw new Error(String(sendError.message || sendError));

    await pgPatch(env, "email_automation_executions", `id=eq.${execution.id}`, { status: "sent", sent_at: new Date().toISOString(), email_subject: personalizedSubject });

    await pgRpc(env, "increment_automation_rule_stats", { _rule_id: execution.rule_id, _stat_type: "sent" });
    await pgRpc(env, "increment_automation_cooldown", { _rule_id: execution.rule_id, _contact_id: execution.contact_id, _org_id: contact.org_id });

    console.log(`Successfully sent email for execution ${execution.id}`);
    return "sent";
  } catch (error) {
    console.error(`Failed to send email for execution ${execution.id}:`, String(error));

    const retryCount = execution.retry_count || 0;
    const maxRetries = execution.max_retries || 3;

    if (retryCount < maxRetries) {
      const backoffMinutes = Math.pow(6, retryCount) * 5;
      const nextRetry = new Date(Date.now() + backoffMinutes * 60 * 1000);
      await pgPatch(env, "email_automation_executions", `id=eq.${execution.id}`, {
        status: "scheduled", retry_count: retryCount + 1, next_retry_at: nextRetry.toISOString(),
        scheduled_for: nextRetry.toISOString(), error_message: `${error.message} (retry ${retryCount + 1}/${maxRetries})`,
      });
      console.log(`Scheduled retry ${retryCount + 1} at ${nextRetry}`);
      return "skipped";
    } else {
      await pgPatch(env, "email_automation_executions", `id=eq.${execution.id}`, { status: "failed", error_message: `${error.message} (failed after ${retryCount} retries)` });
      await pgRpc(env, "increment_automation_rule_stats", { _rule_id: execution.rule_id, _stat_type: "failed" });
      return "failed";
    }
  }
}

async function tick(env) {
  const now = new Date().toISOString();
  const executions = await pgSelect(env, "email_automation_executions",
    `status=eq.scheduled&scheduled_for=lte.${now}&limit=100&select=*,email_automation_rules(*),contacts(*)`);

  if (!executions || executions.length === 0) return { message: "No scheduled emails", count: 0 };

  const templateIds = [...new Set(executions.map((e) => e.email_template_id).filter(Boolean))];
  const orgIds = [...new Set(executions.map((e) => e.contacts?.org_id).filter(Boolean))];

  const templatesData = templateIds.length ? await pgSelect(env, "email_templates", `id=in.(${templateIds.join(",")})&select=*`) : [];
  const orgSettingsData = orgIds.length ? await pgSelect(env, "organizations", `id=in.(${orgIds.join(",")})&select=id,max_automation_emails_per_day`) : [];

  const templatesMap = new Map((templatesData || []).map((t) => [t.id, t]));
  const orgSettingsMap = new Map((orgSettingsData || []).map((o) => [o.id, o]));

  let sentCount = 0, failedCount = 0;

  for (let i = 0; i < executions.length; i += PARALLEL_BATCH_SIZE) {
    const batch = executions.slice(i, i + PARALLEL_BATCH_SIZE);
    const batchResults = await Promise.allSettled(batch.map((execution) => processExecution(env, execution, templatesMap, orgSettingsMap)));
    batchResults.forEach((result) => {
      if (result.status === "fulfilled") {
        if (result.value === "sent") sentCount++;
        else if (result.value === "failed") failedCount++;
      } else {
        failedCount++;
        console.error("Batch execution error:", String(result.reason));
      }
    });
  }

  return { message: "Scheduled emails processed", sent: sentCount, failed: failedCount };
}

export default {
  async scheduled(_event, env, ctx) { ctx.waitUntil(tick(env)); },
  async fetch(_req, env) {
    let out;
    try { out = await tick(env); } catch (e) { out = { error: String(e && e.stack || e) }; }
    return new Response(JSON.stringify(out), { headers: { "Content-Type": "application/json" } });
  },
};
