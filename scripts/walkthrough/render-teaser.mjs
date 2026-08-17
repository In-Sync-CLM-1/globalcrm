// Renders the 60-second TEASER (scenes-teaser.mjs). Mix of freshly recorded
// scenes (hook, capture, close) and SLICES cut from the expert demo's own
// per-scene recordings (dialer / call analysis / field staff) — those must
// exist in recordings/scenes from a prior render-demo run. Subtitles burned
// (teasers get watched muted), loudness at -14 LUFS.
//   node scripts/walkthrough/render-teaser.mjs
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { writeFileSync, existsSync } from 'fs';
import { execFileSync } from 'child_process';
import { SCENES } from './scenes-teaser.mjs';
import { recordSceneVideo } from './lib/scene.mjs';
import { synthTimed } from './lib/voice.mjs';
import { crossfadeStitchVideo, overlayAudio, holdAndFade, webmToMp4, duration } from './lib/video.mjs';

const FF = 'C:\\Users\\Admin\\scoop\\shims\\ffmpeg.exe';
const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, 'recordings', 'scenes');
const T_X = 0.4;

// slice sources must exist (they come from render-demo)
for (const s of SCENES) if (s.slice && !existsSync(join(dir, s.slice.src))) {
  throw new Error(`missing slice source ${s.slice.src} — run render-demo.mjs first`);
}

if (process.env.SKIP_SEED !== '1') {
  console.log('Seeding In-Sync Demo walkthrough state...');
  execFileSync(process.execPath, [join(here, 'seed-walkthrough.mjs')], { stdio: 'inherit' });
}

// 1. narration (full speed — teaser energy)
console.log('Synthesizing teaser narration (1.0x)...');
const fullText = SCENES.map((s) => s.narration).join(' ');
const Taud = await synthTimed(fullText, join(dir, 'teaser-narration.mp3'), { speed: 1.0 });
console.log(`narration ${Taud.duration.toFixed(1)}s, ${SCENES.length} scenes`);

// 2. slots (re-anchored)
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

// 3. produce each segment: record fresh, or cut the slice to the slot length
const videos = [];
for (let i = 0; i < SCENES.length; i++) {
  const scene = SCENES[i];
  if (scene.slice) {
    const out = join(dir, `${scene.name}-v.mp4`);
    const need = slots[i].duration + T_X;
    const src = join(dir, scene.slice.src);
    const avail = duration(src) - scene.slice.from;
    const from = avail >= need ? scene.slice.from : Math.max(0, duration(src) - need);
    webmToMp4(src, out, from, need);
    console.log(`[${scene.name}] slice ${scene.slice.src} @${from.toFixed(1)}s for ${need.toFixed(2)}s`);
    videos.push(out);
    continue;
  }
  let v, lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try { v = await recordSceneVideo({ scene, slotStart: slots[i].start, slotDuration: slots[i].duration, localFind: slots[i].localFind, tailT: T_X }); break; }
    catch (e) { lastErr = e; console.log(`[${scene.name}] attempt ${attempt + 1} failed: ${e.message.split('\n')[0]}`); }
  }
  if (!v) throw new Error(`scene ${scene.name} failed after retries: ${lastErr?.message}`);
  videos.push(v);
}

// 4. stitch + narration
console.log('Stitching + narration...');
const silent = join(dir, 'teaser-silent.mp4');
crossfadeStitchVideo(videos, silent, T_X);
const narrated = join(dir, 'teaser-narrated.mp4');
overlayAudio(silent, join(dir, 'teaser-narration.mp3'), narrated);

// 5. subtitles (sentence cues from TTS timing)
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
writeFileSync(join(dir, 'teaser-subs.srt'), cues.join('\n'), 'utf8');
console.log(`${cues.length} subtitle cues`);

// 6. burn subs + loudness
execFileSync(FF, ['-y', '-i', 'teaser-narrated.mp4',
  '-vf', "subtitles=teaser-subs.srt:force_style='FontName=Segoe UI,FontSize=17,Bold=1,BorderStyle=1,Outline=2,Shadow=0,OutlineColour=&H96000000,PrimaryColour=&H00FFFFFF,MarginV=36'",
  '-af', 'loudnorm=I=-14:TP=-1.5:LRA=11',
  '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-r', '30', '-c:a', 'aac', '-b:a', '192k',
  '-movflags', '+faststart', 'teaser-styled.mp4'], { cwd: dir });

// 7. hold the close, fade
const out = 'C:\\Users\\Admin\\Downloads\\globalcrm-teaser-60s.mp4';
holdAndFade(join(dir, 'teaser-styled.mp4'), out, 2.2, 1.0);
console.log('DONE ->', out);
