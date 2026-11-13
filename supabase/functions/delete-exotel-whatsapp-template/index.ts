import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.58.0';
import { getSupabaseClient } from '../_shared/supabaseClient.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Platform-run products that send on the ONE shared Exotel WABA. Mirrors sync-exotel-whatsapp-templates.
const SHARED_PLATFORM_WABA_ORGS = new Set<string>([
  '6dcf4229-6902-4cd4-9c7f-2d6ed4a6045d', // IEDUP
]);

const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

// Deletes one WhatsApp template: at Exotel/WhatsApp when it was ever submitted, then from this CRM.
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return reply({ error: 'No Authorization header provided' }, 401);

    const userClient = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });
    const { data: { user }, error: userError } = await userClient.auth.getUser(authHeader.replace('Bearer ', ''));
    if (userError || !user) return reply({ error: 'Authentication failed' }, 401);

    const { template_id: rowId } = await req.json().catch(() => ({}));
    if (!rowId) return reply({ error: 'template_id is required' }, 400);

    const service = getSupabaseClient();
    const { data: template } = await service
      .from('communication_templates')
      .select('id, org_id, template_name, template_type, submission_status')
      .eq('id', rowId)
      .maybeSingle();
    // Platform admins have no org of their own, so they may act on any org's template; everyone else only on their own.
    const { data: profile } = await service.from('profiles').select('org_id, is_platform_admin').eq('id', user.id).maybeSingle();
    if (!template || template.template_type !== 'whatsapp' || (template.org_id !== profile?.org_id && !profile?.is_platform_admin)) {
      return reply({ error: 'Template not found' }, 404);
    }
    const orgId = template.org_id as string;

    // A draft that was never sent to WhatsApp only exists here.
    const everSubmitted = !['draft', 'pending_submission'].includes(String(template.submission_status));
    if (everSubmitted) {
      const { data: s } = await service
        .from('exotel_settings').select('*').eq('org_id', orgId).eq('is_active', true).eq('whatsapp_enabled', true).maybeSingle();
      let key: string | null | undefined, token: string | null | undefined, sub: string | null | undefined, sid: string | null | undefined, waba: string | null | undefined;
      if (s?.waba_id) {
        key = s.whatsapp_api_key || s.api_key; token = s.whatsapp_api_token || s.api_token;
        sub = s.whatsapp_subdomain || s.subdomain; sid = s.whatsapp_account_sid || s.account_sid; waba = s.waba_id;
      } else if (SHARED_PLATFORM_WABA_ORGS.has(orgId)) {
        key = Deno.env.get('EXOTEL_API_KEY'); token = Deno.env.get('EXOTEL_API_TOKEN');
        sub = Deno.env.get('EXOTEL_SUBDOMAIN') || 'api.exotel.com'; sid = Deno.env.get('EXOTEL_SID'); waba = Deno.env.get('EXOTEL_WABA_ID');
      }
      if (!key || !token || !sub || !sid || !waba) return reply({ error: 'Exotel WhatsApp is not configured for this organization' }, 400);

      // Exotel deletes by name in the query string (a path-style delete is rejected).
      const url = `https://${sub}/v2/accounts/${sid}/templates?name=${encodeURIComponent(template.template_name)}&waba_id=${encodeURIComponent(waba)}`;
      const res = await fetch(url, { method: 'DELETE', headers: { Authorization: `Basic ${btoa(`${key}:${token}`)}` } });
      const text = await res.text();
      const alreadyGone = /not found|1003/i.test(text);
      if (!res.ok && !alreadyGone) {
        console.error('Exotel template delete failed', res.status, text.slice(0, 300));
        return reply({ error: 'WhatsApp did not accept the deletion. Please try again in a few minutes.' }, 502);
      }
    }

    const { error: delError } = await service.from('communication_templates').delete().eq('id', template.id);
    if (delError) {
      console.error('Template row delete failed', delError.message);
      return reply({ error: 'The template is still used by a campaign or automation, so it cannot be deleted yet.' }, 409);
    }
    return reply({ ok: true, name: template.template_name });
  } catch (e) {
    console.error('delete-exotel-whatsapp-template error', e instanceof Error ? e.message : e);
    return reply({ error: 'Could not delete the template. Please try again.' }, 500);
  }
});
