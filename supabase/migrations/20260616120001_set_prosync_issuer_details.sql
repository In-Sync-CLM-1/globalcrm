-- Set issuer and banking details for PROSYNC AI SOLUTIONS organizations
-- This assumes the organization already exists. Update the issuer_company_name,
-- issuer_pan, issuer_gst_number to match the correct organization.

-- For PROSYNC AI SOLUTIONS (OPC) PRIVATE LIMITED
UPDATE public.organizations
SET
  issuer_company_name = 'PROSYNC AI SOLUTIONS (OPC) PRIVATE LIMITED',
  issuer_pan = 'AARCP0859N',
  issuer_gst_number = '06AARCP0859N1ZO',
  issuer_address = jsonb_build_object(
    'floor', '4th Floor',
    'building', 'Supermart-1',
    'street', 'DLF Phase IV',
    'locality', 'New Gurugram',
    'city', 'Gurugram',
    'state', 'Haryana',
    'postal_code', '122002',
    'country', 'India'
  ),
  banking_details = jsonb_build_object(
    'bank_name', 'IDFC FIRST BANK',
    'branch', 'Sector 4, Gurugram',
    'account_number', '10288101744',
    'ifsc_code', 'IDFB0022461'
  ),
  updated_at = NOW()
WHERE name LIKE '%IEDUP%' OR name LIKE '%prosync%' OR name LIKE '%Prosync%'
LIMIT 1;
