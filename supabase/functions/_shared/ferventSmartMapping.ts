// Smart-formatting layer for Fervent Database uploads.
//
// The uploader hands us a file in *whatever* layout they happen to have —
// columns named differently, in a different order, some missing, some extra.
// This module figures out what each column actually is, derives fields that
// aren't present but can be safely inferred (e.g. a person's name from their
// email), and produces the canonical row shape the existing import pipeline
// expects. It never guesses a person into existence: if it can't confidently
// understand the file's shape, it rejects the whole file with a reason.
//
// Deno edge-function module (can't import from src/). The value-cleaning
// helpers (employee-size banding, turnover parsing) live in
// ./ferventFieldNormalization.ts and are applied downstream when the record
// is built; this module only handles column mapping + field derivation +
// the accept/reject decision.

// --- Canonical fields ------------------------------------------------------
// The row keys we emit, matching what process-bulk-import's record builder
// reads. Descriptions are handed to the AI so it can place unusual columns.
export const CANONICAL_FIELDS: { key: string; desc: string }[] = [
  { key: 'sr_no', desc: 'Serial number / row number' },
  { key: 'unique_id', desc: 'Unique record ID from the source database' },
  { key: 'db_sourced_year', desc: 'Year the data was sourced' },
  { key: 'ucdb_status', desc: 'UCDB status flag' },
  { key: 'company_name', desc: 'Company / organisation / employer / account name' },
  { key: 'first_name', desc: 'Person first / given name' },
  { key: 'last_name', desc: 'Person last name / surname / family name' },
  { key: 'designation', desc: 'Job title / designation / role / position' },
  { key: 'department', desc: 'Department / function / division' },
  { key: 'designation_level', desc: 'Seniority level (e.g. CXO, VP, Manager)' },
  { key: 'city', desc: 'City / town' },
  { key: 'state', desc: 'State / province / region' },
  { key: 'country', desc: 'Country' },
  { key: 'std_code', desc: 'STD / area dialling code' },
  { key: 'mobile_number_1', desc: 'Primary mobile / cell phone number' },
  { key: 'mobile_number_2', desc: 'Secondary / alternate mobile number' },
  { key: 'direct_number', desc: 'Direct line / direct-dial number' },
  { key: 'phone_number', desc: 'Landline / office / general phone number' },
  { key: 'official_email', desc: 'Official / work / business email address' },
  { key: 'personal_email_1', desc: 'Personal / alternate email address' },
  { key: 'personal_email_2', desc: 'Second personal / alternate email address' },
  { key: 'linkedin_url', desc: "Person's LinkedIn profile URL" },
  { key: 'domain_name', desc: 'Company website domain (e.g. acme.com)' },
  { key: 'website', desc: 'Company website URL' },
  { key: 'industry', desc: 'Industry / sector / vertical' },
  { key: 'sub_industry', desc: 'Sub-industry / sub-sector' },
  { key: 'employee_size', desc: 'Company employee headcount / size' },
  { key: 'turnover', desc: 'Company annual turnover / revenue' },
  { key: 'company_linkedin_url', desc: 'Company LinkedIn page URL' },
];

// Fields that let a record be identified/deduped. If none of these can be
// mapped (and there's no name column to derive from), the file is unusable.
const IDENTITY_FIELDS = [
  'first_name', 'last_name',
  'official_email', 'personal_email_1', 'personal_email_2',
  'mobile_number_1', 'mobile_number_2', 'direct_number', 'phone_number',
];

// --- Header synonyms (deterministic first pass) ----------------------------
// Normalised header text -> canonical field. Covers the exact template plus
// the common real-world variants we see across sources. The AI pass refines
// anything left over and settles genuine ambiguity.
const SYNONYMS: Record<string, string[]> = {
  sr_no: ['sr_no', 'srno', 'sr', 'serial', 'serial_no', 'serial_number', 'sno', 's_no'],
  unique_id: ['unique_id', 'uniqueid', 'uid', 'id', 'record_id', 'recordid'],
  db_sourced_year: ['db_sourced_year', 'sourced_year', 'source_year', 'data_year', 'year'],
  ucdb_status: ['ucdb_status', 'ucdb', 'status'],
  company_name: ['company_name', 'company', 'companyname', 'organization', 'organisation', 'organization_name', 'organisation_name', 'org', 'account', 'account_name', 'employer'],
  first_name: ['first_name', 'firstname', 'fname', 'given_name', 'first'],
  last_name: ['last_name', 'lastname', 'lname', 'surname', 'family_name', 'last'],
  designation: ['designation', 'title', 'job_title', 'jobtitle', 'role', 'position', 'job_role'],
  department: ['department', 'dept', 'function', 'division'],
  designation_level: ['designation_level', 'level', 'seniority', 'seniority_level', 'management_level'],
  city: ['city', 'town', 'location_city'],
  state: ['state', 'province', 'region', 'location_state'],
  country: ['country', 'nation', 'location_country'],
  std_code: ['std_code', 'std', 'area_code', 'stdcode'],
  mobile_number_1: ['mobile_number_1', 'mobile_1', 'mobile', 'mobile_no', 'mobile_number', 'cell', 'cell_phone', 'cellphone', 'mobile1', 'mobileno1', 'mobile_no_1', 'phone_1'],
  mobile_number_2: ['mobile_number_2', 'mobile_2', 'mobile_no_2', 'mobile2', 'alternate_mobile', 'phone_2'],
  direct_number: ['direct_number', 'direct', 'direct_line', 'direct_dial', 'ddi'],
  phone_number: ['phone_number', 'phone', 'telephone', 'landline', 'office_number', 'office_phone', 'contact_no', 'contact_number', 'tel'],
  official_email: ['official_email_id', 'official_email', 'work_email', 'company_email', 'business_email', 'email', 'email_id', 'email_address', 'emailid', 'work_email_id'],
  personal_email_1: ['personal_email_id_1', 'personal_email_1', 'personal_email', 'personal_email_id', 'alternate_email', 'other_email', 'email_2'],
  personal_email_2: ['personal_email_id_2', 'personal_email_2', 'email_3'],
  linkedin_url: ['contact_linkedin_id', 'contact_linkedin', 'linkedin_url', 'linkedin', 'linkedin_profile', 'linkedin_id', 'personal_linkedin'],
  domain_name: ['domain_name', 'domain', 'web_domain'],
  website: ['website', 'web', 'url', 'company_website', 'site', 'web_url', 'webpage'],
  industry: ['industry', 'sector', 'vertical', 'industry_type'],
  sub_industry: ['subindustry', 'sub_industry', 'sub_sector', 'sub_vertical'],
  employee_size: ['employee_size', 'employees', 'employee_count', 'headcount', 'company_size', 'size', 'no_of_employees', 'number_of_employees', 'staff_size', 'emp_size'],
  turnover: ['turnover', 'revenue', 'annual_revenue', 'annual_turnover', 'sales', 'company_revenue'],
  company_linkedin_url: ['company_linkedin_id', 'company_linkedin', 'company_linkedin_url', 'organization_linkedin', 'organisation_linkedin'],
};

// Headers that hold a combined full name we should split into first/last.
const FULL_NAME_HEADERS = ['name', 'full_name', 'fullname', 'contact_name', 'contact', 'person_name', 'person', 'contact_person'];

// Local-parts that are role mailboxes, not people — never derive a person's
// name from these.
const GENERIC_MAILBOXES = new Set([
  'info', 'sales', 'contact', 'contactus', 'admin', 'hr', 'support', 'careers',
  'jobs', 'marketing', 'enquiry', 'enquiries', 'inquiry', 'office', 'hello',
  'team', 'mail', 'noreply', 'no-reply', 'service', 'services', 'help',
  'billing', 'accounts', 'finance', 'feedback', 'general', 'reception', 'sale',
]);

export function normalizeHeader(header: string): string {
  return header.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
}

export interface FerventMapping {
  fieldToIndex: Record<string, number>;
  fullNameIndex: number | null;
  rawHeaders: string[];
}

export interface FerventMappingResult {
  mapping?: FerventMapping;
  reject: boolean;
  rejectReason?: string;
  // For logging/audit: which canonical fields resolved to which source header.
  resolved?: Record<string, string>;
  usedAi: boolean;
}

// Build a deterministic field->index map from the header synonyms. First
// occurrence wins; a canonical field is only assigned once (a second column
// that maps to an already-filled field is left for the AI pass to place).
function deterministicMap(synonyms: Record<string, string[]>, normHeaders: string[]): Record<string, number> {
  const lookup = new Map<string, string>();
  for (const [field, variants] of Object.entries(synonyms)) {
    for (const v of variants) if (!lookup.has(v)) lookup.set(v, field);
  }
  const fieldToIndex: Record<string, number> = {};
  normHeaders.forEach((h, idx) => {
    const field = lookup.get(h);
    if (field && !(field in fieldToIndex)) fieldToIndex[field] = idx;
  });
  return fieldToIndex;
}

function detectFullNameIndex(normHeaders: string[], fieldToIndex: Record<string, number>): number | null {
  if ('first_name' in fieldToIndex) return null; // already have a real first-name column
  for (let i = 0; i < normHeaders.length; i++) {
    if (FULL_NAME_HEADERS.includes(normHeaders[i])) return i;
  }
  return null;
}

// --- AI refinement ---------------------------------------------------------
const GROQ_MODEL = 'llama-3.3-70b-versatile';
const HAIKU_MODEL = 'claude-haiku-4-5';

const MAPPING_SYSTEM_PROMPT =
  'You map the columns of an uploaded B2B contact spreadsheet onto a fixed set of canonical database fields. ' +
  'You are given the list of canonical fields (with descriptions), the uploaded file\'s column headers, and a few sample rows. ' +
  'For each canonical field you are CONFIDENT about, return which uploaded header supplies it. Only map a field when the header name and/or the sample values clearly support it; leave uncertain fields out rather than guessing. ' +
  'Use the special field name "full_name" if a single column holds a person\'s complete name (first and last together). ' +
  'Ignore columns that do not correspond to any canonical field. ' +
  'Set "reject" to true ONLY if the file is fundamentally unusable — e.g. it is clearly not a contact/company list, the columns are unintelligible, or two different columns both appear to be the same critical field in a way you cannot resolve. ' +
  'Respond with ONLY JSON of the exact shape {"mapping": {"<canonical_field_or_full_name>": "<exact uploaded header text>", ...}, "reject": <true|false>, "reject_reason": "<short reason or empty>"} and no prose.';

interface AiMapping {
  mapping: Record<string, string>;
  reject: boolean;
  reject_reason: string;
}

function parseAiMapping(text: string): AiMapping | null {
  try {
    const clean = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
    const parsed = JSON.parse(clean);
    if (!parsed || typeof parsed !== 'object' || typeof parsed.mapping !== 'object') return null;
    return {
      mapping: parsed.mapping || {},
      reject: parsed.reject === true,
      reject_reason: typeof parsed.reject_reason === 'string' ? parsed.reject_reason : '',
    };
  } catch {
    return null;
  }
}

function buildAiUserContent(canonicalFields: { key: string; desc: string }[], rawHeaders: string[], sampleRows: string[][]): string {
  const samples = sampleRows.slice(0, 5).map((r) =>
    rawHeaders.reduce((acc, h, i) => {
      const v = (r[i] || '').trim();
      if (v) acc[h] = v.length > 60 ? v.slice(0, 60) : v;
      return acc;
    }, {} as Record<string, string>),
  );
  return JSON.stringify({
    canonical_fields: canonicalFields,
    uploaded_headers: rawHeaders,
    sample_rows: samples,
  });
}

async function callGroqMapping(systemPrompt: string, userContent: string): Promise<AiMapping | null> {
  const key = Deno.env.get('GROQ_API_KEY');
  if (!key) return null;
  try {
    const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: GROQ_MODEL,
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent },
        ],
      }),
    });
    if (!resp.ok) {
      console.error('[SMART-MAP] Groq mapping failed:', resp.status, await resp.text());
      return null;
    }
    const data = await resp.json();
    return parseAiMapping(data.choices?.[0]?.message?.content ?? '');
  } catch (e) {
    console.error('[SMART-MAP] Groq mapping error:', e);
    return null;
  }
}

async function callHaikuMapping(systemPrompt: string, userContent: string): Promise<AiMapping | null> {
  const key = Deno.env.get('ANTHROPIC_API_KEY');
  if (!key) return null;
  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: HAIKU_MODEL,
        max_tokens: 1024,
        system: systemPrompt,
        messages: [{ role: 'user', content: userContent }],
      }),
    });
    if (!resp.ok) {
      console.error('[SMART-MAP] Haiku mapping failed:', resp.status, await resp.text());
      return null;
    }
    const data = await resp.json();
    return parseAiMapping(data.content?.[0]?.text ?? '');
  } catch (e) {
    console.error('[SMART-MAP] Haiku mapping error:', e);
    return null;
  }
}

// Match an AI-returned header string back to a column index. Tries exact,
// then normalised equality.
function headerIndex(rawHeaders: string[], normHeaders: string[], wanted: string): number {
  const exact = rawHeaders.indexOf(wanted);
  if (exact >= 0) return exact;
  const wn = normalizeHeader(wanted);
  return normHeaders.indexOf(wn);
}

// Build the full mapping for a file: deterministic synonyms first, AI to
// refine leftovers and settle ambiguity, then the structural accept/reject
// decision. Fails open to the deterministic map if AI is unavailable.
// Generic engine behind buildFerventMapping/buildContactsMapping — parameterised
// on the canonical field list + synonyms + identity fields so other import
// types can reuse the same AI-assisted column-mapping without duplicating the
// Groq/Haiku plumbing.
async function buildSmartMapping(
  canonicalFields: { key: string; desc: string }[],
  synonyms: Record<string, string[]>,
  identityFields: string[],
  rawHeaders: string[],
  sampleRows: string[][],
  systemPrompt: string,
  noIdentityMessage: string,
): Promise<FerventMappingResult> {
  const normHeaders = rawHeaders.map(normalizeHeader);
  const fieldToIndex = deterministicMap(synonyms, normHeaders);

  const userContent = buildAiUserContent(canonicalFields, rawHeaders, sampleRows);
  const ai = await callGroqMapping(systemPrompt, userContent) ?? await callHaikuMapping(systemPrompt, userContent);
  const usedAi = ai !== null;

  let fullNameIndex: number | null = null;

  if (ai) {
    if (ai.reject) {
      return { reject: true, rejectReason: ai.reject_reason || 'The file could not be understood as a contact list.', usedAi };
    }
    // AI mapping takes precedence; it saw the sample values, not just headers.
    const usedIndices = new Set<number>();
    const aiFieldToIndex: Record<string, number> = {};
    for (const [field, header] of Object.entries(ai.mapping)) {
      if (typeof header !== 'string') continue;
      const idx = headerIndex(rawHeaders, normHeaders, header);
      if (idx < 0 || usedIndices.has(idx)) continue;
      if (field === 'full_name') {
        if (fullNameIndex === null) { fullNameIndex = idx; usedIndices.add(idx); }
        continue;
      }
      if (!(field in aiFieldToIndex) && canonicalFields.some((f) => f.key === field)) {
        aiFieldToIndex[field] = idx;
        usedIndices.add(idx);
      }
    }
    // Fill any gaps the AI left using the deterministic guesses (only for
    // fields it didn't assign, and columns it didn't consume).
    for (const [field, idx] of Object.entries(fieldToIndex)) {
      if (!(field in aiFieldToIndex) && !usedIndices.has(idx)) {
        aiFieldToIndex[field] = idx;
        usedIndices.add(idx);
      }
    }
    Object.keys(fieldToIndex).forEach((k) => delete fieldToIndex[k]);
    Object.assign(fieldToIndex, aiFieldToIndex);
  }

  if (fullNameIndex === null) fullNameIndex = detectFullNameIndex(normHeaders, fieldToIndex);

  const hasIdentity = identityFields.some((f) => f in fieldToIndex) || fullNameIndex !== null;
  if (!hasIdentity) {
    return { reject: true, rejectReason: noIdentityMessage, usedAi };
  }

  const resolved: Record<string, string> = {};
  for (const [field, idx] of Object.entries(fieldToIndex)) resolved[field] = rawHeaders[idx] ?? '';
  if (fullNameIndex !== null) resolved['full_name'] = rawHeaders[fullNameIndex] ?? '';

  return { mapping: { fieldToIndex, fullNameIndex, rawHeaders }, reject: false, resolved, usedAi };
}

const NO_IDENTITY_MESSAGE =
  'The file has no name, email, or phone column we could recognise, so its records can\'t be identified. ' +
  'Please make sure it includes at least a name, an email, or a phone number and upload again.';

export async function buildFerventMapping(rawHeaders: string[], sampleRows: string[][]): Promise<FerventMappingResult> {
  return buildSmartMapping(CANONICAL_FIELDS, SYNONYMS, IDENTITY_FIELDS, rawHeaders, sampleRows, MAPPING_SYSTEM_PROMPT, NO_IDENTITY_MESSAGE);
}

// --- Contacts import (RMPL, In-Sync Demo, and any other org with
// organizations.smart_import_enabled = true) ---------------------------------
// Same AI-assisted column mapping as Fervent's repository upload, retargeted
// at the standard `contacts` table shape so these orgs aren't locked into an
// exact CSV template.
export const CONTACTS_CANONICAL_FIELDS: { key: string; desc: string }[] = [
  { key: 'first_name', desc: 'Person first / given name' },
  { key: 'last_name', desc: 'Person last name / surname / family name' },
  { key: 'email', desc: 'Email address' },
  { key: 'phone', desc: 'Phone / mobile number' },
  { key: 'company', desc: 'Company / employer name' },
  { key: 'job_title', desc: 'Job title / designation / role' },
  { key: 'organization_name', desc: 'Organisation / account name (if different from company)' },
  { key: 'organization_industry', desc: 'Company industry / sector' },
  { key: 'industry_type', desc: 'Industry type / category' },
  { key: 'nature_of_business', desc: 'Nature of business' },
  { key: 'pipeline_stage', desc: 'Pipeline stage / sales stage / action for this contact' },
  { key: 'address', desc: 'Street address' },
  { key: 'city', desc: 'City / town' },
  { key: 'state', desc: 'State / province / region' },
  { key: 'country', desc: 'Country' },
  { key: 'postal_code', desc: 'Postal / ZIP code' },
  { key: 'headline', desc: "Person's professional headline/summary" },
  { key: 'seniority', desc: 'Seniority level' },
  { key: 'referred_by', desc: 'Referred by' },
  { key: 'website', desc: 'Company website URL' },
  { key: 'linkedin_url', desc: "Person's LinkedIn profile URL" },
  { key: 'twitter_url', desc: 'Twitter/X profile URL' },
  { key: 'notes', desc: 'Free-text notes about this contact' },
];

const CONTACTS_IDENTITY_FIELDS = ['first_name', 'last_name', 'email', 'phone'];

const CONTACTS_SYNONYMS: Record<string, string[]> = {
  first_name: ['first_name', 'firstname', 'fname', 'given_name', 'first'],
  last_name: ['last_name', 'lastname', 'lname', 'surname', 'family_name', 'last'],
  email: ['email', 'email_id', 'email_address', 'emailid', 'work_email', 'official_email'],
  phone: ['phone', 'phone_number', 'mobile', 'mobile_number', 'mobile_no', 'cell', 'cell_phone', 'contact_no', 'contact_number', 'telephone', 'tel'],
  company: ['company', 'company_name', 'employer', 'organisation', 'organization'],
  job_title: ['job_title', 'title', 'designation', 'role', 'position'],
  organization_name: ['organization_name', 'organisation_name', 'account_name', 'account'],
  organization_industry: ['organization_industry', 'industry', 'sector', 'vertical'],
  industry_type: ['industry_type'],
  nature_of_business: ['nature_of_business', 'business_nature'],
  pipeline_stage: ['pipeline_stage', 'stage', 'action'],
  address: ['address', 'street_address', 'address_line_1'],
  city: ['city', 'town', 'location_city'],
  state: ['state', 'province', 'region', 'location_state'],
  country: ['country', 'nation', 'location_country'],
  postal_code: ['postal_code', 'zip', 'zip_code', 'pincode', 'pin_code', 'location_zip'],
  headline: ['headline', 'summary'],
  seniority: ['seniority', 'seniority_level'],
  referred_by: ['referred_by', 'referral'],
  website: ['website', 'web', 'url', 'company_website'],
  linkedin_url: ['linkedin_url', 'linkedin', 'linkedin_profile'],
  twitter_url: ['twitter_url', 'twitter', 'x_url'],
  notes: ['notes', 'note', 'comments', 'remarks'],
};

const CONTACTS_MAPPING_SYSTEM_PROMPT =
  'You map the columns of an uploaded B2B contact spreadsheet onto a fixed set of canonical CRM contact fields. ' +
  'You are given the list of canonical fields (with descriptions), the uploaded file\'s column headers, and a few sample rows. ' +
  'For each canonical field you are CONFIDENT about, return which uploaded header supplies it. Only map a field when the header name and/or the sample values clearly support it; leave uncertain fields out rather than guessing. ' +
  'Use the special field name "full_name" if a single column holds a person\'s complete name (first and last together). ' +
  'Ignore columns that do not correspond to any canonical field. ' +
  'Set "reject" to true ONLY if the file is fundamentally unusable — e.g. it is clearly not a contact list, the columns are unintelligible, or two different columns both appear to be the same critical field in a way you cannot resolve. ' +
  'Respond with ONLY JSON of the exact shape {"mapping": {"<canonical_field_or_full_name>": "<exact uploaded header text>", ...}, "reject": <true|false>, "reject_reason": "<short reason or empty>"} and no prose.';

const CONTACTS_NO_IDENTITY_MESSAGE =
  'The file has no name, email, or phone column we could recognise, so its records can\'t be identified. ' +
  'Please make sure it includes at least a name, an email, or a phone number and upload again.';

export async function buildContactsMapping(rawHeaders: string[], sampleRows: string[][]): Promise<FerventMappingResult> {
  return buildSmartMapping(CONTACTS_CANONICAL_FIELDS, CONTACTS_SYNONYMS, CONTACTS_IDENTITY_FIELDS, rawHeaders, sampleRows, CONTACTS_MAPPING_SYSTEM_PROMPT, CONTACTS_NO_IDENTITY_MESSAGE);
}

// Contacts equivalent of applyFerventMapping: same full-name-split and
// name-from-email derivation, targeted at the contacts row shape.
export function applyContactsMapping(values: string[], mapping: FerventMapping): Record<string, string> {
  const row: Record<string, string> = {};
  for (const [field, idx] of Object.entries(mapping.fieldToIndex)) {
    row[field] = (values[idx] ?? '').trim();
  }

  if (mapping.fullNameIndex !== null && !row.first_name && !row.last_name) {
    const full = (values[mapping.fullNameIndex] ?? '').trim();
    if (full) {
      const { first, last } = splitFullName(full);
      row.first_name = first;
      row.last_name = last;
    }
  }

  if (!row.first_name && !row.last_name && row.email) {
    const derived = nameFromEmail(row.email);
    if (derived) {
      row.first_name = derived.first;
      row.last_name = derived.last;
    }
  }

  return row;
}

// A contacts row is unsalvageable only when there's no name, email, or phone.
export function isContactsSalvageable(row: Record<string, string>): { ok: boolean; reason: string } {
  const hasName = !!(row.first_name || row.last_name);
  const hasEmail = !!row.email;
  const hasPhone = !!row.phone;
  if (hasName || hasEmail || hasPhone) return { ok: true, reason: '' };
  return { ok: false, reason: 'No name, email, or phone number to identify this record' };
}

// --- Per-row application + derivation --------------------------------------
function titleCaseToken(t: string): string {
  const s = t.replace(/[^A-Za-z'-]/g, '');
  if (s.length < 2) return '';
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

// Split a combined "full name" into first + rest.
function splitFullName(full: string): { first: string; last: string } {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first: '', last: '' };
  if (parts.length === 1) return { first: parts[0], last: '' };
  return { first: parts[0], last: parts.slice(1).join(' ') };
}

// Derive first/last from an email local-part, unless it's a role mailbox.
function nameFromEmail(email: string): { first: string; last: string } | null {
  const local = email.split('@')[0]?.toLowerCase().trim();
  if (!local || GENERIC_MAILBOXES.has(local)) return null;
  const tokens = local.split(/[._-]+/).map((t) => t.replace(/\d+$/g, '')).filter((t) => t.length >= 2);
  if (tokens.length === 0) return null;
  const first = titleCaseToken(tokens[0]);
  if (!first) return null;
  const last = tokens.length > 1 ? tokens.slice(1).map(titleCaseToken).filter(Boolean).join(' ') : '';
  return { first, last };
}

function firstEmail(row: Record<string, string>): string {
  return row.official_email || row.personal_email_1 || row.personal_email_2 || '';
}

// Turn a raw value row into the canonical row shape, applying safe
// derivations (full-name split, name-from-email, domain-from-email).
export function applyFerventMapping(values: string[], mapping: FerventMapping): Record<string, string> {
  const row: Record<string, string> = {};
  for (const [field, idx] of Object.entries(mapping.fieldToIndex)) {
    row[field] = (values[idx] ?? '').trim();
  }

  // Full-name column -> first/last (only when we have no first name yet).
  if (mapping.fullNameIndex !== null && !row.first_name && !row.last_name) {
    const full = (values[mapping.fullNameIndex] ?? '').trim();
    if (full) {
      const { first, last } = splitFullName(full);
      row.first_name = first;
      row.last_name = last;
    }
  }

  // Name from email local-part, when still nameless.
  if (!row.first_name && !row.last_name) {
    const derived = nameFromEmail(firstEmail(row));
    if (derived) {
      row.first_name = derived.first;
      row.last_name = derived.last;
    }
  }

  // Domain from email, when not otherwise present.
  if (!row.domain_name) {
    const email = firstEmail(row);
    const at = email.indexOf('@');
    if (at >= 0) {
      const domain = email.slice(at + 1).trim().toLowerCase();
      if (domain.includes('.')) row.domain_name = domain;
    }
  }

  return row;
}

// A row is unsalvageable only when there's nothing to identify it by — no
// name (after derivation), no email, and no phone.
export function isSalvageable(row: Record<string, string>): { ok: boolean; reason: string } {
  const hasName = !!(row.first_name || row.last_name);
  const hasEmail = !!(row.official_email || row.personal_email_1 || row.personal_email_2);
  const hasPhone = !!(row.mobile_number_1 || row.mobile_number_2 || row.direct_number || row.phone_number);
  if (hasName || hasEmail || hasPhone) return { ok: true, reason: '' };
  return { ok: false, reason: 'No name, email, or phone number to identify this record' };
}
