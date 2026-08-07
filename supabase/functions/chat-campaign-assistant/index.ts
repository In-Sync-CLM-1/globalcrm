import { getSupabaseClient } from '../_shared/supabaseClient.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Text-only tier: Groq first, Cerebras as the fallback if Groq is
// unavailable/errors. Both are OpenAI-compatible chat-completions APIs.
async function callGroqText(system: string, userContent: string, maxTokens: number, temperature: number): Promise<string | null> {
  const key = Deno.env.get('GROQ_API_KEY');
  if (!key) return null;
  try {
    const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        max_tokens: maxTokens,
        temperature,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: userContent },
        ],
      }),
    });
    if (!resp.ok) {
      console.error('Groq API error:', resp.status, await resp.text());
      return null;
    }
    const data = await resp.json();
    return data.choices?.[0]?.message?.content ?? null;
  } catch (e) {
    console.error('Groq call error:', e);
    return null;
  }
}

async function callCerebrasText(system: string, userContent: string, maxTokens: number, temperature: number): Promise<string | null> {
  const key = Deno.env.get('CEREBRAS_API_KEY');
  if (!key) return null;
  try {
    const resp = await fetch('https://api.cerebras.ai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gemma-4-31b',
        max_tokens: maxTokens,
        temperature,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: userContent },
        ],
      }),
    });
    if (!resp.ok) {
      console.error('Cerebras API error:', resp.status, await resp.text());
      return null;
    }
    const data = await resp.json();
    return data.choices?.[0]?.message?.content ?? null;
  } catch (e) {
    console.error('Cerebras call error:', e);
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { query, orgId } = await req.json();

    if (!query || !orgId) {
      throw new Error('Missing required parameters: query and orgId');
    }

    const supabase = getSupabaseClient();

    if (!Deno.env.get('GROQ_API_KEY') && !Deno.env.get('CEREBRAS_API_KEY')) {
      throw new Error('GROQ_API_KEY / CEREBRAS_API_KEY not configured');
    }

    // Fetch recent campaign data
    const { data: emailCampaigns } = await supabase
      .from('email_bulk_campaigns')
      .select('*')
      .eq('org_id', orgId)
      .order('created_at', { ascending: false })
      .limit(10);

    const { data: whatsappCampaigns } = await supabase
      .from('whatsapp_bulk_campaigns')
      .select('*')
      .eq('org_id', orgId)
      .order('created_at', { ascending: false })
      .limit(10);

    // Fetch recent analytics
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const { data: analytics } = await supabase
      .from('campaign_analytics')
      .select('*')
      .eq('org_id', orgId)
      .gte('date', thirtyDaysAgo.toISOString().split('T')[0])
      .order('date', { ascending: false })
      .limit(100);

    // Fetch active insights
    const { data: insights } = await supabase
      .from('campaign_insights')
      .select('*')
      .eq('org_id', orgId)
      .eq('status', 'active')
      .order('priority', { ascending: true })
      .limit(10);

    // Fetch pipeline data
    const { data: stages } = await supabase
      .from('pipeline_stages')
      .select('id, name, stage_order, probability')
      .eq('org_id', orgId)
      .order('stage_order');

    const { data: contacts } = await supabase
      .from('contacts')
      .select('id, pipeline_stage_id, lead_score')
      .eq('org_id', orgId);

    // Fetch recent pipeline movements (last 7 days)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const { data: recentMovements } = await supabase
      .from('pipeline_movement_history')
      .select('*, from_stage:pipeline_stages!from_stage_id(name), to_stage:pipeline_stages!to_stage_id(name)')
      .eq('org_id', orgId)
      .gte('moved_at', sevenDaysAgo.toISOString())
      .order('moved_at', { ascending: false })
      .limit(20);

    // Fetch lead scores by stage
    const { data: leadScores } = await supabase
      .from('contact_lead_scores')
      .select('contact_id, total_score, score_category')
      .eq('org_id', orgId);

    const scoreMap = new Map(leadScores?.map(s => [s.contact_id, s]) || []);

    // Calculate pipeline metrics
    const pipelineMetrics = stages?.map(stage => {
      const stageContacts = contacts?.filter(c => c.pipeline_stage_id === stage.id) || [];
      const scores = stageContacts.map(c => scoreMap.get(c.id)?.score_category).filter(Boolean);
      const avgScore = stageContacts.reduce((sum, c) => {
        const score = scoreMap.get(c.id)?.total_score || 0;
        return sum + score;
      }, 0) / (stageContacts.length || 1);

      return {
        name: stage.name,
        count: stageContacts.length,
        probability: stage.probability,
        avgScore: Math.round(avgScore),
        scoreBreakdown: {
          hot: scores.filter(s => s === 'hot').length,
          warm: scores.filter(s => s === 'warm').length,
          cool: scores.filter(s => s === 'cool').length,
        }
      };
    }) || [];

    // Build context summary
    const emailSummary = emailCampaigns?.map(c => 
      `${c.name}: ${c.status}, ${c.sent_count} sent, ${c.failed_count} failed`
    ).join('\n') || 'No email campaigns';

    const whatsappSummary = whatsappCampaigns?.map(c => 
      `${c.name}: ${c.status}, ${c.sent_count} sent, ${c.failed_count} failed`
    ).join('\n') || 'No WhatsApp campaigns';

    const analyticsSummary = analytics 
      ? `Total campaigns tracked: ${new Set(analytics.map(a => a.campaign_id)).size}, Total conversions: ${analytics.reduce((sum, a) => sum + (a.conversions || 0), 0)}`
      : 'No analytics data';

    const insightsSummary = insights?.map(i => 
      `${i.priority.toUpperCase()}: ${i.title}`
    ).join('\n') || 'No active insights';

    const pipelineSummary = pipelineMetrics.map(m => 
      `${m.name}: ${m.count} contacts (${m.probability}% prob), Avg Score: ${m.avgScore}, Hot: ${m.scoreBreakdown.hot}, Warm: ${m.scoreBreakdown.warm}`
    ).join('\n');

    const recentMovementsSummary = recentMovements?.slice(0, 5).map(m => 
      `${m.from_stage?.name || 'Unknown'} → ${m.to_stage?.name || 'Unknown'} (${m.days_in_previous_stage} days in prev stage)`
    ).join('\n') || 'No recent movements';

    const context = `You are a helpful campaign and pipeline analytics assistant for an organization.

CURRENT CAMPAIGNS:

Email Campaigns (last 10):
${emailSummary}

WhatsApp Campaigns (last 10):
${whatsappSummary}

ANALYTICS SUMMARY (Last 30 days):
${analyticsSummary}

ACTIVE INSIGHTS:
${insightsSummary}

PIPELINE STATUS:
${pipelineSummary}

RECENT PIPELINE MOVEMENTS (Last 7 days):
${recentMovementsSummary}

Provide helpful, data-driven answers about campaign performance, pipeline health, lead scoring, trends, and recommendations.
Be conversational but precise. Use specific numbers when available.
If the user asks about specific campaigns, reference the data above.`;

    // Call Groq first, Cerebras as fallback
    const response = (await callGroqText(context, query, 4096, 0.7))
      ?? (await callCerebrasText(context, query, 4096, 0.7));

    if (response === null) {
      throw new Error('AI API error: both Groq and Cerebras calls failed');
    }

    return new Response(JSON.stringify({ response }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Chat assistant error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
