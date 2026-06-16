import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { getSupabaseClient } from '../_shared/supabaseClient.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = getSupabaseClient();

    console.log('Starting monthly invoice generation...');

    // Get active pricing
    const { data: pricingData, error: pricingError } = await supabase
      .rpc('get_active_pricing')
      .single();

    if (pricingError) {
      console.error('Error fetching pricing:', pricingError);
      throw pricingError;
    }

    const pricing = pricingData as { gst_percentage: number };

    // Get all active subscriptions
    const { data: subscriptions, error: subsError } = await supabase
      .from('organization_subscriptions')
      .select('org_id, user_count, monthly_subscription_amount')
      .eq('subscription_status', 'active');

    if (subsError) {
      console.error('Error fetching subscriptions:', subsError);
      throw subsError;
    }

    console.log(`Found ${subscriptions?.length || 0} active subscriptions`);

    let generatedCount = 0;
    const now = new Date();
    const billingPeriodStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const billingPeriodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    const dueDate = new Date(now.getFullYear(), now.getMonth(), 10); // Due on 10th

    for (const sub of subscriptions || []) {
      try {
        // Determine billing period - default to monthly
        const billingPeriod = 'monthly'; // Could be quarterly or annual based on subscription

        // Check if proforma invoice already exists for this period
        const { data: existingInvoice } = await supabase
          .from('subscription_invoices')
          .select('id')
          .eq('org_id', sub.org_id)
          .eq('invoice_type', 'proforma')
          .eq('billing_period_start', billingPeriodStart.toISOString().split('T')[0])
          .single();

        if (existingInvoice) {
          console.log(`Proforma invoice already exists for org ${sub.org_id}`);
          continue;
        }

        const baseAmount = sub.monthly_subscription_amount;
        const gstAmount = baseAmount * (pricing.gst_percentage / 100);
        const totalAmount = baseAmount + gstAmount;

        // Generate proforma invoice number
        const invoiceNumber = `PRO-${now.getFullYear()}${(now.getMonth() + 1).toString().padStart(2, '0')}-${sub.org_id.substring(0, 8).toUpperCase()}`;

        // Create PROFORMA invoice (for due/outstanding amounts)
        const { error: invoiceError } = await supabase
          .from('subscription_invoices')
          .insert({
            org_id: sub.org_id,
            invoice_number: invoiceNumber,
            invoice_date: now.toISOString().split('T')[0],
            due_date: dueDate.toISOString().split('T')[0],
            billing_period_start: billingPeriodStart.toISOString().split('T')[0],
            billing_period_end: billingPeriodEnd.toISOString().split('T')[0],
            base_subscription_amount: baseAmount,
            subtotal: baseAmount,
            gst_amount: gstAmount,
            total_amount: totalAmount,
            payment_status: 'pending',
            invoice_type: 'proforma',
            billing_period: billingPeriod,
            user_count: sub.user_count || 0,
          });

        if (invoiceError) {
          console.error(`Error creating invoice for org ${sub.org_id}:`, invoiceError);
        } else {
          generatedCount++;
          console.log(`Generated invoice for org ${sub.org_id}: ${invoiceNumber}`);

          // Send invoice email notification
          await supabase.functions.invoke('send-subscription-email', {
            body: {
              org_id: sub.org_id,
              notification_type: 'invoice_generated',
              invoice_number: invoiceNumber,
              amount: totalAmount,
              due_date: dueDate.toISOString().split('T')[0],
            },
          });
        }
      } catch (error) {
        console.error(`Error processing subscription for org ${sub.org_id}:`, error);
      }
    }

    console.log(`Invoice generation complete: ${generatedCount} invoices generated`);

    return new Response(
      JSON.stringify({
        success: true,
        generated: generatedCount,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      }
    );
  } catch (error) {
    console.error('Invoice generation error:', error);
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      }
    );
  }
});