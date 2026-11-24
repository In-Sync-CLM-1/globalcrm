-- IEDUP dashboard and RAMP message log: the message body shown when a template is hovered on.
-- WhatsApp bodies come from communication_templates and designed emails from email_templates. The emails RAMP writes
-- itself are kept nowhere as templates (only their subject is logged), so their words are listed here once; both apps read them.
create table if not exists public.message_body_texts (
  org_id uuid not null references public.organizations(id) on delete cascade,
  channel text not null,
  template text not null, -- the template name, or the email subject (for emails whose subject goes on to name the class, its first part)
  body text not null,
  updated_at timestamptz not null default now(),
  primary key (org_id, channel, template)
);
alter table public.message_body_texts enable row level security; -- read only through the function below
revoke all on public.message_body_texts from anon, authenticated;

insert into public.message_body_texts (org_id, channel, template, body)
select '6dcf4229-6902-4cd4-9c7f-2d6ed4a6045d'::uuid, v.channel, v.template, v.body
from (values
  ('WhatsApp', 'iedup_registration_confirmed_v1', E'[Document attached]\n\nHello {{1}},\nYour registration for *{{2}}* is confirmed.\n\n*Application no:* {{3}}\n\nSelection is by screening. We will update you here and by email. The programme brochure is attached.\n\n— IEDUP, उत्तर प्रदेश सरकार\n\n[Registration page] [Call IEDUP]'),
  ('Email', 'Thank you for your interest | IEDUP UP RAMP', E'Thank you for your interest\n\nDear [name],\n\nWe have received your interest in the [course] programme at the Institute of Entrepreneurship Development, U.P. (IEDUP), an autonomous organisation under the Department of MSME & Export Promotion, Govt. of Uttar Pradesh.\n\nProgramme details\nOrganised by IEDUP under RAMP (Raising and Accelerating MSME Performance), a collaboration of the Government of Uttar Pradesh and the World Bank.\nDuration: 3 months, with 1 hour of online classes daily for 2 months, followed by a bootcamp and exposure visits.\nCurriculum: developed by IITians and vetted by IIT Kanpur.\nCertification: government-recognised.\n\nComplete your profile\nTo move forward with the screening process, please register and complete your profile at the link below. Applications with incomplete profiles cannot be screened.\n\nWhat happens next\nOnce you complete your profile, your application will be screened for suitability. The final decision rests with IEDUP. We will inform you of the result by email and WhatsApp, on the contact details you provide at registration.'),
  ('Email', 'Registration confirmed | IEDUP UP RAMP', E'Thank you for your interest\n\nDear [name],\n\nWe have received your interest in the [course] programme at the Institute of Entrepreneurship Development, U.P. (IEDUP), an autonomous organisation under the Department of MSME & Export Promotion, Govt. of Uttar Pradesh.\n\nProgramme details\nOrganised by IEDUP under RAMP (Raising and Accelerating MSME Performance), a collaboration of the Government of Uttar Pradesh and the World Bank.\nDuration: 3 months, with 1 hour of online classes daily for 2 months, followed by a bootcamp and exposure visits.\nCurriculum: developed by IITians and vetted by IIT Kanpur.\nCertification: government-recognised.\n\nComplete your profile\nTo move forward with the screening process, please register and complete your profile at the link below. Applications with incomplete profiles cannot be screened.\n\nWhat happens next\nOnce you complete your profile, your application will be screened for suitability. The final decision rests with IEDUP. We will inform you of the result by email and WhatsApp, on the contact details you provide at registration. The programme brochure is attached.'),
  ('Email', 'New class', E'Dear [name],\n\nA live class has been scheduled for your [course].\n\nTopic: [class]. Date: [date]. Time: [time]. Expert: [expert].\n\nPlease click Open class page, then click Join class at the class time so your attendance is marked.\n\n[Open class page]'),
  ('Email', 'Today''s class', E'Dear [name],\n\nYou have a live class today for your [course].\n\nTopic: [class]. Date: [date]. Time: [time]. Expert: [expert].\n\nPlease click Open class page, then click Join class at the class time so your attendance is marked.\n\n[Open class page]'),
  ('Email', 'Class reminder', E'Dear [name],\n\nA reminder of your live class for your [course].\n\nTopic: [class]. Date: [date]. Time: [time]. Expert: [expert].\n\nPlease click Open class page, then click Join class at the class time so your attendance is marked.\n\n[Open class page]'),
  ('Email', 'Class link is live', E'Dear [name],\n\nThe link for your class "[class]" is now active for your [course].\n\nPlease click Open class page, then click Join class so your attendance is marked.\n\n[Open class page]'),
  ('Email', 'Your live class has started', E'Dear [name],\n\nYour live class has started.\n\nTopic: [class]. Time: [time]. Expert: [expert].\n\nPlease click Open class page and click Join class now so your attendance is marked.\n\n[Open class page]'),
  ('Email', 'Class cancelled', E'Dear [name],\n\nThe live class "[class]" on [date], [time], is cancelled.\n\nWe will tell you the new date. Your class page always shows the latest schedule.\n\n[Open class page]'),
  ('Email', 'Class moved', E'Dear [name],\n\nThe live class "[class]" has moved from [old date] to [new date].\n\nDate: [date]. Time: [time]. Expert: [expert].\n\nPlease click Open class page, then click Join class at the class time so your attendance is marked.\n\n[Open class page]'),
  ('Email', 'Class update', E'Dear [name],\n\nThere is a change to the live class "[class]".\n\nDate: [date]. Time: [time]. Expert: [expert].\n\nPlease click Open class page, then click Join class at the class time so your attendance is marked.\n\n[Open class page]'),
  ('Email', 'Thank you for applying', E'Dear [name],\n\nThank you for applying for [course] on ramp.avgroups.in. Your application number is [application no].\n\nPlease wait for approval. We will update you by email and WhatsApp once your registration is approved.'),
  ('Email', 'Congratulations, your RAMP registration is approved', E'Dear [name],\n\nCongratulations! Your registration [application no] for [course] is approved and training is open.\n\nPlease log in at ramp.avgroups.in with your mobile number to continue.\n\n[Log in]'),
  ('Email', 'Update on your RAMP registration', E'Dear [name],\n\nWe are sorry to tell you that your registration [application no] for [course] was not approved.\n\nReason: [reason].\n\nPlease call 7607359820 or write to edpavg@gmail.com for help.'),
  ('Email', 'Please take your face photo to start your RAMP training', E'Dear [name],\n\nYour registration [application no] for [course] is approved, but your training has not started because your face photo is pending.\n\nPlease log in at ramp.avgroups.in and take your face photo to start training.\n\n[Log in]'),
  ('Email', 'Reminder: take your face photo to start your RAMP training', E'Dear [name],\n\nYour training for [course] has not started yet because your face photo is pending.\n\nPlease log in at ramp.avgroups.in and take your face photo. For help call 7607359820.\n\n[Log in]'),
  ('Email', 'Final reminder: take your face photo for your RAMP training', E'Dear [name],\n\nThis is the final reminder: your face photo for [course] (registration [application no]) is still pending, so training has not started.\n\nPlease log in at ramp.avgroups.in and take it. If you need help, please call 7607359820.\n\n[Log in]'),
  ('Email', 'Congratulations on completing all classes', E'Dear [name],\n\nCongratulations for completing all classes of [course]. Your test is now open.\n\nPlease log in at ramp.avgroups.in to take it.\n\n[Log in]'),
  ('Email', 'Your RAMP test is under review', E'Dear [name],\n\nYour test result for [course] is being reviewed.\n\nPlease log in at ramp.avgroups.in to check, or call 7607359820.\n\n[Log in]'),
  ('Email', 'Congratulations on completing the test', E'Dear [name],\n\nCongratulations for completing the test of [course].\n\nYour certificate is being prepared. We will write to you by email and WhatsApp when it is ready.'),
  ('Email', 'Congratulations, your RAMP certificate is ready', E'Dear [name],\n\nCongratulations on completing [course]! Your certificate is ready.\n\nPlease log in at ramp.avgroups.in to download it.\n\n[Log in]'),
  ('Email', 'Your RAMP certificate has been withdrawn', E'Dear [name],\n\nYour certificate for [course] has been withdrawn.\n\nPlease call 7607359820 for details.'),
  ('Email', 'Update on your RAMP request', E'Dear [name],\n\n[The update about the expert''s request]\n\nPlease log in to the RAMP portal to see the details.'),
  ('Email', 'Your RAMP password reset code', E'Dear [name],\n\nYour RAMP password reset code is [code].\n\nIt is valid for 10 minutes. If you did not ask for it, you can ignore this email.')
) as v(channel, template, body)
where exists (select 1 from public.organizations o where o.id = '6dcf4229-6902-4cd4-9c7f-2d6ed4a6045d')
on conflict (org_id, channel, template) do update set body = excluded.body, updated_at = now();

-- An email's html as plain text, with its line breaks
create or replace function public.html_to_text(p text)
returns text
language sql
immutable
set search_path = public
as $$
  select btrim(regexp_replace(
    replace(replace(replace(replace(replace(replace(
      regexp_replace(regexp_replace(regexp_replace(regexp_replace(coalesce(p, ''), '<(style|script|head)[^>]*>.*?</\1>', '', 'gi'),
        '<br\s*/?>|</(li|tr|div)>', E'\n', 'gi'), '</(p|h[1-6]|ul|ol|table)>', E'\n\n', 'gi'), '<[^>]+>', '', 'g'),
      '&nbsp;', ' '), '&lt;', '<'), '&gt;', '>'), '&quot;', '"'), '&#39;', ''''), '&amp;', '&'),
    '\s*\n\s*\n\s*', E'\n\n', 'g'), E' \n\t');
$$;

revoke all on function public.html_to_text(text) from public, anon, authenticated;

create or replace function public.get_iedup_message_bodies(p_org uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with allowed as (
    select 1 as ok
    where auth.role() = 'service_role'
       or exists (select 1 from profiles pr where pr.id = auth.uid() and (pr.org_id = p_org or pr.is_platform_admin))
  ),
  buttons as (
    select t.id, string_agg('[' || (b->>'text') || ']', ' ') as txt
    from communication_templates t, jsonb_array_elements(case when jsonb_typeof(to_jsonb(t.buttons)) = 'array' then to_jsonb(t.buttons) else '[]'::jsonb end) b
    where t.org_id = p_org and b->>'text' is not null group by t.id
  ),
  rows as (
    select 'WhatsApp' as channel, t.template_name as template, 1 as rank,
           concat_ws(E'\n\n',
             case when lower(t.header_type) = 'text' then nullif(btrim(t.header_content), '') when nullif(t.header_type, '') is not null and lower(t.header_type) <> 'none' then '[' || initcap(t.header_type) || ' attached]' end,
             nullif(btrim(t.content), ''), nullif(btrim(t.footer_text), ''), b.txt) as body
    from communication_templates t cross join allowed left join buttons b on b.id = t.id
    where t.org_id = p_org
    union all
    select 'Email', e.name, 1,
           concat_ws(E'\n\n', 'Subject: ' || e.subject, nullif(html_to_text(coalesce(nullif(e.body_content, ''), e.html_content)), ''))
    from email_templates e cross join allowed where e.org_id = p_org
    union all
    select m.channel, m.template, 2, m.body from message_body_texts m cross join allowed where m.org_id = p_org
  )
  select coalesce(jsonb_agg(jsonb_build_object('channel', channel, 'template', template, 'body', body)), '[]'::jsonb)
  from (select distinct on (channel, template) * from rows where btrim(coalesce(body, '')) <> '' order by channel, template, rank) r;
$$;
revoke all on function public.get_iedup_message_bodies(uuid) from public, anon;
grant execute on function public.get_iedup_message_bodies(uuid) to authenticated, service_role;
