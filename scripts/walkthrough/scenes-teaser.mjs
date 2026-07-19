// In-Sync CRM 60-second TEASER — v3 "1 main + 3 subsets".
// Core message (founder-set structure, 2026-07-19): ONE main message, THREE
// subsets, nothing else. Viewer must leave knowing WHAT it does and HOW.
//   MAIN    — the sales CRM that runs the chase: it follows up, your team closes.
//   SUBSET 1 — leads capture themselves (ad → form → pipeline, zero typing)
//   SUBSET 2 — follow-up runs itself (instant ack, AI calls + reminders → demo)
//   SUBSET 3 — nothing stays hidden (calls captured, one AI-scored board)
// Arc: hook card names pain + product up front (no cold open), three numbered
// chapters — one per subset — close card restates main + the three subsets.
// Humans stay in the deciding seat throughout; AI is the plumbing, never the star.
// Slices reuse the expert demo's recordings (render-demo must have run).
import { ACCT } from './lib/scene.mjs';
import { BASE } from './lib/app.mjs';
import { ring, removeAnn } from './lib/annotate.mjs';
import { clickLocator, typeInto } from './lib/cursor.mjs';
import { deleteFormLead } from './lib/db.mjs';

const FORM = 'ff000001-0000-4000-8000-000000000001';
const HD = { width: 1920, height: 1080 };

const cardShell = (inner) => `(() => {
  const st = document.createElement('style'); st.textContent = '#__cur{display:none !important}';
  document.documentElement.appendChild(st);
  const c = document.createElement('div');
  c.style.cssText='position:fixed;inset:0;z-index:2147483600;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;background:radial-gradient(120% 120% at 20% 0%,#101c3a 0%,#0b1220 55%,#060a14 100%);padding:0 8%';
  c.innerHTML = ${JSON.stringify('')} + ${inner};
  document.documentElement.appendChild(c);
})()`;

const hookCard = cardShell(`
    "<div style=\\"font:700 19px 'Segoe UI',sans-serif;color:#5eead4;letter-spacing:3px;text-transform:uppercase\\">In-Sync CRM &middot; Sales CRM</div>"+
    "<div style=\\"font:800 62px 'Segoe UI',sans-serif;color:#fff;letter-spacing:-1.5px;line-height:1.15;max-width:86%;margin-top:22px\\">Leads don&rsquo;t die from &lsquo;no&rsquo;.<br>They die from no follow-up.</div>"+
    "<div style=\\"font:400 26px 'Segoe UI',sans-serif;color:rgba(255,255,255,.75);margin-top:26px\\">The CRM that runs the chase &mdash; so your team just closes.</div>"
`);

const closeCard = cardShell(`
    "<div style=\\"font:700 19px 'Segoe UI',sans-serif;color:#5eead4;letter-spacing:3px;text-transform:uppercase\\">In-Sync CRM</div>"+
    "<div style=\\"font:800 60px 'Segoe UI',sans-serif;color:#fff;letter-spacing:-1.5px;line-height:1.15;max-width:84%;margin-top:18px\\">It chases.<br>You close.</div>"+
    "<div style=\\"display:grid;grid-template-columns:1fr 1fr;margin-top:34px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.12);border-radius:16px;overflow:hidden\\">"+
      "<div style=\\"font:400 22px 'Segoe UI',sans-serif;color:rgba(255,255,255,.5);padding:12px 24px;text-align:right;display:flex;align-items:center;justify-content:flex-end\\">Leads typed in by hand</div>"+
      "<div style=\\"font:600 22px 'Segoe UI',sans-serif;color:#7fd18c;padding:12px 24px;text-align:left;border-left:1px solid rgba(255,255,255,.15);display:flex;align-items:center\\">They capture themselves</div>"+
      "<div style=\\"font:400 22px 'Segoe UI',sans-serif;color:rgba(255,255,255,.5);padding:12px 24px;text-align:right;display:flex;align-items:center;justify-content:flex-end\\">Follow-ups slip on busy days</div>"+
      "<div style=\\"font:600 22px 'Segoe UI',sans-serif;color:#7fd18c;padding:12px 24px;text-align:left;border-left:1px solid rgba(255,255,255,.15);display:flex;align-items:center\\">They run themselves &middot; AI calls \\u20B93/min</div>"+
      "<div style=\\"font:400 22px 'Segoe UI',sans-serif;color:rgba(255,255,255,.5);padding:12px 24px;text-align:right;display:flex;align-items:center;justify-content:flex-end\\">Pipeline lives in people&rsquo;s heads</div>"+
      "<div style=\\"font:600 22px 'Segoe UI',sans-serif;color:#7fd18c;padding:12px 24px;text-align:left;border-left:1px solid rgba(255,255,255,.15);display:flex;align-items:center\\">One board, AI-scored</div>"+
    "</div>"+
    "<div style=\\"font:600 24px 'Segoe UI',sans-serif;color:rgba(255,255,255,.9);margin-top:32px\\">\\u20B9799/user/month \\u00B7 14-day free trial</div>"+
    "<div style=\\"font:500 26px 'Segoe UI',sans-serif;color:rgba(255,255,255,.85);margin-top:12px\\">Book a free demo &mdash; live on your own leads &middot; in-sync.co.in</div>"
`);

export const SCENES = [

// 0 — HOOK: name the pain and the product before anything else
{
  name: 'v0-hook', account: ACCT.guest, viewport: HD,
  narration: "Leads rarely die from a 'no'. They die from no follow-up. In-Sync CRM is the sales CRM that runs the chase for you.",
  beats: async ({ page, D, ready }) => {
    await page.goto('about:blank').catch(() => {});
    await page.evaluate(hookCard);
    const waitUntil = await ready(250);
    await waitUntil(D);
  },
},

// 1a — SUBSET 1: leads capture themselves (the form fills)
{
  name: 'v1a-form', account: ACCT.admin, viewport: HD,
  narration: "One — leads capture themselves. A click on your ad, the form goes in —",
  beats: async ({ page, at, D, ready }) => {
    const LEAD_EMAIL = 'aarav.mehta@northwindlogistics.in';
    await deleteFormLead(LEAD_EMAIL).catch(() => {});
    await page.goto(`${BASE}/form/${FORM}`, { waitUntil: 'networkidle' });
    await page.getByText(/Get a Demo/i).first().waitFor({ timeout: 20000 }).catch(() => {});
    const waitUntil = await ready(600);
    const fast = { moveDur: 260, perChar: 16, settle: 60 };
    await typeInto(page, page.locator('#first_name'), 'Aarav', fast).catch(() => {});
    await typeInto(page, page.locator('#last_name'), 'Mehta', fast).catch(() => {});
    await typeInto(page, page.locator('#email'), LEAD_EMAIL, fast).catch(() => {});
    await waitUntil(Math.min(at('goes in', 4, -0.3), D - 2.2));
    await clickLocator(page, page.getByRole('button', { name: /Submit Form/i }), { dur: 450 }).catch(() => {});
    await page.getByText(/Thank You/i).first().waitFor({ timeout: 12000 }).catch(() => {});
    await waitUntil(D);
    // no cleanup — next scene reveals this lead on the pipeline
  },
},

// 1b — …and it's on the board. Zero typing.
{
  name: 'v1b-pipeline', account: ACCT.admin, viewport: HD,
  narration: "— and it's on your board. No typing, no spreadsheet.",
  beats: async ({ page, D, ready }) => {
    const LEAD_EMAIL = 'aarav.mehta@northwindlogistics.in';
    await page.goto(`${BASE}/pipeline`, { waitUntil: 'domcontentloaded' });
    const nameEl = page.getByText('Aarav Mehta').first();
    await nameEl.waitFor({ timeout: 20000 }).catch(() => {});
    await nameEl.scrollIntoViewIfNeeded().catch(() => {});
    const waitUntil = await ready(400);
    const r = await ring(page, nameEl, { label: 'Captured — zero typing', accent: '#16a34a' }).catch(() => null);
    await waitUntil(D - 0.4);
    if (r) await removeAnn(page, r);
    await waitUntil(D);
    await deleteFormLead(LEAD_EMAIL).catch(() => {});
  },
},

// 2a — SUBSET 2: follow-up runs itself (slice: journey receipts)
{
  name: 'v2a-ack', slice: { src: 'd11-responses-v.mp4', from: 3.5 },
  narration: "Two — follow-up runs itself. The first reply lands in seconds: WhatsApp, email, even an AI call.",
},

// 2b — …and it keeps going until the demo books (slice: demo booked)
{
  name: 'v2b-booked', slice: { src: 'd13-booked-v.mp4', from: 2 },
  narration: "Reminders and scheduled AI calls keep at it — until the demo is on the calendar.",
},

// 3a — SUBSET 3: nothing stays hidden (slice: call analysis dialog)
{
  name: 'v3a-callproof', slice: { src: 'd10-callproof-v.mp4', from: 15 },
  narration: "Three — nothing stays hidden. Your rep's call is captured: summary, objection, next step.",
},

// 3b — …one AI-scored board (slice: the living board)
{
  name: 'v3b-board', slice: { src: 'd14-board-v.mp4', from: 6 },
  narration: "And the whole pipeline sits on one screen, AI-scored — you always know who's warm.",
},

// 4 — CLOSE: restate main + the three subsets, price, website-true CTA
{
  name: 'v4-close', account: ACCT.guest, viewport: HD,
  narration: "That's In-Sync CRM. It captures, it chases, it shows you everything — you close. Seven ninety-nine per user a month, fourteen days free. Book a free demo — we'll run it live on your own leads.",
  beats: async ({ page, D, ready }) => {
    await page.goto('about:blank').catch(() => {});
    await page.evaluate(closeCard);
    const waitUntil = await ready(250);
    await waitUntil(D);
  },
},

];
