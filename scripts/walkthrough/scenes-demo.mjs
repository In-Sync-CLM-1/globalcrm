// In-Sync EXPERT-DEMO walkthrough (~7:30) — played end-to-end by the presenter
// in a live 30-minute demo call, then discussed. Purpose: convey EVERY feature
// so nothing gets forgotten; chapter chips keep presenter + prospect oriented;
// the close hands the room back to the presenter (no cold CTA).
// 1080p. Derived from scenes.mjs (guided cut) + import / call-proof / team /
// field-staff chapters that the guided cut never showed.
import { ACCT } from './lib/scene.mjs';
import { BASE } from './lib/app.mjs';
import { ring, removeAnn, caption, removeCaption, zoomTo, zoomReset, chapter } from './lib/annotate.mjs';
import { clickLocator, typeInto } from './lib/cursor.mjs';
import { deleteFormLead, deleteDemoField, deleteDemoForm } from './lib/db.mjs';

const AARAV = 'aa000001-0000-4000-8000-000000000001';
const FORM = 'ff000001-0000-4000-8000-000000000001';
const HD = { width: 1920, height: 1080 };
const sleep = (page, ms) => page.waitForTimeout(ms);

const brandCard = (title, subtitle, foot) => `(() => {
  const st = document.createElement('style'); st.textContent = '#__cur{display:none !important}';
  document.documentElement.appendChild(st);
  const c = document.createElement('div'); c.id='__brandcard';
  c.style.cssText='position:fixed;inset:0;z-index:2147483600;display:flex;flex-direction:column;align-items:center;justify-content:center;background:linear-gradient(135deg,#0b1220,#1e3a8a 55%,#2563eb)';
  c.innerHTML="<div style=\\"font:800 84px 'Segoe UI',sans-serif;color:#fff;letter-spacing:-1.5px\\">${title}</div>"+
    "<div style=\\"font:500 34px 'Segoe UI',sans-serif;color:rgba(255,255,255,.92);margin-top:18px;max-width:62%;text-align:center;line-height:1.35\\">${subtitle}</div>"+
    "<div style=\\"font:400 19px 'Segoe UI',sans-serif;color:rgba(255,255,255,.7);margin-top:34px\\">${foot}</div>";
  document.documentElement.appendChild(c);
})()`;

export const SCENES = [

// 1 — opening (guest card)
{
  name: 'd01-hook', account: ACCT.guest, viewport: HD,
  narration: "Every sales team sits on more pipeline than it can ever work — leads that came in, got a touch or two, and quietly went cold in the CRM. In-Sync exists to change that: to work every lead you've already paid for — managed, visible, and measured. Over the next eight minutes you'll see the whole platform, end to end — capture, outreach, the AI agent, your team, and the numbers.",
  beats: async ({ page, D, ready }) => {
    await page.goto('about:blank').catch(() => {});
    await page.evaluate(brandCard('In-Sync', 'The whole platform, end to end — in eight minutes.', 'In-Sync Solutions'));
    const waitUntil = await ready(250);
    await waitUntil(D);
  },
},

// 2 — command center
{
  name: 'd02-command', account: ACCT.admin, viewport: HD,
  narration: "Start at the command center. New leads as they arrive, the live pipeline value, every call, message and email your team sent today, and your win rate — the whole operation on one screen, updating as your team works. It's the screen a sales head opens with their morning coffee — no reports to ask for.",
  beats: async ({ page, at, D, ready }) => {
    await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle' });
    await page.getByText('Dashboard').first().waitFor({ timeout: 20000 });
    await page.evaluate(() => {
      const el = [...document.querySelectorAll('h3')].find((e) => /Calls by Disposition/i.test(e.textContent || ''));
      if (el) { const c = el.closest('.rounded-lg') || el.parentElement?.parentElement; if (c) c.style.display = 'none'; }
    }).catch(() => {});
    const waitUntil = await ready(1400);
    await chapter(page, 1, 'Command center');
    await waitUntil(at('pipeline', 4, -0.2));
    const r = await ring(page, page.getByText('Active Pipeline').first(), { label: 'Leads · pipeline · calls · email · WhatsApp · win rate' }).catch(() => null);
    await waitUntil(at('one screen', 9, -0.2));
    if (r) await removeAnn(page, r);
    await zoomTo(page, page.getByText('New Leads').first(), 1.12, 1100).catch(() => {});
    await waitUntil(D - 0.5);
    await zoomReset(page, 800).catch(() => {});
    await waitUntil(D);
  },
},

// 3 — capture: the public form fills and lands (proven flow from the guided cut)
{
  name: 'd03-forms', account: ACCT.admin, viewport: HD,
  narration: "Capture begins before anyone lifts a finger. A prospect finds you — your website, an ad, a QR code at an event — and fills in a form like this one: their name, their company, what they're looking for. Then they hit send. And that instant — watch — they land in your pipeline: there's the brand-new lead at the top, captured on its own, in the New stage, with nobody on your side typing a thing.",
  beats: async ({ page, at, D, ready }) => {
    const LEAD_EMAIL = 'aarav.mehta@northwindlogistics.in';
    await deleteFormLead(LEAD_EMAIL).catch(() => {});
    await page.goto(`${BASE}/form/${FORM}`, { waitUntil: 'networkidle' });
    await page.getByText(/Get a Demo/i).first().waitFor({ timeout: 20000 }).catch(() => {});
    const waitUntil = await ready(900);
    await chapter(page, 2, 'Capture on autopilot');
    await typeInto(page, page.locator('#first_name'), 'Aarav').catch(() => {});
    await typeInto(page, page.locator('#last_name'), 'Mehta').catch(() => {});
    await typeInto(page, page.locator('#email'), LEAD_EMAIL).catch(() => {});
    await typeInto(page, page.locator('#company'), 'Northwind Logistics').catch(() => {});
    await clickLocator(page, page.getByRole('combobox').first()).catch(() => {});
    await page.getByRole('option', { name: '51-200' }).first().click().catch(() => {});
    await waitUntil(Math.min(at('hits send', 8, -0.3), 10));
    await clickLocator(page, page.getByRole('button', { name: /Submit Form/i })).catch(() => {});
    await page.getByText(/Thank You/i).first().waitFor({ timeout: 12000 }).catch(() => {});
    await sleep(page, 500);
    await page.goto(`${BASE}/pipeline`, { waitUntil: 'domcontentloaded' });
    const nameEl = page.getByText('Aarav Mehta').first();
    await nameEl.waitFor({ timeout: 12000 }).catch(() => {});
    await nameEl.scrollIntoViewIfNeeded().catch(() => {});
    await chapter(page, 2, 'Capture on autopilot');
    const r = await ring(page, nameEl, { label: 'Landed that same instant — in "New"', accent: '#16a34a' }).catch(() => null);
    await waitUntil(D - 0.4);
    if (r) await removeAnn(page, r);
    await waitUntil(D);
    await deleteFormLead(LEAD_EMAIL).catch(() => {});
  },
},

// 4 — make it yours: add a field + build a form, live
{
  name: 'd04-configure', account: ACCT.admin, viewport: HD,
  narration: "And all of this bends to how you sell — not the other way around. Need to track a budget, a team size, a region? Add your own field in seconds, any type you like. Need a new capture form for a campaign? Build it yourself — name it, mark it public, tick the fields you want — and it's live with a shareable link you can drop into any ad, email or landing page. No developer, no waiting, no ticket. That form the prospect just filled in? It was built right here, in under a minute.",
  beats: async ({ page, at, D, ready }) => {
    const FIELD = 'budget', FORM_NAME = 'Website Enquiry';
    await deleteDemoForm(FORM_NAME).catch(() => {});
    await deleteDemoField(FIELD).catch(() => {});
    await page.goto(`${BASE}/admin/custom-fields`, { waitUntil: 'networkidle' });
    await page.getByText('Custom Fields').first().waitFor({ timeout: 20000 }).catch(() => {});
    const waitUntil = await ready(900);
    await chapter(page, 3, 'Make it yours');
    await clickLocator(page, page.getByRole('button', { name: /Add Field/i }).first()).catch(() => {});
    await page.getByText('Add New Field').first().waitFor({ timeout: 8000 }).catch(() => {});
    await sleep(page, 300);
    await typeInto(page, page.locator('#field_label'), 'Budget').catch(() => {});
    await typeInto(page, page.locator('#field_name'), FIELD).catch(() => {});
    await waitUntil(at('seconds', 5, -0.2));
    await clickLocator(page, page.getByRole('button', { name: /^Create$/i }).first()).catch(() => {});
    await page.getByText('Budget').first().waitFor({ timeout: 8000 }).catch(() => {});
    await sleep(page, 700);
    await page.goto(`${BASE}/admin/forms`, { waitUntil: 'networkidle' });
    await page.getByText('Forms').first().waitFor({ timeout: 15000 }).catch(() => {});
    await sleep(page, 300);
    await chapter(page, 3, 'Make it yours');
    await waitUntil(at('Build it', 9, -0.3));
    await clickLocator(page, page.getByRole('button', { name: /Create Form/i }).first()).catch(() => {});
    await page.getByText('Create New Form').first().waitFor({ timeout: 8000 }).catch(() => {});
    await sleep(page, 300);
    await typeInto(page, page.locator('#name'), FORM_NAME).catch(() => {});
    await clickLocator(page, page.locator('#connector_type')).catch(() => {});
    await page.getByRole('option', { name: /Public Form/i }).first().click().catch(() => {});
    await clickLocator(page, page.locator('label').filter({ hasText: 'Team size' }).first()).catch(() => {});
    await clickLocator(page, page.locator('label').filter({ hasText: 'Budget' }).first()).catch(() => {});
    await waitUntil(Math.min(at('shareable', 14, -0.3), D - 5));
    await clickLocator(page, page.getByRole('button', { name: /^Create Form$/i }).last()).catch(() => {});
    await page.getByText(FORM_NAME).first().waitFor({ timeout: 8000 }).catch(() => {});
    await sleep(page, 400);
    const r2 = await ring(page, page.getByText(/Public link/i).first(), { label: 'Live · public shareable link', accent: '#2563eb' }).catch(() => null);
    await waitUntil(D - 0.4);
    if (r2) await removeAnn(page, r2);
    await waitUntil(D);
    await deleteDemoForm(FORM_NAME).catch(() => {});
    await deleteDemoField(FIELD).catch(() => {});
  },
},

// 5 — arrives enriched + routed
{
  name: 'd05-enriched', account: ACCT.admin, viewport: HD,
  narration: "The moment a lead lands, it's already complete — company, role, seniority, city, LinkedIn, context — enriched automatically on the way in. And it's routed to the right rep the same moment, by your own assignment rules. Nobody typing, nobody assigning by hand. Your rep opens the lead and starts selling, not researching.",
  beats: async ({ page, at, D, ready }) => {
    await page.goto(`${BASE}/contacts/${AARAV}`, { waitUntil: 'networkidle' });
    await page.getByText('Aarav Mehta').first().waitFor({ timeout: 20000 });
    const waitUntil = await ready(1100);
    await chapter(page, 4, 'Enriched on arrival');
    await waitUntil(at('complete', 3, -0.2));
    const r = await ring(page, page.getByText('Contact Information').first(), { label: 'Company · role · seniority — filled in automatically' }).catch(() => null);
    await waitUntil(D - 0.5);
    if (r) await removeAnn(page, r);
    await waitUntil(D);
  },
},

// 6 — bring your existing book: bulk import (NEW)
{
  name: 'd06-import', account: ACCT.admin, viewport: HD,
  narration: "Already sitting on lead lists from years of business? Bring them with you. Upload a spreadsheet and thousands of contacts flow in at once — mapped to your fields, checked for duplicates, and dropped straight into the pipeline ready to work. Your old database becomes live pipeline in one afternoon — and it exports back out just as easily.",
  beats: async ({ page, at, D, ready }) => {
    await page.goto(`${BASE}/contacts`, { waitUntil: 'networkidle' });
    await page.getByText(/Contacts/i).first().waitFor({ timeout: 20000 }).catch(() => {});
    const waitUntil = await ready(1200);
    await chapter(page, 5, 'Bring your lists');
    await waitUntil(at('Upload', 4, -0.4));
    await clickLocator(page, page.getByRole('button', { name: /Bulk Upload/i }).first()).catch(() => {});
    await page.getByText(/Bulk Upload Contacts/i).first().waitFor({ timeout: 8000 }).catch(() => {});
    await sleep(page, 500);
    const r = await ring(page, page.getByText(/Bulk Upload Contacts/i).first(), { label: 'Thousands at once — mapped · deduplicated', accent: '#7c3aed' }).catch(() => null);
    await waitUntil(D - 0.6);
    if (r) await removeAnn(page, r);
    await page.keyboard.press('Escape').catch(() => {});
    await waitUntil(D);
  },
},

// 7 — reach out, your way
{
  name: 'd07-channels', account: ACCT.admin, viewport: HD,
  narration: "Now reach out, your way. A phone call, a WhatsApp, an email — every channel lives right on the lead itself, one click away. Pick one and go. And whichever channel you choose, the conversation stays on the record — so anyone on the team can pick up a lead and know its whole history in seconds.",
  beats: async ({ page, at, D, ready }) => {
    await page.goto(`${BASE}/contacts/${AARAV}`, { waitUntil: 'networkidle' });
    await page.getByText('Activities & Notes').first().waitFor({ timeout: 20000 });
    const waitUntil = await ready(1100);
    await chapter(page, 6, 'Every channel, one place');
    await waitUntil(at('call', 2, -0.2));
    const rc = await ring(page, page.locator('button:has(.lucide-phone-call), button:has(.lucide-phone)').first(), { label: 'Call', accent: '#16a34a' }).catch(() => null);
    await waitUntil(at('WhatsApp', 3.5, -0.2));
    if (rc) await removeAnn(page, rc);
    await clickLocator(page, page.locator('button:has(.lucide-message-circle)').first()).catch(() => {});
    await page.getByText('Send WhatsApp Message').first().waitFor({ timeout: 6000 }).catch(() => {});
    await sleep(page, 600);
    const rw = await ring(page, page.getByText('Send WhatsApp Message').first(), { label: 'WhatsApp · pick a template', accent: '#25D366' }).catch(() => null);
    await waitUntil(at('email', 6, -0.2));
    if (rw) await removeAnn(page, rw);
    await page.keyboard.press('Escape').catch(() => {});
    await sleep(page, 350);
    await clickLocator(page, page.locator('button:has(.lucide-mail)').first()).catch(() => {});
    await page.getByText(/Send Email to/i).first().waitFor({ timeout: 6000 }).catch(() => {});
    await sleep(page, 600);
    const re = await ring(page, page.getByText(/Send Email to/i).first(), { label: 'Email', accent: '#2563eb' }).catch(() => null);
    await waitUntil(D - 0.6);
    if (re) await removeAnn(page, re);
    await page.keyboard.press('Escape').catch(() => {});
    await waitUntil(D);
  },
},

// 8 — templates
{
  name: 'd08-templates', account: ACCT.admin, viewport: HD,
  narration: "Every message stays on-brand and one click away. Approved WhatsApp and email templates your whole team reuses — personalised automatically with the lead's name and details. No re-typing the same pitch forty times a day, nothing off-script going out under your brand.",
  beats: async ({ page, at, D, ready }) => {
    await page.goto(`${BASE}/templates`, { waitUntil: 'networkidle' });
    await page.getByText('Message Templates').first().waitFor({ timeout: 20000 }).catch(() => {});
    const waitUntil = await ready(1200);
    await chapter(page, 7, 'On-brand templates');
    await waitUntil(at('templates', 3, -0.2));
    const r = await ring(page, page.locator('[role="tabpanel"] .text-lg, .grid .text-lg').first(), { label: 'Approved · reusable · consistent', accent: '#25D366' }).catch(() => null);
    await waitUntil(at('email', 6.5, -0.2));
    if (r) await removeAnn(page, r);
    await clickLocator(page, page.getByRole('tab', { name: /email/i }).first()).catch(() => {});
    await sleep(page, 1000);
    await waitUntil(D - 0.4);
    await waitUntil(D);
  },
},

// 9 — the AI dialer at scale
{
  name: 'd09-aidialer', account: ACCT.admin, viewport: HD,
  narration: "And you don't work thousands of leads one at a time — you hand them to the AI agent. It dials on its own, holds a real conversation in a natural voice, gauges interest, handles the brush-offs politely, and books the meeting when the interest is real. Here's a single day of it: hundreds of calls made without a human dialing once, and every single one sorted by outcome — interested, call back, follow up, demo booked. Your team wakes up to a list of warm conversations.",
  beats: async ({ page, at, D, ready }) => {
    await page.goto(`${BASE}/calling-dashboard`, { waitUntil: 'networkidle' });
    await page.getByText('Calling Dashboard').first().waitFor({ timeout: 20000 }).catch(() => {});
    const waitUntil = await ready(1400);
    await chapter(page, 8, 'The AI agent at scale', '#7c3aed');
    await waitUntil(at('hundreds', 12, -0.4));
    const r = await ring(page, page.getByText('Total Calls').first(), { label: 'Hundreds of calls — on their own', accent: '#7c3aed' }).catch(() => null);
    await waitUntil(at('sorted', 16, -0.4));
    if (r) await removeAnn(page, r);
    await page.getByText('Call Dispositions').first().evaluate((el) => el.scrollIntoView({ block: 'center' })).catch(() => {});
    await sleep(page, 600);
    const r2 = await ring(page, page.getByText('Call Dispositions').first(), { label: 'Interested · follow-up · demo booked', accent: '#16a34a' }).catch(() => null);
    await zoomTo(page, page.getByText('Call Dispositions').first(), 1.15, 1000).catch(() => {});
    await waitUntil(D - 0.7);
    await zoomReset(page, 800).catch(() => {});
    if (r2) await removeAnn(page, r2);
    await waitUntil(D);
  },
},

// 10 — proof the AI call is real (recording + transcript + the agent's own read)
{
  name: 'd10-callproof', account: ACCT.admin, viewport: HD,
  narration: "And it's not a black box — you can audit every word. Every call is recorded, transcribed, and read back to you. Here's the actual conversation with Aarav from this morning — and the agent's own summary of it: confirmed interest, decision-maker, demo booked, with the next step spelled out. Proof, on every single call.",
  beats: async ({ page, at, D, ready }) => {
    await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle' });
    await page.getByText('Dashboard').first().waitFor({ timeout: 20000 });
    const waitUntil = await ready(1400);
    await chapter(page, 9, 'Recorded · transcribed · proven', '#7c3aed');
    await clickLocator(page, page.getByRole('tab', { name: /Call Logs/i }).first()).catch(() => {});
    await sleep(page, 800);
    await page.getByPlaceholder(/Search name or phone/i).first().fill('Aarav').catch(() => {});
    await sleep(page, 900);
    await waitUntil(at('conversation', 6, -0.4));
    await clickLocator(page, page.locator('button:has(.lucide-sparkles)').first()).catch(() => {});
    await page.getByText(/confirmed active interest|decision-maker|Summary/i).first().waitFor({ timeout: 6000 }).catch(() => {});
    await sleep(page, 700);
    const r = await ring(page, page.getByText(/confirmed active interest|decision-maker/i).first(), { label: "The AI's own read — interested · demo booked", accent: '#7c3aed' }).catch(() => null);
    await waitUntil(D - 0.6);
    if (r) await removeAnn(page, r);
    await page.keyboard.press('Escape').catch(() => {});
    await waitUntil(D);
  },
},

// 11 — every response comes back
{
  name: 'd11-responses', account: ACCT.admin, viewport: HD,
  narration: "Every response comes straight back into the lead's journey. On WhatsApp you see delivered, read, and the reply itself; on email you see opened and clicked — down to which link they clicked and when. You always know exactly where each conversation stands — no hot reply sits unanswered.",
  beats: async ({ page, at, D, ready }) => {
    await page.goto(`${BASE}/contacts/${AARAV}`, { waitUntil: 'networkidle' });
    await page.getByText('Customer Journey').first().waitFor({ timeout: 20000 });
    const waitUntil = await ready(1100);
    await chapter(page, 10, 'Every response, tracked', '#0d9488');
    await page.mouse.wheel(0, 260).catch(() => {});
    await sleep(page, 450);
    await waitUntil(at('replied', 4, -0.2));
    const r = await ring(page, page.getByText(/Read Jun|Delivered Jun|Read |Delivered /i).first(), { label: 'WhatsApp — delivered · read · replied', accent: '#25D366' }).catch(() => null);
    await waitUntil(at('clicked', 7, -0.2));
    if (r) await removeAnn(page, r);
    await page.mouse.wheel(0, 380).catch(() => {});
    await sleep(page, 450);
    const r2 = await ring(page, page.getByText(/opened|clicked|In-Sync demo/i).first(), { label: 'Email — opened · clicked', accent: '#2563eb' }).catch(() => null);
    await waitUntil(D - 0.5);
    if (r2) await removeAnn(page, r2);
    await waitUntil(D);
  },
},

// 12 — one picture + AI score
{
  name: 'd12-score', account: ACCT.admin, viewport: HD,
  narration: "It all rolls into one picture — the calls, the messages, the replies, every touch on a single timeline. And on top of it, an AI score that reads the engagement and tells your team exactly which leads deserve the next hour.",
  beats: async ({ page, at, D, ready }) => {
    await page.goto(`${BASE}/contacts/${AARAV}`, { waitUntil: 'networkidle' });
    await page.getByText('Customer Journey').first().waitFor({ timeout: 20000 });
    const waitUntil = await ready(1100);
    await chapter(page, 11, 'AI lead score', '#7c3aed');
    await waitUntil(at('timeline', 5, -0.3));
    const r = await ring(page, page.getByText('Customer Journey').first(), { label: 'One timeline — everything that happened' }).catch(() => null);
    await waitUntil(at('score', 8, -0.3));
    if (r) await removeAnn(page, r);
    await page.getByText(/Lead Score/i).first().evaluate((el) => el.scrollIntoView({ block: 'center' })).catch(() => {});
    await sleep(page, 500);
    const r2 = await ring(page, page.getByText(/Lead Score/i).first(), { label: 'AI score — where to spend your time', accent: '#7c3aed' }).catch(() => null);
    await zoomTo(page, page.getByText(/Lead Score/i).first(), 1.25, 1000).catch(() => {});
    await waitUntil(D - 0.7);
    await zoomReset(page, 800).catch(() => {});
    if (r2) await removeAnn(page, r2);
    await waitUntil(D);
  },
},

// 13 — booked, and it sticks
{
  name: 'd13-booked', account: ACCT.admin, viewport: HD,
  narration: "Book the demo and it sticks — on the calendar with a meeting link attached, an RSVP from the prospect, and reminders that fire on their own before the meeting. Fewer no-shows, no follow-up left to somebody's memory.",
  beats: async ({ page, at, D, ready }) => {
    await page.goto(`${BASE}/contacts/${AARAV}`, { waitUntil: 'networkidle' });
    await page.getByText(/Product demo/i).first().waitFor({ timeout: 20000 }).catch(() => {});
    const waitUntil = await ready(1000);
    await chapter(page, 12, 'Booked — and it sticks', '#0d9488');
    await page.getByText(/Product demo/i).first().scrollIntoViewIfNeeded().catch(() => {});
    await waitUntil(at('calendar', 3, -0.2));
    const r = await ring(page, page.getByText(/Product demo/i).first(), { label: 'On the calendar · link · auto-reminders', accent: '#25D366' }).catch(() => null);
    await waitUntil(D - 0.5);
    if (r) await removeAnn(page, r);
    await waitUntil(D);
  },
},

// 14 — the living board
{
  name: 'd14-board', account: ACCT.admin, viewport: HD,
  narration: "Across the floor, every lead is on the board — its stage, its owner, the last call's outcome, and the state of every channel: called, emailed, messaged. Drag a card to move a deal forward; filter to find anything in seconds. This one screen replaces the Monday status meeting.",
  beats: async ({ page, at, D, ready }) => {
    await page.goto(`${BASE}/pipeline`, { waitUntil: 'networkidle' });
    await page.getByText('All Pipeline Contacts').first().waitFor({ timeout: 20000 }).catch(() => {});
    const waitUntil = await ready(1200);
    await chapter(page, 13, 'The living board');
    await waitUntil(at('owner', 5, -0.2));
    const r = await ring(page, page.getByText(/WhatsApp Outreach/i).first(), { label: 'Stage · owner · last touch — on every lead', accent: '#25D366' }).catch(() => null);
    await waitUntil(D - 0.5);
    if (r) await removeAnn(page, r);
    await waitUntil(D);
  },
},

// 15 — your team on the platform (NEW)
{
  name: 'd15-team', account: ACCT.admin, viewport: HD,
  narration: "Your whole team lives here too. Invite people with a simple link, set their roles — admin, manager, executive — and group them into teams. Everyone sees what their role allows, and new leads route to the right desk automatically. Onboarding a new rep takes about a minute.",
  beats: async ({ page, at, D, ready }) => {
    await page.goto(`${BASE}/users`, { waitUntil: 'networkidle' });
    await page.getByText(/Users|Team Members/i).first().waitFor({ timeout: 20000 }).catch(() => {});
    const waitUntil = await ready(1200);
    await chapter(page, 14, 'Your team & roles');
    await waitUntil(at('Invite', 3, -0.3));
    const r = await ring(page, page.getByRole('button', { name: /invite|add user/i }).first(), { label: 'Invite with a link · set the role', accent: '#2563eb' }).catch(() => null);
    await waitUntil(at('automatically', 10, -0.4));
    if (r) await removeAnn(page, r);
    await waitUntil(D - 0.4);
    await waitUntil(D);
  },
},

// 16 — field staff: attendance with photo + GPS (NEW)
{
  name: 'd16-field', account: ACCT.admin, viewport: HD,
  narration: "And if your team is in the field, In-Sync tracks the field too. Staff check in from their phone with a photo and GPS location, so you know who's where, verified. Hours count themselves, and the month rolls up on its own — attendance, leave requests, approvals, regularization — without a paper register or a WhatsApp group in sight. It's the same platform your sales runs on.",
  beats: async ({ page, at, D, ready }) => {
    await page.goto(`${BASE}/attendance`, { waitUntil: 'networkidle' });
    await page.getByText(/Attendance/i).first().waitFor({ timeout: 20000 }).catch(() => {});
    const waitUntil = await ready(1300);
    await chapter(page, 15, 'Field staff · attendance', '#0d9488');
    await waitUntil(at('photo', 5, -0.3));
    const r = await ring(page, page.getByText(/Today's Attendance/i).first(), { label: 'Photo + GPS check-in · live hours', accent: '#0d9488' }).catch(() => null);
    await waitUntil(at('rolls up', 9, -0.3));
    if (r) await removeAnn(page, r);
    const r2 = await ring(page, page.getByText(/Monthly Summary/i).first(), { label: 'The month, counted for you', accent: '#2563eb' }).catch(() => null);
    await waitUntil(D - 0.5);
    if (r2) await removeAnn(page, r2);
    await waitUntil(D);
  },
},

// 17 — pipeline intelligence
{
  name: 'd17-insights', account: ACCT.admin, viewport: HD,
  narration: "And it all rolls up into intelligence you can act on. The AI reads your whole pipeline — every stage, every source, how long deals sit and where they die — and points straight at the bottlenecks where deals are stalling, with the numbers to back it. So you fix the actual leak in your funnel instead of guessing.",
  beats: async ({ page, at, D, ready }) => {
    await page.goto(`${BASE}/reports`, { waitUntil: 'networkidle' });
    await page.getByText(/Insights Hub/i).first().waitFor({ timeout: 20000 }).catch(() => {});
    const waitUntil = await ready(1100);
    await clickLocator(page, page.getByRole('tab', { name: /AI Insights/i }).first()).catch(() => {});
    await sleep(page, 1400);
    await chapter(page, 16, 'AI pipeline intelligence', '#7c3aed');
    await waitUntil(at('bottlenecks', 8, -0.4));
    const r = await ring(page, page.getByText(/Pipeline Bottlenecks Detected/i).first(), { label: 'AI finds where deals stall', accent: '#dc2626' }).catch(() => null);
    await waitUntil(at('leak', 12, -0.3));
    if (r) await removeAnn(page, r);
    await page.getByText(/Stage Velocity/i).first().evaluate((el) => el.scrollIntoView({ block: 'center' })).catch(() => {});
    await waitUntil(D - 0.4);
    await waitUntil(D);
  },
},

// 18 — every rupee
{
  name: 'd18-rupee', account: ACCT.admin, viewport: HD,
  narration: "Every call, every message, every rupee of spend — tracked in a live wallet against what it brought back. You always know what growth costs and what it returns. Growth becomes a number you manage, not a leap of faith.",
  beats: async ({ page, at, D, ready }) => {
    await page.goto(`${BASE}/billing`, { waitUntil: 'networkidle' });
    await page.getByText(/Wallet|Billing|Subscription/i).first().waitFor({ timeout: 20000 }).catch(() => {});
    const waitUntil = await ready(1100);
    await chapter(page, 17, 'Every rupee, accounted');
    await waitUntil(at('rupee', 4, -0.2));
    await zoomTo(page, page.getByText(/Wallet/i).first(), 1.12, 1000).catch(() => {});
    await waitUntil(at('returns', 10, -0.3));
    await zoomReset(page, 800).catch(() => {});
    await waitUntil(D - 0.3);
    await waitUntil(D);
  },
},

// 19 — protected by design
{
  name: 'd19-dpdp', account: ACCT.admin, viewport: HD,
  narration: "And every lead in that pipeline is personal data — protected by design. Consent on record for every contact, access and erasure requests handled in one inbox, retention rules, and encryption underneath it all — built in line with India's Data Protection Act. Compliance, handled — not bolted on later.",
  beats: async ({ page, at, D, ready }) => {
    await page.goto(`${BASE}/admin/data-protection`, { waitUntil: 'networkidle' });
    await page.getByText('Data Protection').first().waitFor({ timeout: 20000 });
    const waitUntil = await ready(1200);
    await chapter(page, 18, 'Protected by design');
    await waitUntil(at('consent', 4, -0.2));
    const r = await ring(page, page.getByText(/Consents on file/i).first(), { label: 'Consent · access · erasure · retention' }).catch(() => null);
    await waitUntil(at('encryption', 8, -0.3));
    if (r) await removeAnn(page, r);
    await clickLocator(page, page.getByRole('tab', { name: /Encryption/i }).first()).catch(() => {});
    await sleep(page, 1000);
    await waitUntil(D - 0.4);
    await waitUntil(D);
  },
},

// 20 — close: hand the room back to the presenter
{
  name: 'd20-close', account: ACCT.guest, viewport: HD,
  narration: "So that's the whole journey on one platform — every lead captured the moment it exists, worked across every channel, called by an AI agent that never gets tired, your team and your field staff on the same screen, every rupee measured, and all of it protected by design. That's In-Sync. Now — let's talk about your pipeline.",
  beats: async ({ page, D, ready }) => {
    await page.goto('about:blank').catch(() => {});
    await page.evaluate(brandCard('In-Sync', 'That&rsquo;s the platform. Now — let&rsquo;s talk about yours.', 'Questions? Over to you.'));
    const waitUntil = await ready(250);
    await waitUntil(D);
  },
},

];
