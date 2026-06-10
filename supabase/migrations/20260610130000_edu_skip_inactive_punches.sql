-- Send-as-absent enforcement: punches for inactive students/teachers must never
-- reach UPSMF. A BEFORE INSERT trigger marks them 'skipped' on arrival, so the
-- connector (which claims only pending/failed) can never push them. The punch
-- row is kept for audit. Matches by FK link OR by upsmf_identifier, so feeds
-- that insert without linking the person are covered too.

ALTER TABLE public.edu_attendance_punches
  DROP CONSTRAINT IF EXISTS edu_attendance_punches_sync_status_check;
ALTER TABLE public.edu_attendance_punches
  ADD CONSTRAINT edu_attendance_punches_sync_status_check
  CHECK (sync_status IN ('pending','processing','synced','failed','skipped'));

CREATE OR REPLACE FUNCTION public.edu_skip_inactive_punch()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF EXISTS (
       SELECT 1 FROM public.edu_students s
       WHERE s.org_id = NEW.org_id AND s.status <> 'active'
         AND (s.id = NEW.student_id OR s.enrollment_no = NEW.upsmf_identifier)
     )
     OR EXISTS (
       SELECT 1 FROM public.edu_teachers t
       WHERE t.org_id = NEW.org_id AND t.status <> 'active'
         AND (t.id = NEW.teacher_id OR t.tutor_id = NEW.upsmf_identifier)
     )
  THEN
    NEW.sync_status := 'skipped';
    NEW.last_error := 'person inactive (send-as-absent) - not pushed to UPSMF';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_edu_skip_inactive_punch ON public.edu_attendance_punches;
CREATE TRIGGER trg_edu_skip_inactive_punch
  BEFORE INSERT ON public.edu_attendance_punches
  FOR EACH ROW EXECUTE FUNCTION public.edu_skip_inactive_punch();
