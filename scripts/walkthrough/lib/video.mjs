// ffmpeg/ffprobe helpers (scoop install).
import { execFileSync } from 'child_process';

const FF = 'C:\\Users\\Admin\\scoop\\shims\\ffmpeg.exe';
const FP = 'C:\\Users\\Admin\\scoop\\shims\\ffprobe.exe';

export function duration(path) {
  return parseFloat(
    execFileSync(FP, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path])
      .toString().trim(),
  );
}

export function webmToMp4(src, dst, ss = 0, dur = null) {
  const args = ['-y'];
  if (ss > 0) args.push('-ss', String(ss));
  args.push('-i', src);
  if (dur) args.push('-t', String(dur));
  args.push('-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-r', '30', '-movflags', '+faststart', dst);
  execFileSync(FF, args);
  return dst;
}

export function webmToMp4Phone(src, dst, ss = 0, dur = null, { screenH = 712, bg = '0x0b1220', bezel = '0x0e1726' } = {}) {
  const args = ['-y'];
  if (ss > 0) args.push('-ss', String(ss));
  args.push('-i', src);
  if (dur) args.push('-t', String(dur));
  const vf = `scale=-2:${screenH},pad=iw+14:ih+14:7:7:color=${bezel},pad=1366:768:(1366-iw)/2:(768-ih)/2:color=${bg}`;
  args.push('-vf', vf, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-r', '30', '-movflags', '+faststart', dst);
  execFileSync(FF, args);
  return dst;
}

export function crossfadeStitchVideo(paths, out, T = 0.5) {
  const durs = paths.map((p) => duration(p));
  const args = ['-y'];
  paths.forEach((p) => args.push('-i', p));
  const filter = [];
  let prevV = '[0:v]';
  let cum = durs[0];
  for (let i = 1; i < paths.length; i++) {
    const last = i === paths.length - 1;
    const vo = last ? '[vout]' : `[v${i}]`;
    filter.push(`${prevV}[${i}:v]xfade=transition=fade:duration=${T}:offset=${(cum - T).toFixed(3)}${vo}`);
    prevV = vo;
    cum = cum + durs[i] - T;
  }
  args.push('-filter_complex', filter.join(';'), '-map', '[vout]', '-an',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-r', '30', '-movflags', '+faststart', out);
  execFileSync(FF, args, { maxBuffer: 1024 * 1024 * 64 });
  return out;
}

export function overlayAudio(video, audio, out) {
  const ad = duration(audio);
  execFileSync(FF, ['-y', '-i', video, '-i', audio, '-map', '0:v:0', '-map', '1:a:0',
    '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-t', String(ad), '-movflags', '+faststart', out]);
  return out;
}

export function holdAndFade(src, dst, hold = 2.0, fade = 1.2) {
  const d0 = duration(src);
  const total = d0 + hold;
  const st = (total - fade).toFixed(2);
  const vf = `tpad=stop_mode=clone:stop_duration=${hold},fade=t=out:st=${st}:d=${fade}`;
  const af = `apad=pad_dur=${hold},afade=t=out:st=${st}:d=${fade}`;
  execFileSync(FF, ['-y', '-i', src, '-vf', vf, '-af', af,
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-r', '30', '-c:a', 'aac', '-b:a', '192k',
    '-movflags', '+faststart', dst]);
  return dst;
}
