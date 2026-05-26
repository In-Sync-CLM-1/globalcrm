-- Background Devanagari name conversion (runs AFTER upload, not during it).
-- The upload now imports beneficiaries instantly with the English name as a
-- placeholder in name_hi; this job converts any name_hi that isn't yet in
-- Devanagari to Hindi, in batches, on a cron + a post-import trigger.

-- Contacts whose name_hi still needs converting (null or no Devanagari char).
create or replace function public.get_contacts_needing_translit(p_org uuid, p_limit int)
returns table (id uuid, name_en text)
language sql
stable
as $$
  select c.id,
         btrim(coalesce(c.first_name,'') || ' ' || coalesce(c.last_name,'')) as name_en
  from public.contacts c
  where c.org_id = p_org
    and btrim(coalesce(c.first_name,'') || ' ' || coalesce(c.last_name,'')) <> ''
    and (c.name_hi is null or c.name_hi !~ '[ऀ-ॿ]')
  limit p_limit;
$$;
grant execute on function public.get_contacts_needing_translit(uuid, int) to service_role;

-- Bulk-apply converted names in one round trip (id[]/name[] paired by position).
create or replace function public.apply_name_hi(p_ids uuid[], p_names text[])
returns int
language plpgsql
as $$
declare n int;
begin
  update public.contacts c
  set name_hi = v.hi
  from (select unnest(p_ids) as id, unnest(p_names) as hi) v
  where c.id = v.id;
  get diagnostics n = row_count;
  return n;
end;
$$;
grant execute on function public.apply_name_hi(uuid[], text[]) to service_role;

-- Cron: convert pending IEDUP names every 5 minutes (backstop; the UI also
-- fires the function right after an import so names start converting at once).
select cron.unschedule('transliterate-pending-5min')
where exists (select 1 from cron.job where jobname = 'transliterate-pending-5min');

select cron.schedule(
  'transliterate-pending-5min',
  '*/5 * * * *',
  $$ select net.http_post(
       url := 'https://ejzjrvazegaxrhqizgaa.supabase.co/functions/v1/transliterate-pending',
       headers := '{"Content-Type": "application/json"}'::jsonb,
       body := '{}'::jsonb
     ); $$
);
