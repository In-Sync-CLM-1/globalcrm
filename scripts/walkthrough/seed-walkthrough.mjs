// Seed the In-Sync Demo org for the Leadership-Cut walkthrough:
//  - hero lead Aarav Mehta with a full Riya-called -> demo-booked journey
//  - a focused worklist assigned to Priya (BD exec) with today's next-actions
//  - DPDP demo data (DPO settings, consent records, rights inbox, PII audit)
//  - pre-warm Aarav's AI lead score so it shows instantly on camera
// Idempotent. Run: node scripts/walkthrough/seed-walkthrough.mjs
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync(new URL('../../.env', import.meta.url), 'utf8').split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const REF = env.SUPABASE_PROJECT_REF, TOKEN = env.SUPABASE_ACCESS_TOKEN, URL_ = env.SUPABASE_URL, PUB = env.VITE_SUPABASE_PUBLISHABLE_KEY;
const DEMO = '61f7f96d-e80c-4d9b-a765-8eb32bd3c70d';
const PRIYA = '2875482f-af08-49d7-abe4-d8fe257054ab';
const RIYA = 'e4dee7a9-81fe-4638-8fd2-1b36e5ede8bb';
const AARAV = 'aa000001-0000-4000-8000-000000000001';
const ADMIN = '50cb8864-e89b-4d5f-bdf5-bba4045dcf62'; // Arjun (org admin) — attendance demo

async function sql(query) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json', 'User-Agent': 'curl/8' },
    body: JSON.stringify({ query }),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`SQL ${r.status}: ${t}`);
  return t ? JSON.parse(t) : [];
}
const Q = (s) => (s == null ? 'null' : `'${String(s).replace(/'/g, "''")}'`);
const one = async (q) => (await sql(q))[0];

async function main() {
  // --- resolve stage + disposition ids ---
  const stage = await one(`select id from pipeline_stages where org_id=${Q(DEMO)} and name='Qualified' limit 1`);
  const demoStage = await one(`select id from pipeline_stages where org_id=${Q(DEMO)} and name in ('Demo Requested','Qualified') order by stage_order desc limit 1`);
  const dispBooked = await one(`select id from call_dispositions where org_id=${Q(DEMO)} and name='Demo Booked' limit 1`);
  const rec = await one(`select recording_url from call_logs where org_id=${Q(DEMO)} and recording_url like 'http%' and call_duration>30 order by created_at desc limit 1`);
  const recUrl = rec?.recording_url || 'https://api.bolna.ai/recordings/call/demo';

  // --- clean prior walkthrough rows (idempotent) ---
  await sql(`
    delete from contact_activities where contact_id=${Q(AARAV)};
    delete from call_logs where contact_id=${Q(AARAV)};
    delete from contact_lead_scores where contact_id=${Q(AARAV)};
    delete from whatsapp_messages where contact_id=${Q(AARAV)};
    delete from email_conversations where contact_id=${Q(AARAV)};
    delete from consent_records where org_id=${Q(DEMO)} and source='walkthrough_seed';
    delete from data_requests where org_id=${Q(DEMO)} and source='walkthrough_seed';
    delete from pii_access_log where org_id=${Q(DEMO)} and purpose='walkthrough_seed';
    delete from tasks where org_id=${Q(DEMO)} and assigned_to=${Q(PRIYA)} and remarks='__wt';
    delete from contacts where id=${Q(AARAV)};
  `);

  // --- clear on-camera throwaways (a prior render may have left these if it
  //     crashed mid-scene): the submitted lead, the demo field, the demo form ---
  await sql(`
    delete from contact_custom_fields where contact_id in (select id from contacts where org_id=${Q(DEMO)} and source='web_form' and email='aarav.mehta@northwindlogistics.in');
    delete from contact_activities  where contact_id in (select id from contacts where org_id=${Q(DEMO)} and source='web_form' and email='aarav.mehta@northwindlogistics.in');
    delete from contacts where org_id=${Q(DEMO)} and source='web_form' and email='aarav.mehta@northwindlogistics.in';
    delete from form_fields where form_id in (select id from forms where org_id=${Q(DEMO)} and name='Website Enquiry');
    delete from forms where org_id=${Q(DEMO)} and name='Website Enquiry';
    delete from form_fields          where custom_field_id in (select id from custom_fields where org_id=${Q(DEMO)} and field_name='budget');
    delete from contact_custom_fields where custom_field_id in (select id from custom_fields where org_id=${Q(DEMO)} and field_name='budget');
    delete from custom_fields where org_id=${Q(DEMO)} and field_name='budget';
  `);

  // --- hero lead: Aarav Mehta (enriched, qualified, owned by Priya) ---
  await sql(`
    insert into contacts (id, org_id, first_name, last_name, email, phone, company, organization_name,
      organization_industry, job_title, seniority, headline, status, source, city, state, country,
      website, linkedin_url, pipeline_stage_id, assigned_to, created_by, whatsapp_outreach_status,
      product, created_at, updated_at)
    values (${Q(AARAV)}, ${Q(DEMO)}, 'Aarav', 'Mehta', 'aarav.mehta@northwindlogistics.in', '+919820011234',
      'Northwind Logistics', 'Northwind Logistics', 'Logistics & Supply Chain', 'VP of Sales', 'vp',
      'VP of Sales at Northwind Logistics', 'Qualified', 'website', 'Mumbai', 'Maharashtra', 'India',
      'https://northwindlogistics.in', 'https://www.linkedin.com/in/aarav-mehta-demo',
      ${Q(stage.id)}, ${Q(PRIYA)}, ${Q(PRIYA)}, 'delivered', 'WorkSync',
      now() - interval '28 hours', now() - interval '2 hours');
  `);

  // --- Riya's AI call: connected, interested, demo-worthy ---
  const callId = 'aa000001-0000-4000-8000-0000000000c1';
  await sql(`
    insert into call_logs (id, org_id, contact_id, agent_id, call_type, direction, status, from_number, to_number,
      call_duration, conversation_duration, started_at, answered_at, ended_at, created_at, recording_url, recording_duration,
      disposition_id, caller_type, transcript, transcript_status, transcribed_at,
      analysis_summary, analysis_tone, analysis_quality_score, analysis_next_step, analysis_status, analyzed_at)
    values (${Q(callId)}, ${Q(DEMO)}, ${Q(AARAV)}, ${Q(RIYA)}, 'outbound', 'outgoing-api', 'completed',
      '+911169323462', '+919820011234', 92, 78, now() - interval '26 hours', now() - interval '26 hours',
      now() - interval '26 hours' + interval '92 seconds', now() - interval '26 hours', ${Q(recUrl)}, 78,
      ${Q(dispBooked?.id)}, 'ai',
      'Riya: Hi, am I speaking with Aarav? ... Aarav: Yes. Riya: I am Riya, an AI assistant from In-Sync. We help sales teams like Northwind work their pipeline with far less manual effort. Is staff productivity and field tracking something on your radar? Aarav: Actually yes, we have been looking at exactly that. Riya: Wonderful. Would a short demo this week help? Aarav: Yes, please set it up.',
      'completed', now() - interval '25 hours',
      'Aarav Mehta (VP Sales, Northwind Logistics) confirmed active interest in staff productivity and field tracking, and explicitly agreed to a demo this week. Strong, qualified opportunity — decision-maker, clear need, positive intent.',
      'positive', 9, 'Schedule the product demo and send calendar invite + reminders.', 'ok', now() - interval '25 hours');
  `);

  // --- a second, human follow-up call (connected, positive) — real engagement ---
  // NOTE: analysis_status must be 'ok' — the Dashboard call-logs table only shows
  // the Sparkles/analysis button when analysis_status === 'ok' (not 'completed').
  const call2 = 'aa000001-0000-4000-8000-0000000000c2';
  await sql(`
    insert into call_logs (id, org_id, contact_id, agent_id, call_type, direction, status, from_number, to_number,
      call_duration, conversation_duration, started_at, answered_at, ended_at, created_at, recording_url, recording_duration,
      disposition_id, caller_type, transcript, transcript_status, transcribed_at,
      analysis_summary, analysis_tone, analysis_quality_score, analysis_next_step, analysis_status, analyzed_at)
    values (${Q(call2)}, ${Q(DEMO)}, ${Q(AARAV)}, ${Q(PRIYA)}, 'outbound', 'outgoing-api', 'completed',
      '+911169323462', '+919820011234', 168, 150, now() - interval '6 hours', now() - interval '6 hours',
      now() - interval '6 hours' + interval '168 seconds', now() - interval '6 hours', ${Q(recUrl)}, 150,
      ${Q(dispBooked?.id)}, 'human',
      'Priya: Hi Aarav, Priya here from In-Sync — confirming Tuesday 3 PM for the demo. Aarav: Yes, that works. Priya: Perfect. Anything you want us to focus on? Aarav: Field tracking and reporting, mainly. We want rollout within the quarter, so keep it practical. Priya: Done — I''ll send the invite and a short overview now. Aarav: Great, see you Tuesday.',
      'completed', now() - interval '5 hours 50 minutes',
      'Priya confirmed the demo time with Aarav and discussed his team size and rollout timeline. Aarav confirmed active interest, is the decision-maker, and wants rollout within the quarter.',
      'positive', 9, 'Send the calendar invite + overview deck; prep field-tracking demo flow.', 'ok', now() - interval '5 hours 45 minutes');
  `);

  // --- timeline: AI call outcome + scheduled demo (meeting) + next action reminder ---
  await sql(`
    insert into contact_activities (id, org_id, contact_id, activity_type, subject, description, created_by, created_at,
      scheduled_at, demo_date, demo_time, demo_rsvp_status, demo_rsvp_at, meeting_link, meeting_platform)
    values (gen_random_uuid(), ${Q(DEMO)}, ${Q(AARAV)}, 'meeting', 'Product demo — Northwind Logistics',
      'Live product walkthrough with Aarav and team.', ${Q(PRIYA)}, now() - interval '20 hours',
      (current_date + 2) + interval '15 hours', (current_date + 2), '15:00', 'confirmed', now() - interval '20 hours',
      'https://meet.google.com/wsx-demo-link', 'google_meet');
  `);
  await sql(`
    insert into contact_activities (id, org_id, contact_id, activity_type, subject, description, created_by, created_at,
      demo_date, demo_time, demo_rsvp_status, demo_rsvp_at, meeting_link, meeting_platform, completed_at)
    values (gen_random_uuid(), ${Q(DEMO)}, ${Q(AARAV)}, 'call', 'AI call outcome — interested, demo booked',
      'Riya qualified the lead and booked a demo.', ${Q(RIYA)}, now() - interval '26 hours',
      (current_date + 2), '15:00', 'confirmed', now() - interval '20 hours',
      'https://meet.google.com/wsx-demo-link', 'google_meet', now() - interval '26 hours');
    insert into contact_activities (id, org_id, contact_id, activity_type, subject, description, created_by, created_at,
      next_action_date, next_action_type, next_action_notes, priority)
    values (gen_random_uuid(), ${Q(DEMO)}, ${Q(AARAV)}, 'task', 'Prep + confirm demo with Aarav',
      'Send a personalised note before the demo.', ${Q(PRIYA)}, now() - interval '2 hours',
      date_trunc('day', now()) + interval '15 hours', 'follow_up', 'Confirm attendees and agenda.', 'important');
  `);

  // --- active engagement across all three channels (shows in the Journey) ---
  // WhatsApp: outbound (delivered + read) then an inbound reply from the lead
  await sql(`
    insert into whatsapp_messages (id, org_id, contact_id, sent_by, phone_number, message_content, status, direction, sender_name, sent_at, delivered_at, read_at, created_at)
    values
      (gen_random_uuid(), ${Q(DEMO)}, ${Q(AARAV)}, ${Q(PRIYA)}, '+919820011234',
        'Hi Aarav, great speaking with you! Here''s the demo link for Tuesday 3 PM. Anything you''d like us to focus on? — Priya, In-Sync',
        'read', 'outbound', 'Priya Nair', now() - interval '5 hours', now() - interval '5 hours' + interval '40 seconds', now() - interval '4 hours 48 minutes', now() - interval '5 hours'),
      (gen_random_uuid(), ${Q(DEMO)}, ${Q(AARAV)}, null, '+919820011234',
        'Perfect, see you Tuesday. Please cover field tracking and reporting. Looking forward!',
        'received', 'inbound', 'Aarav Mehta', now() - interval '4 hours 45 minutes', now() - interval '4 hours 45 minutes', now() - interval '4 hours 45 minutes', now() - interval '4 hours 45 minutes');
  `);
  // Email: outbound, delivered + opened (x3) + clicked
  await sql(`
    insert into email_conversations (id, conversation_id, org_id, contact_id, direction, from_email, from_name, to_email, subject, email_content,
      status, is_read, sent_by, sent_at, delivered_at, opened_at, first_clicked_at, open_count, click_count, created_at)
    values (gen_random_uuid(), gen_random_uuid(), ${Q(DEMO)}, ${Q(AARAV)}, 'outbound', 'priya.nair@in-sync.co.in', 'Priya Nair · In-Sync',
      'aarav.mehta@northwindlogistics.in', 'Your In-Sync demo — Tue 3 PM + a 2-minute overview',
      'Hi Aarav, confirming our demo for Tuesday at 3 PM. I''ve attached a short overview so your team can come with questions. Talk soon — Priya.',
      'sent', true, ${Q(PRIYA)}, now() - interval '22 hours', now() - interval '22 hours' + interval '15 seconds',
      now() - interval '21 hours', now() - interval '20 hours', 3, 1, now() - interval '22 hours');
  `);

  // --- Priya's worklist: reassign a handful of warm leads + today's next-action ---
  const warm = await sql(`
    select id from contacts where org_id=${Q(DEMO)} and id <> ${Q(AARAV)}
      and pipeline_stage_id is not null and (first_name is not null and first_name <> '')
    order by updated_at desc limit 7`);
  if (warm.length) {
    const ids = warm.map((r) => Q(r.id)).join(',');
    await sql(`update contacts set assigned_to=${Q(PRIYA)}, updated_at=now() where id in (${ids});`);
    // a "due today" next-action for each
    const rows = warm.map((r) => `(gen_random_uuid(), ${Q(DEMO)}, ${Q(r.id)}, 'task', 'Follow up today', ${Q(PRIYA)}, now() - interval '3 hours', date_trunc('day', now()) + interval '14 hours', 'follow_up', 'normal')`).join(',\n');
    await sql(`insert into contact_activities (id, org_id, contact_id, activity_type, subject, created_by, created_at, next_action_date, next_action_type, priority) values\n${rows};`);
  }

  // a couple of in-app tasks for Priya (due today)
  await sql(`
    insert into tasks (id, org_id, title, description, assigned_to, assigned_by, due_date, status, priority, remarks, created_at)
    values
      (gen_random_uuid(), ${Q(DEMO)}, 'Confirm demo with Aarav Mehta', 'Northwind Logistics — demo in 2 days', ${Q(PRIYA)}, ${Q(PRIYA)}, date_trunc('day', now()) + interval '15 hours', 'pending', 'high', '__wt', now()),
      (gen_random_uuid(), ${Q(DEMO)}, 'Work today''s warm leads', 'Riya-qualified list', ${Q(PRIYA)}, ${Q(PRIYA)}, date_trunc('day', now()) + interval '13 hours', 'pending', 'medium', '__wt', now());
  `);

  // --- DPDP: org DPO/retention settings ---
  await sql(`
    update organization_settings set dpo_name='Neha Sharma', dpo_email='dpo@in-sync.co.in', dpo_phone='+91 80 4000 1234',
      grievance_email='grievance@in-sync.co.in', privacy_policy_url='https://globalcrm-sync.pages.dev/privacy-policy',
      data_retention_days=1095 where org_id=${Q(DEMO)};
    insert into organization_settings (org_id, dpo_name, dpo_email, grievance_email, privacy_policy_url, data_retention_days)
      select ${Q(DEMO)}, 'Neha Sharma', 'dpo@in-sync.co.in', 'grievance@in-sync.co.in', 'https://globalcrm-sync.pages.dev/privacy-policy', 1095
      where not exists (select 1 from organization_settings where org_id=${Q(DEMO)});
  `);

  // --- DPDP: consent records (Aarav + a few real warm leads) ---
  const consentTargets = [AARAV, ...warm.slice(0, 4).map((r) => r.id)];
  const consentRows = consentTargets.map((cid, i) =>
    `(gen_random_uuid(), ${Q(DEMO)}, ${Q(cid)}, ${cid === AARAV ? Q('aarav.mehta@northwindlogistics.in') : `(select coalesce(email, phone, 'lead') from contacts where id=${Q(cid)})`}, '1.0', 'sales_outreach', array['call','whatsapp','email'], 'granted', now() - interval '${i + 1} days', 'walkthrough_seed')`
  ).join(',\n');
  await sql(`insert into consent_records (id, org_id, contact_id, data_principal_identifier, consent_version, purpose, channels, status, consented_at, source) values\n${consentRows};`);

  // --- DPDP: rights inbox (access pending, erasure pending, correction completed) ---
  await sql(`
    insert into data_requests (id, org_id, contact_id, requester_identifier, request_type, status, details, created_at, source)
    values
      (gen_random_uuid(), ${Q(DEMO)}, ${Q(warm[0]?.id || AARAV)}, (select coalesce(email,phone,'lead') from contacts where id=${Q(warm[0]?.id || AARAV)}), 'access', 'pending', 'Please share the data you hold about me.', now() - interval '2 days', 'walkthrough_seed'),
      (gen_random_uuid(), ${Q(DEMO)}, ${Q(warm[1]?.id || AARAV)}, (select coalesce(email,phone,'lead') from contacts where id=${Q(warm[1]?.id || AARAV)}), 'erasure', 'pending', 'I would like my personal data erased.', now() - interval '1 day', 'walkthrough_seed'),
      (gen_random_uuid(), ${Q(DEMO)}, ${Q(warm[2]?.id || AARAV)}, (select coalesce(email,phone,'lead') from contacts where id=${Q(warm[2]?.id || AARAV)}), 'correction', 'completed', 'Update my phone number.', now() - interval '4 days', 'walkthrough_seed');
  `);

  // --- DPDP: a few PII access audit entries ---
  await sql(`
    insert into pii_access_log (id, org_id, user_id, table_name, column_name, contact_id, purpose, accessed_at)
    values
      (gen_random_uuid(), ${Q(DEMO)}, ${Q(PRIYA)}, 'contacts', 'email,phone', ${Q(AARAV)}, 'walkthrough_seed', now() - interval '90 minutes'),
      (gen_random_uuid(), ${Q(DEMO)}, ${Q(PRIYA)}, 'contacts', 'email,phone', ${Q(warm[0]?.id || AARAV)}, 'walkthrough_seed', now() - interval '3 hours'),
      (gen_random_uuid(), ${Q(DEMO)}, ${Q(RIYA)}, 'contacts', 'phone', ${Q(warm[1]?.id || AARAV)}, 'walkthrough_seed', now() - interval '5 hours');
  `);

  // --- public lead-capture form (scene: leads capture themselves) ---
  const FORM = 'ff000001-0000-4000-8000-000000000001';
  const CF1 = 'cf000001-0000-4000-8000-000000000001';
  const CF2 = 'cf000001-0000-4000-8000-000000000002';
  await sql(`
    delete from form_fields where form_id=${Q(FORM)};
    delete from forms where id=${Q(FORM)};
    delete from custom_fields where id in (${Q(CF1)}, ${Q(CF2)});
  `);
  await sql(`
    insert into custom_fields (id, org_id, field_name, field_label, field_type, field_options, is_required, is_active, field_order, applies_to_table) values
      (${Q(CF1)}, ${Q(DEMO)}, 'team_size', 'Team size', 'select', '{"options":["1-10","11-50","51-200","200+"]}'::jsonb, false, true, 1, 'contacts'),
      (${Q(CF2)}, ${Q(DEMO)}, 'primary_goal', 'What are you looking to improve?', 'textarea', null, false, true, 2, 'contacts');
    insert into forms (id, org_id, name, description, is_active, connector_type, webhook_token, rate_limit_per_minute)
      values (${Q(FORM)}, ${Q(DEMO)}, 'Get a Demo - In-Sync', 'Tell us a bit about your team and we''ll set up a personalised walkthrough.', true, 'public_form', encode(gen_random_bytes(16),'hex'), 30);
    insert into form_fields (id, form_id, custom_field_id, field_order) values
      (gen_random_uuid(), ${Q(FORM)}, ${Q(CF1)}, 1),
      (gen_random_uuid(), ${Q(FORM)}, ${Q(CF2)}, 2);
  `);

  // --- normalize WhatsApp template variable chips ({{undefined}} -> {{1}} {{2}} ...) ---
  // The UI (Templates.tsx) renders v.index, but the Exotel sync stores plain "{{n}}"
  // strings, so chips show {{undefined}}. This column is display-only (the send flow
  // substitutes from runtime params, not here), so reshaping it is safe. Idempotent.
  const numOf = (v) => {
    if (v && typeof v === 'object' && v.index != null) return Number(v.index);
    const m = String(v ?? '').match(/(\d+)/); return m ? parseInt(m[1], 10) : null;
  };
  const waTpls = await sql(`select id, variables from communication_templates where org_id=${Q(DEMO)} and template_type='whatsapp'`);
  for (const t of waTpls) {
    const nums = [...new Set((t.variables || []).map(numOf).filter((n) => n != null))].sort((a, b) => a - b);
    const objs = nums.map((n) => ({ index: n, name: String(n) }));
    await sql(`update communication_templates set variables=${Q(JSON.stringify(objs))}::jsonb where id=${Q(t.id)}`);
  }

  // --- a recent day of AI-agent calls so the Calling Dashboard (last 7 days) looks alive ---
  // Clear ALL dispositionless call noise in the demo window. An undispositioned call
  // renders as a flat green "Not Set" band that dominates the dashboard's "Calls by
  // Disposition" chart (making it look like a green background) and drags the success
  // rate down. A call without an outcome is incomplete data for a demo tenant.
  await sql(`delete from call_logs where org_id=${Q(DEMO)} and disposition_id is null and created_at > now() - interval '14 days'`);
  await sql(`delete from call_logs where org_id=${Q(DEMO)} and to_number like '+9198765%'`);
  const dmap = Object.fromEntries((await sql(`select id, name from call_dispositions where org_id=${Q(DEMO)}`)).map((d) => [d.name, d.id]));
  // exact counts (not weighted-random) so the dashboard shows a believable AI-dialer
  // day: ~29% positive (Interested + Demo Booked), healthy connect rate.
  const counts = [
    ['Not Connected', 40, 'neutral'], ['Did Not Pick Up', 34, 'neutral'], ['Voicemail', 20, 'neutral'],
    ['Not Interested', 18, 'negative'], ['Call Back Requested', 22, 'neutral'],
    ['Follow Up — Decision Maker', 8, 'positive'], ['Follow Up — Interested', 42, 'positive'], ['Demo Booked', 16, 'positive'],
  ];
  const pool = [];
  counts.forEach(([name, n, tone]) => { for (let i = 0; i < n; i++) pool.push([name, tone]); });
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  const nonConn = new Set(['Not Connected', 'Did Not Pick Up', 'Voicemail']);
  const callRows = pool.map(([name, tone], i) => {
    const dur = nonConn.has(name) ? 3 + Math.floor(Math.random() * 12) : 32 + Math.floor(Math.random() * 170);
    const hoursAgo = 6 + Math.floor(Math.random() * 138); // 6h–6d; keeps Aarav's calls the freshest
    const to = '+9198765' + String(10000 + i).slice(-5);
    const disp = dmap[name] ? Q(dmap[name]) : 'null';
    return `(gen_random_uuid(), ${Q(DEMO)}, ${Q(RIYA)}, 'outbound', 'outgoing-api', 'completed', '+911169323462', ${Q(to)}, ${dur}, ${Math.max(0, dur - 8)}, now() - interval '${hoursAgo} hours', now() - interval '${hoursAgo} hours', now() - interval '${hoursAgo} hours' + interval '${dur} seconds', now() - interval '${hoursAgo} hours', 'ai', ${disp}, ${Q(tone)}, 'completed')`;
  });
  await sql(`insert into call_logs (id, org_id, agent_id, call_type, direction, status, from_number, to_number, call_duration, conversation_duration, started_at, answered_at, ended_at, created_at, caller_type, disposition_id, analysis_tone, analysis_status) values\n${callRows.join(',\n')};`);

  // The dashboard "Calls by Disposition" chart resolves the outcome under the viewer's
  // RLS; pre-existing demo calls whose disposition_id points to an unreadable row show
  // up as a dominant grey/green "Not Set" band. Give every this-month call a real,
  // in-org outcome so the chart reads as data, not a flat background.
  const orphans = await sql(`select cl.id from call_logs cl where cl.org_id=${Q(DEMO)} and cl.created_at >= date_trunc('month', now()) and (cl.disposition_id is null or cl.disposition_id not in (select id from call_dispositions where org_id=${Q(DEMO)}))`);
  if (orphans.length) {
    const vals = orphans.map((r) => { const [name] = pool[Math.floor(Math.random() * pool.length)]; return `('${r.id}','${dmap[name]}')`; }).join(',');
    await sql(`update call_logs c set disposition_id = v.disp::uuid from (values ${vals}) as v(cid, disp) where c.id = v.cid::uuid`);
  }

  // Make Aarav's AI + human calls the two most-recent calls, so the dashboard's
  // 30-row Call Logs list reliably surfaces the AI call (with its analysis dialog)
  // when searched — otherwise newer bulk calls push it out of view.
  await sql(`update call_logs set created_at = now() - interval '5 hours', started_at = now() - interval '5 hours' where id=${Q(callId)}`);
  await sql(`update call_logs set created_at = now() - interval '2 hours', started_at = now() - interval '2 hours' where id=${Q(call2)}`);

  // --- healthy, current billing state (fix a past 'next billing' date + stale wallet alert) ---
  await sql(`update organization_subscriptions set
      billing_cycle_start = current_date - 6,
      next_billing_date = current_date + 84,
      last_payment_date = current_date - 6,
      wallet_balance = 12500,
      wallet_alert_level = 'normal',
      wallet_alert_sent_at = null
    where org_id=${Q(DEMO)}`);

  // --- field-staff attendance: a believable month for the admin (photo+GPS
  //     check-ins from Mumbai), signed in today and still on the clock, so the
  //     Attendance scene shows live "field tracking" instead of an empty month ---
  await sql(`delete from attendance_records where org_id=${Q(DEMO)} and user_id=${Q(ADMIN)}`);
  // Timestamps are stored in UTC but the app renders IST (UTC+5:30): a "9 AM"
  // interval would display as 2:30 PM — and today's row would sit in the future,
  // making Hours Worked count NEGATIVE on camera. So write UTC times that
  // render as ~9:1x AM / ~6:1x PM IST.
  const attRows = [];
  for (let d = 0; d <= 27; d++) {
    const isToday = d === 0;
    attRows.push(
      `(gen_random_uuid(), ${Q(DEMO)}, ${Q(ADMIN)}, current_date - ${d},
        (current_date - ${d}) + interval '3 hours ${40 + (d * 7) % 18} minutes',
        ${isToday ? 'null' : `(current_date - ${d}) + interval '12 hours ${40 + (d * 11) % 20} minutes'`},
        ${isToday ? 'null' : (8.4 + ((d * 13) % 10) / 10).toFixed(2)},
        'present', 19.076090, 72.877426, 'Mumbai', 'Maharashtra', 'online', 'synced')`
    );
  }
  // only weekdays: filter in SQL by extracting dow at insert time is messy — insert
  // all, then delete weekend rows (idempotent either way).
  await sql(`insert into attendance_records (id, org_id, user_id, date, sign_in_time, sign_out_time, total_hours, status, location_lat, location_lng, sign_in_location_city, sign_in_location_state, network_status, sync_status) values\n${attRows.join(',\n')};`);
  await sql(`delete from attendance_records where org_id=${Q(DEMO)} and user_id=${Q(ADMIN)} and extract(dow from date) in (0, 6) and date <> current_date;`);

  console.log('Seeded hero lead, worklist, DPDP data, public form, attendance month, and a recent AI-call day.');

  // --- pre-warm Aarav's AI lead score (login as Priya for a JWT) ---
  try {
    const tok = await fetch(`${URL_}/auth/v1/token?grant_type=password`, {
      method: 'POST', headers: { apikey: PUB, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: env.GC_AGENT_EMAIL, password: env.GC_AGENT_PASSWORD }),
    }).then((r) => r.json());
    if (tok.access_token) {
      const r = await fetch(`${URL_}/functions/v1/lead-score`, {
        method: 'POST', headers: { apikey: PUB, Authorization: `Bearer ${tok.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ contact_id: AARAV, force: true }),
      }).then((r) => r.json());
      console.log(`Aarav lead score pre-warmed: ${r.score} (${r.category})`);
    } else {
      console.log('Could not pre-warm score (login failed); card will score live on open.');
    }
  } catch (e) { console.log('Pre-warm skipped:', e.message); }

  console.log('Done.');
}

main().catch((e) => { console.error(e); process.exit(1); });
