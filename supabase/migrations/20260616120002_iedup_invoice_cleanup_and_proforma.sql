-- Remove old invoice from IEDUP and create new proforma invoice with correct details

-- First, identify the IEDUP organization and store it
DO $$
DECLARE
  iedup_org_id UUID;
  invoice_date_today DATE := CURRENT_DATE;
  billing_period_start DATE := DATE_TRUNC('month', CURRENT_DATE)::DATE;
  billing_period_end DATE := (DATE_TRUNC('month', CURRENT_DATE) + INTERVAL '1 month' - INTERVAL '1 day')::DATE;
BEGIN
  -- Find IEDUP organization
  SELECT id INTO iedup_org_id
  FROM public.organizations
  WHERE name ILIKE '%iedup%' OR name ILIKE '%IEDUP%'
  LIMIT 1;

  IF iedup_org_id IS NOT NULL THEN
    -- Delete the old overdue invoice (₹942.82 from 8 Jun 2026)
    DELETE FROM public.subscription_invoices
    WHERE org_id = iedup_org_id
      AND payment_status = 'overdue'
      AND invoice_date = '2026-06-08'::DATE;

    -- Create new proforma invoice with correct issuer details
    INSERT INTO public.subscription_invoices (
      org_id,
      invoice_number,
      invoice_date,
      due_date,
      billing_period_start,
      billing_period_end,
      base_subscription_amount,
      subtotal,
      gst_amount,
      total_amount,
      payment_status,
      invoice_type,
      billing_period,
      user_count,
      created_at,
      updated_at
    ) VALUES (
      iedup_org_id,
      'PRO-' || TO_CHAR(CURRENT_DATE, 'YYYYMM') || '-' || SUBSTRING(iedup_org_id::TEXT, 1, 8),
      invoice_date_today,
      invoice_date_today + INTERVAL '30 days',
      billing_period_start,
      billing_period_end,
      2397.00,  -- Quarterly amount: ₹799 × 3 months
      2397.00,
      431.46,   -- 18% GST
      2828.46,  -- Total with GST
      'pending',
      'proforma',
      'quarterly',
      1,
      NOW(),
      NOW()
    );

    RAISE NOTICE 'Successfully cleaned up IEDUP invoices and created new proforma invoice';
  ELSE
    RAISE WARNING 'IEDUP organization not found';
  END IF;
END $$;
