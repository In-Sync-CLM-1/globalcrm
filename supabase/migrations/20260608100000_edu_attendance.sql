-- Education / Biometric Attendance feature (org-scoped, multi-tenant).
-- First org: Baba Sadhav Ram Paramedical College.
-- Roster (courses / teachers / students) + biometric punches that are pushed,
-- exactly once, to the UPSMF SQL Server (which is insert-only, no dedup/delete).
-- Additive only: new tables, no change to existing org logic.

-- ============================ courses ============================
CREATE TABLE public.edu_courses (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  code            TEXT NOT NULL,
  name            TEXT NOT NULL,
  duration_months INT,
  status          TEXT NOT NULL DEFAULT 'active',
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE (org_id, code)
);
CREATE INDEX idx_edu_courses_org ON public.edu_courses (org_id);

-- ============================ teachers ============================
CREATE TABLE public.edu_teachers (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id               UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  tutor_id             TEXT NOT NULL,            -- UPSMF Tutor ID (T000000XXXXX)
  name                 TEXT NOT NULL,
  phone                TEXT,
  email                TEXT,
  device_enrollment_id TEXT,                     -- ID held on the biometric device
  status               TEXT NOT NULL DEFAULT 'active',
  created_at           TIMESTAMPTZ DEFAULT now(),
  updated_at           TIMESTAMPTZ DEFAULT now(),
  UNIQUE (org_id, tutor_id)
);
CREATE INDEX idx_edu_teachers_org ON public.edu_teachers (org_id);

-- ============================ students ============================
CREATE TABLE public.edu_students (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id               UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  enrollment_no        TEXT NOT NULL,            -- UPSMF Enrollment No (201234...)
  name                 TEXT NOT NULL,
  course_id            UUID REFERENCES public.edu_courses(id) ON DELETE SET NULL,
  phone                TEXT,
  gender               TEXT,
  date_of_birth        DATE,
  admission_date       DATE,
  device_enrollment_id TEXT,                     -- biometric device's internal ID
  status               TEXT NOT NULL DEFAULT 'active',
  created_at           TIMESTAMPTZ DEFAULT now(),
  updated_at           TIMESTAMPTZ DEFAULT now(),
  UNIQUE (org_id, enrollment_no)
);
CREATE INDEX idx_edu_students_org ON public.edu_students (org_id);
CREATE INDEX idx_edu_students_course ON public.edu_students (course_id);

-- ============================ devices ============================
CREATE TABLE public.edu_devices (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  device_id  TEXT NOT NULL,                      -- UPSMF DeviceId (<= 20 chars)
  label      TEXT,
  status     TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (org_id, device_id)
);
CREATE INDEX idx_edu_devices_org ON public.edu_devices (org_id);

-- ================= attendance punches (staging + push ledger) =================
CREATE TABLE public.edu_attendance_punches (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  person_type      TEXT NOT NULL CHECK (person_type IN ('student','teacher')),
  student_id       UUID REFERENCES public.edu_students(id) ON DELETE SET NULL,
  teacher_id       UUID REFERENCES public.edu_teachers(id) ON DELETE SET NULL,
  upsmf_identifier TEXT NOT NULL,                -- value pushed into UPSMF EnrollmentNo
  device_id        TEXT NOT NULL,                -- UPSMF DeviceId
  punch_time       TIMESTAMPTZ NOT NULL,
  direction        TEXT NOT NULL CHECK (direction IN ('IN','OUT')),
  photo            BYTEA,                         -- optional; UPSMF Photo
  source           TEXT NOT NULL DEFAULT 'device',
  sync_status      TEXT NOT NULL DEFAULT 'pending' CHECK (sync_status IN ('pending','synced','failed')),
  upsmf_entry_id   BIGINT,                        -- EntryId returned by UPSMF on success
  attempts         INT NOT NULL DEFAULT 0,
  last_error       TEXT,
  pushed_at        TIMESTAMPTZ,
  created_at       TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT edu_punch_person_one CHECK (NOT (student_id IS NOT NULL AND teacher_id IS NOT NULL))
);
-- Connector claim path: unsynced rows for an org.
CREATE INDEX idx_edu_punches_pending ON public.edu_attendance_punches (org_id, sync_status) WHERE sync_status <> 'synced';
CREATE INDEX idx_edu_punches_org_time ON public.edu_attendance_punches (org_id, punch_time);
CREATE INDEX idx_edu_punches_student ON public.edu_attendance_punches (student_id);
CREATE INDEX idx_edu_punches_teacher ON public.edu_attendance_punches (teacher_id);

-- ============================ RLS ============================
-- Org members operate within their own org; platform admins (no user_roles row)
-- retain access. Service role (the push connector) bypasses RLS entirely.
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['edu_courses','edu_teachers','edu_students','edu_devices','edu_attendance_punches']
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format($f$
      CREATE POLICY "%1$s org access" ON public.%1$I FOR ALL
        USING (org_id = public.get_user_org_id(auth.uid()) OR public.is_platform_admin(auth.uid()))
        WITH CHECK (org_id = public.get_user_org_id(auth.uid()) OR public.is_platform_admin(auth.uid()));
    $f$, t);
  END LOOP;
END $$;
