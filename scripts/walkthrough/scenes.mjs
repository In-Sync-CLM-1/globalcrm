// In-Sync (globalcrm) walkthrough — v4 (buyer cut).
// Persuasive story for a prospect/buyer: capture -> reach -> AI works it at scale
// -> measured -> protected. One continuity name (the lead, Aarav) where it helps.
// New for v4 vs v3: a public lead-capture FORM, the AI DIALER at scale, and the
// TEMPLATE studio — the three biggest buyer draws that were missing.
// No live sends — composers are opened, never submitted; engagement is seeded.
import { ACCT } from './lib/scene.mjs';
import { BASE } from './lib/app.mjs';
import { ring, removeAnn, caption, removeCaption, zoomTo, zoomReset } from './lib/annotate.mjs';
import { clickLocator, typeInto } from './lib/cursor.mjs';
import { deleteFormLead, deleteDemoField, deleteDemoForm } from './lib/db.mjs';

const AARAV = 'aa000001-0000-4000-8000-000000000001';
const FORM = 'ff000001-0000-4000-8000-000000000001';
const sleep = (page, ms) => page.waitForTimeout(ms);

const brandCard = (title, subtitle, foot) => `(() => {
  const c = document.createElement('div'); c.id='__brandcard';
  c.style.cssText='position:fixed;inset:0;z-index:2147483647;display:flex;flex-direction:column;align-items:center;justify-content:center;background:linear-gradient(135deg,#0b1220,#1e3a8a 55%,#2563eb)';
  c.innerHTML="<div style=\\"font:800 64px 'Segoe UI',sans-serif;color:#fff;letter-spacing:-1px\\">${title}</div>"+
    "<div style=\\"font:500 27px 'Segoe UI',sans-serif;color:rgba(255,255,255,.92);margin-top:14px;max-width:62%;text-align:center\\">${subtitle}</div>"+
    "<div style=\\"font:400 15px 'Segoe UI',sans-serif;color:rgba(255,255,255,.7);margin-top:26px\\">${foot}</div>";
  document.documentElement.appendChild(c);
})()`;

const ALL = [

// 0 — hook. Render ONLY the title card: navigate to a blank page and inject the
// card before recording resumes, so there's no flash of the marketing site first.
{
  name: 's0-hook', account: ACCT.guest,
  narration: "Every sales team sits on more pipeline than it can ever work — leads that came in, got a touch or two, and quietly went cold. In-Sync exists to change that: to work every lead you've already paid for — managed, visible, and measured. Here's how it comes together.",
  beats: async ({ page, D, ready }) => {
    await page.goto('about:blank').catch(() => {});
    await page.evaluate(brandCard('In-Sync', 'Work the pipeline you already have — managed, visible, measured.', 'In-Sync Solutions'));
    const waitUntil = await ready(250);
    await waitUntil(D);
  },
},

// 1 — command center (core Dashboard)
{
  name: 's1-command', account: ACCT.admin,
  narration: "Start here — your command center. New leads, live pipeline, every call, message and email, your win rate. Your whole sales operation on one screen.",
  beats: async ({ page, at, D, ready }) => {
    await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle' });
    await page.getByText('Dashboard').first().waitFor({ timeout: 20000 });
    // The demo org shares an Exotel account whose raw, undispositioned calls get
    // synced in and swamp the "Calls by Disposition" chart with a grey "Not Set"
    // band. Hide that one widget for the shot; the KPI cards are the story here.
    await page.evaluate(() => {
      const el = [...document.querySelectorAll('h3')].find((e) => /Calls by Disposition/i.test(e.textContent || ''));
      if (el) { const c = el.closest('.rounded-lg') || el.parentElement?.parentElement; if (c) c.style.display = 'none'; }
    }).catch(() => {});
    const waitUntil = await ready(1500);
    const cap = await caption(page, 'Command center · your whole operation, live');
    await waitUntil(at('pipeline', 4, -0.2));
    const r = await ring(page, page.getByText('Active Pipeline').first(), { label: 'Leads · pipeline · calls · email · WhatsApp · win rate' }).catch(() => null);
    await waitUntil(at('screen', 13, -0.2));
    if (r) await removeAnn(page, r);
    // zoom the KPI cards (what the narration is about), not the disposition chart
    await zoomTo(page, page.getByText('New Leads').first(), 1.15, 1200).catch(() => {});
    await waitUntil(D - 0.5);
    await zoomReset(page, 900).catch(() => {});
    await removeCaption(page, cap);
    await waitUntil(D);
  },
},

// 2 — leads capture themselves (public form).
// Recorded while authenticated: the public form reads its row under RLS, which
// blocks anonymous SELECT on this preview — an org member reads it fine and the
// standalone public-form page renders identically (no app chrome).
{
  name: 's2-forms', account: ACCT.admin,
  narration: "It begins before you lift a finger. A prospect finds you — your site, an ad, a campaign — and fills in a form like this. Their name, their company, what they need. They hit send, and that instant they land in your pipeline. There it is — a brand-new lead, captured on its own, ready to work.",
  beats: async ({ page, at, D, ready }) => {
    const LEAD_EMAIL = 'aarav.mehta@northwindlogistics.in';
    // start clean so the arrival is a genuine, single new card
    await deleteFormLead(LEAD_EMAIL).catch(() => {});
    await page.goto(`${BASE}/form/${FORM}`, { waitUntil: 'networkidle' });
    await page.getByText(/Get a Demo/i).first().waitFor({ timeout: 20000 }).catch(() => {});
    const waitUntil = await ready(900);
    const cap = await caption(page, 'Your public form — a prospect fills it in', { accent: '#2563eb' });

    // Fill the form on camera as the prospect (Aarav). The typed cadence also keeps
    // the fill above the public form's 3-second bot-detection floor.
    await typeInto(page, page.locator('#first_name'), 'Aarav').catch(() => {});
    await typeInto(page, page.locator('#last_name'), 'Mehta').catch(() => {});
    await typeInto(page, page.locator('#email'), LEAD_EMAIL).catch(() => {});
    await typeInto(page, page.locator('#phone'), '+91 98200 11234').catch(() => {});
    await typeInto(page, page.locator('#company'), 'Northwind Logistics').catch(() => {});
    await clickLocator(page, page.getByRole('combobox').first()).catch(() => {});
    await page.getByRole('option', { name: '51-200' }).first().click().catch(() => {});
    await typeInto(page, page.locator('#primary_goal'), 'Field staff tracking and reporting.').catch(() => {});

    // Submit as soon as the fields are filled (no later than ~9s) so the pipeline
    // has maximum runway to load and the reveal holds — don't gate on the spoken
    // word "send", which lands late in the line and would starve the reveal.
    await waitUntil(Math.min(at('send', 6, -0.2), 9));
    await removeCaption(page, cap).catch(() => {});
    await clickLocator(page, page.getByRole('button', { name: /Submit Form/i })).catch(() => {});
    await page.getByText(/Thank You/i).first().waitFor({ timeout: 12000 }).catch(() => {});
    await sleep(page, 500);

    // Go to the pipeline right away. Use domcontentloaded (NOT networkidle — the
    // pipeline keeps firing background queries, so networkidle blocks ~7s and eats
    // the whole reveal); then wait for the table row itself. Stay on the default
    // Table view — it's server-paginated (ordered by updated_at, so the just-created
    // lead is the top row) and fast; Board View refetches every contact.
    await page.goto(`${BASE}/pipeline`, { waitUntil: 'domcontentloaded' });
    // Annotate only once the table has painted — overlays injected while the page
    // still shows "Loading pipeline…" get wiped as it boots.
    const nameEl = page.getByText('Aarav Mehta').first();
    await nameEl.waitFor({ timeout: 12000 }).catch(() => {});
    await nameEl.scrollIntoViewIfNeeded().catch(() => {});
    const cap2 = await caption(page, 'The moment they hit send — a new lead in your pipeline', { accent: '#16a34a' });
    const r = await ring(page, nameEl, { label: 'New lead — landed in "New", captured automatically', accent: '#16a34a' }).catch(() => null);
    await waitUntil(D - 0.5);
    if (r) await removeAnn(page, r);
    await removeCaption(page, cap2).catch(() => {});
    await waitUntil(D);

    // tidy the throwaway so it doesn't shadow the seeded, enriched Aarav later
    await deleteFormLead(LEAD_EMAIL).catch(() => {});
  },
},

// 2b — make it yours (configurability: custom fields + form builder)
{
  name: 's2b-configure', account: ACCT.admin,
  narration: "And all of this bends to how you actually sell. Need a new field? Add it in seconds. Need a form? Build it yourself — pick your fields, mark it public, and you've got a shareable capture form. No developer, no waiting. That form the prospect just filled in? You built it here, in minutes — and there it is, live and ready to share.",
  beats: async ({ page, at, D, ready }) => {
    const FIELD = 'budget', FORM_NAME = 'Website Enquiry';
    // start clean so the added field / built form are genuine creations on camera
    await deleteDemoForm(FORM_NAME).catch(() => {});
    await deleteDemoField(FIELD).catch(() => {});

    // (A) add a custom field, live
    await page.goto(`${BASE}/admin/custom-fields`, { waitUntil: 'networkidle' });
    await page.getByText('Custom Fields').first().waitFor({ timeout: 20000 }).catch(() => {});
    const waitUntil = await ready(900);
    let cap = await caption(page, 'Make it yours — add your own field', { accent: '#7c3aed' });
    await clickLocator(page, page.getByRole('button', { name: /Add Field/i }).first()).catch(() => {});
    await page.getByText('Add New Field').first().waitFor({ timeout: 8000 }).catch(() => {});
    await sleep(page, 350);
    await typeInto(page, page.locator('#field_label'), 'Budget').catch(() => {});
    await typeInto(page, page.locator('#field_name'), FIELD).catch(() => {});
    await waitUntil(at('seconds', 6, -0.2));
    await clickLocator(page, page.getByRole('button', { name: /^Create$/i }).first()).catch(() => {});
    await page.getByText('Budget').first().waitFor({ timeout: 8000 }).catch(() => {});
    await sleep(page, 400);
    const r = await ring(page, page.getByText('Budget').first(), { label: 'New field — added, no developer', accent: '#7c3aed' }).catch(() => null);
    await sleep(page, 800);
    if (r) await removeAnn(page, r);
    await removeCaption(page, cap).catch(() => {});

    // (B) build a public capture form, live
    await page.goto(`${BASE}/admin/forms`, { waitUntil: 'networkidle' });
    await page.getByText('Forms').first().waitFor({ timeout: 15000 }).catch(() => {});
    await sleep(page, 400);
    cap = await caption(page, 'Build your own capture form', { accent: '#2563eb' });
    await waitUntil(at('Build', 11, -0.2));
    await clickLocator(page, page.getByRole('button', { name: /Create Form/i }).first()).catch(() => {});
    await page.getByText('Create New Form').first().waitFor({ timeout: 8000 }).catch(() => {});
    await sleep(page, 350);
    await typeInto(page, page.locator('#name'), FORM_NAME).catch(() => {});
    await clickLocator(page, page.locator('#connector_type')).catch(() => {});
    await page.getByRole('option', { name: /Public Form/i }).first().click().catch(() => {});
    await sleep(page, 300);
    await clickLocator(page, page.locator('label').filter({ hasText: 'Team size' }).first()).catch(() => {});
    await clickLocator(page, page.locator('label').filter({ hasText: 'Budget' }).first()).catch(() => {});
    // submit no later than D-5 so the created form + its public link have time to
    // paint and be ringed before the hold (never let the reveal get trimmed).
    await waitUntil(Math.min(at('public', 10, -0.2), D - 5));
    await clickLocator(page, page.getByRole('button', { name: /^Create Form$/i }).last()).catch(() => {});
    await page.getByText(FORM_NAME).first().waitFor({ timeout: 8000 }).catch(() => {});
    await sleep(page, 500);
    const r2 = await ring(page, page.getByText(/Public link/i).first(), { label: 'Your form · public shareable link', accent: '#2563eb' }).catch(() => null);
    await waitUntil(D - 0.5);
    if (r2) await removeAnn(page, r2);
    await removeCaption(page, cap).catch(() => {});
    await waitUntil(D);

    // tidy the on-camera throwaways so the demo org stays as seeded
    await deleteDemoForm(FORM_NAME).catch(() => {});
    await deleteDemoField(FIELD).catch(() => {});
  },
},

// 3 — and they arrive already complete (enriched + auto-routed)
{
  name: 's3-capture', account: ACCT.admin,
  narration: "The moment a lead lands, it's already complete — company, role, seniority, context, enriched on the way in — and it's routed to the right rep automatically. Nobody typing, nobody assigning by hand. It just shows up on the right desk, ready to work.",
  beats: async ({ page, at, D, ready }) => {
    await page.goto(`${BASE}/contacts/${AARAV}`, { waitUntil: 'networkidle' });
    await page.getByText('Aarav Mehta').first().waitFor({ timeout: 20000 });
    const waitUntil = await ready(1100);
    const cap = await caption(page, 'A new lead — enriched on arrival');
    await waitUntil(at('complete', 5, -0.2));
    const r = await ring(page, page.getByText('Contact Information').first(), { label: 'Company · role · seniority · context — filled in automatically' }).catch(() => null);
    await waitUntil(D - 0.5);
    if (r) await removeAnn(page, r);
    await removeCaption(page, cap);
    await waitUntil(D);
  },
},

// 4 — reach them YOUR WAY (channels shown actively: composers open)
{
  name: 's4-channels', account: ACCT.admin,
  narration: "Now reach out, your way. A call, a WhatsApp, an email — pick a channel and go. Every lead, your choice.",
  beats: async ({ page, at, D, ready }) => {
    await page.goto(`${BASE}/contacts/${AARAV}`, { waitUntil: 'networkidle' });
    await page.getByText('Activities & Notes').first().waitFor({ timeout: 20000 });
    const waitUntil = await ready(1100);
    const cap = await caption(page, 'Call · WhatsApp · email · or the AI agent');
    await waitUntil(at('call', 2, -0.2));
    const rc = await ring(page, page.locator('button:has(.lucide-phone-call), button:has(.lucide-phone)').first(), { label: 'Call', accent: '#16a34a' }).catch(() => null);
    await waitUntil(at('whatsapp', 4, -0.2));
    if (rc) await removeAnn(page, rc);
    await clickLocator(page, page.locator('button:has(.lucide-message-circle)').first()).catch(() => {});
    await page.getByText('Send WhatsApp Message').first().waitFor({ timeout: 6000 }).catch(() => {});
    await sleep(page, 700);
    const rw = await ring(page, page.getByText('Send WhatsApp Message').first(), { label: 'WhatsApp · pick a template', accent: '#25D366' }).catch(() => null);
    await waitUntil(at('email', 7, -0.2));
    if (rw) await removeAnn(page, rw);
    await page.keyboard.press('Escape').catch(() => {});
    await sleep(page, 400);
    await clickLocator(page, page.locator('button:has(.lucide-mail)').first()).catch(() => {});
    await page.getByText(/Send Email to/i).first().waitFor({ timeout: 6000 }).catch(() => {});
    await sleep(page, 700);
    const re = await ring(page, page.getByText(/Send Email to/i).first(), { label: 'Email', accent: '#2563eb' }).catch(() => null);
    await waitUntil(D - 0.6);
    if (re) await removeAnn(page, re);
    await page.keyboard.press('Escape').catch(() => {});
    await removeCaption(page, cap);
    await waitUntil(D);
  },
},

// 5 — the AI agent works the pipeline at scale (dialer)
{
  name: 's5-aidialer', account: ACCT.admin,
  narration: "But you don't work thousands of leads one at a time. Hand them to the AI agent. It dials, holds a real conversation, gauges interest, handles the brush-offs, and books the meeting when it's there. Here's a single day of it — hundreds of calls, every one sorted by outcome.",
  beats: async ({ page, at, D, ready }) => {
    await page.goto(`${BASE}/calling-dashboard`, { waitUntil: 'networkidle' });
    await page.getByText('Calling Dashboard').first().waitFor({ timeout: 20000 }).catch(() => {});
    const waitUntil = await ready(1500);
    const cap = await caption(page, 'The AI agent — calling at scale, qualifying, booking', { accent: '#7c3aed' });
    await waitUntil(at('calls', 5, -0.2));
    const r = await ring(page, page.getByText('Total Calls').first(), { label: 'Hundreds of calls, on their own', accent: '#7c3aed' }).catch(() => null);
    await waitUntil(at('meeting', 11, -0.2));
    if (r) await removeAnn(page, r);
    await page.getByText('Call Dispositions').first().evaluate((el) => el.scrollIntoView({ block: 'center' })).catch(() => {});
    await sleep(page, 700);
    const r2 = await ring(page, page.getByText('Call Dispositions').first(), { label: 'Every call sorted by outcome — interested, booked, follow-up', accent: '#16a34a' }).catch(() => null);
    await zoomTo(page, page.getByText('Call Dispositions').first(), 1.15, 1100).catch(() => {});
    await waitUntil(D - 0.7);
    await zoomReset(page, 800).catch(() => {});
    if (r2) await removeAnn(page, r2);
    await removeCaption(page, cap);
    await waitUntil(D);
  },
},

// 5b — proof the AI call is real (recording + transcript + the agent's own read)
{
  name: 's5b-callproof', account: ACCT.admin,
  narration: "And it's not a black box. Every call is recorded, transcribed, and read back to you. Here's the actual conversation with Aarav — and the agent's own summary: interested, decision-maker, demo booked. Proof, on every call.",
  beats: async ({ page, at, D, ready }) => {
    await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle' });
    await page.getByText('Dashboard').first().waitFor({ timeout: 20000 });
    const waitUntil = await ready(1500);
    const cap = await caption(page, 'Recorded · transcribed · read back to you', { accent: '#7c3aed' });
    await clickLocator(page, page.getByRole('tab', { name: /Call Logs/i }).first()).catch(() => {});
    await sleep(page, 900);
    await page.getByPlaceholder(/Search name or phone/i).first().fill('Aarav').catch(() => {});
    await sleep(page, 1000);
    await waitUntil(at('conversation', 4, -0.2));
    await clickLocator(page, page.locator('button:has(.lucide-sparkles)').first()).catch(() => {});
    await page.getByText(/confirmed active interest|decision-maker|Summary/i).first().waitFor({ timeout: 6000 }).catch(() => {});
    await sleep(page, 800);
    const r = await ring(page, page.getByText(/confirmed active interest|decision-maker/i).first(), { label: "The AI's own read — interested · demo booked", accent: '#7c3aed' }).catch(() => null);
    await waitUntil(D - 0.6);
    if (r) await removeAnn(page, r);
    await removeCaption(page, cap);
    await waitUntil(D);
  },
},

// 6 — reusable templates (template studio)
{
  name: 's6-templates', account: ACCT.admin,
  narration: "Every message is on-brand and one click away. Approved WhatsApp and email templates your whole team reuses — no re-typing, nothing off-script.",
  beats: async ({ page, at, D, ready }) => {
    await page.goto(`${BASE}/templates`, { waitUntil: 'networkidle' });
    await page.getByText('Message Templates').first().waitFor({ timeout: 20000 }).catch(() => {});
    const waitUntil = await ready(1300);
    const cap = await caption(page, 'On-brand templates — WhatsApp & email, one click', { accent: '#25D366' });
    await waitUntil(at('templates', 4, -0.2));
    const r = await ring(page, page.locator('[role="tabpanel"] .text-lg, .grid .text-lg').first(), { label: 'Approved · reusable · consistent', accent: '#25D366' }).catch(() => null);
    await waitUntil(at('email', 8, -0.2));
    if (r) await removeAnn(page, r);
    await clickLocator(page, page.getByRole('tab', { name: /email/i }).first()).catch(() => {});
    await sleep(page, 1200);
    await waitUntil(D - 0.5);
    await removeCaption(page, cap);
    await waitUntil(D);
  },
},

// 7 — and they respond (engagement shown live in the journey)
{
  name: 's7-responses', account: ACCT.admin,
  narration: "And every response comes straight back. Delivered, read, replied, opened, clicked — you always know exactly where each lead stands.",
  beats: async ({ page, at, D, ready }) => {
    await page.goto(`${BASE}/contacts/${AARAV}`, { waitUntil: 'networkidle' });
    await page.getByText('Customer Journey').first().waitFor({ timeout: 20000 });
    const waitUntil = await ready(1200);
    const cap = await caption(page, 'Every response, live — delivered · read · replied · opened · clicked', { accent: '#0d9488' });
    await page.mouse.wheel(0, 260).catch(() => {});
    await sleep(page, 500);
    await waitUntil(at('replied', 3, -0.2));
    const r = await ring(page, page.getByText(/Read Jun|Delivered Jun|Read |Delivered /i).first(), { label: 'WhatsApp — delivered · read · replied', accent: '#25D366' }).catch(() => null);
    await waitUntil(at('clicked', 7, -0.2));
    if (r) await removeAnn(page, r);
    await page.mouse.wheel(0, 380).catch(() => {});
    await sleep(page, 500);
    const r2 = await ring(page, page.getByText(/opened|clicked|In-Sync demo/i).first(), { label: 'Email — opened · clicked', accent: '#2563eb' }).catch(() => null);
    await waitUntil(D - 0.5);
    if (r2) await removeAnn(page, r2);
    await removeCaption(page, cap);
    await waitUntil(D);
  },
},

// 8 — the full picture + AI score (reads the engagement)
{
  name: 's8-picture', account: ACCT.admin,
  narration: "It all rolls into one picture — the calls, the messages, the replies — and an AI score that reads the engagement and tells you where to spend your time.",
  beats: async ({ page, at, D, ready }) => {
    await page.goto(`${BASE}/contacts/${AARAV}`, { waitUntil: 'networkidle' });
    await page.getByText('Customer Journey').first().waitFor({ timeout: 20000 });
    const waitUntil = await ready(1200);
    const cap = await caption(page, 'One picture — and an AI score that reads the engagement');
    await waitUntil(at('messages', 6, -0.2));
    const r = await ring(page, page.getByText('Customer Journey').first(), { label: 'Calls · messages · replies — one timeline' }).catch(() => null);
    await waitUntil(at('score', 11, -0.2));
    if (r) await removeAnn(page, r);
    await page.getByText(/Lead Score/i).first().evaluate((el) => el.scrollIntoView({ block: 'center' })).catch(() => {});
    await sleep(page, 600);
    const r2 = await ring(page, page.getByText(/Lead Score/i).first(), { label: 'AI score — warm, where to spend your time', accent: '#7c3aed' }).catch(() => null);
    await zoomTo(page, page.getByText(/Lead Score/i).first(), 1.3, 1100).catch(() => {});
    await waitUntil(D - 0.8);
    await zoomReset(page, 800).catch(() => {});
    if (r2) await removeAnn(page, r2);
    await removeCaption(page, cap);
    await waitUntil(D);
  },
},

// 9 — booked, and it sticks
{
  name: 's9-booked', account: ACCT.admin,
  narration: "Book the demo and it sticks — on the calendar, with a link, and reminders that fire on their own. Fewer no-shows.",
  beats: async ({ page, at, D, ready }) => {
    await page.goto(`${BASE}/contacts/${AARAV}`, { waitUntil: 'networkidle' });
    await page.getByText(/Product demo/i).first().waitFor({ timeout: 20000 }).catch(() => {});
    const waitUntil = await ready(1100);
    await page.getByText(/Product demo/i).first().scrollIntoViewIfNeeded().catch(() => {});
    const cap = await caption(page, 'Booked · reminders fire on their own', { accent: '#0d9488' });
    await waitUntil(at('calendar', 4, -0.2));
    const r = await ring(page, page.getByText(/Product demo/i).first(), { label: 'On the calendar, with a link', accent: '#25D366' }).catch(() => null);
    await waitUntil(D - 0.5);
    if (r) await removeAnn(page, r);
    await removeCaption(page, cap);
    await waitUntil(D);
  },
},

// 10 — the living board
{
  name: 's10-board', account: ACCT.admin,
  narration: "Across the floor, every lead's on the board — its stage, its owner, and the last thing that happened: called, emailed, messaged. No status meeting needed.",
  beats: async ({ page, at, D, ready }) => {
    await page.goto(`${BASE}/pipeline`, { waitUntil: 'networkidle' });
    await page.getByText('All Pipeline Contacts').first().waitFor({ timeout: 20000 }).catch(() => {});
    const waitUntil = await ready(1300);
    const cap = await caption(page, 'Every lead, live — stage · owner · channels');
    await waitUntil(at('owner', 7, -0.2));
    const r = await ring(page, page.getByText(/WhatsApp Outreach/i).first(), { label: 'Called · emailed · messaged — on every card', accent: '#25D366' }).catch(() => null);
    await waitUntil(at('meeting', 14, -0.2));
    if (r) await removeAnn(page, r);
    await removeCaption(page, cap);
    await waitUntil(D);
  },
},

// 11 — the numbers, and just ask
{
  name: 's11-numbers', account: ACCT.admin,
  narration: "And it all rolls up. The AI reads your whole pipeline — every stage, every source — and points straight at the bottlenecks where deals are stalling, so you fix the leak instead of guessing.",
  beats: async ({ page, at, D, ready }) => {
    await page.goto(`${BASE}/reports`, { waitUntil: 'networkidle' });
    await page.getByText(/Insights Hub/i).first().waitFor({ timeout: 20000 }).catch(() => {});
    const waitUntil = await ready(1200);
    // land on AI Insights (populated: pipeline health + bottlenecks); the default
    // Campaign Analytics tab is empty (campaigns are external) and Sales Performance is thin.
    await clickLocator(page, page.getByRole('tab', { name: /AI Insights/i }).first()).catch(() => {});
    await sleep(page, 1600);
    const cap = await caption(page, 'It all rolls up — pipeline intelligence', { accent: '#7c3aed' });
    await waitUntil(at('pipeline', 5, -0.2));
    const r = await ring(page, page.getByText(/Pipeline Bottlenecks Detected/i).first(), { label: 'AI finds where deals stall', accent: '#dc2626' }).catch(() => null);
    await waitUntil(at('stalling', 11, -0.2));
    if (r) await removeAnn(page, r);
    await page.getByText(/Stage Velocity/i).first().evaluate((el) => el.scrollIntoView({ block: 'center' })).catch(() => {});
    await waitUntil(D - 0.4);
    await removeCaption(page, cap).catch(() => {});
    await waitUntil(D);
  },
},

// 12 — every rupee
{
  name: 's12-rupee', account: ACCT.admin,
  narration: "Every call, every message, every rupee — tracked against what it brought back. You always know what growth costs, and what it returns.",
  beats: async ({ page, at, D, ready }) => {
    await page.goto(`${BASE}/billing`, { waitUntil: 'networkidle' });
    await page.getByText(/Wallet|Billing|Subscription/i).first().waitFor({ timeout: 20000 }).catch(() => {});
    const waitUntil = await ready(1200);
    const cap = await caption(page, 'Every rupee — tracked against what it returned');
    await waitUntil(at('rupee', 6, -0.2));
    await zoomTo(page, page.getByText(/Wallet/i).first(), 1.12, 1100).catch(() => {});
    await waitUntil(at('returns', 12, -0.2));
    await zoomReset(page, 900).catch(() => {});
    await waitUntil(D - 0.4);
    await removeCaption(page, cap);
    await waitUntil(D);
  },
},

// 13 — safe by design (DPDP)
{
  name: 's13-dpdp', account: ACCT.admin,
  narration: "And every lead is personal data, protected by design. Consent, access, erasure, retention, encryption — all built in, to the Digital Personal Data Protection Act. Compliance, handled.",
  beats: async ({ page, at, D, ready }) => {
    await page.goto(`${BASE}/admin/data-protection`, { waitUntil: 'networkidle' });
    await page.getByText('Data Protection').first().waitFor({ timeout: 20000 });
    const waitUntil = await ready(1300);
    const cap = await caption(page, 'Every lead is personal data — protected by design');
    await waitUntil(at('consent', 5, -0.2));
    const r = await ring(page, page.getByText(/Consents on file/i).first(), { label: 'Consent · access · erasure · retention' }).catch(() => null);
    await waitUntil(at('encryption', 11, -0.2));
    if (r) await removeAnn(page, r);
    await clickLocator(page, page.getByRole('tab', { name: /Encryption/i }).first()).catch(() => {});
    await sleep(page, 1200);
    await waitUntil(D - 0.5);
    await removeCaption(page, cap);
    await waitUntil(D);
  },
},

// close
{
  name: 's14-close', account: ACCT.guest,
  narration: "One platform for the whole journey — every lead captured, worked across every channel, called by AI, measured to the rupee, and protected by design. Stop losing the pipeline you already have. That's In-Sync.",
  beats: async ({ page, D, ready }) => {
    await page.goto('about:blank').catch(() => {});
    await page.evaluate(brandCard('In-Sync', 'Your whole pipeline — captured, worked, measured, protected.', 'In-Sync Solutions'));
    const waitUntil = await ready(250);
    await waitUntil(D);
  },
},

];

// s5b-callproof cut: its Dashboard Call Logs view is swamped by synced Exotel calls
// (see s1 note); the AI call's realness is already shown in the dialer outcomes and
// the lead-score card's reasoning ("2 connected calls, avg quality 9/10").
const ORDER = ['s0-hook','s1-command','s2-forms','s2b-configure','s3-capture','s4-channels','s5-aidialer','s6-templates','s7-responses','s8-picture','s9-booked','s10-board','s11-numbers','s12-rupee','s13-dpdp','s14-close'];
export const SCENES = ORDER.map((n) => ALL.find((s) => s.name === n)).filter(Boolean);
