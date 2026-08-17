// globalcrm app driver: simple email + password login (one org per user, no
// org-select). Records against a deployed *.pages.dev URL (set GC_BASE) to
// avoid any apex Cloudflare challenge.
import { loadEnv } from './env.mjs';

const env = loadEnv(new URL('../../../.env', import.meta.url));

// The deployed URL to record against (a Pages preview that includes the
// DPDP + lead-scoring branches). Falls back to the production Pages URL.
export const BASE = (env.GC_BASE || 'https://globalcrm-sync.pages.dev').replace(/\/$/, '');

export const ORG = { id: '61f7f96d-e80c-4d9b-a765-8eb32bd3c70d', name: 'In-Sync Demo' };

// Radix-free login: fill #email + #password, submit, require /dashboard AND a
// persisted Supabase token. The sign-in sometimes toasts success but routes
// back to "/" before the token persists, so we retry the whole flow.
export async function login(page, email, password) {
  const attempt = async () => {
    await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
    await page.locator('#email').fill(email, { timeout: 25000 });
    await page.locator('#password').fill(password);
    await page.getByRole('button', { name: /^sign in$/i }).click();
    await page.waitForURL(/\/dashboard|\/platform-admin/, { timeout: 20000 });
    await page.waitForFunction(
      () => Object.keys(localStorage).some((k) => /sb-.*-auth-token/.test(k) && localStorage.getItem(k)),
      undefined, { timeout: 8000 },
    );
  };
  let err;
  for (let i = 0; i < 6; i++) {
    try { await attempt(); await page.waitForLoadState('networkidle').catch(() => {}); return; }
    catch (e) { err = e; await page.waitForTimeout(1500); }
  }
  throw err;
}

export const contactUrl = (id) => `${BASE}/contacts/${id}`;
