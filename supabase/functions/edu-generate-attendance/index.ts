// edu-generate-attendance — TEMPORARY random attendance generator for the
// BSR one-week stability test (2026-06-10 .. 2026-06-17, inclusive). After the
// window it no-ops; the daily CSV upload takes over as the real punch source.
//
// Invoked by two cron workers at WINDOW START: 03:30 UTC (=09:00 IST, IN) and
// 10:30 UTC (=16:00 IST, OUT). Direction is inferred from IST hour since the
// cron worker posts an empty body. The whole window is planned up front with
// punch times spread randomly across it; the 5-min pusher only uploads punches
// whose time has passed (claim_edu_punches), so punches trickle to UPSMF
// sequentially like a real device — never one bulk batch.
//
// Random attendance, per user spec (2026-06-10):
//   - IN run: a random 5-15% of active students (0-8% of teachers) are absent
//     for the day — no punches at all. Everyone else gets an IN punch.
//   - OUT run: an OUT punch for exactly the persons who punched IN today.
//   - Sundays skipped (college closed).
//
// Upload history: every run writes one edu_upload_log row (date, direction,
// present/absent counts, named absentee list). The log's UNIQUE constraint is
// also the idempotency gate — a window is generated at most once, so absences
// are never re-rolled by a retry.
//
// Inactive (send-as-absent) persons are excluded here AND blocked by the
// edu_skip_inactive_punch trigger. Alerts are FAILURE-ONLY.

import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const OPS_EMAIL = "a@in-sync.co.in";
const ALERT_FROM = "In-Sync Attendance <notifications@globalcrm.in-sync.co.in>";

const ORG_ID = "421eb87f-6bc9-409b-91c4-b5aa7022f37a"; // Baba Sadhav Ram Paramedical College
const DEVICE_ID = "BSRBIO01";
const SOURCE = "random-generator";
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

// Random punch time spread across the window (e.g. 09:00:00-09:55:59 IST).
function randomPunchTime(date: string, windowHour: number): string {
  const t = `${date}T${pad(windowHour)}:${pad(Math.floor(Math.random() * 56))}:${pad(Math.floor(Math.random() * 60))}+05:30`;
  return new Date(t).toISOString();
}

Deno.serve(async () => {
  const ist = new Date(Date.now() + IST_MS);
  const date = ist.toISOString().slice(0, 10);
  if (date < START || date > END) return json({ skipped: `outside test window ${START}..${END}`, date });
  if (ist.getUTCDay() === 0) return json({ skipped: "sunday", date });

  const direction = ist.getUTCHours() < 12 ? "IN" : "OUT";
  const windowHour = direction === "IN" ? 9 : 16;

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  // Idempotency gate: each (date, direction) is generated at most once.
  const { data: gate, error: ge } = await supabase
    .from("edu_upload_log")
    .insert({ org_id: ORG_ID, upload_date: date, direction, source: SOURCE, total_active: 0, present: 0, absent: 0 })
    .select("id")
    .maybeSingle();
  if (ge) {
    if (ge.code === "23505") return json({ skipped: "already generated", date, direction });
    await alertFailure("upload-log gate", ge.message);
    return json({ error: ge.message }, 500);
  }
  const logId = gate!.id;

  const { data: students, error: se } = await supabase
    .from("edu_students")
    .select("id, enrollment_no, name")
    .eq("org_id", ORG_ID)
    .eq("status", "active");
  if (se) {
    await alertFailure("fetch students", se.message);
    return json({ error: se.message }, 500);
  }
  const { data: teachers, error: te } = await supabase
    .from("edu_teachers")
    .select("id, tutor_id, name")
    .eq("org_id", ORG_ID)
    .eq("status", "active");
  if (te) {
    await alertFailure("fetch teachers", te.message);
    return json({ error: te.message }, 500);
  }

  const all = [
    ...(students ?? []).map((s) => ({ person_type: "student", key: s.id, identifier: s.enrollment_no, name: s.name })),
    ...(teachers ?? []).map((t) => ({ person_type: "teacher", key: t.id, identifier: t.tutor_id, name: t.name })),
  ];

  let present: typeof all = [];
  let absentees: typeof all = [];

  if (direction === "IN") {
    // Daily random absence: students 5-15%, teachers 0-8%.
    const studentRate = 0.05 + Math.random() * 0.10;
    const teacherRate = Math.random() * 0.08;
    for (const p of all) {
      const rate = p.person_type === "student" ? studentRate : teacherRate;
      (Math.random() < rate ? absentees : present).push(p);
    }
  } else {
    // OUT goes to exactly those who punched IN today.
    const dayStartUtc = new Date(Date.parse(`${date}T00:00:00Z`) - IST_MS).toISOString();
    const dayEndUtc = new Date(Date.parse(`${date}T00:00:00Z`) - IST_MS + 86400000).toISOString();
    const { data: ins, error: ie } = await supabase
      .from("edu_attendance_punches")
      .select("student_id, teacher_id")
      .eq("org_id", ORG_ID)
      .eq("direction", "IN")
      .neq("sync_status", "skipped")
      .gte("punch_time", dayStartUtc)
      .lt("punch_time", dayEndUtc);
    if (ie) {
      await alertFailure("fetch IN punches", ie.message);
      return json({ error: ie.message }, 500);
    }
    const punchedIn = new Set((ins ?? []).flatMap((r) => [r.student_id, r.teacher_id]).filter(Boolean));
    present = all.filter((p) => punchedIn.has(p.key));
    absentees = all.filter((p) => !punchedIn.has(p.key));
  }

  const rows = present.map((p) => ({
    org_id: ORG_ID,
    person_type: p.person_type,
    student_id: p.person_type === "student" ? p.key : null,
    teacher_id: p.person_type === "teacher" ? p.key : null,
    upsmf_identifier: p.identifier,
    device_id: DEVICE_ID,
    punch_time: randomPunchTime(date, windowHour),
    direction,
    source: SOURCE,
  }));

  if (rows.length > 0) {
    const { error: pe } = await supabase.from("edu_attendance_punches").insert(rows);
    if (pe) {
      // Roll back the gate so a retry can regenerate this window.
      await supabase.from("edu_upload_log").delete().eq("id", logId);
      await alertFailure("insert punches", pe.message);
      return json({ error: pe.message }, 500);
    }
  }

  const { error: le } = await supabase
    .from("edu_upload_log")
    .update({
      total_active: all.length,
      present: present.length,
      absent: absentees.length,
      absentees: absentees.map((p) => ({ type: p.person_type, id: p.identifier, name: p.name })),
    })
    .eq("id", logId);
  if (le) await alertFailure("update upload log", le.message);

  return json({ date, direction, total_active: all.length, present: present.length, absent: absentees.length });
});
