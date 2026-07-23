// Ported from supabase/functions/_shared/templateVariables.ts (replaceVariables only --
// automation-email-sender.js is the only native worker that needs it).
import { pgSelectOne, pgSelect } from "./postgrest.js";

export async function replaceVariables(env, template, contact, triggerData = {}, customMappings) {
  let result = template;

  if (customMappings) {
    for (const [variable, mapping] of Object.entries(customMappings)) {
      let value = "";
      if (mapping.source === "crm" && contact) value = contact[mapping.field] || "";
      else if (mapping.source === "csv" && triggerData) value = triggerData[mapping.field] || "";
      else if (mapping.source === "static") value = mapping.value || "";
      const escapedVariable = variable.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      result = result.replace(new RegExp(escapedVariable, "g"), value);
    }
    return result;
  }

  const prospectName = `${contact?.first_name || ""} ${contact?.last_name || ""}`.trim() || "there";
  result = result
    .replace(/{{first_name}}/g, contact?.first_name || "")
    .replace(/{{last_name}}/g, contact?.last_name || "")
    .replace(/{{full_name}}/g, prospectName)
    .replace(/{{prospect_name}}/g, prospectName)
    .replace(/{{prospect_email}}/g, contact?.email || "")
    .replace(/{{email}}/g, contact?.email || "")
    .replace(/{{phone}}/g, contact?.phone || "")
    .replace(/{{company}}/g, contact?.company || "")
    .replace(/{{job_title}}/g, contact?.job_title || "")
    .replace(/{{city}}/g, contact?.city || "")
    .replace(/{{state}}/g, contact?.state || "")
    .replace(/{{country}}/g, contact?.country || "")
    .replace(/{{status}}/g, contact?.status || "")
    .replace(/{{source}}/g, contact?.source || "")
    .replace(/{{sales_rep_name}}/g, "Amit Sengupta");

  if (contact?.created_at) {
    const createdDate = new Date(contact.created_at);
    result = result
      .replace(/{{created_date}}/g, createdDate.toLocaleDateString())
      .replace(/{{created_date_long}}/g, createdDate.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }));
  }

  if (contact?.updated_at) {
    const daysSince = Math.floor((Date.now() - new Date(contact.updated_at).getTime()) / (1000 * 60 * 60 * 24));
    result = result.replace(/{{days_since_last_contact}}/g, String(daysSince));
  }

  if (contact?.pipeline_stage_id && result.includes("{{pipeline_stage}}")) {
    try {
      const stage = await pgSelectOne(env, "pipeline_stages", `id=eq.${contact.pipeline_stage_id}&select=name&limit=1`);
      result = result.replace(/{{pipeline_stage}}/g, stage?.name || "");
    } catch (e) { console.error("[TemplateVariables] Error fetching stage:", String(e)); }
  }

  if (contact?.assigned_to && (result.includes("{{assigned_to_name}}") || result.includes("{{assigned_to_email}}"))) {
    try {
      const assignedUser = await pgSelectOne(env, "profiles", `id=eq.${contact.assigned_to}&select=first_name,last_name,email&limit=1`);
      if (assignedUser) {
        result = result
          .replace(/{{assigned_to_name}}/g, `${assignedUser.first_name} ${assignedUser.last_name}`.trim())
          .replace(/{{assigned_to_email}}/g, assignedUser.email || "");
      }
    } catch (e) { console.error("[TemplateVariables] Error fetching assigned user:", String(e)); }
  }

  if (contact?.id && result.includes("{{custom_field.")) {
    try {
      const customFields = await pgSelect(env, "contact_custom_fields", `contact_id=eq.${contact.id}&select=custom_field_id,field_value,custom_fields(field_name)`);
      (customFields || []).forEach((cf) => {
        const fieldName = cf.custom_fields?.field_name;
        if (fieldName) {
          const regex = new RegExp(`{{custom_field\\.${fieldName}}}`, "g");
          result = result.replace(regex, cf.field_value || "");
        }
      });
    } catch (e) { console.error("[TemplateVariables] Error fetching custom fields:", String(e)); }
  }

  if (triggerData?.created_by && (result.includes("{{caller_name}}") || result.includes("{{caller_email}}") || result.includes("{{caller_phone}}"))) {
    try {
      const caller = await pgSelectOne(env, "profiles", `id=eq.${triggerData.created_by}&select=first_name,last_name,email,phone&limit=1`);
      if (caller) {
        const callerName = `${caller.first_name || ""} ${caller.last_name || ""}`.trim();
        result = result
          .replace(/{{caller_name}}/g, callerName)
          .replace(/{{caller_email}}/g, caller.email || "")
          .replace(/{{caller_phone}}/g, caller.phone || "");
      }
    } catch (e) { console.error("[TemplateVariables] Error fetching caller profile:", String(e)); }
  }
  result = result.replace(/{{caller_name}}/g, "").replace(/{{caller_email}}/g, "").replace(/{{caller_phone}}/g, "");

  if (triggerData?.demo_date || triggerData?.demo_time) {
    const demoDateRaw = triggerData.demo_date || null;
    const demoTimeRaw = triggerData.demo_time || null;
    let demoDateStr = "", demoDayStr = "", demoTimeStr = "";
    if (demoDateRaw) {
      const d = new Date(demoDateRaw + "T00:00:00");
      demoDateStr = d.toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });
      demoDayStr = d.toLocaleDateString("en-IN", { weekday: "long" });
    }
    if (demoTimeRaw) {
      const parts = String(demoTimeRaw).split(":");
      let h = parseInt(parts[0] || "0", 10);
      const m = parts[1] || "00";
      const period = h >= 12 ? "PM" : "AM";
      h = h % 12 || 12;
      demoTimeStr = `${h}:${m} ${period}`;
    }
    result = result.replace(/{{demo_date}}/g, demoDateStr).replace(/{{demo_day}}/g, demoDayStr).replace(/{{demo_time}}/g, demoTimeStr);
  }
  result = result.replace(/{{demo_date}}/g, "").replace(/{{demo_day}}/g, "").replace(/{{demo_time}}/g, "");

  if (triggerData && Object.keys(triggerData).length > 0) {
    Object.keys(triggerData).forEach((key) => {
      const regex = new RegExp(`{{trigger\\.${key}}}`, "g");
      result = result.replace(regex, String(triggerData[key] || ""));
    });

    if (triggerData.from_stage_id || triggerData.to_stage_id) {
      try {
        if (triggerData.from_stage_id && (result.includes("{{trigger.old_stage}}") || result.includes("{{trigger.from_stage}}"))) {
          const fromStage = await pgSelectOne(env, "pipeline_stages", `id=eq.${triggerData.from_stage_id}&select=name&limit=1`);
          result = result.replace(/{{trigger\.old_stage}}/g, fromStage?.name || "").replace(/{{trigger\.from_stage}}/g, fromStage?.name || "");
        }
        if (triggerData.to_stage_id && (result.includes("{{trigger.new_stage}}") || result.includes("{{trigger.to_stage}}"))) {
          const toStage = await pgSelectOne(env, "pipeline_stages", `id=eq.${triggerData.to_stage_id}&select=name&limit=1`);
          result = result.replace(/{{trigger\.new_stage}}/g, toStage?.name || "").replace(/{{trigger\.to_stage}}/g, toStage?.name || "");
        }
      } catch (e) { console.error("[TemplateVariables] Error fetching stages:", String(e)); }
    }

    if (triggerData.disposition_id && result.includes("{{trigger.disposition")) {
      try {
        const disposition = await pgSelectOne(env, "call_dispositions", `id=eq.${triggerData.disposition_id}&select=name,description&limit=1`);
        result = result.replace(/{{trigger\.disposition}}/g, disposition?.name || "").replace(/{{trigger\.disposition_description}}/g, disposition?.description || "");
      } catch (e) { console.error("[TemplateVariables] Error fetching disposition:", String(e)); }
    }

    if (triggerData.activity_type) result = result.replace(/{{trigger\.activity_type}}/g, triggerData.activity_type);

    if (triggerData.call_duration) {
      const minutes = Math.floor(triggerData.call_duration / 60);
      const seconds = triggerData.call_duration % 60;
      result = result.replace(/{{trigger\.call_duration}}/g, `${minutes}m ${seconds}s`).replace(/{{trigger\.call_duration_minutes}}/g, String(minutes));
    }
  }

  return result;
}
