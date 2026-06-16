-- Add issuer and banking details to organizations table
ALTER TABLE public.organizations
ADD COLUMN IF NOT EXISTS issuer_company_name TEXT,
ADD COLUMN IF NOT EXISTS issuer_pan TEXT,
ADD COLUMN IF NOT EXISTS issuer_gst_number TEXT,
ADD COLUMN IF NOT EXISTS issuer_address JSONB,
ADD COLUMN IF NOT EXISTS banking_details JSONB,
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Add invoice_type column to subscription_invoices (invoice vs proforma)
ALTER TABLE public.subscription_invoices
ADD COLUMN IF NOT EXISTS invoice_type TEXT NOT NULL DEFAULT 'invoice'
  CHECK (invoice_type IN ('invoice', 'proforma'));

-- Add billing_period column to track if monthly or quarterly
ALTER TABLE public.subscription_invoices
ADD COLUMN IF NOT EXISTS billing_period TEXT DEFAULT 'monthly'
  CHECK (billing_period IN ('monthly', 'quarterly', 'annual'));

-- Create index on invoice_type for faster queries
CREATE INDEX IF NOT EXISTS idx_invoices_type ON public.subscription_invoices(invoice_type);
CREATE INDEX IF NOT EXISTS idx_invoices_billing_period ON public.subscription_invoices(billing_period);

-- Add comment explaining the issuer details structure
COMMENT ON COLUMN public.organizations.issuer_company_name IS 'Legal name of the company issuing invoices (e.g., PROSYNC AI SOLUTIONS (OPC) PRIVATE LIMITED)';
COMMENT ON COLUMN public.organizations.issuer_pan IS 'PAN of the issuing company for GST registration';
COMMENT ON COLUMN public.organizations.issuer_gst_number IS 'GST Registration Number of the issuing company';
COMMENT ON COLUMN public.organizations.issuer_address IS 'Address of the issuing company (JSON: {floor, building, street, locality, city, state, postal_code, country})';
COMMENT ON COLUMN public.organizations.banking_details IS 'Banking details for payments (JSON: {bank_name, branch, account_number, ifsc_code})';
