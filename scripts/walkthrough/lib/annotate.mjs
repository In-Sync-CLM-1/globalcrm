// Recordable annotations: highlight ring + label, lower-third caption, a camera
// punch-in (zoom), a dim layer, and real-screenshot notification cards.
// Overlays live on <html> so they aren't scaled by zoom.
import { readFileSync } from 'fs';

let seq = 0;

export async function dim(page, on = true) {
  await page.evaluate((on) => {
    let d = document.getElementById('__dim');
    if (on) {
      if (!d) {
        d = document.createElement('div');
        d.id = '__dim';
        d.style.cssText = 'position:fixed;inset:0;background:rgba(13,15,22,.6);z-index:2147483620;opacity:0;transition:opacity .5s;pointer-events:none';
        document.documentElement.appendChild(d);
      }
      requestAnimationFrame(() => { d.style.opacity = '1'; });
    } else if (d) { d.style.opacity = '0'; setTimeout(() => d.remove(), 520); }
  }, on);
}

export async function showCard(page, imgPath, opts = {}) {
  const { top = 80, right = 36, width = 340, label = '', accent = '#25D366', icon = '' } = opts;
  const dataUri = 'data:image/png;base64,' + readFileSync(imgPath).toString('base64');
  const id = '__card' + (++seq);
  await page.evaluate(({ dataUri, id, top, right, width, label, accent, icon }) => {
    const card = document.createElement('div');
    card.id = id;
    card.style.cssText =
      `position:fixed;right:${right}px;top:${top}px;width:${width}px;z-index:2147483630;border-radius:14px;` +
      'overflow:hidden;box-shadow:0 20px 55px rgba(0,0,0,.35);background:#fff;opacity:0;transform:translateX(80px);' +
      'transition:opacity .5s ease,transform .55s cubic-bezier(.22,1.2,.36,1)';
    const head = label
      ? `<div style="display:flex;align-items:center;gap:8px;background:${accent};color:#fff;font:700 14px 'Segoe UI',sans-serif;padding:10px 14px">${icon}${label}</div>`
      : '';
    card.innerHTML = head + `<img src="${dataUri}" style="display:block;width:100%"/>`;
    document.documentElement.appendChild(card);
    requestAnimationFrame(() => { card.style.opacity = '1'; card.style.transform = 'translateX(0)'; });
  }, { dataUri, id, top, right, width, label, accent, icon });
  return id;
}

export async function hideCard(page, id) {
  await page.evaluate((id) => {
    const c = document.getElementById(id);
    if (c) { c.style.opacity = '0'; c.style.transform = 'translateX(80px)'; setTimeout(() => c.remove(), 560); }
  }, id);
}

export async function ring(page, locator, { label, accent = '#2563eb' } = {}) {
  const box = await locator.boundingBox();
  if (!box) return null;
  const id = '__ann' + (++seq);
  await page.evaluate(({ box, label, id, accent }) => {
    const pad = 6;
    const r = document.createElement('div');
    r.id = id;
    r.style.cssText =
      `position:fixed;left:${box.x - pad}px;top:${box.y - pad}px;width:${box.width + pad * 2}px;height:${box.height + pad * 2}px;` +
      `border:2.5px solid ${accent};border-radius:10px;box-shadow:0 0 0 4px ${accent}33,0 0 18px ${accent}88;` +
      'z-index:2147483640;pointer-events:none;opacity:0;transition:opacity .3s';
    document.documentElement.appendChild(r);
    if (label) {
      const l = document.createElement('div');
      l.id = id + 'l';
      l.textContent = label;
      l.style.cssText =
        `position:fixed;left:${box.x - pad}px;top:${box.y - pad - 34}px;background:${accent};color:#fff;` +
        "font:600 13px 'Segoe UI',sans-serif;padding:5px 11px;border-radius:8px;z-index:2147483641;pointer-events:none;" +
        'opacity:0;transition:opacity .3s;white-space:nowrap;box-shadow:0 4px 10px rgba(0,0,0,.2)';
      document.documentElement.appendChild(l);
      requestAnimationFrame(() => { l.style.opacity = '1'; });
    }
    requestAnimationFrame(() => { r.style.opacity = '1'; });
  }, { box, label, id, accent });
  return id;
}

export async function removeAnn(page, id) {
  if (!id) return;
  await page.evaluate((id) => {
    for (const e of [document.getElementById(id), document.getElementById(id + 'l')]) {
      if (e) { e.style.opacity = '0'; setTimeout(() => e.remove(), 320); }
    }
  }, id);
}

export async function caption(page, text, { ms = 0, accent } = {}) {
  const id = '__cap' + (++seq);
  await page.evaluate(({ text, id, accent }) => {
    const c = document.createElement('div');
    c.id = id;
    c.textContent = text;
    const bg = accent ? accent : 'rgba(17,24,39,.92)';
    c.style.cssText =
      'position:fixed;left:50%;bottom:48px;transform:translateX(-50%) translateY(12px);max-width:74%;' +
      `background:${bg};color:#fff;font:500 17px 'Segoe UI',sans-serif;padding:12px 22px;border-radius:12px;` +
      'z-index:2147483642;pointer-events:none;opacity:0;transition:opacity .35s,transform .35s;text-align:center;backdrop-filter:blur(4px)';
    document.documentElement.appendChild(c);
    requestAnimationFrame(() => { c.style.opacity = '1'; c.style.transform = 'translateX(-50%) translateY(0)'; });
  }, { text, id, accent });
  if (ms > 0) { await page.waitForTimeout(ms); await removeCaption(page, id); }
  return id;
}

export async function removeCaption(page, id) {
  await page.evaluate((id) => {
    const c = document.getElementById(id);
    if (c) { c.style.opacity = '0'; setTimeout(() => c.remove(), 380); }
  }, id);
}

export async function zoomTo(page, locator, scale = 1.4, dur = 900) {
  const b = await locator.boundingBox();
  const x = b ? b.x + b.width / 2 : 683, y = b ? b.y + b.height / 2 : 384;
  await page.evaluate(({ x, y, scale, dur }) => {
    document.documentElement.style.overflow = 'hidden';
    const body = document.body;
    body.style.transition = `transform ${dur}ms cubic-bezier(.22,.61,.36,1)`;
    body.style.transformOrigin = `${x}px ${y}px`;
    body.style.transform = `scale(${scale})`;
  }, { x, y, scale, dur });
  await page.waitForTimeout(dur);
}

export async function zoomReset(page, dur = 650) {
  await page.evaluate((dur) => {
    const body = document.body;
    body.style.transition = `transform ${dur}ms cubic-bezier(.22,.61,.36,1)`;
    body.style.transform = 'scale(1)';
  }, dur);
  await page.waitForTimeout(dur);
}

// Chapter chip: a persistent top-center pill ("3 · Capture on autopilot") so a
// presenter and prospect always know where they are in the run. Survives for the
// whole scene; no removal needed (the context closes with the scene).
export async function chapter(page, num, title, accent = '#2563eb') {
  const id = '__chap' + (++seq);
  await page.evaluate(({ id, num, title, accent }) => {
    const c = document.createElement('div');
    c.id = id;
    c.style.cssText =
      'position:fixed;top:14px;left:50%;transform:translateX(-50%) translateY(-8px);z-index:2147483643;display:flex;align-items:center;gap:10px;' +
      'background:rgba(13,18,32,.88);backdrop-filter:blur(6px);border-radius:999px;padding:7px 16px 7px 8px;' +
      'box-shadow:0 6px 18px rgba(0,0,0,.28);opacity:0;transition:opacity .4s,transform .4s;pointer-events:none';
    c.innerHTML =
      `<span style="display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:50%;background:${accent};color:#fff;font:700 13px 'Segoe UI',sans-serif">${num}</span>` +
      `<span style="color:#fff;font:600 14px 'Segoe UI',sans-serif;letter-spacing:.2px">${title}</span>`;
    document.documentElement.appendChild(c);
    requestAnimationFrame(() => { c.style.opacity = '1'; c.style.transform = 'translateX(-50%) translateY(0)'; });
  }, { id, num, title, accent });
  return id;
}
