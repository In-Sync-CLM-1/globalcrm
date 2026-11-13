// Injected, recordable cursor with human-like easing + click ripple.
// Lives on <html> so page zoom (which scales <body>) doesn't move it.

export async function installCursor(page, startX = 683, startY = 384) {
  await page.evaluate(({ startX, startY }) => {
    if (document.getElementById('__cur')) return;
    const c = document.createElement('div');
    c.id = '__cur';
    c.style.cssText =
      'position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;will-change:transform;filter:drop-shadow(0 2px 3px rgba(0,0,0,.35))';
    c.innerHTML =
      '<svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M5 3l14 7-6 1.5L9.5 18 5 3z" fill="#ffffff" stroke="#222" stroke-width="1.2" stroke-linejoin="round"/></svg>';
    document.documentElement.appendChild(c);
    window.__cx = startX; window.__cy = startY;
    c.style.transform = `translate(${startX}px,${startY}px)`;
  }, { startX, startY });
}

export async function moveTo(page, x, y, dur = 800) {
  await page.evaluate(({ x, y, dur }) => new Promise((resolve) => {
    const c = document.getElementById('__cur');
    const sx = window.__cx ?? 0, sy = window.__cy ?? 0;
    const t0 = performance.now();
    function step(t) {
      const p = Math.min((t - t0) / dur, 1);
      const e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
      const cx = sx + (x - sx) * e, cy = sy + (y - sy) * e;
      c.style.transform = `translate(${cx}px,${cy}px)`;
      window.__cx = cx; window.__cy = cy;
      if (p < 1) requestAnimationFrame(step); else { window.__cx = x; window.__cy = y; resolve(); }
    }
    requestAnimationFrame(step);
  }), { x, y, dur });
}

export async function ripple(page) {
  await page.evaluate(() => {
    const x = window.__cx, y = window.__cy;
    const r = document.createElement('div');
    r.style.cssText =
      `position:fixed;left:${x}px;top:${y}px;width:10px;height:10px;border:2px solid #2563eb;border-radius:50%;` +
      'z-index:2147483646;pointer-events:none;transform:translate(-50%,-50%);transition:all .45s ease-out;opacity:.9';
    document.documentElement.appendChild(r);
    requestAnimationFrame(() => { r.style.width = '44px'; r.style.height = '44px'; r.style.opacity = '0'; });
    setTimeout(() => r.remove(), 550);
  });
}

async function centerOf(locator) {
  const b = await locator.boundingBox();
  if (!b) throw new Error('element has no bounding box (not visible)');
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

export async function clickLocator(page, locator, { dur = 800, settle = 130 } = {}) {
  await installCursor(page).catch(() => {}); // self-heal after a mid-scene navigation
  const { x, y } = await centerOf(locator);
  await moveTo(page, x, y, dur);
  await ripple(page);
  await page.waitForTimeout(settle);
  await locator.click();
}

export async function moveToLocator(page, locator, dur = 800) {
  await installCursor(page).catch(() => {});
  const { x, y } = await centerOf(locator);
  await moveTo(page, x, y, dur);
}

// Move the cursor to an input, click it, then type character-by-character at a
// human cadence so the fill is visible on camera (not an instant value set).
export async function typeInto(page, locator, text, { moveDur = 400, perChar = 28, settle = 90 } = {}) {
  await installCursor(page).catch(() => {}); // self-heal after a mid-scene navigation
  const { x, y } = await centerOf(locator);
  await moveTo(page, x, y, moveDur);
  await ripple(page);
  await page.waitForTimeout(settle);
  await locator.click();
  await locator.fill('');
  await locator.pressSequentially(text, { delay: perChar });
}
