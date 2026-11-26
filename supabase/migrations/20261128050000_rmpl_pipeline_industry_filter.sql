-- Redefine (rmpl): the Pipeline shows an Industry / Segment filter in place of Targeted Product and WhatsApp Outreach.
-- Switch: organizations.settings.pipeline_industry_filter = true. Other organisations are unchanged.

create or replace function public.contact_industry_options(p_org_id uuid)
returns setof text
language sql
stable
security invoker
set search_path = public
as $$
  select distinct trim(industry_type)
  from contacts
  where org_id = p_org_id
    and industry_type is not null
    and trim(industry_type) <> ''
  order by 1;
$$;

grant execute on function public.contact_industry_options(uuid) to authenticated;

update organizations
set settings = coalesce(settings, '{}'::jsonb) || '{"pipeline_industry_filter": true}'::jsonb
where slug = 'rmpl';
