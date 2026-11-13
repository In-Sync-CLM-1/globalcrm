// Renders the 60-second COLD CUT (scenes-short.mjs): one narration take at
// full speed, 1080p scene recordings, crossfade stitch, burned-in subtitles
// (most cold viewers watch muted), and loudness normalized to the -14 LUFS
// streaming standard.   node scripts/walkthrough/render-short.mjs
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { writeFileSync } from 'fs';
import { execFileSync } from 'child_process';
import { SCENES } from './scenes-short.mjs';
import { recordSceneVideo } from './lib/scene.mjs';
import { synthTimed } from './lib/voice.mjs';
import { crossfadeStitchVideo, overlayAudio, holdAndFade } from './lib/video.mjs';

const FF = 'C:\\Users\\Admin\\scoop\\shims\\ffmpeg.exe';
const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, 'recordings', 'scenes');
const T_X = 0.4;

// 0. seed (same state as the full walkthrough; skip with SKIP_SEED=1)
if (process.env.SKIP_SEED !== '1') {
  console.log('Seeding In-Sync Demo walkthrough state...');
  execFileSync(process.execPath, [join(here, 'seed-walkthrough.mjs')], { stdio: 'inherit' });
}

// 1. one continuous, full-speed narration (cold cuts want energy, not calm)
const fullText = SCENES.map((s) => s.narration).join(' ');
console.log('Synthesizing cold-cut narration (1.0x)...');
const Taud = await synthTimed(fullText, join(dir, 'short-narration.mp3'), { speed: 1.0 });
console.log(`narration ${Taud.duration.toFixed(1)}s, ${SCENES.length} scenes`);

// 2. per-scene slots, re-anchored to where each scene's opening words really
//    land in the take (same drift-proofing as the full cut)
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

// 4. stitch + narration
console.log('Stitching + narration...');
const silent = join(dir, 'short-silent.mp4');
crossfadeStitchVideo(videos, silent, T_X);
const narrated = join(dir, 'short-narrated.mp4');
overlayAudio(silent, join(dir, 'short-narration.mp3'), narrated);

// 5. subtitles: sentence-level cues from the TTS character timing
const srtTime = (t) => {
  const ms = Math.max(0, Math.round(t * 1000));
  const h = String(Math.floor(ms / 3600000)).padStart(2, '0');
  const m = String(Math.floor((ms % 3600000) / 60000)).padStart(2, '0');
  const s = String(Math.floor((ms % 60000) / 1000)).padStart(2, '0');
  return `${h}:${m}:${s},${String(ms % 1000).padStart(3, '0')}`;
};
const cues = [];
let cursor = 0;
for (const scene of SCENES) {
  for (const raw of scene.narration.split(/(?<=[.!?])\s+/)) {
    const line = raw.trim();
    if (!line) continue;
    const k = Taud.joined.indexOf(line.toLowerCase().slice(0, Math.min(24, line.length)), cursor);
    if (k < 0) continue;
    const start = Taud.timeAtChar(k);
    const end = Taud.timeAtChar(k + line.length - 1) + 0.25;
    cues.push(`${cues.length + 1}\n${srtTime(start)} --> ${srtTime(end)}\n${line}\n`);
    cursor = k + line.length;
  }
}
writeFileSync(join(dir, 'short-subs.srt'), cues.join('\n'), 'utf8');
console.log(`${cues.length} subtitle cues`);

// 6. burn subs + normalize loudness to -14 LUFS in one encode
//    (run from the scenes dir so the subtitles filter gets a colon-free path)
const styled = join(dir, 'short-styled.mp4');
execFileSync(FF, ['-y', '-i', 'short-narrated.mp4',
  '-vf', "subtitles=short-subs.srt:force_style='FontName=Segoe UI,FontSize=17,Bold=1,BorderStyle=1,Outline=2,Shadow=0,OutlineColour=&H96000000,PrimaryColour=&H00FFFFFF,MarginV=36'",
  '-af', 'loudnorm=I=-14:TP=-1.5:LRA=11',
  '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-r', '30', '-c:a', 'aac', '-b:a', '192k',
  '-movflags', '+faststart', 'short-styled.mp4'], { cwd: dir });

// 7. hold the CTA, fade out
const out = 'C:\\Users\\Admin\\Downloads\\in-sync-cold-cut.mp4';
holdAndFade(styled, out, 2.2, 1.0);
console.log('DONE ->', out);
