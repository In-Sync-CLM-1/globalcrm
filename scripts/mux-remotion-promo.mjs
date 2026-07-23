// Mux remotion visual + narration + music bed -> Downloads\globalcrm-promo.mp4
//   node scripts/mux-remotion-promo.mjs [visualPath] [outPath]
import { execFileSync } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import * as V from './lib/video.mjs';

const FF = 'C:\\Users\\Admin\\scoop\\shims\\ffmpeg.exe';
const here = dirname(fileURLToPath(import.meta.url));
const scenes = join(here, 'recordings', 'scenes');
const silent = process.argv[2] || join(here, '..', 'remotion-promo', 'out', 'promo-visual.mp4');
const narr = join(scenes, 'promo-narration.mp3');
const music = join(here, 'assets', 'promo-bed.mp3');
const mixed = join(scenes, 'promo-remotion-mixed.mp4');
const OUT = process.argv[3] || 'C:\\Users\\Admin\\Downloads\\globalcrm-promo.mp4';

const dur = V.duration(silent);
console.log(`visual ${dur.toFixed(2)}s, narration ${V.duration(narr).toFixed(2)}s`);
execFileSync(FF, ['-y', '-i', silent, '-i', narr, '-stream_loop', '-1', '-i', music,
  '-filter_complex',
  `[2:a]volume=0.30,atrim=0:${(dur + 3).toFixed(2)}[mus];[mus][1:a]sidechaincompress=threshold=0.045:ratio=9:attack=12:release=340[md];[1:a][md]amix=inputs=2:normalize=0,loudnorm=I=-14:TP=-1.5:LRA=11[a]`,
  '-map', '0:v', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest', mixed]);
V.holdAndFade(mixed, OUT, 0.3, 1.0);
console.log('DONE ->', OUT, V.duration(OUT).toFixed(2) + 's');
