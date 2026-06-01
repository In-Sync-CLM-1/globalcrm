import { getSupabaseClient } from '../_shared/supabaseClient.ts';

/**
 * Public web-lead intake.
 *
 * A single front door that product landing pages POST a lead into. The first
 * consumer is the WorkSync "Request a Demo" form; other product sites reuse the
 * same endpoint with a different `product`.
 *
 * It does NOT need to know about owners or routing: it inserts a contact with
 * `product` set, and globalcrm's existing triggers take over —
 *   - fn_auto_assign_owner() assigns the right owner (e.g. Worksync -> Riya)
 *     via lead_assignment_rules,
 *   - activity logging + auto-enrichment + outbound webhooks fire on insert.
 *
 * The product->org (and product->owner) mapping is sourced from
 * lead_assignment_rules, so onboarding a new product is a data change, not code.
 *
 * Public (verify_jwt=false): the browser calls it directly with no key, so no
 * secret is ever exposed in a product's frontend bundle.
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface LeadPayload {
  product?: string;
  name?: string;
  first_name?: string;
  last_name?: string;
  phone?: string;
  email?: string;
  company?: string;
  message?: string;
  gclid?: string;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  source_url?: string;
  // Honeypot — real users never fill this; bots do. If set, we 200-OK and drop.
  _hp?: string;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

const clean = (v: unknown) =>
  typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    let payload: LeadPayload;
    try {
      payload = await req.json();
    } catch {
      return json({ error: 'Invalid JSON body' }, 400);
    }

    // Silently absorb bot submissions (honeypot filled) — look successful, do nothing.
    if (clean(payload._hp)) return json({ success: true, contact_id: null });

    const product = clean(payload.product);
    const phone = clean(payload.phone);
    const email = clean(payload.email);

    if (!product) return json({ error: 'product is required' }, 400);
    if (!phone && !email) return json({ error: 'A phone or email is required' }, 400);

    // Split a full name if first/last not given explicitly.
    let firstName = clean(payload.first_name);
    let lastName = clean(payload.last_name);
    if (!firstName) {
      const parts = (clean(payload.name) || 'Unknown').split(' ');
      firstName = parts[0];
      lastName = lastName || parts.slice(1).join(' ') || '';
    }

    const supabase = getSupabaseClient();

    // Resolve product -> org via the same rules that drive owner assignment.
    const { data: rule, error: ruleErr } = await supabase
      .from('lead_assignment_rules')
      .select('org_id, product')
      .ilike('product', product)
      .eq('is_active', true)
      .limit(1)
      .maybeSingle();

    if (ruleErr) {
      console.error('lead_assignment_rules lookup failed:', ruleErr);
      return json({ error: 'Lookup failed' }, 500);
    }
    if (!rule) {
      console.warn('No active assignment rule for product:', product);
      return json({ error: `Unknown product: ${product}` }, 400);
    }
    const orgId = rule.org_id;
    // Use the product string exactly as stored so the auto-assign trigger matches.
    const productCanonical = rule.product;

    // Stage routing: products with a dedicated demo-confirm flow (WorkSync) drop
    // into the "Demo Requested" stage, which fires the prompt qualify-and-book
    // call. Everything else starts at "New". Falls back to "New" if absent.
    let stage: { id: string } | null = null;
    let isDemoIntake = false;
    if (productCanonical.toLowerCase() === 'worksync') {
      const { data: demoStage } = await supabase
        .from('pipeline_stages')
        .select('id')
        .eq('org_id', orgId)
        .eq('name', 'Demo Requested')
        .eq('is_active', true)
        .maybeSingle();
      stage = demoStage ?? null;
      isDemoIntake = !!stage;
    }
    if (!stage) {
      const { data: newStage, error: stageErr } = await supabase
        .from('pipeline_stages')
        .select('id')
        .eq('org_id', orgId)
        .eq('name', 'New')
        .eq('is_active', true)
        .maybeSingle();
      if (stageErr || !newStage) {
        console.error('Pipeline stage not found for org', orgId, stageErr);
        return json({ error: 'Pipeline not configured' }, 500);
      }
      stage = newStage;
    }

    const gclid = clean(payload.gclid);
    const utmSource = clean(payload.utm_source);
    const message = clean(payload.message);
    // Channel attribution: a gclid means it came from a Google Ad.
    const source = gclid ? 'Google Ads' : (utmSource || 'Website');

    // Dedup within the org by phone (then email) so double-submits / repeat
    // enquiries don't spawn duplicate contacts or re-trigger enrichment.
    let existingId: string | null = null;
    if (phone || email) {
      const orFilter = [phone ? `phone.eq.${phone}` : null, email ? `email.eq.${email}` : null]
        .filter(Boolean)
        .join(',');
      const { data: existing } = await supabase
        .from('contacts')
        .select('id')
        .eq('org_id', orgId)
        .or(orFilter)
        .limit(1)
        .maybeSingle();
      existingId = existing?.id ?? null;
    }

    if (existingId) {
      await supabase.from('contact_activities').insert({
        contact_id: existingId,
        org_id: orgId,
        activity_type: 'note',
        subject: `Repeat ${productCanonical} demo request (website)`,
        description: message || 'Demo requested again via website form.',
        completed_at: new Date().toISOString(),
      });
      return json({ success: true, contact_id: existingId, deduped: true });
    }

    const notes =
      `Demo requested via ${source} (${productCanonical}).` +
      (message ? `\nMessage: ${message}` : '') +
      (payload.source_url ? `\nPage: ${clean(payload.source_url)}` : '');

    const { data: contact, error: insertErr } = await supabase
      .from('contacts')
      .insert({
        org_id: orgId,
        first_name: firstName,
        last_name: lastName,
        phone,
        email,
        company: clean(payload.company),
        source,
        product: productCanonical,
        status: 'new',
        pipeline_stage_id: stage.id,
        gclid,
        utm_source: utmSource,
        utm_medium: clean(payload.utm_medium),
        utm_campaign: clean(payload.utm_campaign),
        source_url: clean(payload.source_url),
        notes,
      })
      .select('id, assigned_to')
      .single();

    if (insertErr) {
      console.error('Contact insert failed:', insertErr);
      return json({ error: 'Failed to create lead', details: insertErr.message }, 500);
    }

    await supabase.from('contact_activities').insert({
      contact_id: contact.id,
      org_id: orgId,
      activity_type: 'note',
      subject: `New ${productCanonical} demo request (website)`,
      description: notes,
      completed_at: new Date().toISOString(),
    });

    console.log(`web-lead-intake: created contact ${contact.id} (${productCanonical}), owner=${contact.assigned_to}`);

    // Instant dial: the insert above already enqueued the qualify call via the
    // stage trigger. Ping the dispatcher now so an in-window demo request is
    // called within seconds instead of waiting for the next cron tick. The
    // dispatcher self-enforces the calling window / caps / billing, so this is a
    // safe no-op out of window — the every-minute cron stays the catch-all.
    if (isDemoIntake) {
      const dispatcherUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/pipeline-action-dispatcher`;
      const srk = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
      const kick = fetch(dispatcherUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${srk}` },
        body: '{}',
      }).catch((e) => console.error('dispatcher kick failed:', String(e)));
      // Keep the fetch alive past the HTTP response (a bare fire-and-forget gets cut off).
      try { (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime?.waitUntil?.(kick); }
      catch { /* EdgeRuntime unavailable — cron picks it up within a minute */ }
    }

    return json({ success: true, contact_id: contact.id });
  } catch (error) {
    console.error('web-lead-intake fatal:', error);
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return json({ error: 'Internal server error', details: msg }, 500);
  }
});
