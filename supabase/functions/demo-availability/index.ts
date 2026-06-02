import { getSupabaseClient } from '../_shared/supabaseClient.ts';

// Public endpoint: given a date, return the demo slots and whether each is free,
// based on demos already booked on the host's calendar (contact_activities
// meetings for the In-Sync Demo org). The WorkSync "Request a Demo" form uses
// this to grey out already-booked times so a prospect can't pick a taken slot.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

const ORG = '61f7f96d-e80c-4d9b-a765-8eb32bd3c70d'; // In-Sync Demo
// Offerable demo slots (IST). Demos are 15–20 min; one prospect per slot.
const SLOTS = ['11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00'];

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

// "now" in IST as YYYY-MM-DD and minutes-since-midnight.
function istNow() {
  const off = (5 * 60 + 30) * 60 * 1000;
  const d = new Date(Date.now() + off);
  const date = d.toISOString().slice(0, 10);
  const mins = d.getUTCHours() * 60 + d.getUTCMinutes();
  return { date, mins };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  try {
    const date = new URL(req.url).searchParams.get('date');
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return json({ error: 'date (YYYY-MM-DD) is required' }, 400);
    }

    const supabase = getSupabaseClient();
    // Demos already on the host's calendar for that date.
    const { data: booked } = await supabase
      .from('contact_activities')
      .select('demo_time')
      .eq('org_id', ORG)
      .eq('activity_type', 'meeting')
      .eq('demo_date', date);
    const taken = new Set((booked || []).map((r: { demo_time: string | null }) => String(r.demo_time || '').slice(0, 5)));

    const now = istNow();
    const slots = SLOTS.map((t) => {
      const [h, m] = t.split(':').map(Number);
      const slotMins = h * 60 + m;
      const inPast = date < now.date || (date === now.date && slotMins <= now.mins);
      return { time: t, available: !taken.has(t) && !inPast };
    });

    return json({ date, slots });
  } catch (error) {
    console.error('demo-availability error:', error);
    return json({ error: 'Internal server error' }, 500);
  }
});
