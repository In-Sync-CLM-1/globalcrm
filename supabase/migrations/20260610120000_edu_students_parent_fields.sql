-- BSR roster load support: keep parents' names and per-student notes from the
-- college's enrollment sheets (additive; org-scoped via existing RLS).
ALTER TABLE public.edu_students ADD COLUMN IF NOT EXISTS father_name TEXT;
ALTER TABLE public.edu_students ADD COLUMN IF NOT EXISTS mother_name TEXT;
ALTER TABLE public.edu_students ADD COLUMN IF NOT EXISTS notes TEXT;