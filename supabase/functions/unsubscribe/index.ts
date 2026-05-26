import { getSupabaseClient } from '../_shared/supabaseClient.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = getSupabaseClient();

    const url = new URL(req.url);
    const token = url.searchParams.get('token');

    if (!token) {
      return new Response('Invalid unsubscribe link', { status: 400, headers: corsHeaders });
    }

    console.log('Processing unsubscribe for token:', token);

    // Find email conversation by unsubscribe token
    const { data: conversation, error } = await supabase
      .from('email_conversations')
      .select('id, org_id, to_email, contact_id')
      .eq('unsubscribe_token', token)
      .maybeSingle();

    if (error || !conversation) {
      console.error('Error finding conversation:', error);
      return new Response('Invalid or expired unsubscribe link', { 
        status: 404, 
        headers: corsHeaders 
      });
    }

    // Record unsubscribe (idempotent - won't fail if already unsubscribed)
    const { error: insertError } = await supabase.from('email_unsubscribes').insert({
      org_id: conversation.org_id,
      email: conversation.to_email,
      contact_id: conversation.contact_id,
      source: 'automation',
      unsubscribe_token: token,
      user_agent: req.headers.get('user-agent'),
      ip_address: req.headers.get('x-forwarded-for')
    });

    // If already unsubscribed, that's OK
    if (insertError && !insertError.message.includes('duplicate')) {
      console.error('Error recording unsubscribe:', insertError);
    }

    // Suppress this contact's email (and mark opted-out overall) so no further
    // automated email goes out. Record is kept.
    if (conversation.contact_id) {
      await supabase.from('contacts').update({
        do_not_email: true,
        opted_out: true,
        opt_out_reason: 'Email unsubscribe',
        opt_out_at: new Date().toISOString(),
      }).eq('id', conversation.contact_id);
    }

    console.log('Successfully unsubscribed:', conversation.to_email);

    // Render success page
    return new Response(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Successfully Unsubscribed</title>
        <style>
          body { 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
            max-width: 600px; 
            margin: 80px auto; 
            padding: 40px 20px; 
            text-align: center;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
          }
          .card {
            background: white;
            border-radius: 16px;
            padding: 48px 32px;
            box-shadow: 0 20px 60px rgba(0,0,0,0.3);
          }
          .success-icon { 
            color: #10b981; 
            font-size: 72px; 
            margin-bottom: 24px;
            animation: scaleIn 0.5s ease-out;
          }
          h1 { 
            color: #1f2937; 
            margin-bottom: 16px;
            font-size: 32px;
          }
          p { 
            color: #6b7280; 
            line-height: 1.7; 
            font-size: 16px;
            margin-bottom: 12px;
          }
          .email {
            background: #f3f4f6;
            padding: 12px 20px;
            border-radius: 8px;
            font-family: monospace;
            color: #374151;
            margin: 24px 0;
            word-break: break-all;
          }
          @keyframes scaleIn {
            from { transform: scale(0); }
            to { transform: scale(1); }
          }
        </style>
      </head>
      <body>
        <div class="card">
          <div class="success-icon">✓</div>
          <h1>Successfully Unsubscribed</h1>
          <p>You have been removed from our automation email list:</p>
          <div class="email">${conversation.to_email}</div>
          <p>You will no longer receive automated emails from us.</p>
          <p style="margin-top: 32px; font-size: 14px;">
            If this was a mistake, please contact us directly to re-subscribe.
          </p>
        </div>
      </body>
      </html>
    `, {
      headers: { ...corsHeaders, 'Content-Type': 'text/html' },
      status: 200
    });
  } catch (error: any) {
    console.error('Unsubscribe error:', error);
    return new Response('An unexpected error occurred. Please try again later.', { 
      status: 500,
      headers: corsHeaders
    });
  }
});
