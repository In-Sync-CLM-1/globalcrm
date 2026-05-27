-- Per-product daily AI insights. Adds a product dimension so each agent (product)
-- gets its own Key Learnings / objections / script tweaks, while the special
-- value '__all__' holds the org-wide lump shown on the Dashboard Overview.
--
-- Existing rows were org-wide, so they default to '__all__' (the lump).

ALTER TABLE public.ai_daily_insights
  ADD COLUMN IF NOT EXISTS product text NOT NULL DEFAULT '__all__';

-- Replace the (org_id, for_date) uniqueness with (org_id, for_date, product).
ALTER TABLE public.ai_daily_insights DROP CONSTRAINT IF EXISTS ai_daily_insights_org_id_for_date_key;
DROP INDEX IF EXISTS public.ai_daily_insights_org_id_for_date_key;
CREATE UNIQUE INDEX IF NOT EXISTS ai_daily_insights_org_date_product_key
  ON public.ai_daily_insights (org_id, for_date, product);
