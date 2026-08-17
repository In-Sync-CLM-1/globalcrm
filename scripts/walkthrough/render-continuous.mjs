// Continuous-narration pipeline for the globalcrm Leadership-Cut walkthrough:
// ONE Riya take for the whole script, video recorded to per-scene slots,
// crossfaded, the single narration laid underneath, graceful outro.
//   node scripts/walkthrough/render-continuous.mjs
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { execFileSync } from 'child_process';
import { SCENES } from './scenes.mjs';
import { recordSceneVideo } from './lib/scene.mjs';
import { synthTimed } from './lib/voice.mjs';
import { crossfadeStitchVideo, overlayAudio, holdAndFade } from './lib/video.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, 'recordings', 'scenes');
const T_X = 0.5;

// 0. Seed the In-Sync Demo org to a believable mid-day state + the hero lead.
if (process.env.SKIP_SEED !== '1') {
  console.log('Seeding In-Sync Demo walkthrough state...');
  execFileSync(process.execPath, [join(here, 'seed-walkthrough.mjs')], { stdio: 'inherit' });
}

// 1. one continuous narration
const SEP = ' ';
const fullText = SCENES.map((s) => s.narration).join(SEP);
console.log('Synthesizing full narration (0.95x)...');
const Taud = await synthTimed(fullText, join(dir, 'full-narration.mp3'), { speed: 0.95 });
console.log(`narration ${Taud.duration.toFixed(1)}s, ${SCENES.length} scenes`);

// 2. slots + scene-local word finders.
// Instead of blindly accumulating character offsets (which drifts the moment the
// TTS engine's alignment string differs from our script by even one character —
// numbers, punctuation, spacing — desyncing every later scene), we RE-ANCHOR each
// scene to where its own opening words actually appear in the narration timeline.
// searchFrom advances monotonically, so even scenes that open with the same words
// resolve to the right occurrence. This keeps the single continuous take while
// making the video-to-voice sync immune to cumulative drift.
const charStarts = [];
let searchFrom = 0;
for (const s of SCENES) {
  const norm = s.narration.toLowerCase();
  const probe = norm.slice(0, Math.min(20, norm.length));
  let k = Taud.joined.indexOf(probe, searchFrom);
  if (k < 0) k = Taud.joined.indexOf(norm.slice(0, 10), searchFrom);
  if (k < 0) k = searchFrom;                 // last resort: continue from prior end
  charStarts.push(k);
  searchFrom = k + norm.length;              // next scene searches past this one
}
const slots = SCENES.map((s, i) => {
  const charStart = charStarts[i];
  const charEnd = charStart + s.narration.length;
  const start = Taud.timeAtChar(charStart);
  const end = i < SCENES.length - 1 ? Taud.timeAtChar(charStarts[i + 1]) : Taud.duration;
  const localFind = (phrase) => { const k = Taud.joined.indexOf(phrase.toLowerCase(), charStart); return (k < 0 || k >= charEnd) ? null : Taud.starts[k]; };
  return { start, duration: Math.max(0.8, end - start), localFind };
});

// 3. record each scene's video to its slot (retry a flaky login/scene up to 3x)
const videos = [];
for (let i = 0; i < SCENES.length; i++) {
  let v, lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try { v = await recordSceneVideo({ scene: SCENES[i], slotStart: slots[i].start, slotDuration: slots[i].duration, localFind: slots[i].localFind, tailT: T_X }); break; }
    catch (e) { lastErr = e; console.log(`[${SCENES[i].name}] attempt ${attempt + 1} failed: ${e.message.split('\n')[0]}`); }
  }
  if (!v) throw new Error(`scene ${SCENES[i].name} failed after retries: ${lastErr?.message}`);
  videos.push(v);
}

// 4. crossfade the videos, then lay the single narration under them
console.log('Stitching (crossfade) + overlaying narration...');
const silent = join(dir, 'continuous-silent.mp4');
crossfadeStitchVideo(videos, silent, T_X);
const narrated = join(dir, 'continuous-narrated.mp4');
overlayAudio(silent, join(dir, 'full-narration.mp3'), narrated);
const out = 'C:\\Users\\Admin\\Downloads\\globalcrm-demo-full.mp4';
holdAndFade(narrated, out, 2.0, 1.2);
console.log('DONE ->', out);
