-- Web-lead attribution: capture Google Ads click id + UTM params on contacts.
-- Populated by the public web-lead-intake edge function (WorkSync "Request a Demo"
-- and, going forward, other product landing pages). The gclid is what later lets
-- us report a qualified lead back to Google Ads as an offline conversion so the
-- campaign can optimise. All nullable + additive — no impact on existing rows/orgs.

ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS gclid          text,
  ADD COLUMN IF NOT EXISTS utm_source     text,
  ADD COLUMN IF NOT EXISTS utm_medium     text,
  ADD COLUMN IF NOT EXISTS utm_campaign   text,
  ADD COLUMN IF NOT EXISTS source_url     text;

-- Find leads still needing an offline-conversion push back to Google Ads.
CREATE INDEX IF NOT EXISTS idx_contacts_gclid
  ON public.contacts (gclid)
  WHERE gclid IS NOT NULL;
