// Shared types + query translation for the Fervent Database's Advanced
// (Boolean) Search and Saved Searches. Kept out of FerventRepository.tsx so
// FerventAdvancedSearch.tsx and FerventSavedSearches.tsx can both import it.

// Text columns only — db_sourced_year/sr_no are numeric and already covered
// by the basic Filters panel's "DB Sourced Year" input.
export const BOOLEAN_SEARCH_FIELDS: { key: string; label: string }[] = [
  { key: "company_name", label: "Company Name" },
  { key: "full_name", label: "Full Name" },
  { key: "designation", label: "Designation" },
  { key: "department", label: "Department" },
  { key: "designation_level", label: "Designation Level" },
  { key: "city", label: "City" },
  { key: "state", label: "State" },
  { key: "country", label: "Country" },
  { key: "isd_code", label: "ISD Code" },
  { key: "std_code", label: "STD Code" },
  { key: "mobile_number_1", label: "Mobile Number 1" },
  { key: "mobile_number_2", label: "Mobile Number 2" },
  { key: "direct_number", label: "Direct Number" },
  { key: "phone_number", label: "Phone Number" },
  { key: "official_email", label: "Official Email" },
  { key: "personal_email_1", label: "Personal Email 1" },
  { key: "personal_email_2", label: "Personal Email 2" },
  { key: "linkedin_url", label: "LinkedIn" },
  { key: "domain_name", label: "Domain Name" },
  { key: "website", label: "Website" },
  { key: "industry", label: "Industry" },
  { key: "sub_industry", label: "Sub Industry" },
  { key: "employee_size", label: "Employee Size" },
  { key: "turnover", label: "Turnover" },
  { key: "company_linkedin_url", label: "Company LinkedIn" },
  { key: "ucdb_status", label: "UCDB Status" },
  { key: "unique_id", label: "Unique ID" },
];

const BOOLEAN_SEARCH_FIELD_KEYS = new Set(BOOLEAN_SEARCH_FIELDS.map((f) => f.key));

export type BooleanOp = "contains" | "not_contains";

export interface BooleanCondition {
  field: string;
  op: BooleanOp;
  value: string;
}

export interface BooleanQuery {
  mode: "all" | "any"; // all = AND every condition, any = OR any condition
  conditions: BooleanCondition[];
}

export const emptyBooleanQuery: BooleanQuery = { mode: "all", conditions: [] };

// What a saved search actually stores — either a snapshot of the basic
// Filters panel, or an advanced boolean query. Uses a generic string map
// instead of importing RepositoryFilters to avoid a circular import with
// FerventRepository.tsx (which imports BOOLEAN_SEARCH_FIELDS from here).
export type SavedSearchDefinition =
  | { mode: "basic"; filters: Record<string, string | string[]> }
  | { mode: "advanced"; query: BooleanQuery };

export function isBooleanQueryEmpty(q: BooleanQuery): boolean {
  return q.conditions.every((c) => !c.value.trim());
}

// Same escaping as the basic search box (Phase 1): PostgREST's raw .or()
// string splits on unescaped commas/parens, so user-typed values must be
// quoted and escaped before being spliced into the filter string. Field
// names and operators are never user input — always drawn from the fixed
// BOOLEAN_SEARCH_FIELDS/BooleanOp vocabulary above.
function escapeOrValue(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

// Applies a BooleanQuery to a Supabase query builder. Only ever called with
// `field` values already restricted to BOOLEAN_SEARCH_FIELD_KEYS.
// Typed `any` because the exact PostgrestFilterBuilder generic varies by
// caller (list query vs. export query) and every method used here
// (.ilike/.not/.or) is available regardless of row-type parameters.
export function applyBooleanQuery(query: any, bq: BooleanQuery): any {
  const active = bq.conditions.filter((c) => c.value.trim() && BOOLEAN_SEARCH_FIELD_KEYS.has(c.field));
  if (active.length === 0) return query;

  if (bq.mode === "all") {
    let q = query;
    for (const c of active) {
      const pattern = `%${c.value.trim()}%`;
      q = c.op === "contains" ? q.ilike(c.field, pattern) : q.not(c.field, "ilike", pattern);
    }
    return q;
  }

  const parts = active.map((c) => {
    const v = escapeOrValue(c.value.trim());
    const opStr = c.op === "contains" ? "ilike" : "not.ilike";
    return `${c.field}.${opStr}.%${v}%`;
  });
  return query.or(parts.join(","));
}
