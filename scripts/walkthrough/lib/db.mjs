// Tiny DB helper for the walkthrough: run SQL against the demo org via the
// Supabase Management API (same path the seed uses). Used to tidy up the
// throwaway rows the scenes create on camera (a submitted lead, a demo custom
// field, a demo form) so re-renders stay clean and the seeded hero data is the
// only "Aarav" on the board.
import { loadEnv } from './env.mjs';

const env = loadEnv(new URL('../../../.env', import.meta.url));
const REF = env.SUPABASE_PROJECT_REF, TOKEN = env.SUPABASE_ACCESS_TOKEN;
export const DEMO = '61f7f96d-e80c-4d9b-a765-8eb32bd3c70d';
const Q = (s) => (s == null ? 'null' : `'${String(s).replace(/'/g, "''")}'`);

export async function sql(query) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json', 'User-Agent': 'curl/8' },
    body: JSON.stringify({ query }),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`SQL ${r.status}: ${t}`);
  return t ? JSON.parse(t) : [];
}

// Remove a lead captured through the public form (by email), plus its children.
export async function deleteFormLead(email) {
  await sql(`
    delete from contact_custom_fields where contact_id in (select id from contacts where org_id=${Q(DEMO)} and source='web_form' and email=${Q(email)});
    delete from contact_activities  where contact_id in (select id from contacts where org_id=${Q(DEMO)} and source='web_form' and email=${Q(email)});
    delete from contacts where org_id=${Q(DEMO)} and source='web_form' and email=${Q(email)};
  `);
}

// Remove a custom field created on camera (by internal field_name), plus refs.
export async function deleteDemoField(fieldName) {
  await sql(`
    delete from form_fields          where custom_field_id in (select id from custom_fields where org_id=${Q(DEMO)} and field_name=${Q(fieldName)});
    delete from contact_custom_fields where custom_field_id in (select id from custom_fields where org_id=${Q(DEMO)} and field_name=${Q(fieldName)});
    delete from custom_fields where org_id=${Q(DEMO)} and field_name=${Q(fieldName)};
  `);
}

// Remove a form built on camera (by name), plus its field links.
export async function deleteDemoForm(name) {
  await sql(`
    delete from form_fields where form_id in (select id from forms where org_id=${Q(DEMO)} and name=${Q(name)});
    delete from forms where org_id=${Q(DEMO)} and name=${Q(name)};
  `);
}
