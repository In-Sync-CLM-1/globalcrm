import { useState } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ShieldCheck, CheckCircle2 } from "lucide-react";

// Public data-principal rights intake. Files straight into data_requests
// (anon INSERT is permitted by the DPDP RLS policy). The org is taken from
// ?org=<uuid>, defaulting to the In-Sync Demo organization.
const DEFAULT_ORG = "61f7f96d-e80c-4d9b-a765-8eb32bd3c70d";

const TYPES = [
  { v: "access", label: "Access my data" },
  { v: "correction", label: "Correct my data" },
  { v: "erasure", label: "Erase my data" },
  { v: "nomination", label: "Nominate someone" },
];

export default function DataRights() {
  const [params] = useSearchParams();
  const orgId = params.get("org") || DEFAULT_ORG;
  const [form, setForm] = useState({ name: "", email: "", phone: "", request_type: "access", details: "" });
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!form.email && !form.phone) { setError("Please provide an email or phone so we can verify and respond."); return; }
    setSubmitting(true);
    const { error } = await (supabase as any).from("data_requests").insert({
      org_id: orgId,
      requester_identifier: form.email || form.phone,
      request_type: form.request_type,
      details: [form.name && `Name: ${form.name}`, form.details].filter(Boolean).join(" — ") || null,
      source: "public_portal",
    });
    setSubmitting(false);
    if (error) { setError(error.message); return; }
    setDone(true);
  }

  if (done) {
    return (
      <Centered>
        <CheckCircle2 className="h-12 w-12 text-emerald-500 mb-3" />
        <h1 className="text-xl font-bold">Request received</h1>
        <p className="text-muted-foreground mt-2 max-w-sm">
          Your request has been logged. Our Data Protection Officer will respond within the timeline required
          by the DPDP Act. A confirmation will be sent to the contact you provided.
        </p>
        <Link to="/privacy-policy" className="text-primary underline text-sm mt-4">Back to Privacy Policy</Link>
      </Centered>
    );
  }

  return (
    <Centered>
      <div className="w-full max-w-md bg-background rounded-xl border p-6">
        <div className="flex items-center gap-2 mb-1">
          <ShieldCheck className="h-6 w-6 text-primary" />
          <h1 className="text-xl font-bold">Your data rights</h1>
        </div>
        <p className="text-sm text-muted-foreground mb-4">
          Exercise your rights under the Digital Personal Data Protection Act, 2023.
        </p>
        <form onSubmit={submit} className="space-y-3">
          <div className="space-y-1"><Label>Full name</Label>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
          <div className="space-y-1"><Label>Email</Label>
            <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
          <div className="space-y-1"><Label>Phone</Label>
            <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
          <div className="space-y-1"><Label>What would you like to do?</Label>
            <select
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={form.request_type}
              onChange={(e) => setForm({ ...form, request_type: e.target.value })}
            >
              {TYPES.map((t) => <option key={t.v} value={t.v}>{t.label}</option>)}
            </select></div>
          <div className="space-y-1"><Label>Details (optional)</Label>
            <Textarea value={form.details} onChange={(e) => setForm({ ...form, details: e.target.value })} /></div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <Button type="submit" className="w-full" disabled={submitting}>
            {submitting ? "Submitting…" : "Submit request"}
          </Button>
        </form>
      </div>
    </Centered>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-muted/30 flex flex-col items-center justify-center text-center px-6 py-10">
      {children}
    </div>
  );
}
