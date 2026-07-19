// In-Sync CRM teaser v3 — "buyer-question" cut, TWO orientations.
//   node scripts/walkthrough/render-teaser3.mjs   (FRESH_NARRATION=1 / FRESH_VIDEO=1)
// Outputs:
//   C:\Users\Admin\Downloads\globalcrm-teaser.mp4         (1920x1080)
//   C:\Users\Admin\Downloads\globalcrm-teaser-mobile.mp4  (1080x1920)
//
// Story spine (teaser-v3 spec, ATS template; screenplay in
// Downloads\globalcrm-teaser-screenplay.md):
//   problem card -> coverage montage -> 3 differentiators on Aarav Mehta
//   (form capture -> AI call in writing -> one scored timeline) ->
//   outcome-numbers card -> demo CTA.
// All app footage is freshly recorded against the live app inside rounded
// proof windows on the brand canvas — never full-bleed.
// DO NOT run seed-walkthrough here (non-idempotent) — state is already seeded.
import { chromium } from 'playwright';
import { readFileSync, existsSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { execFileSync } from 'child_process';
import { BASE } from './lib/app.mjs';
import { ACCT, recordSceneVideo } from './lib/scene.mjs';
import { synthTimed } from './lib/voice.mjs';
import * as V from './lib/video.mjs';
import { crossfadeStitchVideo, overlayAudio, holdAndFade } from './lib/video.mjs';
import { ring, removeAnn, zoomTo, zoomReset } from './lib/annotate.mjs';
import { clickLocator, typeInto } from './lib/cursor.mjs';
import { deleteFormLead } from './lib/db.mjs';

const FF = 'C:\\Users\\Admin\\scoop\\shims\\ffmpeg.exe';
const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, 'recordings', 'scenes');
const T_X = 0.4;
const HD = { width: 1920, height: 1080 };

const AARAV = 'aa000001-0000-4000-8000-000000000001';
const FORM = 'ff000001-0000-4000-8000-000000000001';
const LEAD_EMAIL = 'aarav.mehta@northwindlogistics.in';

const LOGO = 'data:image/png;base64,' +
  readFileSync(join(here, 'recordings', 'insync-logo-band.png')).toString('base64');

// ── The 7 narration blocks ────────────────────────────────────────────────────
const NARR = {
  n0: "A lead rarely dies from a 'no' — it dies from no follow-up. Enquiries land on calls, WhatsApp, and web forms, then sit in a spreadsheet nobody updates. Lose one follow-up a day and competitors take twenty conversations a month. In-Sync CRM runs the chase.",
  n1: "One platform runs the whole sale — the command center, the pipeline, AI calling, and pipeline insights.",
  n2a: "One — leads capture themselves. Aarav clicks your ad and submits the form, and he's on your board — enriched, assigned, nobody typing.",
  n2b: "Two — the follow-up runs itself. The AI calls Aarav, holds a real conversation, and books the demo — recorded, transcribed, summarised in writing.",
  n2c: "Three — nothing stays hidden. Every call and reply sits on one timeline, and the AI scores who is warm — so the next hour goes to the right lead.",
  n3: "The chase stops eating the day. Leads land themselves. Follow-up runs until the demo is on the calendar. The Monday status hunt becomes one look at the board. Seven ninety-nine per user a month, fourteen days free.",
  n4: "In-Sync CRM. Book a free demo — we'll run it on your own leads.",
};
const ORDER = ['n0', 'n1', 'n2a', 'n2b', 'n2c', 'n3', 'n4'];

// ── 1. narration ──────────────────────────────────────────────────────────────
const SEP = ' ';
const fullText = ORDER.map((k) => NARR[k]).join(SEP);
const mp3Path = join(dir, 'teaser3-narration.mp3');
const alignPath = join(dir, 'teaser3-align.json');
let Taud;
if (process.env.FRESH_NARRATION !== '1' && existsSync(mp3Path) && existsSync(alignPath)) {
  const c = JSON.parse(readFileSync(alignPath, 'utf8'));
  if (c.text === fullText) {
    console.log('Reusing cached narration.');
    Taud = { duration: c.duration, joined: c.joined, starts: c.starts, ends: c.ends,
      timeAtChar: (i) => c.starts[Math.max(0, Math.min(i, c.starts.length - 1))] };
  }
}
if (!Taud) {
  console.log(`Synthesizing narration (${fullText.length} chars, 1.1x)...`);
  Taud = await synthTimed(fullText, mp3Path, { speed: 1.1 });
  writeFileSync(alignPath, JSON.stringify({ text: fullText, duration: Taud.duration, joined: Taud.joined, starts: Taud.starts, ends: Taud.ends }));
}
console.log(`Narration ${Taud.duration.toFixed(1)}s`);
if (Taud.duration > 78) throw new Error(`narration ballooned (${Taud.duration.toFixed(1)}s > 78s) — trim or re-take`);

let offset = 0;
const slots = {};
for (let i = 0; i < ORDER.length; i++) {
  const k = ORDER[i];
  const charStart = offset, charEnd = offset + NARR[k].length;
  const nextOffset = charEnd + SEP.length;
  const start = Taud.timeAtChar(charStart);
  const end = i < ORDER.length - 1 ? Taud.timeAtChar(nextOffset) : Taud.duration;
  offset = nextOffset;
  const localFind = (phrase) => { const j = Taud.joined.indexOf(phrase.toLowerCase(), charStart); return (j < 0 || j >= charEnd) ? null : Taud.starts[j]; };
  slots[k] = { start, duration: end - start, localFind };
}

// ── 2. PASS A — raw live clips (recorded once, reused by both orientations) ───
const RAW = [
  { name: 'g-cov-command', account: ACCT.admin, seconds: 4, beats: async ({ page, D, ready }) => {
      await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle' });
      await page.getByText('Dashboard').first().waitFor({ timeout: 20000 });
      const waitUntil = await ready(600);
      await page.evaluate(() => window.scrollBy({ top: 60, behavior: 'smooth' })).catch(() => {});
      await waitUntil(D);
    } },
  // July live state is sparse (June walkthrough richness is gone) — these two
  // flashes and all three proofs slice the June expert-demo recordings instead.
  { name: 'g-cov-pipeline', slice: { src: 'd14-board-v.mp4', from: 6 }, seconds: 4 },
  { name: 'g-cov-calling', slice: { src: 'd09-aidialer-v.mp4', from: 14 }, seconds: 4 },
  { name: 'g-cov-insights', account: ACCT.admin, seconds: 4, beats: async ({ page, D, ready }) => {
      await page.goto(`${BASE}/reports`, { waitUntil: 'networkidle' });
      await page.getByText(/Insights Hub/i).first().waitFor({ timeout: 20000 }).catch(() => {});
      await clickLocator(page, page.getByRole('tab', { name: /AI Insights/i }).first()).catch(() => {});
      const waitUntil = await ready(600);
      await waitUntil(D);
    } },
  // proof 1 — Aarav's form fills, and he lands on the board ringed green.
  // Two cuts of d03 spliced (the middle is a loading spinner): fill+submit,
  // then the board reveal.
  { name: 'g-p1-capture', concat: [
      { src: 'd03-forms-v.mp4', from: 4.5, dur: 5.5 },
      { src: 'd03-forms-v.mp4', from: 21.5 },
    ], slot: 'n2a' },
  // proof 2 — the AI's call with Aarav: Call Analysis dialog, ringed summary
  { name: 'g-p2-chase', slice: { src: 'd10-callproof-v.mp4', from: 13 }, slot: 'n2b' },
  // proof 3 — one timeline (WhatsApp read receipts) + Lead Score 78 WARM ringed
  { name: 'g-p3-visible', slice: { src: 'd12-score-v.mp4', from: 5.3 }, slot: 'n2c' },
];

const probeDur = (p) => parseFloat(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', p]).toString().trim());

for (const r of RAW) {
  const out = join(dir, `${r.name}-v.mp4`);
  const secs = r.slot ? slots[r.slot].duration : r.seconds;
  const need = secs + (r.slot ? T_X : 0);
  if (r.slice) {
    const src = join(dir, r.slice.src);
    const from = Math.max(0, Math.min(r.slice.from, probeDur(src) - need));
    V.webmToMp4(src, out, from, need);
    console.log(`[${r.name}] slice ${r.slice.src} @${from.toFixed(1)}s for ${need.toFixed(2)}s`);
    continue;
  }
  if (r.concat) {
    const [a, b] = r.concat;
    const durA = Math.min(a.dur, need - 1);
    const durB = need - durA;
    const srcA = join(dir, a.src), srcB = join(dir, b.src);
    const fromB = Math.max(0, Math.min(b.from, probeDur(srcB) - durB));
    execFileSync(FF, ['-y', '-ss', String(a.from), '-t', String(durA), '-i', srcA,
      '-ss', String(fromB), '-t', String(durB.toFixed(3)), '-i', srcB,
      '-filter_complex', '[0:v][1:v]concat=n=2:v=1:a=0[v]', '-map', '[v]',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-r', '30', '-movflags', '+faststart', out]);
    console.log(`[${r.name}] splice ${a.src} @${a.from}+${durA}s | @${fromB.toFixed(1)}+${durB.toFixed(1)}s`);
    continue;
  }
  if (process.env.FRESH_VIDEO !== '1' && existsSync(out)) {
    try {
      const d = probeDur(out);
      if (isFinite(d) && Math.abs(d - need) < 0.5) { console.log(`[${r.name}] reuse cached`); continue; }
    } catch {}
  }
  let ok = false, lastErr;
  for (let a = 0; a < 3 && !ok; a++) {
    try {
      await recordSceneVideo({
        scene: { name: r.name, account: r.account, viewport: HD, beats: r.beats },
        slotStart: r.slot ? slots[r.slot].start : 0,
        slotDuration: secs,
        localFind: r.slot ? slots[r.slot].localFind : (() => null),
        tailT: r.slot ? T_X : 0,
      });
      ok = true;
    } catch (e) { lastErr = e; console.log(`[${r.name}] attempt ${a + 1} failed: ${e.message.split('\n')[0]}`); }
  }
  if (!ok) throw new Error(`raw clip ${r.name} failed: ${lastErr?.message}`);
}

const b64 = (name) => 'data:video/mp4;base64,' + readFileSync(join(dir, `${name}-v.mp4`)).toString('base64');

// ── 3. PASS B — canvas scenes per orientation (navy-teal brand canvas) ────────
const CANVAS_BG = `background:
  radial-gradient(900px 500px at 15% -10%,rgba(13,148,136,.25),transparent 60%),
  radial-gradient(800px 500px at 95% 115%,rgba(124,58,237,.16),transparent 55%),
  linear-gradient(135deg,#0a1120 0%,#0e2433 55%,#10393f 100%)`;

const baseCss = (o) => `
  *{margin:0;padding:0;box-sizing:border-box}html,body{height:100%}
  body{font-family:'Segoe UI',Arial,sans-serif;color:#e7f4f2;overflow:hidden;${CANVAS_BG}}
  .wrap{height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:${o === 'tall' ? '60px 44px 200px' : '56px'}}
  .logocard{background:#fff;border-radius:20px;padding:${o === 'tall' ? '20px 34px' : '16px 28px'};box-shadow:0 14px 40px rgba(0,0,0,.35)}
  .logocard img{height:${o === 'tall' ? 108 : 82}px;width:auto;display:block}
  .kicker{color:#2dd4bf;font-weight:800;font-size:${o === 'tall' ? 26 : 22}px;letter-spacing:2.5px;text-transform:uppercase}
  h1{font-weight:800;letter-spacing:-.02em;line-height:1.1;font-size:${o === 'tall' ? 66 : 64}px}
  h1 .g{color:#2dd4bf}
  .sub{color:#9fc4bd;font-size:${o === 'tall' ? 30 : 26}px;line-height:1.45}
  .chip{display:inline-block;background:rgba(45,212,191,.12);border:1px solid rgba(45,212,191,.4);border-radius:999px;
    padding:${o === 'tall' ? '14px 30px' : '10px 24px'};font-size:${o === 'tall' ? 28 : 22}px;font-weight:700;color:#99f6e4}
  .frame{border-radius:18px;overflow:hidden;box-shadow:0 30px 80px rgba(0,0,0,.55);border:1px solid rgba(255,255,255,.14);
    width:${o === 'tall' ? '94%' : '76%'};position:relative;background:#0a1120}
  .crop{overflow:hidden;width:100%;aspect-ratio:16/9}
  .crop video{display:block;width:100%;height:100%;object-fit:cover}
  .grid{display:grid;grid-template-columns:1fr 1fr;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);border-radius:16px;overflow:hidden;text-align:left}
  .grid .l{font-size:${o === 'tall' ? 26 : 21}px;color:rgba(255,255,255,.55);padding:${o === 'tall' ? '18px 22px' : '14px 24px'};display:flex;align-items:center;justify-content:flex-end;text-align:right}
  .grid .r{font-size:${o === 'tall' ? 26 : 21}px;font-weight:600;color:#5eead4;padding:${o === 'tall' ? '18px 22px' : '14px 24px'};border-left:1px solid rgba(255,255,255,.15);display:flex;align-items:center}
  .cta{display:inline-block;background:linear-gradient(135deg,#0d9488,#0891b2);color:#fff;font-weight:700;
    font-size:${o === 'tall' ? 34 : 28}px;padding:${o === 'tall' ? '24px 52px' : '18px 42px'};border-radius:999px;box-shadow:0 12px 30px rgba(13,148,136,.4)}
  .gap-s{margin-top:18px}.gap-m{margin-top:28px}.gap-l{margin-top:38px}
`;

const page5 = (o, inner, script = '') => `<!doctype html><html><head><meta charset="utf-8"><style>${baseCss(o)}</style></head>
<body><div class="wrap">${inner}</div><script>${script}</script></body></html>`;

function cardProblem(o) {
  return page5(o, `
    <div class="logocard"><img src="${LOGO}"/></div>
    <div class="kicker gap-l">In-Sync CRM &middot; Sales CRM</div>
    <h1 class="gap-m">Leads don&rsquo;t die from &lsquo;no&rsquo;.<br>They die from <span class="g">no follow-up.</span></h1>
    <div class="sub gap-m">Calls &middot; WhatsApp &middot; web forms &rarr; an Excel sheet nobody updates.</div>
    <div class="chip gap-m">1 slipped follow-up a day &asymp; 20+ conversations a month, gone</div>`);
}

function cardCoverage(o, perSec) {
  const labels = ['Command Center', 'Pipeline', 'AI Calling', 'AI Insights'];
  const vids = ['g-cov-command', 'g-cov-pipeline', 'g-cov-calling', 'g-cov-insights']
    .map((n, i) => `<video muted playsinline preload="auto" src="${b64(n)}" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;transform:scale(1.15);opacity:${i === 0 ? 1 : 0};transition:opacity .3s"></video>`)
    .join('');
  return page5(o, `
    <div class="kicker">One platform &middot; the whole sale</div>
    <div class="frame gap-m"><div class="crop" style="aspect-ratio:16/9;position:relative">${vids}</div></div>
    <div class="chip gap-m" id="lab">${labels[0]}</div>`, `
    window.__start = () => {
      const vids=[...document.querySelectorAll('video')], lab=document.getElementById('lab');
      const labels=${JSON.stringify(labels)};
      const show=(k)=>{vids.forEach((v,j)=>{v.style.opacity=j===k?1:0; if(j===k){try{v.currentTime=0;v.play();}catch(e){}}else{try{v.pause();}catch(e){}}}); lab.textContent=labels[k];};
      show(0); let i=0;
      const iv=setInterval(()=>{i++; if(i>=4){clearInterval(iv);return;} show(i);}, ${Math.max(1.2, perSec).toFixed(2)}*1000);
    };`);
}

function cardProof(o, clipName, label, fx) {
  const f = (fx && fx[o]) || (o === 'tall' ? { s: 1.4, x: 0, y: 0 } : { s: 1, x: 0, y: 0 });
  const style = `transform:scale(${f.s}) translate(${f.x}%,${f.y}%)`;
  return page5(o, `
    <div class="chip">${label}</div>
    <div class="frame gap-m"><div class="crop"><video muted playsinline preload="auto" style="${style}" src="${b64(clipName)}"></video></div></div>`, `
    window.__start = () => { const v=document.querySelector('video'); try{v.play();}catch(e){} };`);
}

function cardNumbers(o) {
  return page5(o, `
    <div class="kicker">The chase stops eating the day</div>
    <div class="grid gap-m">
      <div class="l">Lead capture</div><div class="r">Typed from five inboxes &rarr; lands itself, enriched</div>
      <div class="l">Follow-up</div><div class="r">Slips on busy days &rarr; runs till the demo books</div>
      <div class="l">Pipeline review</div><div class="r">An hour of screenshot-hunting &rarr; one AI-scored board</div>
    </div>
    <div class="sub gap-m" style="color:#e7f4f2;font-weight:600">&#8377;799 per user / month &middot; 14-day free trial</div>`);
}

function cardCta(o) {
  return page5(o, `
    <div class="logocard"><img src="${LOGO}"/></div>
    <h1 class="gap-l" style="font-size:${o === 'tall' ? 58 : 56}px">It runs the chase.<br><span class="g">Your team closes.</span></h1>
    <div class="cta gap-l">Book your free demo &rarr;</div>
    <div class="sub gap-m" style="font-size:${o === 'tall' ? 24 : 20}px">In-Sync CRM &middot; in-sync.co.in</div>`);
}

async function recordCanvas({ name, html, seconds, vp }) {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: vp, recordVideo: { dir, size: vp } });
  const page = await ctx.newPage();
  const t0 = Date.now();
  await page.setContent(html, { waitUntil: 'load' });
  await page.evaluate(() => Promise.all([...document.querySelectorAll('video')].map((v) =>
    v.readyState >= 3 ? 1 : new Promise((res) => { v.addEventListener('canplaythrough', res, { once: true }); v.addEventListener('error', res, { once: true }); })
  ))).catch(() => {});
  await page.waitForTimeout(250);
  const leadSec = (Date.now() - t0) / 1000;
  await page.evaluate(() => window.__start && window.__start()).catch(() => {});
  await page.waitForTimeout(seconds * 1000);
  await ctx.close(); await browser.close();
  const webm = await page.video().path();
  const mp4 = join(dir, `${name}-v.mp4`);
  V.webmToMp4(webm, mp4, leadSec, seconds);
  console.log(`[${name}] canvas ${seconds.toFixed(2)}s`);
  return mp4;
}

const ORIENTS = [
  { key: 'wide', vp: { width: 1920, height: 1080 }, out: 'C:\\Users\\Admin\\Downloads\\globalcrm-teaser.mp4', subStyle: "FontName=Segoe UI,FontSize=17,Bold=1,BorderStyle=1,Outline=2,Shadow=0,OutlineColour=&H96000000,PrimaryColour=&H00FFFFFF,MarginV=40" },
  // Portrait note: libass scales FontSize/margins against PlayResY=288 — tiny values.
  { key: 'tall', vp: { width: 1080, height: 1920 }, out: 'C:\\Users\\Admin\\Downloads\\globalcrm-teaser-mobile.mp4', subStyle: "FontName=Segoe UI,FontSize=7,Bold=1,BorderStyle=1,Outline=1,Shadow=0,OutlineColour=&H96000000,PrimaryColour=&H00FFFFFF,MarginV=20" },
];

const srtTime = (t) => {
  const ms = Math.max(0, Math.round(t * 1000));
  const h = String(Math.floor(ms / 3600000)).padStart(2, '0');
  const m = String(Math.floor((ms % 3600000) / 60000)).padStart(2, '0');
  const s = String(Math.floor((ms % 60000) / 1000)).padStart(2, '0');
  return `${h}:${m}:${s},${String(ms % 1000).padStart(3, '0')}`;
};
const cues = [];
let cursor = 0;
for (const k of ORDER) {
  for (const raw of NARR[k].split(/(?<=[.!?])\s+/)) {
    const line = raw.trim();
    if (!line) continue;
    const j = Taud.joined.indexOf(line.toLowerCase().slice(0, Math.min(24, line.length)), cursor);
    if (j < 0) continue;
    const start = Taud.timeAtChar(j);
    const end = Taud.timeAtChar(j + line.length - 1) + 0.25;
    cues.push(`${cues.length + 1}\n${srtTime(start)} --> ${srtTime(end)}\n${line}\n`);
    cursor = j + line.length;
  }
}
writeFileSync(join(dir, 'teaser3-subs.srt'), cues.join('\n'), 'utf8');
console.log(`${cues.length} subtitle cues`);

for (const O of ORIENTS) {
  console.log(`\n=== ${O.key} (${O.vp.width}x${O.vp.height}) ===`);
  const covPer = slots.n1.duration / 4;
  const sceneDefs = [
    { k: 'n0', html: cardProblem(O.key) },
    { k: 'n1', html: cardCoverage(O.key, covPer) },
    // scale ≥1.15 keeps the June walkthrough's chapter pills (top 5% of frame)
    // cropped out of the proof windows.
    { k: 'n2a', html: cardProof(O.key, 'g-p1-capture', '1 &middot; Leads capture themselves', { wide: { s: 1.16, x: 0, y: 0 }, tall: { s: 1.5, x: 0, y: 0 } }) },
    { k: 'n2b', html: cardProof(O.key, 'g-p2-chase', '2 &middot; Follow-up runs itself', { wide: { s: 1.16, x: 0, y: 0 }, tall: { s: 1.5, x: 0, y: 0 } }) },
    { k: 'n2c', html: cardProof(O.key, 'g-p3-visible', '3 &middot; Nothing stays hidden', { wide: { s: 1.16, x: 0, y: 0 }, tall: { s: 1.5, x: 0, y: 0 } }) },
    { k: 'n3', html: cardNumbers(O.key) },
    { k: 'n4', html: cardCta(O.key) },
  ];
  const clips = [];
  for (const sd of sceneDefs) {
    clips.push(await recordCanvas({ name: `c-${sd.k}-${O.key}`, html: sd.html, seconds: slots[sd.k].duration + T_X, vp: O.vp }));
  }
  const silent = join(dir, `teaser3-${O.key}-silent.mp4`);
  crossfadeStitchVideo(clips, silent, T_X);
  const narrated = join(dir, `teaser3-${O.key}-narrated.mp4`);
  overlayAudio(silent, mp3Path, narrated);
  execFileSync(FF, ['-y', '-i', `teaser3-${O.key}-narrated.mp4`,
    '-vf', `subtitles=teaser3-subs.srt:force_style='${O.subStyle}'`,
    '-af', 'loudnorm=I=-14:TP=-1.5:LRA=11',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-r', '30', '-c:a', 'aac', '-b:a', '192k',
    '-movflags', '+faststart', `teaser3-${O.key}-styled.mp4`], { cwd: dir });
  holdAndFade(join(dir, `teaser3-${O.key}-styled.mp4`), O.out, 2.0, 1.0);
  console.log('DONE ->', O.out);
}
