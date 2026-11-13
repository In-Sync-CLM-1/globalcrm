// In-Sync 60-second COLD CUT — for LinkedIn / WhatsApp outreach.
// Global-standard structure: magic-moment hook (the AI sales call) → one pain
// line → three fast proof beats (form→pipeline, AI dialer, command center) →
// CTA. Recorded at 1920x1080; subtitles + loudness are handled by render-short.
// The chat replay in the hook is the REAL seeded transcript of Riya's call.
import { ACCT } from './lib/scene.mjs';
import { BASE } from './lib/app.mjs';
import { ring, removeAnn, zoomTo, zoomReset } from './lib/annotate.mjs';
import { clickLocator, typeInto } from './lib/cursor.mjs';
import { deleteFormLead } from './lib/db.mjs';

const FORM = 'ff000001-0000-4000-8000-000000000001';
const HD = { width: 1920, height: 1080 };
const sleep = (page, ms) => page.waitForTimeout(ms);

// Full-frame dark card with huge center text (hook claims, pain line, CTA).
// Hides the injected cursor — no arrow on typography frames.
const bigCard = ({ kicker = '', title, sub = '', foot = '' }) => `(() => {
  const c = document.createElement('div'); c.id='__bigcard';
  const st = document.createElement('style'); st.textContent = '#__cur{display:none !important}';
  document.documentElement.appendChild(st);
  c.style.cssText='position:fixed;inset:0;z-index:2147483600;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;background:radial-gradient(120% 120% at 20% 0%,#101c3a 0%,#0b1220 55%,#060a14 100%);padding:0 8%';
  c.innerHTML =
    "<div style=\\"font:700 22px 'Segoe UI',sans-serif;color:#60a5fa;letter-spacing:4px;text-transform:uppercase;margin-bottom:26px;min-height:28px\\">${kicker}</div>" +
    "<div style=\\"font:800 74px 'Segoe UI',sans-serif;color:#fff;letter-spacing:-1.5px;line-height:1.12;max-width:82%\\">${title}</div>" +
    "<div style=\\"font:500 30px 'Segoe UI',sans-serif;color:rgba(255,255,255,.85);margin-top:30px;max-width:66%;line-height:1.4\\">${sub}</div>" +
    "<div style=\\"font:600 19px 'Segoe UI',sans-serif;color:rgba(255,255,255,.55);margin-top:44px;letter-spacing:1px\\">${foot}</div>";
  document.documentElement.appendChild(c);
})()`;

// The hook: a phone-call replay. Chat bubbles of the real AI call appear one by
// one under a REC chip, then the claim stamps over it.
const hookCard = `(() => {
  const st = document.createElement('style');
  st.textContent = '#__cur{display:none !important}'+
    '@keyframes bpop{0%{opacity:0;transform:translateY(14px) scale(.97)}100%{opacity:1;transform:none}}'+
    '@keyframes stamp{0%{opacity:0;transform:scale(1.18)}60%{opacity:1;transform:scale(.98)}100%{opacity:1;transform:scale(1)}}'+
    '@keyframes pulse{0%,100%{opacity:1}50%{opacity:.35}}';
  document.documentElement.appendChild(st);
  const c = document.createElement('div'); c.id='__hook';
  c.style.cssText='position:fixed;inset:0;z-index:2147483600;background:radial-gradient(120% 120% at 20% 0%,#101c3a 0%,#0b1220 55%,#060a14 100%);display:flex;align-items:center;justify-content:center';
  c.innerHTML =
    '<div style="width:760px;max-width:86%">'+
      '<div style="display:flex;align-items:center;gap:14px;margin-bottom:26px">'+
        '<span style="display:inline-flex;align-items:center;gap:8px;background:rgba(220,38,38,.16);border:1px solid rgba(220,38,38,.5);color:#fca5a5;font:700 15px \\'Segoe UI\\',sans-serif;padding:7px 14px;border-radius:999px"><span style="width:9px;height:9px;border-radius:50%;background:#ef4444;animation:pulse 1.2s infinite"></span>REC · LIVE SALES CALL</span>'+
        '<span style="color:rgba(255,255,255,.55);font:600 15px \\'Segoe UI\\',sans-serif;letter-spacing:1px">AI AGENT · RIYA</span>'+
      '</div>'+
      '<div id="__bubbles" style="display:flex;flex-direction:column;gap:12px"></div>'+
    '</div>';
  document.documentElement.appendChild(c);
  const MSGS = [
    ['ai','Hi, am I speaking with Aarav?'],
    ['human','Yes — who is this?'],
    ['ai','I\\'m Riya from In-Sync. Is staff productivity and field tracking something on your radar?'],
    ['human','Actually yes. We\\'ve been looking at exactly that.'],
    ['ai','Wonderful — would a short demo this week help?'],
    ['human','Yes, please set it up.'],
  ];
  const box = c.querySelector('#__bubbles');
  MSGS.forEach(([who, text], i) => {
    setTimeout(() => {
      const b = document.createElement('div');
      const ai = who === 'ai';
      b.style.cssText = 'max-width:78%;padding:14px 20px;border-radius:16px;font:500 22px \\'Segoe UI\\',sans-serif;line-height:1.35;animation:bpop .38s ease both;'+
        (ai ? 'align-self:flex-start;background:#1d2b4f;color:#e6edff;border-bottom-left-radius:4px'
            : 'align-self:flex-end;background:#134e36;color:#dcfce8;border-bottom-right-radius:4px');
      b.textContent = text;
      box.appendChild(b);
    }, 400 + i * 950);
  });
  setTimeout(() => {
    const s = document.createElement('div');
    s.style.cssText='position:fixed;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;background:rgba(4,7,14,.78);backdrop-filter:blur(3px);animation:stamp .5s ease both';
    s.innerHTML = '<div style="font:800 78px \\'Segoe UI\\',sans-serif;color:#fff;letter-spacing:-1.5px;text-align:center;max-width:80%;line-height:1.1">This sales call was made<br>by an AI.</div>'+
      '<div style="font:600 30px \\'Segoe UI\\',sans-serif;color:#4ade80;margin-top:28px">It booked the demo.</div>';
    c.appendChild(s);
  }, 400 + MSGS.length * 950 + 900);
})()`;

export const SCENES = [

// H0 — the magic moment (0–12s)
{
  name: 'h0-hook', account: ACCT.guest, viewport: HD,
  narration: "This sales call was made by an AI. It dialed, held a real conversation, handled the hesitation — and booked the demo. Recording and transcript included.",
  beats: async ({ page, D, ready }) => {
    await page.goto('about:blank').catch(() => {});
    await page.evaluate(hookCard);
    const waitUntil = await ready(250);
    await waitUntil(D);
  },
},

// H1 — the pain, one line (12–18s)
{
  name: 'h1-pain', account: ACCT.guest, viewport: HD,
  narration: "Here's the problem: most of your leads never get a second call. They go cold, sitting in your own pipeline.",
  beats: async ({ page, D, ready }) => {
    await page.goto('about:blank').catch(() => {});
    await page.evaluate(bigCard({
      title: 'Most leads never get a second call.',
      sub: 'They came in. Got one touch. Went cold — in your own pipeline.',
    }));
    const waitUntil = await ready(250);
    await waitUntil(D);
  },
},

// H2a — proof beat 1a: the form fills itself and submits (18–27s)
{
  name: 'h2a-form', account: ACCT.admin, viewport: HD,
  narration: "In-Sync fixes that from the first second. A prospect finds your form, fills it in, hits send —",
  beats: async ({ page, at, D, ready }) => {
    const LEAD_EMAIL = 'aarav.mehta@northwindlogistics.in';
    await deleteFormLead(LEAD_EMAIL).catch(() => {});
    await page.goto(`${BASE}/form/${FORM}`, { waitUntil: 'networkidle' });
    await page.getByText(/Get a Demo/i).first().waitFor({ timeout: 20000 }).catch(() => {});
    const waitUntil = await ready(600);
    // fast, punchy fill — three fields tell the story (first name + email required).
    // The typed cadence also clears the form's 3-second bot floor.
    const fast = { moveDur: 260, perChar: 16, settle: 60 };
    await typeInto(page, page.locator('#first_name'), 'Aarav', fast).catch(() => {});
    // last name matters: it makes the new lead render as "Aarav Mehta", so the
    // next scene's ring locks onto THIS row (top of the table), not the seeded one
    await typeInto(page, page.locator('#last_name'), 'Mehta', fast).catch(() => {});
    await typeInto(page, page.locator('#email'), LEAD_EMAIL, fast).catch(() => {});
    await typeInto(page, page.locator('#company'), 'Northwind Logistics', fast).catch(() => {});
    await waitUntil(Math.min(at('hits send', 5, -0.3), D - 2.2));
    await clickLocator(page, page.getByRole('button', { name: /Submit Form/i }), { dur: 450 }).catch(() => {});
    await page.getByText(/Thank You/i).first().waitFor({ timeout: 12000 }).catch(() => {});
    await waitUntil(D);
    // NOTE: no cleanup here — the next scene reveals this lead on the pipeline.
  },
},

// H2b — proof beat 1b: …and it's already in the pipeline (27–34s).
// Separate scene so the pipeline's page boot happens BEFORE recording resumes
// (trimmed as lead time); the crossfade covers the cut.
{
  name: 'h2b-pipeline', account: ACCT.admin, viewport: HD,
  narration: "and lands in your pipeline that same instant. Enriched, routed, ready to work.",
  beats: async ({ page, D, ready }) => {
    const LEAD_EMAIL = 'aarav.mehta@northwindlogistics.in';
    await page.goto(`${BASE}/pipeline`, { waitUntil: 'domcontentloaded' });
    const nameEl = page.getByText('Aarav Mehta').first();
    await nameEl.waitFor({ timeout: 20000 }).catch(() => {});
    await nameEl.scrollIntoViewIfNeeded().catch(() => {});
    const waitUntil = await ready(400);
    const r = await ring(page, nameEl, { label: 'Landed in your pipeline — that same instant', accent: '#16a34a' }).catch(() => null);
    await waitUntil(D - 0.4);
    if (r) await removeAnn(page, r);
    await waitUntil(D);
    await deleteFormLead(LEAD_EMAIL).catch(() => {});
  },
},

// H3 — proof beat 2: the AI dialer at scale (34–46s)
{
  name: 'h3-dialer', account: ACCT.admin, viewport: HD,
  narration: "Then the AI agent takes over. Hundreds of calls a day, real conversations — every outcome sorted: interested, follow-up, demo booked.",
  beats: async ({ page, at, D, ready }) => {
    await page.goto(`${BASE}/calling-dashboard`, { waitUntil: 'networkidle' });
    await page.getByText('Calling Dashboard').first().waitFor({ timeout: 20000 }).catch(() => {});
    const waitUntil = await ready(1100);
    const r = await ring(page, page.getByText('Total Calls').first(), { label: 'Hundreds of calls — on their own', accent: '#7c3aed' }).catch(() => null);
    await waitUntil(at('every outcome', 6, -0.2));
    if (r) await removeAnn(page, r);
    await page.getByText('Call Dispositions').first().evaluate((el) => el.scrollIntoView({ block: 'center' })).catch(() => {});
    await sleep(page, 500);
    const r2 = await ring(page, page.getByText('Call Dispositions').first(), { label: 'Interested · follow-up · demo booked', accent: '#16a34a' }).catch(() => null);
    await zoomTo(page, page.getByText('Call Dispositions').first(), 1.15, 900).catch(() => {});
    await waitUntil(D - 0.6);
    await zoomReset(page, 700).catch(() => {});
    if (r2) await removeAnn(page, r2);
    await waitUntil(D);
  },
},

// (a "command center" beat was tried here and cut: the month-to-date demo
// dashboard reads nearly empty — "New Leads 1 · Win Rate 0%" — which anti-sells
// on a cold cut. The pipeline table in H2b already carries the one-screen feel.)

// H5 — CTA (45–53s)
{
  name: 'h5-cta', account: ACCT.guest, viewport: HD,
  narration: "Stop losing the pipeline you already paid for. Reply 'demo' — and we'll show you yours, live, this week.",
  beats: async ({ page, D, ready }) => {
    await page.goto('about:blank').catch(() => {});
    await page.evaluate(bigCard({
      title: 'Stop losing the pipeline you already have.',
      sub: "Reply “DEMO” — get a live walkthrough of your pipeline this week.",
      foot: 'In-Sync Solutions',
    }));
    const waitUntil = await ready(250);
    await waitUntil(D);
  },
},

];
