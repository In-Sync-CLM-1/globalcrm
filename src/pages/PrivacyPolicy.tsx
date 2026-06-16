import { Link } from "react-router-dom";
import { ShieldCheck, Lock, MapPin, Eye, FileText, AlertTriangle, Mail } from "lucide-react";

// Public, DPDP Act 2023-aligned privacy notice. No auth required.
export default function PrivacyPolicy() {
  return (
    <div className="min-h-screen bg-muted/30">
      <header className="bg-primary text-primary-foreground">
        <div className="max-w-3xl mx-auto px-6 py-8 flex items-center gap-3">
          <ShieldCheck className="h-7 w-7" />
          <div>
            <h1 className="text-2xl font-bold">Privacy Policy</h1>
            <p className="opacity-90 text-sm">Digital Personal Data Protection Act, 2023 — compliant</p>
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-8 space-y-6">
        <Section icon={<FileText />} title="Who we are">
          We act as the <strong>Data Fiduciary</strong> for the personal data we collect in the course of
          our sales and customer-relationship activities. This notice explains what we collect, why, and the
          rights you have over your data.
        </Section>

        <Section icon={<FileText />} title="Data we collect">
          Contact details (name, email, phone), company and role, the source you came to us through, and the
          record of our interactions with you (calls, messages, meetings). We may enrich this with publicly
          available business information.
        </Section>

        <Section icon={<FileText />} title="Why we collect it">
          To respond to your interest, qualify and manage the opportunity, schedule demos, and maintain a
          business relationship. We process this data on the <strong>basis of your consent</strong> under
          Section 6 of the DPDP Act, 2023.
        </Section>

        <Section icon={<Lock />} title="How we protect it">
          Personal data is <strong>encrypted with AES-256</strong>, with keys held in a secured vault and never
          in code or logs. Access to personal data is role-restricted and <strong>every access is recorded in
          an audit log</strong>. Data is <strong>hosted in India</strong> and encrypted at rest.
        </Section>

        <Section icon={<MapPin />} title="How long we keep it">
          We retain personal data for the duration of the business relationship and a defined retention period
          thereafter, as required by applicable law. Beyond that window, records are <strong>anonymised
          automatically</strong>. On an approved erasure request, your personal data is anonymised, subject to
          any legal retention obligation.
        </Section>

        <Section icon={<Eye />} title="Your rights">
          Under the DPDP Act, 2023 you may request <strong>access</strong> to your data, its <strong>correction</strong>,
          its <strong>erasure</strong>, or <strong>nominate</strong> someone to exercise these rights. You may also
          withdraw consent at any time.
          <div className="mt-3">
            <Link to="/data-rights" className="inline-flex items-center gap-2 rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium">
              Exercise your rights
            </Link>
          </div>
        </Section>

        <Section icon={<AlertTriangle />} title="Data breach">
          In the event of a personal-data breach, we notify affected data principals and the Data Protection
          Board in clear, plain language and within the timeline required by the DPDP Act.
        </Section>

        <Section icon={<Mail />} title="Contact our Data Protection Officer">
          For any question or grievance about your personal data, contact our Data Protection Officer at{" "}
          <a className="text-primary underline" href="mailto:dpo@in-sync.co.in">dpo@in-sync.co.in</a>. If your
          grievance is not resolved, you may escalate to the Data Protection Board of India.
        </Section>

        <p className="text-xs text-muted-foreground pt-2">Last updated: June 2026.</p>
      </main>
    </div>
  );
}

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <section className="bg-background rounded-xl border p-5">
      <h2 className="flex items-center gap-2 text-lg font-semibold mb-2">
        <span className="text-primary h-5 w-5">{icon}</span>{title}
      </h2>
      <p className="text-sm text-muted-foreground leading-relaxed">{children}</p>
    </section>
  );
}
