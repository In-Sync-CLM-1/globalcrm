import { readFileSync } from 'fs';
export function loadEnv(url) {
  return Object.fromEntries(
    readFileSync(url, 'utf8').split('\n')
      .filter(l => l.includes('=') && !l.trim().startsWith('#'))
      .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
  );
}
