// Shared scene runner (continuous-narration mode): pre-auth -> record video to
// a slot of the single master audio track -> trim boot lead -> encode.
import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { loadEnv } from './env.mjs';
import * as V from './video.mjs';
import { installCursor } from './cursor.mjs';
import { login } from './app.mjs';

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'recordings', 'scenes');
const env = loadEnv(new URL('../../../.env', import.meta.url));
const VP = { width: 1366, height: 768 };
const PHONE = { width: 390, height: 844 };

export const ACCT = {
  admin: { email: env.GC_ADMIN_EMAIL, password: env.GC_ADMIN_PASSWORD },   // manager + leadership
  agent: { email: env.GC_AGENT_EMAIL, password: env.GC_AGENT_PASSWORD },   // BD executive (Priya)
  guest: { guest: true },
};

export async function recordSceneVideo({ scene, slotStart, slotDuration, localFind, tailT = 0.5 }) {
  const browser = await chromium.launch({ headless: true });
  const recVP = scene.mobile ? PHONE : (scene.viewport || VP);
  let storageState;
  if (!scene.account.guest) {
    const a = await browser.newContext({ viewport: VP });
    const ap = await a.newPage();
    await login(ap, scene.account.email, scene.account.password);
    storageState = await a.storageState();
    await a.close();
  }
  const ctx = await browser.newContext({
    viewport: recVP, storageState,
    timezoneId: 'Asia/Kolkata', locale: 'en-IN', // deterministic "today" regardless of host
    ...(scene.mobile ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}),
    recordVideo: { dir: outDir, size: recVP },
  });
  const page = await ctx.newPage();
  let leadSec = 0, tBeats = 0;
  const t0 = Date.now();
  const ready = async (extra = 300) => {
    await page.waitForTimeout(extra);
    leadSec = (Date.now() - t0) / 1000;
    await installCursor(page);
    tBeats = Date.now();
    return async (s) => { const e = (Date.now() - tBeats) / 1000; if (e < s) await page.waitForTimeout((s - e) * 1000); };
  };
  const at = (phrase, fb, off = 0) => {
    const g = localFind(phrase);
    const local = g == null ? fb : g - slotStart;
    return Math.max(0, local) + off;
  };
  const D = slotDuration + tailT;
  try { await scene.beats({ page, find: localFind, at, D, ready }); }
  catch (e) { console.log(`[${scene.name}] beats error: ${e.message.split('\n')[0]}`); }
  await ctx.close();
  await browser.close();

  const webm = await page.video().path();
  const mp4 = join(outDir, `${scene.name}-v.mp4`);
  if (scene.mobile) V.webmToMp4Phone(webm, mp4, leadSec, D);
  else V.webmToMp4(webm, mp4, leadSec, D);
  console.log(`[${scene.name}] video ${D.toFixed(2)}s (lead ${leadSec.toFixed(2)})${scene.mobile ? ' [mobile]' : ''}`);
  return mp4;
}
