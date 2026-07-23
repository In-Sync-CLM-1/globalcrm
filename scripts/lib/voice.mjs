// Riya voiceover via ElevenLabs (192 kbps).
import { writeFileSync } from 'fs';
import { loadEnv } from './env.mjs';

const env = loadEnv(new URL('../../.env', import.meta.url));
const RIYA = 'vYENaCJHl4vFKNDYPr8y';

export async function synth(text, outPath, opts = {}) {
  const voiceId = opts.voiceId || RIYA;
  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_192`,
    {
      method: 'POST',
      headers: { 'xi-api-key': env.ELEVENLABS_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        model_id: 'eleven_turbo_v2_5',
        voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0.0, speed: 1.0 },
      }),
    },
  );
  if (!res.ok) throw new Error(`TTS ${res.status}: ${await res.text()}`);
  writeFileSync(outPath, Buffer.from(await res.arrayBuffer()));
  return outPath;
}

// Synthesize AND return character-level timing, so beats/scenes can lock to words.
// Returns { duration, find, chars, starts, ends, timeAtChar, outPath }.
export async function synthTimed(text, outPath, opts = {}) {
  const voiceId = opts.voiceId || RIYA;
  const speed = opts.speed ?? 0.9; // ~10% slower => more natural, less clipped
  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/with-timestamps?output_format=mp3_44100_192`,
    {
      method: 'POST',
      headers: { 'xi-api-key': env.ELEVENLABS_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        model_id: 'eleven_turbo_v2_5',
        voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0.0, speed },
      }),
    },
  );
  if (!res.ok) throw new Error(`TTS ${res.status}: ${await res.text()}`);
  const j = await res.json();
  writeFileSync(outPath, Buffer.from(j.audio_base64, 'base64'));
  const al = j.alignment || j.normalized_alignment;
  const chars = al.characters;
  const starts = al.character_start_times_seconds;
  const ends = al.character_end_times_seconds;
  const joined = chars.join('').toLowerCase();
  const find = (phrase) => {
    const i = joined.indexOf(phrase.toLowerCase());
    return i < 0 ? null : starts[i];
  };
  const timeAtChar = (i) => starts[Math.max(0, Math.min(i, starts.length - 1))];
  return { duration: ends[ends.length - 1], find, chars, starts, ends, timeAtChar, joined, outPath };
}
