// Recon capture: explore the CRM's AI / enrichment / chart screens to pick the
// best promo stills. Outputs to scripts/assets/recon/*.png
import { chromium } from 'playwright';
import { loadEnv } from './lib/env.mjs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync } from 'fs';

const env = loadEnv(new URL('../.env', import.meta.url));
const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, 'assets', 'recon');
mkdirSync(out, { recursive: true });
const BASE = 'https://globalcrm-sync.pages.dev';
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
const snap = async (page, name, settle = 2000) => { await page.waitForTimeout(settle); await page.mouse.move(2, 2); await page.waitForTimeout(300); await page.screenshot({ path: join(out, `${name}.png`) }); console.log('  shot', name); };

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: VP, deviceScaleFactor: 2 });
const page = await ctx.newPage();
await login(page);
console.log('logged in');

// Dashboard + AI tabs
await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle' });
await snap(page, 'dash_overview', 2800);
for (const [tab, name] of [['Agent Coaching', 'dash_coaching'], ['AI Caller', 'dash_ai_caller'], ['AI Agents', 'dash_ai_agents']]) {
  await page.getByRole('tab', { name: new RegExp(tab, 'i') }).click({ timeout: 6000 }).catch((e) => console.log('  tab miss', tab, e.message));
  await snap(page, name, 2600);
}

// Contact detail (a scored contact) + live Apollo enrichment
await page.goto(`${BASE}/contacts/c3ef186c-358e-44df-985d-3fec6c5c028c`, { waitUntil: 'networkidle' }).catch(() => {});
await snap(page, 'contact_before', 2400);
const enrichBtn = page.getByRole('button', { name: /Enrich with Apollo/i });
if (await enrichBtn.count()) {
  await enrichBtn.first().click().catch((e) => console.log('  enrich click', e.message));
  await page.waitForTimeout(9000); // let enrich-contact edge fn populate
  await snap(page, 'contact_enriched', 1500);
}

// Calendar + revenue + analytics AI insights
for (const [url, name] of [['/calendar', 'calendar'], ['/revenue-dashboard', 'revenue'], ['/reports', 'reports_hub']]) {
  await page.goto(`${BASE}${url}`, { waitUntil: 'networkidle' }).catch(() => {});
  await snap(page, name.replace('/', ''), 2600);
}
// Analytics AI Insights tab
await page.getByRole('tab', { name: /ai insights/i }).click({ timeout: 5000 }).catch(() => {});
await snap(page, 'reports_ai_insights', 2600);

await ctx.close(); await browser.close();
console.log('recon done ->', out);
