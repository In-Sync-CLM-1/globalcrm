import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.58.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface BulkDeleteRequest {
  tableName: 'contacts' | 'fervent_data_repository';
  recordIds: string[];
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Step 1: Extract and verify authenticated user from JWT
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Missing authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const token = authHeader.replace('Bearer ', '');
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    
    // Create client with service role for admin operations
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    
    // Verify user from JWT
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      console.error('[BulkDelete] Auth error:', authError);
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('[BulkDelete] Authenticated user:', user.id);

    // Step 2: Get user's org_id from profiles (server-side, never trust client)
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('org_id')
      .eq('id', user.id)
      .single();

    if (profileError || !profile?.org_id) {
      console.error('[BulkDelete] Profile error:', profileError);
      return new Response(
        JSON.stringify({ error: 'User organization not found' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const userOrgId = profile.org_id;
    console.log('[BulkDelete] User org_id:', userOrgId);

    // Step 3: Parse request body
    const { tableName, recordIds }: BulkDeleteRequest = await req.json();

    // Validate input
    if (!tableName || !recordIds || !Array.isArray(recordIds) || recordIds.length === 0) {
      return new Response(
        JSON.stringify({ error: 'Invalid request: tableName and recordIds are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[BulkDelete] Deleting ${recordIds.length} records from ${tableName}`);

    // Step 4: Call the optimized PostgreSQL function
    const { data, error } = await supabase.rpc('bulk_delete_verified', {
      _table_name: tableName,
      _record_ids: recordIds,
      _org_id: userOrgId,
      _user_id: user.id
    });

    if (error) {
      console.error('[BulkDelete] RPC error:', error);
      
      // Check for specific error messages
      if (error.message.includes('Invalid table name')) {
        return new Response(
          JSON.stringify({ error: 'Invalid table name' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      if (error.message.includes('cross-org')) {
        return new Response(
          JSON.stringify({ error: 'Forbidden: Cannot delete records from other organizations' }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      throw error;
    }

    const deletedCount = data?.deleted || recordIds.length;
    console.log(`[BulkDelete] Successfully deleted ${deletedCount} records from ${tableName}`);

    return new Response(
      JSON.stringify({
        success: true,
        deletedCount,
        tableName,
        message: `Successfully deleted ${deletedCount} record(s)`
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[BulkDelete] Unexpected error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
