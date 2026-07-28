import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.58.0';
import { getSupabaseClient } from '../_shared/supabaseClient.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Platform-run products that send on the ONE shared Exotel WABA instead of
// bringing their own Exotel account. Mirrors WA_SENDER_BY_ORG elsewhere.
const SHARED_PLATFORM_WABA_ORGS = new Set<string>([
  '6dcf4229-6902-4cd4-9c7f-2d6ed4a6045d', // IEDUP
]);

const RATE_LIMIT_SYNCS_PER_HOUR = 3;

// Check rate limit for template syncs
async function checkSyncRateLimit(supabaseClient: any, orgId: string): Promise<boolean> {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  
  const { count } = await supabaseClient
    .from('rate_limit_log')
    .select('*', { count: 'exact', head: true })
    .eq('org_id', orgId)
    .eq('operation', 'sync_whatsapp_templates')
    .gte('created_at', oneHourAgo);
  
  return (count || 0) < RATE_LIMIT_SYNCS_PER_HOUR;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log('=== sync-exotel-whatsapp-templates Started ===');

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      throw new Error('No Authorization header provided');
    }

    const token = authHeader.replace('Bearer ', '');
    
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        global: { headers: { Authorization: authHeader } },
        auth: { persistSession: false },
      }
    );

    const { data: { user }, error: userError } = await supabaseClient.auth.getUser(token);
    if (userError || !user) {
      throw new Error('Authentication failed');
    }

    // Get user's org_id
    const { data: profile } = await supabaseClient
      .from('profiles')
      .select('org_id')
      .eq('id', user.id)
      .single();

    if (!profile?.org_id) {
      throw new Error('Organization not found');
    }

    const orgId = profile.org_id;

    // Check rate limit
    const withinLimit = await checkSyncRateLimit(supabaseClient, orgId);
    if (!withinLimit) {
      return new Response(
        JSON.stringify({ 
          status: 'rate_limited',
          message: 'Template sync rate limit exceeded. Please wait an hour before syncing again.'
        }),
        { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get Exotel settings — most orgs bring their own Exotel account. A
    // small allow-list of platform-run products (IEDUP today) instead share
    // the ONE platform Exotel/WABA account, held only in function secrets —
    // never written into exotel_settings, which orgs can read their own row
    // of, so the shared platform credentials never become client-visible.
    const { data: exotelSettings } = await supabaseClient
      .from('exotel_settings')
      .select('*')
      .eq('org_id', orgId)
      .eq('is_active', true)
      .eq('whatsapp_enabled', true)
      .single();

    let waApiKey: string | null | undefined;
    let waApiToken: string | null | undefined;
    let waSubdomain: string | null | undefined;
    let waAccountSid: string | null | undefined;
    let wabaId: string | null | undefined;

    if (exotelSettings?.waba_id) {
      waApiKey = exotelSettings.whatsapp_api_key || exotelSettings.api_key;
      waApiToken = exotelSettings.whatsapp_api_token || exotelSettings.api_token;
      waSubdomain = exotelSettings.whatsapp_subdomain || exotelSettings.subdomain;
      waAccountSid = exotelSettings.whatsapp_account_sid || exotelSettings.account_sid;
      wabaId = exotelSettings.waba_id;
    } else if (SHARED_PLATFORM_WABA_ORGS.has(orgId)) {
      waApiKey = Deno.env.get('EXOTEL_API_KEY');
      waApiToken = Deno.env.get('EXOTEL_API_TOKEN');
      waSubdomain = Deno.env.get('EXOTEL_SUBDOMAIN') || 'api.exotel.com';
      waAccountSid = Deno.env.get('EXOTEL_SID');
      wabaId = Deno.env.get('EXOTEL_WABA_ID');
    } else {
      return new Response(
        JSON.stringify({ error: 'Exotel WhatsApp not configured' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!waApiKey || !waApiToken || !waSubdomain || !waAccountSid || !wabaId) {
      return new Response(
        JSON.stringify({ error: 'WABA ID not configured' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Log rate limit
    const serviceClient = getSupabaseClient();
    await serviceClient.from('rate_limit_log').insert({
      org_id: orgId,
      user_id: user.id,
      operation: 'sync_whatsapp_templates',
    });

    // Fetch templates from Exotel API - Using v2 endpoint
    const exotelUrl = `https://${waApiKey}:${waApiToken}@${waSubdomain}/v2/accounts/${waAccountSid}/templates?waba_id=${wabaId}&limit=100`;

    console.log('Fetching templates from Exotel...');

    const exotelResponse = await fetch(exotelUrl, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!exotelResponse.ok) {
      const errorText = await exotelResponse.text();
      console.error('Exotel API error response:', {
        status: exotelResponse.status,
        statusText: exotelResponse.statusText,
        body: errorText,
        url: exotelUrl.replace(waApiToken, '***').replace(waApiKey, '***') // Mask creds in logs
      });
      throw new Error(`Failed to fetch templates from Exotel: ${exotelResponse.status} - ${errorText}`);
    }

    const exotelResult = await exotelResponse.json();
    console.log('Exotel templates response:', JSON.stringify(exotelResult, null, 2));

    const templates = exotelResult?.response?.whatsapp?.templates || [];
    let syncedCount = 0;
    let failedCount = 0;

    for (const templateWrapper of templates) {
      const template = templateWrapper.data;
      if (!template || templateWrapper.code !== 200) {
        failedCount++;
        continue;
      }

      try {
        // Extract components
        const headerComponent = template.components?.find((c: any) => c.type === 'HEADER');
        const bodyComponent = template.components?.find((c: any) => c.type === 'BODY');
        const footerComponent = template.components?.find((c: any) => c.type === 'FOOTER');
        const buttonsComponent = template.components?.find((c: any) => c.type === 'BUTTONS');

        // Extract variables from body text
        const bodyText = bodyComponent?.text || '';
        const variables = bodyText.match(/\{\{[^}]+\}\}/g) || [];

        // Map Exotel status to our status / submission_status. The DB
        // CHECK constraint only allows submission_status in (draft,
        // pending_submission, synced, rejected).
        let status = 'pending';
        let submissionStatus = 'pending_submission';
        if (template.status === 'APPROVED') {
          status = 'approved';
          submissionStatus = 'synced';
        } else if (template.status === 'REJECTED') {
          status = 'rejected';
          submissionStatus = 'rejected';
        }

        // header_type CHECK only allows text/image/video/document, so map
        // Exotel's HEADER format only when it's one of those.
        const rawHeaderFormat = headerComponent?.format?.toLowerCase() || null;
        const headerType = ['text', 'image', 'video', 'document'].includes(rawHeaderFormat || '')
          ? rawHeaderFormat
          : null;

        // Only UPDATE existing rows. Do NOT insert new templates from
        // Exotel — the WABA may be shared with other apps and those
        // templates don't belong to this CRM org.
        const { data: updatedRows, error: upsertError } = await serviceClient
          .from('communication_templates')
          .update({
            template_name: template.name,
            content: bodyText,
            category: template.category?.toLowerCase() || 'utility',
            language: template.language || 'en',
            status: status,
            submission_status: submissionStatus,
            header_type: headerType,
            header_content: headerComponent?.text || null,
            footer_text: footerComponent?.text || null,
            buttons: buttonsComponent?.buttons || null,
            variables: variables,
            rejection_reason: template.rejected_reason && template.rejected_reason !== 'NONE' ? template.rejected_reason : null,
            last_synced_at: new Date().toISOString(),
          })
          .eq('org_id', orgId)
          .eq('template_id', template.id || template.name)
          .eq('template_type', 'whatsapp')
          .select('id');

        if (upsertError) {
          console.error('Error updating template:', template.name, upsertError);
          failedCount++;
        } else if (updatedRows && updatedRows.length > 0) {
          // Row existed and was refreshed
          syncedCount++;
        }
        // Otherwise the template lives on the shared WABA but wasn't
        // created from this CRM — silently skip.
      } catch (err) {
        console.error('Error processing template:', template.name, err);
        failedCount++;
      }
    }

    console.log(`Synced ${syncedCount} templates, ${failedCount} failed`);

    return new Response(
      JSON.stringify({
        success: true,
        synced: syncedCount,
        failed: failedCount,
        total: templates.length,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error syncing templates:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});