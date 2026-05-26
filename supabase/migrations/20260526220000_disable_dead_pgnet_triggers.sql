-- Disable every trigger whose function posts (net.http_post) to a migrated-away Supabase
-- project (aizgpxaqvtvvqarzjmze / knuewnenaswscgaldjej). Those endpoints are dead; the
-- triggers only flood net._http_response with NULL/timeout responses on every write
-- (~20k/day). The one live http_post trigger (call_logs.notify_on_demo_agreed_trg ->
-- current project ejzjrvazegaxrhqizgaa) is intentionally left enabled.
-- Idempotent + replay-safe: detects by destination host in the function body.
do $$
declare r record;
begin
  for r in
    select distinct c.relname as tbl, t.tgname
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_proc p on p.oid = t.tgfoid
    join pg_namespace ns on ns.oid = c.relnamespace
    where not t.tgisinternal
      and t.tgenabled <> 'D'
      and p.prokind = 'f'
      and ns.nspname = 'public'
      and (pg_get_functiondef(p.oid) ilike '%aizgpxaqvtvvqarzjmze%'
           or pg_get_functiondef(p.oid) ilike '%knuewnenaswscgaldjej%')
  loop
    execute format('alter table public.%I disable trigger %I', r.tbl, r.tgname);
  end loop;
end $$;
