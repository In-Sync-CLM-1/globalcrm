// Staging-time cleanup for contact uploads (opt-in per org via
// organizations.settings.import_cleanup.enabled).
//
// Runs on the rows of a CSV after column mapping and BEFORE they are written
// to import_staging, so the clean values are what get imported:
//   - deterministic: names to Title Case, phones to +91XXXXXXXXXX (invalid
//     phones dropped and noted), emails lower-cased / validated
//   - AI (Groq, Cerebras as backup): maps the DISTINCT free-text values the file
//     used for stage / source / product(game) / city onto the org's own lists
//     (stage names, source list, game list) and standard city names. One call
//     per chunk over distinct values only, so cost stays flat on big files.
// Any AI failure leaves the value as uploaded -- cleanup never blocks an import.

export interface CleanupVocab {
  stages: { id: string; name: string }[];
  sources: string[];
  products: string[];
}

const GROQ_MODEL = 'openai/gpt-oss-120b';
const CEREBRAS_MODEL = 'gpt-oss-120b';

export function titleCaseName(s: string): string {
  const t = (s || '').trim().replace(/\s+/g, ' ');
  if (!t) return '';
  // Per word: only touch words typed all-lower or ALL-UPPER; leave deliberate
  // mixed case such as "McDonald" or "D'Souza" alone.
  return t.split(' ').map((w) => (w === w.toLowerCase() || w === w.toUpperCase())
    ? w.toLowerCase().replace(/(^|['\-.])([a-z])/g, (_m, p, c) => p + c.toUpperCase())
    : w).join(' ');
}

// Returns +91XXXXXXXXXX for a valid Indian mobile, otherwise null.
export function normalizeIndianPhone(raw: string): string | null {
  let d = (raw || '').replace(/\D/g, '');
  if (d.length === 12 && d.startsWith('91')) d = d.slice(2);
  else if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  else if (d.length === 13 && d.startsWith('091')) d = d.slice(3);
  return /^[6-9]\d{9}$/.test(d) ? '+91' + d : null;
}

export function cleanEmail(raw: string): string | null {
  const e = (raw || '').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : null;
}

const norm = (v: string) => v.trim().toLowerCase();

async function askModel(url: string, key: string, model: string, system: string, user: string): Promise<Record<string, any> | null> {
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      }),
    });
    if (!resp.ok) {
      console.error('[IMPORT-CLEANUP] model call failed:', url, resp.status, (await resp.text()).slice(0, 200));
      return null;
    }
    const data = await resp.json();
    const text = String(data.choices?.[0]?.message?.content ?? '').trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
    return JSON.parse(text);
  } catch (e) {
    console.error('[IMPORT-CLEANUP] model call error:', e);
    return null;
  }
}

const SYSTEM_PROMPT =
  'You clean up values from an uploaded lead spreadsheet for a CRM. You get JSON with up to four groups of free-text values the file used, ' +
  'and the allowed canonical lists. For each group, map every value to the single best canonical entry, or null if nothing fits confidently. ' +
  'Groups: "stage" -> must be one of allowed.stage (e.g. "hot lead" means interested, "signed up" means registered); ' +
  '"source" -> must be one of allowed.source (e.g. "fb" is Facebook Ads, "insta" is Instagram Ads); ' +
  '"product" -> must be one of allowed.product; ' +
  '"city" -> the standard current English city name (e.g. Bombay -> Mumbai, Bangalore -> Bengaluru, Gurgaon -> Gurugram), or null if it is not a city. ' +
  'Never invent entries outside the allowed lists. Respond with ONLY JSON of the shape ' +
  '{"stage": {"<input value>": "<canonical or null>"}, "source": {...}, "product": {...}, "city": {...}} and no prose.';

export interface CleanupStats { rows: number; phonesDropped: number; emailsDropped: number; aiCalls: number; aiMapped: number }

// Cleans one chunk of staged records in place. Each record may carry a `_raw`
// object ({stage, source, product}) holding the file's original free text; it is
// consumed (deleted) here so it never reaches the contacts insert.
export async function cleanContactChunk(
  records: Array<{ row_index: number; record: any }>,
  vocab: CleanupVocab,
  keys: { groq?: string; cerebras?: string },
): Promise<CleanupStats> {
  const stats: CleanupStats = { rows: records.length, phonesDropped: 0, emailsDropped: 0, aiCalls: 0, aiMapped: 0 };
  const stageByName = new Map(vocab.stages.map((s) => [norm(s.name), s.id]));
  const sourceByName = new Map(vocab.sources.map((s) => [norm(s), s]));
  const productByName = new Map(vocab.products.map((s) => [norm(s), s]));

  // 1. deterministic pass + collect the values AI has to resolve
  const need = { stage: new Set<string>(), source: new Set<string>(), product: new Set<string>(), city: new Set<string>() };
  for (const { record: r } of records) {
    r.first_name = titleCaseName(r.first_name);
    r.last_name = titleCaseName(r.last_name);
    if (r.phone) {
      const p = normalizeIndianPhone(r.phone);
      if (p) r.phone = p;
      else {
        stats.phonesDropped++;
        r.notes = [r.notes, `Phone in file was not a valid mobile number: ${r.phone}`].filter(Boolean).join(' | ');
        r.phone = null;
      }
    }
    if (r.email) {
      const e = cleanEmail(r.email);
      if (!e) stats.emailsDropped++;
      r.email = e;
    }
    const raw = r._raw || {};
    const rs = String(raw.stage ?? '').trim();
    const rsrc = String(raw.source ?? '').trim();
    const rp = String(raw.product ?? '').trim();
    if (rs && !stageByName.has(norm(rs))) need.stage.add(rs);
    if (rsrc && !sourceByName.has(norm(rsrc))) need.source.add(rsrc);
    if (rp && !productByName.has(norm(rp))) need.product.add(rp);
    if (r.city) need.city.add(String(r.city).trim());
  }

  // 2. one AI call over the distinct values
  let ai: Record<string, Record<string, string | null>> = {};
  const total = need.stage.size + need.source.size + need.product.size + need.city.size;
  if (total > 0) {
    const payload = JSON.stringify({
      allowed: { stage: vocab.stages.map((s) => s.name), source: vocab.sources, product: vocab.products },
      values: { stage: [...need.stage], source: [...need.source], product: [...need.product], city: [...need.city] },
    });
    stats.aiCalls++;
    let out: Record<string, any> | null = null;
    if (keys.groq) out = await askModel('https://api.groq.com/openai/v1/chat/completions', keys.groq, GROQ_MODEL, SYSTEM_PROMPT, payload);
    if (!out && keys.cerebras) out = await askModel('https://api.cerebras.ai/v1/chat/completions', keys.cerebras, CEREBRAS_MODEL, SYSTEM_PROMPT, payload);
    if (out && typeof out === 'object') ai = out;
  }
  const pick = (group: string, value: string, allowed?: Map<string, string>): string | null => {
    const m = ai[group]?.[value];
    if (typeof m !== 'string' || !m.trim()) return null;
    if (!allowed) return m.trim(); // city: free standard name
    const hit = allowed.get(norm(m)); // must be an allowed entry, whatever the model said
    return hit ?? null;
  };

  // 3. apply
  for (const { record: r } of records) {
    const raw = r._raw || {};
    delete r._raw;

    const rs = String(raw.stage ?? '').trim();
    if (rs) {
      const id = stageByName.get(norm(rs)) ?? (() => { const n = pick('stage', rs, new Map(vocab.stages.map((s) => [norm(s.name), s.name]))); return n ? stageByName.get(norm(n)) : undefined; })();
      if (id) { r.pipeline_stage_id = id; if (!stageByName.has(norm(rs))) stats.aiMapped++; }
    }
    const rsrc = String(raw.source ?? '').trim();
    if (rsrc) {
      const s = sourceByName.get(norm(rsrc)) ?? pick('source', rsrc, sourceByName);
      r.source = s ?? rsrc; // keep what the file said when nothing matches
      if (s && !sourceByName.has(norm(rsrc))) stats.aiMapped++;
    }
    const rp = String(raw.product ?? '').trim();
    if (rp) {
      const p = productByName.get(norm(rp)) ?? pick('product', rp, productByName);
      r.product = p ?? rp;
      if (p && !productByName.has(norm(rp))) stats.aiMapped++;
    }
    if (r.city) {
      const c = pick('city', String(r.city).trim());
      if (c) { if (c !== r.city) stats.aiMapped++; r.city = c; }
    }
  }
  return stats;
}
