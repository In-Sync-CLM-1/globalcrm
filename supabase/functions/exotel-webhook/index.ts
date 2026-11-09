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
    const supabaseClient = getSupabaseClient();

    const formData = await req.formData();
    const webhookData: any = {};
    
    for (const [key, value] of formData.entries()) {
      webhookData[key] = value;
    }

    const callSid = webhookData.CallSid;
    const rawStatus = webhookData.Status || webhookData.CallStatus;
    const rawEvent = webhookData.EventType;
    
    console.log('=== Exotel Webhook Received ===');
    console.log('CallSid:', callSid);
    console.log('Status:', rawStatus);
    console.log('EventType:', rawEvent);
    console.log('StartTime:', webhookData.StartTime);
    console.log('EndTime:', webhookData.EndTime);
    console.log('Full webhook data:', JSON.stringify(webhookData));
    
    if (!callSid) {
      console.error('Missing CallSid in webhook');
      return new Response(JSON.stringify({ error: 'Missing CallSid' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Find existing call log
    const { data: callLog } = await supabaseClient
      .from('call_logs')
      .select('*')
      .eq('exotel_call_sid', callSid)
      .single();

    if (!callLog) {
      console.error('Call log not found for CallSid:', callSid);
      return new Response(JSON.stringify({ error: 'Call log not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const status = webhookData.Status?.toLowerCase() || 
                   webhookData.EventType?.toLowerCase() || 
                   webhookData.CallStatus?.toLowerCase() || 
                   'unknown';
    
    // Defensive terminal state detection
    const normalizedStatus = status.toLowerCase();
    const isTerminal = 
      ['completed', 'failed', 'busy', 'no-answer', 'canceled'].includes(normalizedStatus) ||
      normalizedStatus.startsWith('completed') ||
      normalizedStatus.startsWith('failed');
    
    console.log('Normalized status:', normalizedStatus);
    console.log('Is terminal:', isTerminal);
    
    const updateData: any = {
      status,
      exotel_raw_data: webhookData,
    };

    // Helper function to parse Exotel IST times to UTC
    const parseExotelTime = (timeStr: string | null) => {
      if (!timeStr) return null;
      // Exotel sends times in IST (UTC+5:30), convert to UTC
      const istDate = new Date(timeStr + ' GMT+0530');
      return istDate.toISOString();
    };

    // Update timestamps based on status
    if (webhookData.StartTime) {
      updateData.started_at = parseExotelTime(webhookData.StartTime);
    }
    if (webhookData.AnswerTime) {
      updateData.answered_at = parseExotelTime(webhookData.AnswerTime);
    }
    if (webhookData.EndTime) {
      updateData.ended_at = parseExotelTime(webhookData.EndTime);
    }

    // Update durations
    if (webhookData.Duration) {
      updateData.call_duration = parseInt(webhookData.Duration);
    }
    if (webhookData.ConversationDuration) {
      updateData.conversation_duration = parseInt(webhookData.ConversationDuration);
    }
    if (webhookData.RingDuration) {
      updateData.ring_duration = parseInt(webhookData.RingDuration);
    }

    // Update recording URL if available
    if (webhookData.RecordingUrl) {
      updateData.recording_url = webhookData.RecordingUrl;
      if (webhookData.RecordingDuration) {
        updateData.recording_duration = parseInt(webhookData.RecordingDuration);
      }
    }

    // Update call log
    await supabaseClient
      .from('call_logs')
      .update(updateData)
      .eq('id', callLog.id);

    // If call ended, create activity and clear session
    if (isTerminal) {
      console.log('Call is terminal - creating activity and closing session');

      // Auto-set "Not Connected" disposition when call was dialled but never connected.
      // Treats: no-answer, busy, failed, canceled, OR completed-with-zero-conversation.
      const conversationDur = updateData.conversation_duration ?? callLog.conversation_duration ?? 0;
      const notConnected =
        ['no-answer', 'busy', 'failed', 'canceled', 'cancelled'].includes(normalizedStatus) ||
        (normalizedStatus === 'completed' && conversationDur === 0);

      let notConnectedDispositionId: string | null = null;
      if (notConnected && !callLog.disposition_id) {
        // Orgs name this outcome "Not Connected" (default list) or "Unreachable" (custom lists,
        // with "No Answer" / "Busy" sub-options). Use whichever is active, preferring Not Connected.
        const { data: candidates } = await supabaseClient
          .from('call_dispositions')
          .select('id, name')
          .eq('org_id', callLog.org_id)
          .eq('is_active', true)
          .in('name', ['Not Connected', 'Unreachable']);
        const disposition =
          candidates?.find((d) => d.name === 'Not Connected') ?? candidates?.find((d) => d.name === 'Unreachable');

        if (disposition?.id) {
          notConnectedDispositionId = disposition.id;
          const { data: sub } = await supabaseClient
            .from('call_sub_dispositions')
            .select('id')
            .eq('disposition_id', disposition.id)
            .eq('is_active', true)
            .eq('name', normalizedStatus === 'busy' ? 'Busy' : 'No Answer')
            .maybeSingle();
          await supabaseClient
            .from('call_logs')
            .update({ disposition_id: disposition.id, ...(sub?.id ? { sub_disposition_id: sub.id } : {}) })
            .eq('id', callLog.id);
          console.log(`Auto-set disposition to ${disposition.name} for call`, callLog.id);
        } else {
          console.warn('Not Connected disposition missing for org', callLog.org_id);
        }
      }

      // Create contact activity
      if (callLog.contact_id) {
        const { data: activity } = await supabaseClient
          .from('contact_activities')
          .insert({
            org_id: callLog.org_id,
            contact_id: callLog.contact_id,
            activity_type: 'call',
            subject: `${callLog.call_type === 'outbound' ? 'Outbound' : 'Inbound'} call - ${status}`,
            description: `Call duration: ${updateData.conversation_duration || 0} seconds`,
            created_by: callLog.agent_id,
            completed_at: updateData.ended_at || new Date().toISOString(),
            call_duration: updateData.conversation_duration,
            call_disposition_id: notConnectedDispositionId,
          })
          .select()
          .single();

        // Link activity to call log
        if (activity) {
          await supabaseClient
            .from('call_logs')
            .update({ activity_id: activity.id })
            .eq('id', callLog.id);
        }
      }

      // Clear agent session
      await supabaseClient
        .from('agent_call_sessions')
        .update({
          status: 'ended',
          ended_at: new Date().toISOString()
        })
        .eq('exotel_call_sid', callSid);

      // Fire customer post-call message for auto-set Not Connected calls.
      // (Manual dispositions fire from PostCallDispositionDialog instead.)
      if (notConnectedDispositionId) {
        try {
          const fnUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/send-post-call-message`;
          fetch(fnUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
            },
            body: JSON.stringify({ call_log_id: callLog.id }),
          }).catch((err) => console.warn('send-post-call-message invoke failed:', err));
        } catch (e) {
          console.warn('Failed to fire post-call message:', e);
        }
      }

      // Deduct call cost from wallet (only for completed calls with conversation)
      if (status === 'completed' && updateData.conversation_duration > 0) {
        const conversationMinutes = updateData.conversation_duration / 60;
        const perMinuteCost = 1.00;
        const totalCost = conversationMinutes * perMinuteCost;

        const { data: deductResult, error: deductError } = await supabaseClient.rpc('deduct_from_wallet', {
          _org_id: callLog.org_id,
          _amount: totalCost,
          _service_type: 'call',
          _reference_id: callLog.id,
          _quantity: conversationMinutes,
          _unit_cost: perMinuteCost,
          _user_id: callLog.agent_id
        });

        if (deductError || !deductResult?.success) {
          console.warn('Wallet deduction failed for call:', deductError || deductResult);
          // Call completed, but wallet deduction failed - log but don't fail
        }
      }
    } else {
      // Update session status for ongoing call
      const sessionStatus = 
        status === 'ringing' ? 'ringing' :
        status === 'in-progress' ? 'connected' :
        'initiating';

      await supabaseClient
        .from('agent_call_sessions')
        .update({ status: sessionStatus })
        .eq('exotel_call_sid', callSid);
    }

    return new Response(
      JSON.stringify({ success: true, status }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error in exotel-webhook:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
