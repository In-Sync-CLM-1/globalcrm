// Renders the EXPERT-DEMO walkthrough (scenes-demo.mjs): one ~7:30 narration
// take at 0.95x, 1080p scene recordings with chapter chips, crossfade stitch,
// loudness normalized to -14 LUFS (meeting-room friendly). No subtitles — the
// presenter plays this with sound on.   node scripts/walkthrough/render-demo.mjs
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { execFileSync } from 'child_process';
import { SCENES } from './scenes-demo.mjs';
import { recordSceneVideo } from './lib/scene.mjs';
import { synthTimed } from './lib/voice.mjs';
import { crossfadeStitchVideo, overlayAudio, holdAndFade } from './lib/video.mjs';

const FF = 'C:\\Users\\Admin\\scoop\\shims\\ffmpeg.exe';
const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, 'recordings', 'scenes');
const T_X = 0.5;

// 0. seed (same demo-org state as the guided cut; skip with SKIP_SEED=1)
if (process.env.SKIP_SEED !== '1') {
  console.log('Seeding In-Sync Demo walkthrough state...');
  execFileSync(process.execPath, [join(here, 'seed-walkthrough.mjs')], { stdio: 'inherit' });
}

// 1. one continuous narration
console.log('Synthesizing expert-demo narration (0.95x)...');
const fullText = SCENES.map((s) => s.narration).join(' ');
const Taud = await synthTimed(fullText, join(dir, 'demo-narration.mp3'), { speed: 0.95 });
console.log(`narration ${Taud.duration.toFixed(1)}s (${(Taud.duration / 60).toFixed(1)} min), ${SCENES.length} scenes`);

// 2. per-scene slots, re-anchored to the take (drift-proof, same as other cuts)
const charStarts = [];
let searchFrom = 0;
for (const s of SCENES) {
  const norm = s.narration.toLowerCase();
  let k = Taud.joined.indexOf(norm.slice(0, Math.min(20, norm.length)), searchFrom);
  if (k < 0) k = Taud.joined.indexOf(norm.slice(0, 10), searchFrom);
  if (k < 0) k = searchFrom;
  charStarts.push(k);
  searchFrom = k + norm.length;
}
const slots = SCENES.map((s, i) => {
  const charStart = charStarts[i];
  const charEnd = charStart + s.narration.length;
  const start = Taud.timeAtChar(charStart);
  const end = i < SCENES.length - 1 ? Taud.timeAtChar(charStarts[i + 1]) : Taud.duration;
  const localFind = (phrase) => { const k = Taud.joined.indexOf(phrase.toLowerCase(), charStart); return (k < 0 || k >= charEnd) ? null : Taud.starts[k]; };
  return { start, duration: Math.max(0.8, end - start), localFind };
});

// 3. record each scene (retry flaky runs)
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

// 4. stitch + narration + loudness
console.log('Stitching + narration + loudness...');
const silent = join(dir, 'demo-silent.mp4');
crossfadeStitchVideo(videos, silent, T_X);
const narrated = join(dir, 'demo-narrated.mp4');
overlayAudio(silent, join(dir, 'demo-narration.mp3'), narrated);
const leveled = join(dir, 'demo-leveled.mp4');
execFileSync(FF, ['-y', '-i', narrated, '-af', 'loudnorm=I=-14:TP=-1.5:LRA=11',
  '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', leveled]);

// 5. hold the close card, fade out
const out = 'C:\\Users\\Admin\\Downloads\\in-sync-expert-demo.mp4';
holdAndFade(leveled, out, 2.5, 1.2);
console.log('DONE ->', out);
