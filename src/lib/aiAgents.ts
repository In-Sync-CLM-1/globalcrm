// Shared mapping from a product to its friendly label + dedicated AI agent.
// Product names reach us in two casings: compact ("Worksync", "Vendorverification")
// from contacts / ai_daily_insights, and display ("WorkSync", "Vendor Verification")
// from ai_call_scripts. Both normalise to the same key via normProduct.
//
// New products fall back to the raw name + "—" agent, so panels keep working as
// the remaining agents come online without code changes.
export const PRODUCT_META: Record<string, { label: string; agent: string }> = {
  worksync: { label: "WorkSync", agent: "Riya" },
  vendorverification: { label: "Vendor Verification", agent: "Anushree" },
  globalcrm: { label: "GlobalCRM", agent: "—" },
  whatsapp: { label: "WhatsApp", agent: "—" },
  email: { label: "Email", agent: "—" },
  fieldsync: { label: "FieldSync", agent: "—" },
  event: { label: "Event", agent: "—" },
  expense: { label: "Expense", agent: "—" },
  ats: { label: "ATS", agent: "—" },
};

export const normProduct = (p: string) => p.toLowerCase().replace(/\s+/g, "");

export const metaFor = (p: string) => PRODUCT_META[normProduct(p)] ?? { label: p, agent: "—" };

// The agent's display name for a product, falling back to the product label
// (then a generic phrase) when no dedicated agent is mapped.
export const agentNameFor = (p: string | null | undefined) => {
  const m = metaFor(p || "");
  return m.agent !== "—" ? m.agent : m.label || "this agent";
};
