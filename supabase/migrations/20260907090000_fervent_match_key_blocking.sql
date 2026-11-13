-- Replaces the wide-table expression-index approach from the previous migration
-- (20260907070000) with a proper blocking-key table. That fix worked (8s -> 1s
-- per batch) but still depends on the query planner choosing 7 different
-- expression indexes against a wide, ever-growing table -- fragile as the
-- repository keeps growing past its current 300k rows. A dedicated, compact
-- key table scales independently of the repository's row count or column
-- layout: one small row per (phone/email/name) key per record, looked up by
-- a single index, regardless of how large fervent_data_repository gets.

CREATE OR REPLACE FUNCTION public.fervent_norm_phone(p text) RETURNS text
 LANGUAGE sql IMMUTABLE AS $$
  SELECT NULLIF(right(regexp_replace(COALESCE(p, ''), '\D', '', 'g'), 10), '')
$$;

CREATE OR REPLACE FUNCTION public.fervent_norm_email(e text) RETURNS text
 LANGUAGE sql IMMUTABLE AS $$
  SELECT NULLIF(lower(trim(COALESCE(e, ''))), '')
$$;

CREATE OR REPLACE FUNCTION public.fervent_norm_name(p_first text, p_last text) RETURNS text
 LANGUAGE sql IMMUTABLE AS $$
  SELECT NULLIF(lower(regexp_replace(trim(COALESCE(p_first, '') || ' ' || COALESCE(p_last, '')), '\s+', ' ', 'g')), '')
$$;

CREATE TABLE IF NOT EXISTS public.fervent_repo_match_keys (
  record_id uuid NOT NULL REFERENCES public.fervent_data_repository(id) ON DELETE CASCADE,
  org_id uuid NOT NULL,
  key_type text NOT NULL CHECK (key_type IN ('phone', 'email', 'name')),
  key_value text NOT NULL,
  PRIMARY KEY (record_id, key_type, key_value)
);
CREATE INDEX IF NOT EXISTS idx_fervent_match_keys_lookup ON public.fervent_repo_match_keys (org_id, key_type, key_value);

-- Keeps the key table in sync with every write path (upsert_fervent_repository_batch,
-- merge_fervent_repository_batch, or any future direct write) without those
-- functions needing to know this table exists. DELETE is handled by the FK's
-- ON DELETE CASCADE above, not this trigger.
CREATE OR REPLACE FUNCTION public.fervent_sync_match_keys() RETURNS trigger
 LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM public.fervent_repo_match_keys WHERE record_id = NEW.id;

  INSERT INTO public.fervent_repo_match_keys (record_id, org_id, key_type, key_value)
  SELECT NEW.id, NEW.org_id, 'phone', v FROM (VALUES
    (public.fervent_norm_phone(NEW.mobile_number_1)),
    (public.fervent_norm_phone(NEW.mobile_number_2)),
    (public.fervent_norm_phone(NEW.direct_number)),
    (public.fervent_norm_phone(NEW.phone_number))
  ) AS t(v) WHERE v IS NOT NULL AND length(v) >= 8
  ON CONFLICT DO NOTHING;

  INSERT INTO public.fervent_repo_match_keys (record_id, org_id, key_type, key_value)
  SELECT NEW.id, NEW.org_id, 'email', v FROM (VALUES
    (public.fervent_norm_email(NEW.official_email)),
    (public.fervent_norm_email(NEW.personal_email_1)),
    (public.fervent_norm_email(NEW.personal_email_2))
  ) AS t(v) WHERE v IS NOT NULL
  ON CONFLICT DO NOTHING;

  INSERT INTO public.fervent_repo_match_keys (record_id, org_id, key_type, key_value)
  SELECT NEW.id, NEW.org_id, 'name', v FROM (VALUES
    (public.fervent_norm_name(NEW.first_name, NEW.last_name))
  ) AS t(v) WHERE v IS NOT NULL
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_fervent_sync_match_keys ON public.fervent_data_repository;
CREATE TRIGGER trg_fervent_sync_match_keys
  AFTER INSERT OR UPDATE ON public.fervent_data_repository
  FOR EACH ROW EXECUTE FUNCTION public.fervent_sync_match_keys();

-- One-time backfill for existing rows. Idempotent (ON CONFLICT DO NOTHING) so
-- a pre-applied-then-CI-replayed migration is safe to run twice.
INSERT INTO public.fervent_repo_match_keys (record_id, org_id, key_type, key_value)
SELECT f.id, f.org_id, 'phone', v
FROM public.fervent_data_repository f,
     LATERAL (VALUES
       (public.fervent_norm_phone(f.mobile_number_1)),
       (public.fervent_norm_phone(f.mobile_number_2)),
       (public.fervent_norm_phone(f.direct_number)),
       (public.fervent_norm_phone(f.phone_number))
     ) AS t(v)
WHERE v IS NOT NULL AND length(v) >= 8
ON CONFLICT DO NOTHING;

INSERT INTO public.fervent_repo_match_keys (record_id, org_id, key_type, key_value)
SELECT f.id, f.org_id, 'email', v
FROM public.fervent_data_repository f,
     LATERAL (VALUES
       (public.fervent_norm_email(f.official_email)),
       (public.fervent_norm_email(f.personal_email_1)),
       (public.fervent_norm_email(f.personal_email_2))
     ) AS t(v)
WHERE v IS NOT NULL
ON CONFLICT DO NOTHING;

INSERT INTO public.fervent_repo_match_keys (record_id, org_id, key_type, key_value)
SELECT f.id, f.org_id, 'name', v
FROM public.fervent_data_repository f,
     LATERAL (VALUES (public.fervent_norm_name(f.first_name, f.last_name))) AS t(v)
WHERE v IS NOT NULL
ON CONFLICT DO NOTHING;

-- Superseded by fervent_repo_match_keys -- the wide-table expression indexes
-- from 20260907070000 are no longer read by find_fervent_duplicate_candidates
-- and would otherwise just cost extra write-time maintenance for nothing.
DROP INDEX IF EXISTS public.idx_fervent_repo_phone1_norm;
DROP INDEX IF EXISTS public.idx_fervent_repo_phone2_norm;
DROP INDEX IF EXISTS public.idx_fervent_repo_phone3_norm;
DROP INDEX IF EXISTS public.idx_fervent_repo_phone4_norm;
DROP INDEX IF EXISTS public.idx_fervent_repo_email1_norm;
DROP INDEX IF EXISTS public.idx_fervent_repo_email2_norm;
DROP INDEX IF EXISTS public.idx_fervent_repo_email3_norm;
DROP INDEX IF EXISTS public.idx_fervent_repo_name_norm;

CREATE OR REPLACE FUNCTION public.find_fervent_duplicate_candidates(p_org_id uuid, p_records jsonb)
 RETURNS TABLE(incoming_idx integer, match_type text, existing_record jsonb)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH incoming AS (
    SELECT
      (r->>'idx')::integer AS idx,
      public.fervent_norm_name(r->>'first_name', r->>'last_name') AS name_norm,
      ARRAY[
        r->>'mobile_number_1', r->>'mobile_number_2',
        r->>'direct_number',   r->>'phone_number'
      ] AS raw_phones,
      ARRAY[
        r->>'official_email', r->>'personal_email_1', r->>'personal_email_2'
      ] AS raw_emails
    FROM jsonb_array_elements(p_records) AS r
  ),
  incoming_phone AS (
    SELECT DISTINCT i.idx, t.n AS p
    FROM incoming i,
         LATERAL unnest(i.raw_phones) AS rp,
         LATERAL (SELECT public.fervent_norm_phone(rp) AS n) AS t
    WHERE t.n IS NOT NULL AND length(t.n) >= 8
  ),
  incoming_email AS (
    SELECT DISTINCT i.idx, t.n AS e
    FROM incoming i,
         LATERAL unnest(i.raw_emails) AS re,
         LATERAL (SELECT public.fervent_norm_email(re) AS n) AS t
    WHERE t.n IS NOT NULL
  ),
  hits AS (
    SELECT i.idx, k.record_id AS id, 1 AS tier
    FROM incoming_phone i
    JOIN public.fervent_repo_match_keys k
      ON k.org_id = p_org_id AND k.key_type = 'phone' AND k.key_value = i.p
    UNION ALL
    SELECT i.idx, k.record_id AS id, 2 AS tier
    FROM incoming_email i
    JOIN public.fervent_repo_match_keys k
      ON k.org_id = p_org_id AND k.key_type = 'email' AND k.key_value = i.e
    UNION ALL
    SELECT i.idx, k.record_id AS id, 3 AS tier
    FROM incoming i
    JOIN public.fervent_repo_match_keys k
      ON k.org_id = p_org_id AND k.key_type = 'name' AND k.key_value = i.name_norm
    WHERE i.name_norm IS NOT NULL
  ),
  best AS (
    SELECT DISTINCT ON (idx, id) idx, id, tier
    FROM hits
    ORDER BY idx, id, tier
  )
  SELECT
    b.idx,
    CASE b.tier WHEN 1 THEN 'phone' WHEN 2 THEN 'email' ELSE 'name' END,
    jsonb_build_object(
      'id', f.id,
      'unique_id', f.unique_id,
      'first_name', f.first_name,
      'last_name', f.last_name,
      'company_name', f.company_name,
      'designation', f.designation,
      'department', f.department,
      'city', f.city,
      'state', f.state,
      'country', f.country,
      'industry', f.industry,
      'linkedin_url', f.linkedin_url,
      'mobile_number_1', f.mobile_number_1,
      'mobile_number_2', f.mobile_number_2,
      'direct_number', f.direct_number,
      'phone_number', f.phone_number,
      'official_email', f.official_email,
      'personal_email_1', f.personal_email_1,
      'personal_email_2', f.personal_email_2
    )
  FROM best b
  JOIN public.fervent_data_repository f ON f.id = b.id;
$function$;
