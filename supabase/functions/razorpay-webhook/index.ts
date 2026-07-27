import { getSupabaseClient } from '../_shared/supabaseClient.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-razorpay-signature',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = getSupabaseClient();

    const signature = req.headers.get('x-razorpay-signature');
    const body = await req.text();

    console.log('Webhook received from Razorpay');

    // Verify webhook signature using Web Crypto API. This MUST be the
    // separate webhook secret entered when creating the webhook in the
    // Razorpay dashboard (Settings -> Webhooks) -- Razorpay signs webhook
    // payloads with that secret, not with the API key secret used to
    // authenticate outbound API calls. Using RAZORPAY_KEY_SECRET here meant
    // every real webhook would fail signature verification.
    const RAZORPAY_WEBHOOK_SECRET = Deno.env.get('RAZORPAY_WEBHOOK_SECRET');
    if (!RAZORPAY_WEBHOOK_SECRET) {
      throw new Error('Razorpay webhook secret not configured');
    }

    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(RAZORPAY_WEBHOOK_SECRET),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    const signatureBytes = await crypto.subtle.sign(
      'HMAC',
      key,
      encoder.encode(body)
    );
    const expectedSignature = Array.from(new Uint8Array(signatureBytes))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');

    if (signature !== expectedSignature) {
      console.error('Webhook signature verification failed');
      throw new Error('Invalid webhook signature');
    }

    const event = JSON.parse(body);
    console.log('Webhook event:', event.event);

    // Process webhook based on event type
    switch (event.event) {
      case 'payment.authorized':
      case 'payment.captured': {
        const payment = event.payload.payment.entity;
        console.log('Payment authorized/captured:', payment.id);

        // Find payment transaction by order_id
        const { data: paymentTxn } = await supabase
          .from('payment_transactions')
          .select('*')
          .eq('razorpay_order_id', payment.order_id)
          .single();

        if (paymentTxn && paymentTxn.payment_status !== 'success') {
          // Update transaction status
          await supabase
            .from('payment_transactions')
            .update({
              razorpay_payment_id: payment.id,
              payment_status: 'success',
              payment_method: payment.method,
              completed_at: new Date().toISOString(),
              metadata: { ...paymentTxn.metadata, webhook_event: event },
            })
            .eq('id', paymentTxn.id);

          console.log('Payment transaction updated from webhook');
        }
        break;
      }

      case 'payment.failed': {
        const payment = event.payload.payment.entity;
        console.log('Payment failed:', payment.id);

        const { data: paymentTxn } = await supabase
          .from('payment_transactions')
          .select('*')
          .eq('razorpay_order_id', payment.order_id)
          .single();

        if (paymentTxn) {
          await supabase
            .from('payment_transactions')
            .update({
              razorpay_payment_id: payment.id,
              payment_status: 'failed',
              failure_reason: payment.error_description || 'Payment failed',
              metadata: { ...paymentTxn.metadata, webhook_event: event },
            })
            .eq('id', paymentTxn.id);

          console.log('Payment marked as failed from webhook');
        }
        break;
      }

      case 'order.paid': {
        const order = event.payload.order.entity;
        console.log('Order paid:', order.id);

        const { data: paymentTxn } = await supabase
          .from('payment_transactions')
          .select('*')
          .eq('razorpay_order_id', order.id)
          .single();

        if (paymentTxn && paymentTxn.payment_status !== 'success') {
          await supabase
            .from('payment_transactions')
            .update({
              payment_status: 'success',
              completed_at: new Date().toISOString(),
              metadata: { ...paymentTxn.metadata, webhook_event: event },
            })
            .eq('id', paymentTxn.id);

          console.log('Order marked as paid from webhook');
        }
        break;
      }

      default:
        console.log('Unhandled webhook event:', event.event);
    }

    return new Response(
      JSON.stringify({ success: true, message: 'Webhook processed' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error in razorpay-webhook:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
