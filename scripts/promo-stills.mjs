// Capture crisp AI/enrichment/chart stills for the In-Sync CRM premium promo.
//   node scripts/promo-stills.mjs
import { chromium } from 'playwright';
import { loadEnv } from './lib/env.mjs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync } from 'fs';

const env = loadEnv(new URL('../.env', import.meta.url));
const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, 'assets', 'promo');
mkdirSync(out, { recursive: true });
const BASE = 'https://globalcrm-sync.pages.dev';
const HERO = '7f450dd0-d4a6-4b52-bd3f-9156cd1a056a'; // enriched hot lead (Rajendra · L&T)
const VP = { width: 1600, height: 1000 };

async function login(page) {
  for (let i = 0; i < 6; i++) {
    try {
      await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
      await page.locator('#email').fill(env.GC_ADMIN_EMAIL, { timeout: 25000 });
      await page.locator('#password').fill(env.GC_ADMIN_PASSWORD);
      await page.getByRole('button', { name: /^sign in$/i }).click();
      await page.waitForURL(/\/dashboard|\/platform-admin/, { timeout: 20000 });
      await page.waitForFunction(() => Object.keys(localStorage).some((k) => /sb-.*-auth-token/.test(k) && localStorage.getItem(k)), undefined, { timeout: 8000 });
      await page.waitForLoadState('networkidle').catch(() => {});
      return;
    } catch (e) { if (i === 5) throw e; await page.waitForTimeout(1500); }
  }
}
const shot = async (page, name, settle = 2400, extra) => {
  await page.waitForTimeout(settle);
  if (extra) await extra(page).catch((e) => console.log('  extra', name, e.message));
  await page.mouse.move(2, 2); await page.waitForTimeout(400);
  await page.screenshot({ path: join(out, `${name}.png`) }); console.log('  shot', name);
};

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: VP, deviceScaleFactor: 2 });
const page = await ctx.newPage();
await login(page);
console.log('logged in');

await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle' });
await shot(page, 'dashboard', 2800); // Overview: AI Key Learnings + Calls-by-Disposition chart
await shot(page, 'coaching', 500, async (p) => { await p.getByRole('tab', { name: /agent coaching/i }).click({ timeout: 6000 }); await p.waitForTimeout(2400); });
await shot(page, 'aicaller', 500, async (p) => { await p.getByRole('tab', { name: /ai caller/i }).click({ timeout: 6000 }); await p.waitForTimeout(2400); });

await page.goto(`${BASE}/contacts/${HERO}`, { waitUntil: 'networkidle' });
await shot(page, 'contact', 2800); // enriched hot lead: lead score 92 + enriched fields + journey

await page.goto(`${BASE}/pipeline`, { waitUntil: 'networkidle' });
await shot(page, 'pipeline', 2600);

await page.goto(`${BASE}/reports`, { waitUntil: 'networkidle' });
await shot(page, 'insights', 500, async (p) => { await p.getByRole('tab', { name: /ai insights/i }).click({ timeout: 6000 }); await p.waitForTimeout(2600); });

await page.goto(`${BASE}/calendar`, { waitUntil: 'networkidle' });
await shot(page, 'calendar', 2400);

await ctx.close(); await browser.close();
console.log('done ->', out);
