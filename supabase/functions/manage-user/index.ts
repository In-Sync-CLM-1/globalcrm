import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
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
    // Create service role client to bypass RLS
    const supabaseAdmin = getSupabaseClient();

    // Get the authorization header
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'No authorization header' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Verify the JWT and get user
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(token);
    
    if (userError || !user) {
      console.error('Auth error:', userError);
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get requesting user's profile and role
    const { data: requestingProfile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('org_id, is_platform_admin')
      .eq('id', user.id)
      .single();

    if (profileError || !requestingProfile) {
      console.error('Profile error:', profileError);
      return new Response(JSON.stringify({ error: 'Profile not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Allow either org admins/super_admins OR platform admins
    if (!requestingProfile.is_platform_admin) {
      const { data: userRole, error: roleError } = await supabaseAdmin
        .from('user_roles')
        .select('role')
        .eq('user_id', user.id)
        .eq('org_id', requestingProfile.org_id)
        .single();

      if (roleError || !userRole || !['admin', 'super_admin'].includes(userRole.role)) {
        console.error('Role check failed for org admin:', roleError, userRole);
        return new Response(JSON.stringify({ error: 'Insufficient permissions' }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    } else {
      console.log('Platform admin authorized for manage-user:', { user_id: user.id });
    }

    const requestingUserOrgId = requestingProfile.org_id;

    const body = await req.json();
    const { action } = body;

    // Handle Create new user (POST without action='update', or action='create')
    if (action !== 'update') {
      const { 
        email,
        password,
        first_name,
        last_name,
        role,
        phone,
        designation_id,
        reports_to_user_id,
        calling_enabled,
        whatsapp_enabled,
        email_enabled,
        sms_enabled
      } = body;

      // Validate required fields
      if (!email || !email.trim()) {
        console.error('Validation error: Email is required');
        return new Response(JSON.stringify({ error: 'Email is required' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      if (!password || !password.trim()) {
        console.error('Validation error: Password is required');
        return new Response(JSON.stringify({ error: 'Password is required' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      if (reports_to_user_id) {
        const { data: managerProfile } = await supabaseAdmin
          .from('profiles')
          .select('org_id')
          .eq('id', reports_to_user_id)
          .single();
        if (!managerProfile || managerProfile.org_id !== requestingUserOrgId) {
          return new Response(JSON.stringify({ error: 'Reports-to user must belong to the same organization' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
      }

      console.log('Creating user with data:', { email, first_name, last_name, role, phone, designation_id, reports_to_user_id });

      // Create auth user
      const { data: newUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: {
          first_name,
          last_name,
          org_id: requestingUserOrgId
        }
      });

      if (createError || !newUser.user) {
        console.error('Error creating auth user:', createError);
        return new Response(JSON.stringify({ error: createError?.message || 'Failed to create user' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Update profile with all fields
      const { error: profileUpdateError } = await supabaseAdmin
        .from('profiles')
        .update({
          first_name,
          last_name,
          org_id: requestingUserOrgId,
          phone: phone || null,
          designation_id: designation_id || null,
          reports_to_user_id: reports_to_user_id || null,
          calling_enabled: calling_enabled || false,
          whatsapp_enabled: whatsapp_enabled || false,
          email_enabled: email_enabled || false,
          sms_enabled: sms_enabled || false,
        })
        .eq('id', newUser.user.id);

      if (profileUpdateError) {
        console.error('Error updating profile:', profileUpdateError);
        return new Response(JSON.stringify({ error: 'Failed to update profile' }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Upsert user role — the handle_new_user trigger may have already
      // inserted a default row, so we overwrite it with the chosen role.
      const { error: roleInsertError } = await supabaseAdmin
        .from('user_roles')
        .upsert(
          {
            user_id: newUser.user.id,
            org_id: requestingUserOrgId,
            role: role || 'sales_agent'
          },
          { onConflict: 'user_id,org_id' }
        );

      if (roleInsertError) {
        console.error('Error assigning role:', roleInsertError);
        return new Response(JSON.stringify({ error: 'Failed to assign role' }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      console.log('User created successfully:', newUser.user.id);

      return new Response(JSON.stringify({ success: true, user: newUser.user }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Handle Update existing user
    if (action === 'update') {
      const {
        userId,
        first_name,
        last_name,
        role,
        phone,
        designation_id,
        reports_to_user_id,
        calling_enabled,
        whatsapp_enabled,
        email_enabled,
        sms_enabled
      } = body;

      // Validate required fields for update
      if (!userId) {
        console.error('Validation error: userId is required');
        return new Response(JSON.stringify({ error: 'userId is required' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      if (reports_to_user_id === userId) {
        return new Response(JSON.stringify({ error: 'A user cannot report to themselves' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      console.log('Updating user:', userId, 'with data:', { first_name, last_name, role, phone, designation_id, reports_to_user_id });

      // Verify target user belongs to same org
      const { data: targetProfile, error: targetProfileError } = await supabaseAdmin
        .from('profiles')
        .select('org_id')
        .eq('id', userId)
        .single();

      if (targetProfileError || !targetProfile || targetProfile.org_id !== requestingUserOrgId) {
        console.error('Target profile error:', targetProfileError);
        return new Response(JSON.stringify({ error: 'User not found or access denied' }), {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      if (reports_to_user_id) {
        const { data: managerProfile } = await supabaseAdmin
          .from('profiles')
          .select('org_id')
          .eq('id', reports_to_user_id)
          .single();
        if (!managerProfile || managerProfile.org_id !== requestingUserOrgId) {
          return new Response(JSON.stringify({ error: 'Reports-to user must belong to the same organization' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
      }

      // Update profile
      const { error: profileUpdateError } = await supabaseAdmin
        .from('profiles')
        .update({
          first_name,
          last_name,
          phone: phone || null,
          designation_id: designation_id || null,
          reports_to_user_id: reports_to_user_id || null,
          calling_enabled: calling_enabled ?? false,
          whatsapp_enabled: whatsapp_enabled ?? false,
          email_enabled: email_enabled ?? false,
          sms_enabled: sms_enabled ?? false,
        })
        .eq('id', userId);

      if (profileUpdateError) {
        console.error('Error updating profile:', profileUpdateError);
        return new Response(JSON.stringify({ error: 'Failed to update profile' }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Update role if provided
      if (role) {
        const { error: roleUpdateError } = await supabaseAdmin
          .from('user_roles')
          .update({ role })
          .eq('user_id', userId)
          .eq('org_id', requestingUserOrgId);

        if (roleUpdateError) {
          console.error('Error updating role:', roleUpdateError);
          return new Response(JSON.stringify({ error: 'Failed to update role' }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
      }

      console.log('User updated successfully:', userId);

      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Unexpected error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
