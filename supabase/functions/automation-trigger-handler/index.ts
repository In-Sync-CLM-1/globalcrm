import { getSupabaseClient } from '../_shared/supabaseClient.ts';
import { replaceVariables } from '../_shared/templateVariables.ts';
import { ORG_EMAIL_IDENTITY_OVERRIDE } from '../_shared/orgEmailIdentity.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface TriggerPayload {
  orgId: string;
  triggerType: 'stage_change' | 'disposition_set' | 'activity_logged' | 'field_updated' | 'inactivity' | 'time_based' | 'assignment_changed' | 'test';
  contactId: string;
  ruleId?: string;  // For test mode
  preview?: boolean;  // For preview mode
  triggerData: {
    from_stage_id?: string;
    to_stage_id?: string;
    disposition_id?: string;
    sub_disposition_id?: string;
    activity_id?: string;
    activity_type?: string;
    custom_field_id?: string;
    field_id?: string;
    old_value?: string;
    new_value?: string;
    old_user_id?: string;
    new_user_id?: string;
    old_team_id?: string;
    new_team_id?: string;
    days_inactive?: number;
    last_activity?: string;
    [key: string]: any;
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = getSupabaseClient();

    const payload: TriggerPayload = await req.json();
    console.log('Automation trigger received:', payload);

    const { orgId, triggerType, contactId, triggerData, ruleId, preview } = payload;

    // Handle test/preview mode
    if (triggerType === 'test' && ruleId) {
      console.log('Test mode triggered for rule:', ruleId);
      
      const { data: rule, error: ruleError } = await supabase
        .from('email_automation_rules')
        .select('*, email_templates(*)')
        .eq('id', ruleId)
        .single();
      
      if (ruleError) throw ruleError;
      if (!rule) throw new Error('Rule not found');
      
      // Get contact details
      const { data: contact, error: contactError } = await supabase
        .from('contacts')
        .select('*')
        .eq('id', contactId)
        .single();
      
      if (contactError) throw contactError;
      
      // Generate email preview
      const emailData = await generateEmailPreview(supabase, rule, contact, triggerData);
      
      if (preview) {
        // Just return preview
        return new Response(
          JSON.stringify(emailData),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
        );
      } else {
        // Send actual test email by creating a temporary execution
        const { data: execution, error: execError } = await supabase
          .from('email_automation_executions')
          .insert({
            org_id: orgId,
            rule_id: ruleId,
            contact_id: contactId,
            trigger_type: 'test',
            trigger_data: triggerData,
            status: 'pending',
            email_template_id: rule.email_template_id,
            email_subject: emailData.subject,
          })
          .select()
          .single();
        
        if (execError) throw execError;
        
        await sendAutomationEmail(supabase, execution.id);
        
        return new Response(
          JSON.stringify({ success: true, message: 'Test email sent' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
        );
      }
    }

    // 1. Find matching active rules for this trigger type and org
    const { data: rules, error: rulesError } = await supabase
      .from('email_automation_rules')
      .select('*')
      .eq('org_id', orgId)
      .eq('trigger_type', triggerType)
      .eq('is_active', true)
      .order('priority', { ascending: false });

    if (rulesError) throw rulesError;

    if (!rules || rules.length === 0) {
      console.log('No matching rules found');
      return new Response(
        JSON.stringify({ message: 'No matching rules' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      );
    }

    console.log(`Found ${rules.length} matching rules`);
    let processedCount = 0;

    // 2. Process each rule
    for (const rule of rules) {
      // Check if trigger config matches
      if (!checkTriggerMatch(rule.trigger_config, triggerData, triggerType)) {
        console.log(`Rule ${rule.name} trigger config doesn't match`);
        continue;
      }

      // Check cooldown/frequency limits
      const canSend = await checkCooldown(supabase, rule.id, contactId, rule);
      if (!canSend) {
        console.log(`Rule ${rule.name} cooldown not met`);
        continue;
      }

      // Evaluate conditions
      const conditionsMet = await evaluateConditions(supabase, rule.conditions, contactId, orgId, rule.condition_logic);
      if (!conditionsMet) {
        console.log(`Rule ${rule.name} conditions not met`);
        continue;
      }

      // Get contact email
      const { data: contact } = await supabase
        .from('contacts')
        .select('email, first_name, last_name')
        .eq('id', contactId)
        .single();

      if (!contact?.email) {
        console.log('Contact has no email');
        continue;
      }

      // Calculate scheduled time
      const scheduledFor = new Date();
      scheduledFor.setMinutes(scheduledFor.getMinutes() + (rule.send_delay_minutes || 0));

      // Create execution record
      const { data: execution, error: execError } = await supabase
        .from('email_automation_executions')
        .insert({
          org_id: orgId,
          rule_id: rule.id,
          contact_id: contactId,
          trigger_type: triggerType,
          trigger_data: triggerData,
          status: rule.send_delay_minutes > 0 ? 'scheduled' : 'pending',
          scheduled_for: rule.send_delay_minutes > 0 ? scheduledFor.toISOString() : null,
          email_template_id: rule.email_template_id,
        })
        .select()
        .single();

      if (execError) {
        console.error('Failed to create execution:', execError);
        continue;
      }

      // Increment triggered count
      await supabase.rpc('increment_automation_rule_stats', {
        _rule_id: rule.id,
        _stat_type: 'triggered',
      });

      // If immediate send, trigger email sender
      if (rule.send_delay_minutes === 0) {
        await sendAutomationEmail(supabase, execution.id);
      }

      processedCount++;
      console.log(`Rule ${rule.name} processed for contact ${contactId}`);
    }

    return new Response(
      JSON.stringify({ 
        message: 'Automation processed', 
        rulesProcessed: processedCount 
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    );
  } catch (error: any) {
    console.error('Automation trigger error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});

function checkTriggerMatch(config: any, triggerData: any, triggerType: string): boolean {
  if (triggerType === 'stage_change') {
    // Check from_stage_id and to_stage_id
    if (config.from_stage_id && config.from_stage_id !== 'any' && config.from_stage_id !== triggerData.from_stage_id) {
      return false;
    }
    if (config.to_stage_id && config.to_stage_id !== 'any' && config.to_stage_id !== triggerData.to_stage_id) {
      return false;
    }
    return true;
  }

  if (triggerType === 'disposition_set') {
    // Check disposition_ids or sub_disposition_ids
    if (config.disposition_ids?.length > 0) {
      if (!config.disposition_ids.includes(triggerData.disposition_id)) {
        return false;
      }
    }
    if (config.sub_disposition_ids?.length > 0) {
      if (!config.sub_disposition_ids.includes(triggerData.sub_disposition_id)) {
        return false;
      }
    }
    return true;
  }

  if (triggerType === 'activity_logged') {
    // Check activity types
    if (config.activity_types?.length > 0) {
      if (!config.activity_types.includes(triggerData.activity_type)) {
        return false;
      }
    }
    // Check minimum call duration
    if (config.min_call_duration_seconds && triggerData.call_duration) {
      if (triggerData.call_duration < config.min_call_duration_seconds) {
        return false;
      }
    }
    return true;
  }

  if (triggerType === 'field_updated') {
    // Check specific field
    if (config.field_id && config.field_id !== triggerData.custom_field_id) {
      return false;
    }
    // Check change type
    if (config.change_type) {
      if (config.change_type === 'set' && !triggerData.new_value) return false;
      if (config.change_type === 'cleared' && triggerData.new_value) return false;
      // For numeric fields, check threshold
      if (config.value_threshold && triggerData.new_value) {
        const newValue = parseFloat(triggerData.new_value);
        if (isNaN(newValue)) return false;
        
        if (config.value_threshold.startsWith('>')) {
          const threshold = parseFloat(config.value_threshold.substring(1).trim());
          if (newValue <= threshold) return false;
        } else if (config.value_threshold.startsWith('<')) {
          const threshold = parseFloat(config.value_threshold.substring(1).trim());
          if (newValue >= threshold) return false;
        }
      }
    }
    return true;
  }

  if (triggerType === 'inactivity') {
    // Inactivity matching is done in the database function
    return true;
  }

  if (triggerType === 'time_based') {
    // Time-based matching is done in the database function
    return true;
  }

  if (triggerType === 'assignment_changed') {
    // Check specific users or teams
    if (config.assigned_to_user_ids?.length > 0) {
      if (!config.assigned_to_user_ids.includes(triggerData.new_user_id)) {
        return false;
      }
    }
    if (config.assigned_to_team_ids?.length > 0) {
      if (!config.assigned_to_team_ids.includes(triggerData.new_team_id)) {
        return false;
      }
    }
    return true;
  }

  if (triggerType === 'email_engagement') {
    const engagementType = triggerData.engagement_type; // 'opened' or 'clicked'
    
    // Check trigger config for specific engagement type
    if (config.engagement_type && config.engagement_type !== engagementType) {
      return false;
    }

    // Optional: Check engagement timeframe (within X hours of send)
    if (config.within_hours && triggerData.sent_at) {
      const sentAt = new Date(triggerData.sent_at);
      const engagedAt = new Date(triggerData[engagementType === 'opened' ? 'opened_at' : 'clicked_at']);
      const hoursDiff = (engagedAt.getTime() - sentAt.getTime()) / (1000 * 60 * 60);
      
      if (hoursDiff > config.within_hours) {
        return false;
      }
    }

    return true;
  }

  return false;
}

async function checkCooldown(supabase: any, ruleId: string, contactId: string, rule: any): Promise<boolean> {
  // Check if there's a cooldown record
  const { data: cooldown } = await supabase
    .from('email_automation_cooldowns')
    .select('*')
    .eq('rule_id', ruleId)
    .eq('contact_id', contactId)
    .single();

  if (!cooldown) return true; // No cooldown record, can send

  // Check max sends per contact
  if (rule.max_sends_per_contact && cooldown.send_count >= rule.max_sends_per_contact) {
    return false;
  }

  // Check cooldown period
  if (rule.cooldown_period_days) {
    const lastSentDate = new Date(cooldown.last_sent_at);
    const daysSinceLastSent = (Date.now() - lastSentDate.getTime()) / (1000 * 60 * 60 * 24);
    if (daysSinceLastSent < rule.cooldown_period_days) {
      return false;
    }
  }

  return true;
}

async function evaluateConditions(supabase: any, conditions: any[], contactId: string, orgId: string, conditionLogic: string = 'AND'): Promise<boolean> {
  if (!conditions || conditions.length === 0) return true;

  // Fetch contact with all related data
  const { data: contact, error } = await supabase
    .from('contacts')
    .select(`
      *,
      contact_custom_fields (
        custom_field_id,
        field_value,
        custom_fields (field_name, field_type)
      )
    `)
    .eq('id', contactId)
    .single();

  if (error || !contact) {
    console.error('Error fetching contact for conditions:', error);
    return false;
  }

  const results: boolean[] = [];

  for (const condition of conditions) {
    const result = await evaluateSingleCondition(supabase, condition, contact, orgId);
    results.push(result);

    // Early exit optimization
    if (conditionLogic === 'AND' && !result) return false;
    if (conditionLogic === 'OR' && result) return true;
  }

  return conditionLogic === 'AND' ? results.every(r => r) : results.some(r => r);
}

async function evaluateSingleCondition(supabase: any, condition: any, contact: any, orgId: string): Promise<boolean> {
  try {
    switch (condition.type) {
      case 'contact_field': {
        const fieldValue = contact[condition.field];
        return compareValues(fieldValue, condition.operator, condition.value);
      }

      case 'custom_field': {
        const customField = contact.contact_custom_fields?.find(
          (cf: any) => cf.custom_fields.field_name === condition.field_name
        );
        const fieldValue = customField?.field_value;
        return compareValues(fieldValue, condition.operator, condition.value);
      }

      case 'activity_history': {
        const daysAgo = condition.days_ago || 30;
        const sinceDate = new Date();
        sinceDate.setDate(sinceDate.getDate() - daysAgo);

        const { data: activities } = await supabase
          .from('contact_activities')
          .select('id')
          .eq('contact_id', contact.id)
          .eq('activity_type', condition.activity_type)
          .gte('created_at', sinceDate.toISOString());

        const count = activities?.length || 0;
        return compareValues(count, condition.operator, parseInt(condition.value));
      }

      case 'time_condition': {
        const now = new Date();
        
        if (condition.time_type === 'day_of_week') {
          const dayOfWeek = now.toLocaleDateString('en-US', { weekday: 'short' });
          return condition.values.includes(dayOfWeek);
        }
        
        if (condition.time_type === 'time_of_day') {
          const hour = now.getHours();
          const startHour = parseInt(condition.start_time?.split(':')[0] || '0');
          const endHour = parseInt(condition.end_time?.split(':')[0] || '23');
          return hour >= startHour && hour <= endHour;
        }
        
        if (condition.time_type === 'month') {
          const month = now.toLocaleDateString('en-US', { month: 'short' });
          return condition.values.includes(month);
        }
        
        return true;
      }

      case 'user_team': {
        if (condition.check_type === 'assigned_user') {
          return condition.user_ids?.includes(contact.assigned_to);
        }
        if (condition.check_type === 'assigned_team') {
          return condition.team_ids?.includes(contact.assigned_team_id);
        }
        return true;
      }

      default:
        console.warn('Unknown condition type:', condition.type);
        return true;
    }
  } catch (error) {
    console.error('Error evaluating condition:', error, condition);
    return false;
  }
}

function compareValues(actualValue: any, operator: string, expectedValue: any): boolean {
  // Handle null/undefined
  if (actualValue === null || actualValue === undefined) {
    return operator === 'is_empty' || operator === 'not_equals';
  }

  // Convert to string for comparison
  const actual = String(actualValue).toLowerCase().trim();
  const expected = String(expectedValue).toLowerCase().trim();

  switch (operator) {
    case 'equals':
      return actual === expected;
    case 'not_equals':
      return actual !== expected;
    case 'contains':
      return actual.includes(expected);
    case 'not_contains':
      return !actual.includes(expected);
    case 'starts_with':
      return actual.startsWith(expected);
    case 'ends_with':
      return actual.endsWith(expected);
    case 'is_empty':
      return actual.length === 0;
    case 'is_not_empty':
      return actual.length > 0;
    case 'greater_than':
      return parseFloat(actualValue) > parseFloat(expectedValue);
    case 'less_than':
      return parseFloat(actualValue) < parseFloat(expectedValue);
    case 'greater_than_or_equal':
      return parseFloat(actualValue) >= parseFloat(expectedValue);
    case 'less_than_or_equal':
      return parseFloat(actualValue) <= parseFloat(expectedValue);
    case 'in':
      return expected.split(',').map((v: string) => v.trim()).includes(actual);
    case 'not_in':
      return !expected.split(',').map((v: string) => v.trim()).includes(actual);
    default:
      return false;
  }
}

async function generateEmailPreview(supabase: any, rule: any, contact: any, triggerData: any) {
  // Get email settings
  const { data: emailSettings } = await supabase
    .from('email_settings')
    .select('*')
    .eq('org_id', contact.org_id)
    .single();

  if (!emailSettings) {
    throw new Error('Email settings not configured');
  }

  // Get template
  const { data: template } = await supabase
    .from('email_templates')
    .select('*')
    .eq('id', rule.email_template_id)
    .single();

  if (!template) {
    throw new Error('Email template not found');
  }

  // Replace variables in subject and body
  const subject = await replaceVariables(template.subject, contact, triggerData, supabase);
  const htmlContent = await replaceVariables(template.html_content, contact, triggerData, supabase);

  return {
    from_email: `${emailSettings.sender_name} <${emailSettings.sender_email}>`,
    to_email: contact.email,
    subject,
    html_content: htmlContent,
  };
}

async function sendAutomationEmail(supabase: any, executionId: string) {
  try {
    // Get execution details
    const { data: execution } = await supabase
      .from('email_automation_executions')
      .select(`
        *,
        email_automation_rules(*),
        contacts(*)
      `)
      .eq('id', executionId)
      .single();

    if (!execution) throw new Error('Execution not found');

    // Get template
    const { data: template } = await supabase
      .from('email_templates')
      .select('*')
      .eq('id', execution.email_template_id)
      .single();

    if (!template) {
      await supabase
        .from('email_automation_executions')
        .update({ 
          status: 'failed', 
          error_message: 'Template not found' 
        })
        .eq('id', executionId);
      return;
    }

    // Enhanced variable replacement
    const personalizedSubject = await replaceVariables(template.subject, execution.contacts, execution.trigger_data, supabase);
    const personalizedHtml = await replaceVariables(template.html_content, execution.contacts, execution.trigger_data, supabase);

    // Look up verified sending domain for this org
    const { data: emailSettings } = await supabase
      .from('email_settings')
      .select('sending_domain, verification_status, is_active')
      .eq('org_id', execution.contacts.org_id)
      .maybeSingle();

    if (!emailSettings?.is_active || emailSettings.verification_status !== 'verified') {
      throw new Error('Sending domain not configured or not verified for this org');
    }

    const identityOverride = ORG_EMAIL_IDENTITY_OVERRIDE[execution.contacts.org_id];

    // Resolve caller (the SDR who logged the call) for reply-to + from name
    let replyToEmail = '';
    let fromName = 'In-Sync';
    if (execution.trigger_data?.created_by) {
      const { data: caller } = await supabase
        .from('profiles')
        .select('first_name, last_name, email')
        .eq('id', execution.trigger_data.created_by)
        .single();
      if (caller) {
        const callerName = `${caller.first_name || ''} ${caller.last_name || ''}`.trim();
        if (callerName) fromName = `${callerName} • In-Sync`;
        if (caller.email) replyToEmail = caller.email;
      }
    }
    if (identityOverride) replyToEmail = identityOverride.replyToEmail;

    const fromEmail = identityOverride?.fromEmail ?? `noreply@${emailSettings.sending_domain}`;
    const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
    if (!RESEND_API_KEY) throw new Error('RESEND_API_KEY not configured');

    const resendPayload: any = {
      from: `${fromName} <${fromEmail}>`,
      to: [execution.contacts.email],
      subject: personalizedSubject,
      html: personalizedHtml,
    };
    if (replyToEmail && replyToEmail !== fromEmail) {
      resendPayload.reply_to = [replyToEmail];
    }

    const resendResp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify(resendPayload),
    });

    if (!resendResp.ok) {
      const errBody = await resendResp.text();
      throw new Error(`Resend send failed: ${resendResp.status} ${errBody}`);
    }

    // Log into email_conversations for the contact timeline
    try {
      await supabase.from('email_conversations').insert([{
        org_id: execution.contacts.org_id,
        conversation_id: crypto.randomUUID(),
        contact_id: execution.contact_id,
        from_email: fromEmail,
        from_name: fromName,
        to_email: execution.contacts.email,
        subject: personalizedSubject,
        email_content: personalizedHtml,
        html_content: personalizedHtml,
        direction: 'outbound',
        status: 'sent',
        sent_by: execution.trigger_data?.created_by || null,
      }]);
    } catch (logErr) {
      console.error('Failed to log email_conversations entry:', logErr);
    }

    // Also send the WhatsApp companion message, if the rule has one configured
    try {
      const waTemplateId = execution.email_automation_rules?.whatsapp_template_id;
      if (waTemplateId && execution.contacts.phone) {
        await sendCompanionWhatsApp(supabase, execution, waTemplateId);
      }
    } catch (waErr) {
      console.error('WhatsApp companion send failed (non-fatal):', waErr);
    }

    // Update execution status
    await supabase
      .from('email_automation_executions')
      .update({ 
        status: 'sent', 
        sent_at: new Date().toISOString(),
        email_subject: personalizedSubject
      })
      .eq('id', executionId);

    // Update rule stats
    await supabase.rpc('increment_automation_rule_stats', {
      _rule_id: execution.rule_id,
      _stat_type: 'sent',
    });

    // Record cooldown
    await supabase
      .from('email_automation_cooldowns')
      .upsert({
        org_id: execution.contacts.org_id,
        rule_id: execution.rule_id,
        contact_id: execution.contact_id,
        last_sent_at: new Date().toISOString(),
        send_count: 1,
      }, {
        onConflict: 'rule_id,contact_id',
        ignoreDuplicates: false,
      });

  } catch (error: any) {
    console.error('Failed to send automation email:', error);
    await supabase
      .from('email_automation_executions')
      .update({ 
        status: 'failed', 
        error_message: error.message 
      })
      .eq('id', executionId);

    await supabase.rpc('increment_automation_rule_stats', {
      _rule_id: executionId,
      _stat_type: 'failed',
    });
  }
}

async function sendCompanionWhatsApp(supabase: any, execution: any, waTemplateRowId: string) {
  // Look up the WhatsApp template
  const { data: tpl } = await supabase
    .from('communication_templates')
    .select('template_id, template_name, content, language, status')
    .eq('id', waTemplateRowId)
    .single();
  if (!tpl) {
    console.warn('WhatsApp companion: template row not found', waTemplateRowId);
    return;
  }

  // Look up org's Exotel WhatsApp creds
  const { data: ex } = await supabase
    .from('exotel_settings')
    .select('whatsapp_enabled, whatsapp_source_number, whatsapp_api_key, whatsapp_api_token, whatsapp_subdomain, whatsapp_account_sid, api_key, api_token, subdomain, account_sid, waba_id')
    .eq('org_id', execution.contacts.org_id)
    .eq('is_active', true)
    .maybeSingle();
  if (!ex?.whatsapp_enabled || !ex.whatsapp_source_number) {
    console.warn('WhatsApp companion: org WhatsApp not configured');
    return;
  }

  const apiKey = ex.whatsapp_api_key || ex.api_key;
  const apiToken = ex.whatsapp_api_token || ex.api_token;
  const subdomain = ex.whatsapp_subdomain || ex.subdomain;
  const accountSid = ex.whatsapp_account_sid || ex.account_sid;

  // Resolve the caller (SDR) profile for name
  let callerName = 'In-Sync';
  if (execution.trigger_data?.created_by) {
    const { data: caller } = await supabase
      .from('profiles')
      .select('first_name, last_name')
      .eq('id', execution.trigger_data.created_by)
      .single();
    if (caller) {
      const fullName = `${caller.first_name || ''} ${caller.last_name || ''}`.trim();
      if (fullName) callerName = fullName;
    }
  }

  // Build parameter list by template name (positional)
  const first = execution.contacts.first_name || 'there';
  let params: string[] = [];
  if (tpl.template_name === 'worksync_intro_post_call') {
    params = [first, callerName];
  } else if (tpl.template_name === 'worksync_demo_confirmation') {
    const demoDateRaw: string | null = execution.trigger_data?.demo_date || null;
    const demoTimeRaw: string | null = execution.trigger_data?.demo_time || null;
    let demoDate = '';
    if (demoDateRaw) {
      const d = new Date(demoDateRaw + 'T00:00:00');
      const day = d.toLocaleDateString('en-IN', { weekday: 'long' });
      const date = d.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
      demoDate = `${day}, ${date}`;
    }
    let demoTime = '';
    if (demoTimeRaw) {
      const [hStr, mStr] = String(demoTimeRaw).split(':');
      let h = parseInt(hStr || '0', 10);
      const m = mStr || '00';
      const period = h >= 12 ? 'PM' : 'AM';
      h = h % 12 || 12;
      demoTime = `${h}:${m} ${period}`;
    }
    params = [first, callerName, demoDate, demoTime];
  } else {
    console.warn('WhatsApp companion: no parameter mapping for template', tpl.template_name);
    return;
  }

  // Build Exotel WhatsApp payload
  const exotelUrl = `https://${subdomain}/v2/accounts/${accountSid}/messages`;
  const auth = btoa(`${apiKey}:${apiToken}`);
  const callbackUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/whatsapp-webhook`;
  let formattedPhone = String(execution.contacts.phone).replace(/[^\d+]/g, '');
  if (!formattedPhone.startsWith('+')) {
    if (!formattedPhone.startsWith('91') && formattedPhone.length === 10) {
      formattedPhone = '+91' + formattedPhone;
    } else {
      formattedPhone = '+' + formattedPhone;
    }
  }
  const payload = {
    custom_data: execution.contact_id,
    status_callback: callbackUrl,
    whatsapp: {
      messages: [{
        from: ex.whatsapp_source_number,
        to: formattedPhone,
        content: {
          type: 'template',
          template: {
            name: tpl.template_name,
            language: { code: tpl.language || 'en' },
            components: [{
              type: 'body',
              parameters: params.map((p) => ({ type: 'text', text: p })),
            }],
          },
        },
      }],
    },
  };

  const resp = await fetch(exotelUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Basic ${auth}` },
    body: JSON.stringify(payload),
  });
  const respText = await resp.text();
  console.log(`WhatsApp companion ${tpl.template_name} status=${resp.status} body=${respText.slice(0, 300)}`);

  // Log to whatsapp_messages so DLR webhook can update it
  try {
    let sid: string | null = null;
    try {
      const j = JSON.parse(respText);
      sid = j?.response?.whatsapp?.messages?.[0]?.data?.sid || null;
    } catch {}
    const messageText = (tpl.content || '').replace(/\{\{(\d+)\}\}/g, (_: string, idx: string) => params[parseInt(idx, 10) - 1] ?? '');
    await supabase.from('whatsapp_messages').insert({
      org_id: execution.contacts.org_id,
      contact_id: execution.contact_id,
      template_id: waTemplateRowId,
      sent_by: execution.trigger_data?.created_by || null,
      phone_number: formattedPhone,
      message_content: messageText,
      exotel_message_id: sid,
      status: resp.ok ? 'sent' : 'failed',
      error_message: resp.ok ? null : respText.slice(0, 500),
    });
  } catch (logErr) {
    console.error('Failed to log whatsapp_messages entry:', logErr);
  }
}

