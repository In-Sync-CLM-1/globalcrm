-- BSR teacher roster: keep designation/qualification/registration details and
-- per-teacher notes from the college's Tutor Panel sheet (additive; org-scoped
-- via existing RLS).
ALTER TABLE public.edu_teachers ADD COLUMN IF NOT EXISTS designation TEXT;
ALTER TABLE public.edu_teachers ADD COLUMN IF NOT EXISTS qualification TEXT;
ALTER TABLE public.edu_teachers ADD COLUMN IF NOT EXISTS registration_detail TEXT;
ALTER TABLE public.edu_teachers ADD COLUMN IF NOT EXISTS notes TEXT;
