// GET the list of RMPL OPM projects, for the "RMPL Project ID" picker shown
// when an RMPL-org user converts a Won contact into a client (see
// 20260926100000_clients_rmpl_project_id.sql). Direct PostgREST read against
// RMPL's own Supabase project using a service-role key, same pattern rmpl
// itself uses for cross-app reads (e.g. VENDOR_SUPABASE_SERVICE_ROLE_KEY).
//
// Restricted to users in the RMPL org (9b3528ad-8946-4f31-a1ca-1c8d3d782fb9)
// -- no other org on this platform has RMPL projects to pick from.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.58.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const RMPL_ORG_ID = '9b3528ad-8946-4f31-a1ca-1c8d3d782fb9';

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: req.headers.get('Authorization')! } } }
    );

    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: profile } = await supabaseClient
      .from('profiles')
      .select('org_id')
      .eq('id', user.id)
      .single();

    if (profile?.org_id !== RMPL_ORG_ID) {
      return new Response(JSON.stringify({ error: 'Forbidden' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const rmplUrl = Deno.env.get('RMPL_SUPABASE_URL');
    const rmplKey = Deno.env.get('RMPL_SUPABASE_SERVICE_ROLE_KEY');
    if (!rmplUrl || !rmplKey) {
      return new Response(JSON.stringify({ error: 'RMPL bridge not configured' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const resp = await fetch(
      `${rmplUrl}/rest/v1/projects?select=id,project_number,project_name&order=created_at.desc&limit=2000`,
      { headers: { apikey: rmplKey, Authorization: `Bearer ${rmplKey}` } }
    );

    if (!resp.ok) {
      return new Response(JSON.stringify({ error: `RMPL project fetch failed: ${resp.status}` }), {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const projects = await resp.json();
    return new Response(JSON.stringify({ projects }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('rmpl-project-list error:', error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Internal error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
