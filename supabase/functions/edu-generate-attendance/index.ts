// edu-generate-attendance — TEMPORARY random attendance generator for the
// BSR one-week stability test (2026-06-11 .. 2026-06-17, inclusive). After the
// window it no-ops; the daily CSV upload takes over as the real punch source.
//
// Invoked by two cron workers: 04:30 UTC (=10:00 IST, generates IN punches
// randomly placed in the 09:00-09:55 window) and 11:30 UTC (=17:00 IST, OUT
// punches in 16:00-16:55). Direction is inferred from IST hour since the cron
// worker posts an empty body. Sundays are skipped (college closed). Covers all
// active students AND teachers. Idempotent: a re-run only fills persons missing
// that day's punch in that direction. Inactive (send-as-absent) persons are
// excluded here AND blocked by the edu_skip_inactive_punch trigger. Alerts are
// FAILURE-ONLY.

import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const OPS_EMAIL = "a@in-sync.co.in";
const ALERT_FROM = "In-Sync Attendance <notifications@globalcrm.in-sync.co.in>";

const ORG_ID = "421eb87f-6bc9-409b-91c4-b5aa7022f37a"; // Baba Sadhav Ram Paramedical College
const DEVICE_ID = "BSRBIO01";
const START = "2026-06-10";
const END = "2026-06-17";
const IST_MS = 5.5 * 3600 * 1000;

const pad = (n: number) => String(n).padStart(2, "0");

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

async function alertFailure(step: string, detail: string) {
  if (!RESEND_API_KEY) return;
  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${RESEND_API_KEY}` },
    body: JSON.stringify({
      from: ALERT_FROM,
      to: [OPS_EMAIL],
      subject: `[BSR attendance generator] failed at ${step}`,
      html: `<p>The BSR random attendance generator failed.</p><pre>${detail}</pre>`,
    }),
  }).catch(() => {});
}

Deno.serve(async () => {
  const ist = new Date(Date.now() + IST_MS);
  const date = ist.toISOString().slice(0, 10);
  if (date < START || date > END) return json({ skipped: `outside test window ${START}..${END}`, date });
  if (ist.getUTCDay() === 0) return json({ skipped: "sunday", date });

  const direction = ist.getUTCHours() < 12 ? "IN" : "OUT";
  const windowHour = direction === "IN" ? 9 : 16;

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  const { data: students, error: se } = await supabase
    .from("edu_students")
    .select("id, enrollment_no")
    .eq("org_id", ORG_ID)
    .eq("status", "active");
  if (se) {
    await alertFailure("fetch students", se.message);
    return json({ error: se.message }, 500);
  }
  const { data: teachers, error: te } = await supabase
    .from("edu_teachers")
    .select("id, tutor_id")
    .eq("org_id", ORG_ID)
    .eq("status", "active");
  if (te) {
    await alertFailure("fetch teachers", te.message);
    return json({ error: te.message }, 500);
  }

  // Persons already punched today in this direction (idempotent re-runs).
  const dayStartUtc = new Date(Date.parse(`${date}T00:00:00Z`) - IST_MS).toISOString();
  const dayEndUtc = new Date(Date.parse(`${date}T00:00:00Z`) - IST_MS + 86400000).toISOString();
  const { data: existing, error: ee } = await supabase
    .from("edu_attendance_punches")
    .select("student_id, teacher_id")
    .eq("org_id", ORG_ID)
    .eq("direction", direction)
    .gte("punch_time", dayStartUtc)
    .lt("punch_time", dayEndUtc);
  if (ee) {
    await alertFailure("fetch existing punches", ee.message);
    return json({ error: ee.message }, 500);
  }
  const doneStudents = new Set((existing ?? []).map((r) => r.student_id).filter(Boolean));
  const doneTeachers = new Set((existing ?? []).map((r) => r.teacher_id).filter(Boolean));

  const people = [
    ...(students ?? [])
      .filter((s) => !doneStudents.has(s.id))
      .map((s) => ({ person_type: "student", student_id: s.id, upsmf_identifier: s.enrollment_no })),
    ...(teachers ?? [])
      .filter((t) => !doneTeachers.has(t.id))
      .map((t) => ({ person_type: "teacher", teacher_id: t.id, upsmf_identifier: t.tutor_id })),
  ];

  const rows = people.map((p) => {
    const t = `${date}T${pad(windowHour)}:${pad(Math.floor(Math.random() * 56))}:${pad(Math.floor(Math.random() * 60))}+05:30`;
    return {
      org_id: ORG_ID,
      device_id: DEVICE_ID,
      punch_time: new Date(t).toISOString(),
      direction,
      source: "random-generator",
      ...p,
    };
  });

  if (rows.length > 0) {
    const { error: ie } = await supabase.from("edu_attendance_punches").insert(rows);
    if (ie) {
      await alertFailure("insert punches", ie.message);
      return json({ error: ie.message }, 500);
    }
  }

  return json({ date, direction, generated: rows.length, already_punched: done.size });
});
