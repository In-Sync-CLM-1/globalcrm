import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getSupabaseClient } from '../_shared/supabaseClient.ts';
import { orgServiceGate } from '../_shared/billingGate.ts';

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");

const sendEmail = async (to: string, subject: string, html: string, fromEmail: string, fromName: string, replyToEmail?: string, unsubscribeUrl?: string) => {
  const emailPayload: any = {
    from: `${fromName} <${fromEmail}>`,
    to: [to],
    subject: subject,
    html: html,
  };

  // Add reply_to if provided and different from sender
  if (replyToEmail && replyToEmail !== fromEmail) {
    emailPayload.reply_to = [replyToEmail];
  }

  // Add List-Unsubscribe headers for RFC 8058 compliance
  if (unsubscribeUrl) {
    emailPayload.headers = {
      'List-Unsubscribe': `<${unsubscribeUrl}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click'
    };
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${RESEND_API_KEY}`,
    },
    body: JSON.stringify(emailPayload),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || "Failed to send email");
  }

  return response.json();
};

interface SendEmailRequest {
  to: string;
  subject: string;
  htmlContent?: string;
  html?: string;
  contactId?: string;
  conversationId?: string;
  trackingPixelId?: string;
  unsubscribeToken?: string;
}

// Decodes a JWT payload without verifying the signature (the gateway already
// verified it before this function ran). Returns null if the token isn't a
// JWT at all -- true for the newer sb_secret_/sb_publishable_ key formats,
// which are opaque API keys, not JWTs.
function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const part = token.split('.')[1];
    if (!part) return null;
    const json = atob(part.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(json);
  } catch {
    return null;
  }
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log('=== send-email Request Started ===');
    console.log('Request method:', req.method);
    console.log('Timestamp:', new Date().toISOString());

    // Check for Authorization header
    const authHeader = req.headers.get("Authorization");
    console.log('Auth Header Status:', {
      present: !!authHeader,
      preview: authHeader ? `${authHeader.substring(0, 20)}...` : 'MISSING',
      length: authHeader?.length || 0
    });

    if (!authHeader) {
      throw new Error('No Authorization header provided');
    }

    // Extract JWT token (remove "Bearer " prefix)
    const token = authHeader.replace('Bearer ', '');
    console.log('Extracted JWT token (length):', token.length);

    // Cron/automation callers authenticate with the service-role key (either
    // the legacy JWT, which decodes with role:"service_role", or the newer
    // sb_secret_ opaque key, which isn't a JWT at all) -- there's no logged-in
    // user to run getUser() against, so that call always 401s with "invalid
    // claim: missing sub claim" for them. Route those through an org-derived-
    // from-contactId path instead of failing every automated send.
    const jwtPayload = decodeJwtPayload(token);
    const isServiceCaller = !jwtPayload || jwtPayload.role === 'service_role';
    console.log('Caller type:', isServiceCaller ? 'service-role (automation)' : 'user session');

    const {
      to,
      subject,
      htmlContent,
      html,
      contactId,
      conversationId,
      trackingPixelId,
      unsubscribeToken
    }: SendEmailRequest = await req.json();

    const emailHtml = htmlContent || html || '';

    if (!emailHtml) {
      throw new Error('Email content is required');
    }

    // dbClient is the client used for every read/write below. For a real
    // user it's their own session client (RLS-scoped); for a service caller
    // it's the shared service-role client (bypasses RLS -- safe, since
    // holding the actual service-role secret is what got them here).
    let dbClient: ReturnType<typeof createClient>;
    let orgId: string;
    let userId: string | null;
    let fromName: string;
    let replyToEmail: string | undefined;

    if (isServiceCaller) {
      if (!contactId) {
        throw new Error('contactId is required when calling send-email with a service-role key (used to resolve the organization)');
      }

      dbClient = getSupabaseClient();

      const { data: contact, error: contactError } = await dbClient
        .from('contacts')
        .select('org_id')
        .eq('id', contactId)
        .maybeSingle();

      if (contactError || !contact?.org_id) {
        console.error('Contact lookup failed for service-role send:', contactError);
        throw new Error('Could not resolve organization from contactId');
      }

      orgId = contact.org_id as string;
      userId = null;

      const { data: org } = await dbClient
        .from('organizations')
        .select('name')
        .eq('id', orgId)
        .maybeSingle();
      fromName = (org?.name as string) || 'In-Sync';
      replyToEmail = undefined; // resolved to fromEmail once the sending domain is known

      console.log('✓ Service-role caller resolved to org:', orgId);
    } else {
      // Create Supabase client
      console.log('Creating Supabase client with ANON_KEY...');
      const supabaseClient = createClient(
        Deno.env.get("SUPABASE_URL") ?? "",
        Deno.env.get("SUPABASE_ANON_KEY") ?? "",
        {
          global: {
            headers: { Authorization: authHeader },
          },
          auth: {
            persistSession: false,
          },
        }
      );
      console.log('✓ Supabase client created successfully');

      // Authenticate user by passing token directly to getUser()
      console.log('Attempting user authentication with JWT token...');
      const {
        data: { user },
        error: authError,
      } = await supabaseClient.auth.getUser(token);

      console.log('User Auth Result:', {
        success: !!user,
        userId: user?.id || 'N/A',
        userEmail: user?.email || 'N/A',
        hasError: !!authError,
        errorCode: authError?.code || 'N/A',
        errorMessage: authError?.message || 'N/A',
        errorStatus: authError?.status || 'N/A',
      });

      if (authError) {
        console.error('Auth Error Details:', JSON.stringify(authError, null, 2));
        throw new Error(`Authentication failed: ${authError.message}`);
      }

      if (!user) {
        throw new Error('No user found in session');
      }

      console.log('✓ User authenticated:', user.email);

      // Fetch user profile and org_id
      console.log('Fetching user profile and org_id...');
      const { data: profile, error: profileError } = await supabaseClient
        .from("profiles")
        .select("org_id, first_name, last_name")
        .eq("id", user.id)
        .single();

      console.log('Profile Lookup Result:', {
        found: !!profile,
        orgId: profile?.org_id || 'N/A',
        hasError: !!profileError,
        errorMessage: profileError?.message || 'N/A'
      });

      if (profileError) {
        console.error('Profile Error:', profileError);
        throw new Error(`Failed to fetch user profile: ${profileError.message}`);
      }

      if (!profile?.org_id) {
        throw new Error("User organization not found");
      }

      console.log('✓ Organization verified:', profile.org_id);

      dbClient = supabaseClient;
      orgId = profile.org_id as string;
      userId = user.id;
      fromName = profile.first_name
        ? `${profile.first_name} ${profile.last_name || ''}`.trim()
        : (user.email || "User");
      replyToEmail = user.email || undefined;
    }

    // No money, no service: block paid email sends when the org is locked for
    // non-payment or its wallet has hit the ₹500 reserve.
    const gate = await orgServiceGate(getSupabaseClient(), orgId);
    if (!gate.allowed) {
      return new Response(
        JSON.stringify({ error: `Email unavailable: ${gate.reason}`, code: gate.locked ? 'account_locked' : 'wallet_exhausted' }),
        { status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // Get email settings and verify domain
    const { data: emailSettings, error: settingsError } = await dbClient
      .from("email_settings")
      .select("sending_domain, verification_status, is_active, resend_domain_id")
      .eq("org_id", orgId)
      .maybeSingle();

    if (!emailSettings || !emailSettings.is_active) {
      throw new Error("Email sending is not configured. Please set up your sending domain in Email Settings.");
    }

    if (emailSettings.verification_status !== "verified") {
      throw new Error("Email domain verification pending. Please go to Email Settings and click 'Verify Domain' to complete verification.");
    }

    // Double-check domain status with Resend API to avoid stale data issues
    console.log('Checking domain status with Resend API...');
    const domainCheckResponse = await fetch(
      `https://api.resend.com/domains/${emailSettings.resend_domain_id}`,
      {
        headers: {
          'Authorization': `Bearer ${RESEND_API_KEY}`,
        },
      }
    );

    if (domainCheckResponse.ok) {
      const domainStatus = await domainCheckResponse.json();
      console.log('Current Resend domain status:', domainStatus.status);

      if (domainStatus.status !== 'verified') {
        // Update database with actual status
        await dbClient
          .from('email_settings')
          .update({ verification_status: 'pending' })
          .eq('org_id', orgId);

        throw new Error(`Domain verification incomplete. Status: ${domainStatus.status}. Please verify all DNS records in Email Settings.`);
      }
    }

    // Use verified domain as sender, user's email as reply-to (service-role
    // callers have no user email, so they reply-to themselves)
    const fromEmail = `noreply@${emailSettings.sending_domain}`;
    if (!replyToEmail) replyToEmail = fromEmail;

    console.log("Sending email to:", to, "from:", fromEmail, "reply-to:", replyToEmail);

    // Generate unsubscribe token if not provided
    const unsubToken = unsubscribeToken || crypto.randomUUID();
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const unsubscribeUrl = `${supabaseUrl}/functions/v1/unsubscribe?token=${unsubToken}`;

    // Inject unsubscribe footer into email HTML
    const unsubscribeFooter = `
      <div style="margin: 40px 0 20px; padding-top: 20px; border-top: 1px solid #e5e7eb; text-align: center;">
        <p style="margin: 0; font-size: 12px; color: #6b7280; line-height: 1.5;">
          You're receiving this email because you interacted with our platform.<br>
          <a href="${unsubscribeUrl}" style="color: #6b7280; text-decoration: underline;">Unsubscribe</a> from these emails
        </p>
      </div>
    `;
    const finalHtml = emailHtml.includes('</body>')
      ? emailHtml.replace('</body>', `${unsubscribeFooter}</body>`)
      : emailHtml + unsubscribeFooter;

    // Send email via Resend
    const emailData = await sendEmail(to, subject, finalHtml, fromEmail, fromName, replyToEmail, unsubscribeUrl);

    console.log("Email sent successfully:", emailData);

    // Use shared service role client for wallet deduction
    const supabaseServiceClient = getSupabaseClient();

    // Deduct email cost from wallet
    const { data: deductResult, error: deductError } = await supabaseServiceClient.rpc('deduct_from_wallet', {
      _org_id: orgId,
      _amount: 0.10, // Get from pricing
      _service_type: 'email',
      _reference_id: null, // Will be updated after logging
      _quantity: 1,
      _unit_cost: 0.10,
      _user_id: userId
    });

    if (deductError || !deductResult?.success) {
      console.warn('Wallet deduction failed:', deductError || deductResult);
      // Email was sent, but wallet deduction failed - log but don't fail the request
    }

    // Log email to email_conversations table
    console.log('[send-email] Logging email to database...');
    const { error: logError } = await dbClient
      .from("email_conversations")
      .insert({
        org_id: orgId,
        contact_id: contactId,
        conversation_id: conversationId || emailData?.id || crypto.randomUUID(),
        from_email: fromEmail,
        from_name: fromName,
        to_email: to,
        reply_to_email: replyToEmail,
        subject: subject,
        email_content: emailHtml,
        html_content: emailHtml,
        direction: "outbound",
        sent_by: userId,
        status: "sent",
        sent_at: new Date().toISOString(),
        tracking_pixel_id: trackingPixelId,
        unsubscribe_token: unsubToken,
        provider_message_id: emailData?.id,
      });

    if (logError) {
      console.error('[send-email] Error logging email to email_conversations:', logError);
      console.error('[send-email] Email was sent but database logging failed');
      // Don't throw - email was sent successfully
    } else {
      console.log('[send-email] Email logged successfully to database');
    }

    return new Response(
      JSON.stringify({ success: true, emailId: emailData?.id }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error: any) {
    console.error('=== send-email Error ===');
    console.error('Error Type:', error.constructor.name);
    console.error('Error Message:', error.message);
    console.error('Error Stack:', error.stack);
    console.error('Timestamp:', new Date().toISOString());

    return new Response(
      JSON.stringify({
        error: error.message,
        timestamp: new Date().toISOString()
      }),
      {
        status: error.message.includes('Unauthorized') || error.message.includes('Authentication') ? 401 : 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
