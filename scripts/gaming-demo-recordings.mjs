// Sample call recordings for the "Gaming CRM Demo" org.
//   node scripts/gaming-demo-recordings.mjs generate   synthesise the clips (ElevenLabs) into a work folder + write the manifest
//   node scripts/gaming-demo-recordings.mjs upload     put the clips in the R2 recordings bucket (key gaming-demo/<id>.mp3)
//   node scripts/gaming-demo-recordings.mjs assign     attach clips + transcripts + AI analysis to matching demo calls
// The scripts below are fictional and invented for the demo. The voice key is read from the AI-calling agent's .env
// at run time and is never copied anywhere.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { loadEnv } from './lib/env.mjs';

const env = loadEnv(new URL('../.env', import.meta.url));
const WORK = process.env.RECORDING_WORK_DIR || 'C:/Users/Admin/AppData/Local/Temp/gaming-demo-recordings';
const MANIFEST = new URL('./gaming-demo-recordings.json', import.meta.url);
const ORG = 'f07a3fa9-3a30-43bb-af2a-4c35bda2fce8';

// agent = the human caller, user = the lead. Voices: Indian female / male for callers, Indian male / female for leads.
const VOICES = { agentF: 'vYENaCJHl4vFKNDYPr8y', agentM: 'BZ7QSotEmGyFMP8nbbhC', leadM: 'vO7hjeAjmsdlGgUdvPpe', leadF: '6BZyx2XekeeXOkTVn8un' };

// disposition / sub-disposition each clip stands for, whether it is a "clean" call (a minute or more), and the AI analysis.
const SCRIPTS = [
  {
    id: 'registered', dispo: 'Registered', sub: 'New Signup', clean: true, score: 9, tone: 'warm',
    summary: 'The caller explained the free signup and the welcome reward, handled a question about safety, and walked the lead through registration. The lead created an account on the call and received an OTP on their own phone.',
    adherence: 'Followed the script closely: greeting, free registration, welcome reward, safety answer, close. Never asked for the OTP.',
    objections: ['Is it safe?', 'Will it cost anything?'], next: 'Call in two days to help the lead play their first game and claim the welcome reward.',
    lines: [
      ['agent', 'Hello, I am calling from the gaming platform. You showed interest in our games last week. Do you have two minutes?'],
      ['user', 'Yes, tell me. I did look at it on Instagram.'],
      ['agent', 'Great. Registration is completely free and takes about two minutes. New players also get a welcome reward in their account after signing up.'],
      ['user', 'Okay. Is it safe? I do not want to give my bank details or anything.'],
      ['agent', 'That is a very fair question. Your account is verified with just your mobile number. We never ask for bank details, passwords or an OTP on a call.'],
      ['user', 'Alright. And is there any cost?'],
      ['agent', 'No cost to register, and you can try the games before deciding anything else. Shall we do it together right now?'],
      ['user', 'Okay, let us do it.'],
      ['agent', 'Perfect. Please open the link I sent and enter your mobile number. You will get a six digit code on your own phone. Keep that with you, do not tell it to me.'],
      ['user', 'I got the code. I have entered it. It says registration complete.'],
      ['agent', 'Wonderful, you are registered. Your welcome reward is now waiting in your account. Which game would you like to try first?'],
      ['user', 'Ludo, I used to play that a lot.'],
      ['agent', 'Excellent choice. Go ahead and try it today. I will call you in two days to check how it went. Thank you for your time.'],
    ],
  },
  {
    id: 'activated', dispo: 'Activated', sub: 'Played First Game', clean: true, score: 8, tone: 'friendly',
    summary: 'A follow-up call to a registered player. The caller reminded the player about the welcome reward and helped them play their first game during the call.',
    adherence: 'Good: confirmed the registration, pointed to the reward, guided the first game. Could have mentioned the invite option earlier.',
    objections: ['I will try later'], next: 'No further call needed. Send the monthly update once the player has been active for two weeks.',
    lines: [
      ['agent', 'Hello, I am calling from the gaming platform. Thanks again for registering with us last week. Is this a good time?'],
      ['user', 'Yes, hello. I have not really played yet. I got busy with work.'],
      ['agent', 'No problem at all. Your welcome reward is still waiting in your account, and your first game takes only a couple of minutes.'],
      ['user', 'I will try later in the evening.'],
      ['agent', 'Of course. If you like, I can stay on the line and guide you. It is just two taps to start, and it may be easier with me here.'],
      ['user', 'Okay, fine. I have the app open right now.'],
      ['agent', 'Great. On the home screen you will see the games you showed interest in. Which one would you like to try first?'],
      ['user', 'The quiz one, I think. I like quizzes.'],
      ['agent', 'Good choice. Tap on it, and then on Play. Tell me when it starts, and take your time.'],
      ['user', 'It started. There is a timer, and the questions are quite easy.'],
      ['agent', 'That is the practice round, so there is no pressure at all. Answer a few, and the game will show your score at the end.'],
      ['user', 'I got seven out of ten. That was fun, honestly.'],
      ['agent', 'Well done. Now open the rewards section, and you should see your welcome reward added to your account.'],
      ['user', 'Yes, I can see it. It says reward added.'],
      ['agent', 'Wonderful. You are all set. You can invite a friend whenever you like, but that is entirely your choice. Is there anything else I can help you with?'],
      ['user', 'No, that is all. Thank you for walking me through it.'],
      ['agent', 'My pleasure. Enjoy the games, and have a lovely evening.'],
    ],
  },
  {
    id: 'interested', dispo: 'Interested', sub: 'Registration Link Sent', clean: true, score: 8, tone: 'professional',
    summary: 'The lead was interested but wanted to register later. The caller described the free signup and the welcome reward and agreed to send the registration link.',
    adherence: 'Followed the script. Offered the link instead of pushing the lead to register immediately.',
    objections: ['Busy right now'], next: 'Check whether the lead has registered in two days; call once if not.',
    lines: [
      ['agent', 'Hello, I am calling from the gaming platform. You showed interest in Carrom on our site. Do you have a minute?'],
      ['user', 'Yes, but I am in the middle of something. Please keep it short.'],
      ['agent', 'Of course. Registration is free and takes about two minutes, and new players get a welcome reward after signing up.'],
      ['user', 'That sounds good. What games do you have?'],
      ['agent', 'Carrom, Ludo, Chess, quiz and puzzle games, among others. You can try any of them as soon as you register.'],
      ['user', 'Okay. Is there any age limit, or any documents needed?'],
      ['agent', 'Players must be eighteen or older, and you only need your mobile number to start. We never ask for bank details or passwords on a call.'],
      ['user', 'That is good to know. I cannot do it right now though. Can you send me the details?'],
      ['agent', 'Certainly. I will send you the registration link now, so you can register whenever you are free.'],
      ['user', 'Yes, please send it. And how long does the welcome reward stay in the account?'],
      ['agent', 'The reward details are shown right inside the app once you register, so you can read them at your own pace.'],
      ['user', 'Fine. I will look at it this evening.'],
      ['agent', 'Perfect. If you have any questions, just ask me when I call back. Thank you for your time, and have a good day.'],
      ['user', 'Thank you, bye.'],
    ],
  },
  {
    id: 'callback', dispo: 'Callback Requested', sub: 'Specific Time Given', clean: true, score: 7, tone: 'polite',
    summary: 'The lead was travelling and asked to be called back the next morning at ten. The caller confirmed the time and kept the call short.',
    adherence: 'Good: respected the lead\'s time, confirmed the callback slot, no pressure.',
    objections: ['Not a good time'], next: 'Call tomorrow at 10:00.',
    lines: [
      ['agent', 'Hello, I am calling from the gaming platform. Is this a good time to talk for two minutes?'],
      ['user', 'Oh, hello. I am travelling right now, and the network is not great.'],
      ['agent', 'I understand. I will not take much time. You had shown interest in registering with us a few days ago.'],
      ['user', 'Yes, I remember. I was looking at the quiz games. But I cannot talk properly now.'],
      ['agent', 'No worries at all. Would you like me to call you at a better time, or send you the details first?'],
      ['user', 'Please call me tomorrow morning. I would like to understand it properly, and I do not want to rush.'],
      ['agent', 'Certainly. What time suits you best?'],
      ['user', 'Around ten in the morning is fine. I will be at my desk by then, and the network will be better.'],
      ['agent', 'Perfect. Just so you know, registration is free and takes about two minutes, so we can do it together tomorrow if you like.'],
      ['user', 'Okay, that works. Please do not call before ten though.'],
      ['agent', 'Understood. I will call you tomorrow at ten, not a minute earlier. Thank you, and have a safe journey.'],
      ['user', 'Thank you. Talk tomorrow.'],
    ],
  },
  {
    id: 'not-interested-elsewhere', dispo: 'Not Interested', sub: 'Already Plays Elsewhere', clean: true, score: 7, tone: 'respectful',
    summary: 'The lead already plays on another platform and was not interested. The caller mentioned the welcome reward once, accepted the answer and ended politely.',
    adherence: 'Good: one gentle follow-up only, no pressure, polite close.',
    objections: ['Already plays on another app', 'Does not want to install another app'], next: 'Do not call again for 90 days.',
    lines: [
      ['agent', 'Hello, I am calling from the gaming platform. You enquired about our games recently. Do you have a minute?'],
      ['user', 'Yes, but I already play on another app. I do not need another one.'],
      ['agent', 'That is quite common, many of our players use more than one. Ours is free to join, and there is a welcome reward for new players.'],
      ['user', 'I do not want to install another app. My phone is already full.'],
      ['agent', 'Understood. You can also try the games in your browser without installing anything.'],
      ['user', 'Still not interested, honestly. I am happy where I am.'],
      ['agent', 'That is perfectly fine. Thank you for your time, and I wish you good games.'],
    ],
  },
  {
    id: 'not-interested-no-time', dispo: 'Not Interested', sub: 'No Time', clean: false, score: 7, tone: 'polite',
    summary: 'The lead had no time and declined. The caller thanked them and ended the call quickly.',
    adherence: 'Good: brief and polite, no pressure.', objections: ['No time'], next: 'No follow-up for 60 days.',
    lines: [
      ['agent', 'Hello, I am calling from the gaming platform. Can I take a minute of your time?'],
      ['user', 'Sorry, I have no time for this. Not interested.'],
      ['agent', 'No problem at all. Thank you, have a good day.'],
    ],
  },
  {
    id: 'wrong-number', dispo: 'Wrong Number', sub: 'Not the Lead', clean: false, score: 8, tone: 'polite',
    summary: 'The person who answered was not the lead. The caller apologised and ended the call.',
    adherence: 'Followed the script: confirmed the name, apologised, closed.', objections: [], next: 'Mark the number as wrong; no further calls.',
    lines: [
      ['agent', 'Hello, is this the number that enquired about our gaming platform?'],
      ['user', 'No, you have the wrong number. I did not enquire about anything.'],
      ['agent', 'I am sorry for the trouble. Have a good day.'],
    ],
  },
  {
    id: 'already-registered', dispo: 'Already Registered', sub: 'Existing Active Player', clean: false, score: 8, tone: 'friendly',
    summary: 'The lead already had an account and played regularly. The caller thanked them and ended the call.',
    adherence: 'Good: recognised the existing player, no pitch.', objections: [], next: 'No call needed; keep the lead in the player list.',
    lines: [
      ['agent', 'Hello, I am calling from the gaming platform. You enquired about registering with us.'],
      ['user', 'I already have an account with you. I play every day.'],
      ['agent', 'Wonderful, thank you. Enjoy the games, and let us know if you ever need help.'],
    ],
  },
];

const CALLER_NAMES = { F: 'Ishita', M: 'Nikhil' };

function variants() {
  const out = [];
  for (const s of SCRIPTS) {
    for (const g of ['F', 'M']) {
      out.push({ id: `${s.id}-${g}`, script: s, agentGender: g, agentVoice: g === 'F' ? VOICES.agentF : VOICES.agentM, leadVoice: g === 'F' ? VOICES.leadM : VOICES.leadF });
    }
  }
  return out;
}

async function tts(key, voice, text, out) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}?output_format=mp3_44100_128`, {
      method: 'POST', headers: { 'xi-api-key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, model_id: 'eleven_turbo_v2_5', voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0, speed: 1.0 } }),
    });
    if (r.ok) { writeFileSync(out, Buffer.from(await r.arrayBuffer())); return; }
    if (attempt === 2) throw new Error(`TTS ${r.status}: ${(await r.text()).slice(0, 200)}`);
    await new Promise((res) => setTimeout(res, 1500));
  }
}

const probeSecs = (f) => Math.round(parseFloat(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).toString().trim()));

const cmd = process.argv[2];
if (cmd === 'generate') {
  const key = readFileSync('C:/Users/Admin/ai-calling/.env', 'utf8').match(/^(?:ELEVENLABS_API_KEY|ELEVEN_API_KEY)=(.*)$/m)[1].trim().replace(/^["']|["']$/g, '');
  mkdirSync(WORK, { recursive: true });
  const manifest = [];
  for (const v of variants()) {
    const dir = `${WORK}/${v.id}`; mkdirSync(dir, { recursive: true });
    const lines = v.script.lines.map(([who, text]) => [who, text.replace('{caller}', CALLER_NAMES[v.agentGender])]);
    const parts = [];
    for (let i = 0; i < lines.length; i++) {
      const [who, text] = lines[i]; const f = `${dir}/${String(i).padStart(2, '0')}.mp3`;
      if (!existsSync(f)) await tts(key, who === 'agent' ? v.agentVoice : v.leadVoice, text, f);
      parts.push(f);
    }
    // join the turns with a short pause: re-encode to one mp3
    const list = `${dir}/list.txt`; writeFileSync(list, parts.map((p) => `file '${p}'`).join('\n'));
    const out = `${WORK}/${v.id}.mp3`;
    execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-af', 'adelay=0|0,apad=pad_dur=0', '-c:a', 'libmp3lame', '-b:a', '96k', '-ar', '44100', out]);
    manifest.push({ id: v.id, scriptId: v.script.id, agentGender: v.agentGender, seconds: probeSecs(out), transcript: lines.map(([who, t]) => `${who}: ${t}`).join('\n') });
    console.log(v.id, probeSecs(out), 's');
  }
  writeFileSync(MANIFEST, JSON.stringify(manifest, null, 1));
  console.log('manifest written:', manifest.length, 'clips');
} else if (cmd === 'upload') {
  const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
  for (const m of manifest) {
    const r = await fetch(`${env.R2_RECORDINGS_WORKER_URL}/gaming-demo/${m.id}.mp3`, { method: 'PUT', headers: { Authorization: `Bearer ${env.R2_RECORDINGS_SECRET}`, 'Content-Type': 'audio/mpeg' }, body: readFileSync(`${WORK}/${m.id}.mp3`) });
    console.log(m.id, r.status);
    if (!r.ok) throw new Error('upload failed ' + (await r.text()));
  }
} else if (cmd === 'assign') {
  const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
  const sql = async (query) => {
    const r = await fetch(`https://api.supabase.com/v1/projects/${env.SUPABASE_PROJECT_REF}/database/query`, { method: 'POST', headers: { Authorization: 'Bearer ' + env.SUPABASE_ACCESS_TOKEN, 'Content-Type': 'application/json', 'User-Agent': 'curl/8' }, body: JSON.stringify({ query }) });
    const t = await r.text(); if (!r.ok) throw new Error(t.slice(0, 300)); return JSON.parse(t);
  };
  let seed = 424242; const rnd = () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const callers = await sql(`select p.id, p.first_name from profiles p join user_roles r on r.user_id = p.id and r.org_id = '${ORG}' where r.role = 'sales_agent'`);
  const female = new Set(['Ishita', 'Pooja', 'Tanya']);
  const bias = { Kabir: 1, Ishita: 0, Nikhil: 0, Pooja: -1, Sahil: -1, Tanya: 0 };
  const byId = Object.fromEntries(callers.map((c) => [c.id, c.first_name]));
  const rows = []; const used = new Set();
  const TONES = ['warm', 'professional', 'friendly', 'calm', 'enthusiastic'];
  for (const m of manifest) {
    const sc = SCRIPTS.find((x) => x.id === m.scriptId);
    const ids = callers.filter((c) => (m.agentGender === 'F') === female.has(c.first_name)).map((c) => c.id);
    const cand = await sql(`select l.id, l.agent_id, l.call_duration, l.ring_duration, l.answered_at, l.started_at from call_logs l
      join call_dispositions d on d.id = l.disposition_id and d.name = '${sc.dispo}'
      join call_sub_dispositions s on s.id = l.sub_disposition_id and s.name = '${sc.sub}'
      where l.org_id = '${ORG}' and l.caller_type = 'human' and l.agent_id in (${ids.map((i) => `'${i}'`).join(',')}) and l.answered_at is not null and l.r2_key is null`);
    // keep the clean / not-clean status of the call unchanged
    const ok = cand.filter((c) => !used.has(c.id) && ((c.call_duration ?? 0) >= 60) === ((c.ring_duration ?? 0) + m.seconds >= 60));
    ok.sort(() => rnd() - 0.5);
    for (const c of ok.slice(0, 55)) {
      used.add(c.id);
      const name = byId[c.agent_id];
      const score = Math.max(4, Math.min(10, sc.score + (bias[name] ?? 0) + Math.round(rnd() * 2 - 1)));
      const tone = rnd() < 0.55 ? sc.tone : TONES[Math.floor(rnd() * TONES.length)];
      rows.push({ id: c.id, key: `gaming-demo/${m.id}.mp3`, secs: m.seconds, ring: c.ring_duration ?? 0, transcript: m.transcript, summary: sc.summary, adherence: sc.adherence, objections: sc.objections, next: sc.next, score, tone });
    }
    console.log(m.id, 'eligible', ok.length, 'assigned', Math.min(55, ok.length));
  }
  for (let i = 0; i < rows.length; i += 60) {
    const chunk = rows.slice(i, i + 60);
    await sql(`set session_replication_role = replica; set statement_timeout = 0;
      update call_logs c set
        r2_key = v.key, recording_url = 'r2://globalcrm-call-recordings/' || v.key, r2_uploaded_at = c.started_at, recording_duration = v.secs,
        conversation_duration = v.secs, call_duration = v.ring + v.secs, ended_at = c.answered_at + make_interval(secs => v.secs),
        transcript = v.transcript, transcript_status = 'completed', transcribed_at = c.started_at + interval '5 minutes',
        analysis_summary = v.summary, analysis_tone = v.tone, analysis_script_adherence = v.adherence, analysis_objections = v.objections,
        analysis_next_step = v.next, analysis_quality_score = v.score, analysis_status = 'ok', analyzed_at = c.started_at + interval '6 minutes'
      from jsonb_to_recordset($gdj$${JSON.stringify(chunk)}$gdj$::jsonb) as v(id uuid, key text, secs int, ring int, transcript text, summary text, adherence text, objections jsonb, next text, score int, tone text)
      where c.id = v.id`);
    console.log('updated', Math.min(i + 60, rows.length), '/', rows.length);
  }
  // AI calls: analysis without audio
  await sql(`set session_replication_role = replica; update call_logs set analysis_status = 'ok' where org_id = '${ORG}' and caller_type = 'ai' and analysis_status = 'completed';
    update call_logs c set analysis_tone = 'friendly', analysis_quality_score = 7 + (abs(hashtext(c.id::text)) % 3),
      analysis_script_adherence = 'The AI assistant followed the script: introduced itself, pitched free registration and the welcome reward, and respected the lead''s answer.',
      analysis_objections = case d.name when 'Not Interested' then '["Not interested"]'::jsonb when 'Callback Requested' then '["Not a good time"]'::jsonb else '[]'::jsonb end,
      analysis_next_step = case d.name when 'Interested' then 'A human caller follows up within two days to help the lead register.' when 'Callback Requested' then 'Call back at the time the lead asked for.' when 'Not Interested' then 'Do not call again for 90 days.' when 'Do Not Call' then 'Lead is on the do-not-call list.' else 'No action needed.' end,
      analyzed_at = c.started_at + interval '3 minutes'
    from call_dispositions d where d.id = c.disposition_id and c.org_id = '${ORG}' and c.caller_type = 'ai' and c.transcript is not null and c.analysis_tone is null`);
  console.log('AI calls analysed');
} else {
  console.log('usage: generate | upload | assign');
}
export { SCRIPTS, ORG, variants };
