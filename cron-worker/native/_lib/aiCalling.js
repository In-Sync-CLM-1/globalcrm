// Ported from supabase/functions/_shared/aiCalling.ts -- only the pieces
// ai-callback-dispatcher.js needs (window gate + call trigger).
const BOLNA = "https://api.bolna.ai";
export const DEFAULT_FROM_NUMBER = "+911169323462";

export function nowIstMinutesSinceMidnight(now = new Date()) {
  const utcMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  return (utcMinutes + 5 * 60 + 30) % (24 * 60);
}
export function nowIstDayOfWeek(now = new Date()) {
  const utcMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  const istTotal = utcMinutes + 5 * 60 + 30;
  const dayShift = Math.floor(istTotal / (24 * 60));
  return (now.getUTCDay() + dayShift) % 7;
}
function formatIstMin(m) {
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

// Window 1: 11:00-13:30 IST, Window 2: 15:00-<AI_WINDOW2_END_MIN, default 17:00> IST. Mon-Sat only.
export function isInsideWorkingWindow(env, now = new Date()) {
  if (nowIstDayOfWeek(now) === 0) return { inside: false, window: null, reason: "Sunday — no calling" };
  const istMinutes = nowIstMinutesSinceMidnight(now);
  if (istMinutes >= 660 && istMinutes < 810) return { inside: true, window: 1, reason: "inside window 1 (11:00-13:30 IST)" };
  const win2End = parseInt(env.AI_WINDOW2_END_MIN ?? "1020", 10);
  const win2EndMin = Number.isFinite(win2End) && win2End >= 900 && win2End <= 1440 ? win2End : 1020;
  if (istMinutes >= 900 && istMinutes < win2EndMin) return { inside: true, window: 2, reason: `inside window 2 (15:00-${formatIstMin(win2EndMin)} IST)` };
  if (istMinutes >= 810 && istMinutes < 900) return { inside: false, window: null, reason: "lunch break (13:30-15:00 IST)" };
  return { inside: false, window: null, reason: `outside business hours (11:00-${formatIstMin(win2EndMin)} IST)` };
}

export async function triggerBolnaCall(bolnaKey, input) {
  const firstNameForBolna = input.contact.name_hi ? input.contact.name_hi : (input.contact.first_name ?? "");
  const callBody = {
    agent_id: input.agentId,
    recipient_phone_number: input.toNumber,
    from_phone_number: input.fromNumber || DEFAULT_FROM_NUMBER,
    user_data: {
      contact_id: input.contact.id, call_log_id: input.callLogId,
      first_name: firstNameForBolna, last_name: input.contact.last_name ?? "",
      company: input.contact.company ?? "your company", job_title: input.contact.job_title ?? "",
    },
  };
  const res = await fetch(`${BOLNA}/call`, { method: "POST", headers: { Authorization: `Bearer ${bolnaKey}`, "Content-Type": "application/json" }, body: JSON.stringify(callBody) });
  const text = await res.text();
  let json = {}; try { json = JSON.parse(text); } catch { /* keep raw */ }
  if (!res.ok) return { error: `${res.status}: ${text}` };
  const execId = json.execution_id ?? json.run_id;
  if (!execId) return { error: `No execution_id in Bolna response: ${text}` };
  return { execution_id: execId };
}
