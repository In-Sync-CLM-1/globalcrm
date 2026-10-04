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
  designation?: string; // lead's role/designation → stored as contact job_title
  message?: string;
  gclid?: string;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  source_url?: string;
  // Demo preferences captured on the form so the call can confirm, not elicit.
  team_size?: string;
  preferred_date?: string; // YYYY-MM-DD
  preferred_time?: string; // HH:mm
  // Honeypot — real users never fill this; bots do. If set, we 200-OK and drop.
  _hp?: string;
  // Set by the browser when the form refused to send (never a real lead).
  _client_event?: string;
  // Cloudflare Turnstile token from the form (turnstile.render in "invisible"
  // mode — the site key itself is provisioned invisible, so no challenge, no
  // checkbox, no user-visible friction at all). Same provider already proven
  // live on it-helpdesk's signup form (_shared/turnstile.ts there).
  turnstile_token?: string;
}

type TurnstileResult = { result: 'pass' | 'fail' | 'missing' | 'unconfigured' | 'error'; codes?: string };

// LOG-ONLY: this reports what Cloudflare said, it never rejects a lead. Turnstile
// has no score, only pass/fail + error codes; both are recorded on every
// submission so we can see whether real visitors were failing it before ever
// deciding to enforce it again.
async function checkTurnstile(token: string | undefined, ip: string | null): Promise<TurnstileResult> {
  const secret = Deno.env.get('TURNSTILE_SECRET_KEY');
  if (!secret) return { result: 'unconfigured' };
  if (!token) return { result: 'missing' };
  try {
    const params = new URLSearchParams({ secret, response: token });
    if (ip) params.set('remoteip', ip);
    const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: params });
    const j = await r.json();
    if (j.success) return { result: 'pass' };
    return { result: 'fail', codes: Array.isArray(j['error-codes']) ? j['error-codes'].join(',') : undefined };
  } catch (e) {
    console.error('turnstile verify error:', e);
    return { result: 'error' };
  }
}

// Failures the browser reports about itself (validation it blocked, a network
// error). Whitelisted so the public endpoint can't be used to write free text.
const CLIENT_EVENTS = new Set([
  'missing_fields', 'phone_invalid', 'email_invalid', 'network_error', 'server_error', 'unexpected_error',
]);

function clientIp(req: Request): string | null {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  return req.headers.get('cf-connecting-ip') || req.headers.get('x-real-ip');
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

const clean = (v: unknown) =>
  typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined;

const isValidPhone = (v: string) => /^[6-9]\d{9}$/.test(v.replace(/\D/g, ''));
const isValidEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());

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

    const supabase = getSupabaseClient();
    const ip = clientIp(req);
    const userAgent = req.headers.get('user-agent');

    // Browser-reported failure (e.g. the form refused to send): log it and stop.
    // These are the failures the server would otherwise never see.
    if (typeof payload._client_event === 'string') {
      const ev = CLIENT_EVENTS.has(payload._client_event) ? payload._client_event : 'unexpected_error';
      await supabase.from('web_lead_submissions').insert({
        product: clean(payload.product) ?? null,
        source_url: clean(payload.source_url) ?? null,
        ip,
        user_agent: userAgent,
        outcome: 'client_error',
        client_event: ev,
      });
      return json({ success: true });
    }

    // Every hit gets logged before any other check runs — the whole point is
    // to be able to tell a blocked bot from a real lead that failed for some
    // other reason, so this can't be conditional on how the request turns out.
    const honeypotTriggered = !!clean(payload._hp);
    const turnstile = await checkTurnstile(payload.turnstile_token, ip);
    // Only the honeypot blocks. Turnstile is log-only (see checkTurnstile).
    const blocked = honeypotTriggered;
    const blockReason = honeypotTriggered ? 'honeypot' : null;

    const { data: submissionRow } = await supabase
      .from('web_lead_submissions')
      .insert({
        product: clean(payload.product) ?? null,
        source_url: clean(payload.source_url) ?? null,
        ip,
        user_agent: userAgent,
        blocked,
        block_reason: blockReason,
        honeypot_filled: honeypotTriggered,
        turnstile_result: turnstile.result,
        turnstile_codes: turnstile.codes ?? null,
      })
      .select('id')
      .single();
    const submissionId = submissionRow?.id as string | undefined;

    // Closes out the audit row with how this hit ended.
    const finish = async (status: number, outcome: string, errorMessage?: string, extra: Record<string, unknown> = {}) => {
      if (submissionId) {
        await supabase.from('web_lead_submissions')
          .update({ outcome, http_status: status, error_message: errorMessage ?? null, ...extra })
          .eq('id', submissionId);
      }
    };

    // Silently absorb bot submissions (honeypot filled) — look successful, do
    // nothing. Never tip off a script by returning a different response for a
    // blocked vs. accepted submission.
    if (blocked) {
      await finish(200, 'blocked_honeypot');
      return json({ success: true, contact_id: null });
    }

    const product = clean(payload.product);
    const rawPhone = clean(payload.phone);
    const phone = rawPhone ? rawPhone.replace(/\D/g, '') : undefined;
    const email = clean(payload.email);
    const company = clean(payload.company);

    if (!product) { await finish(400, 'rejected', 'product_missing'); return json({ error: 'product is required' }, 400); }
    if (!company) { await finish(400, 'rejected', 'company_missing'); return json({ error: 'Company name is required' }, 400); }
    if (!phone && !email) { await finish(400, 'rejected', 'phone_and_email_missing'); return json({ error: 'A phone or email is required' }, 400); }
    if (phone && !isValidPhone(phone)) { await finish(400, 'rejected', 'phone_invalid'); return json({ error: 'Please enter a valid 10-digit mobile number' }, 400); }
    if (email && !isValidEmail(email)) { await finish(400, 'rejected', 'email_invalid'); return json({ error: 'Please enter a valid email address' }, 400); }

    // Split a full name if first/last not given explicitly.
    let firstName = clean(payload.first_name);
    let lastName = clean(payload.last_name);
    if (!firstName) {
      const parts = (clean(payload.name) || 'Unknown').split(' ');
      firstName = parts[0];
      lastName = lastName || parts.slice(1).join(' ') || '';
    }

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
      await finish(500, 'rejected', 'rule_lookup_failed');
      return json({ error: 'Lookup failed' }, 500);
    }
    if (!rule) {
      console.warn('No active assignment rule for product:', product);
      await finish(400, 'rejected', 'unknown_product');
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
        await finish(500, 'rejected', 'pipeline_not_configured');
        return json({ error: 'Pipeline not configured' }, 500);
      }
      stage = newStage;
    }

    const gclid = clean(payload.gclid);
    const utmSource = clean(payload.utm_source);
    const message = clean(payload.message);
    const designation = clean(payload.designation);
    const teamSize = clean(payload.team_size);
    const preferredDate = clean(payload.preferred_date); // YYYY-MM-DD or undefined
    const preferredTime = clean(payload.preferred_time); // HH:mm or undefined
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
      await finish(200, 'deduped', undefined, { contact_id: existingId });
      return json({ success: true, contact_id: existingId, deduped: true });
    }

    const notes =
      `Demo requested via ${source} (${productCanonical}).` +
      (designation ? `\nRole: ${designation}` : '') +
      (teamSize ? `\nTeam size: ${teamSize}` : '') +
      (preferredDate || preferredTime ? `\nPreferred demo: ${preferredDate || '(no date)'} ${preferredTime || ''}`.trimEnd() : '') +
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
        job_title: designation,
        source,
        product: productCanonical,
        status: 'new',
        pipeline_stage_id: stage.id,
        gclid,
        utm_source: utmSource,
        utm_medium: clean(payload.utm_medium),
        utm_campaign: clean(payload.utm_campaign),
        source_url: clean(payload.source_url),
        team_size: teamSize,
        preferred_demo_date: preferredDate || null,
        preferred_demo_time: preferredTime,
        notes,
      })
      .select('id, assigned_to')
      .single();

    if (insertErr) {
      console.error('Contact insert failed:', insertErr);
      await finish(500, 'rejected', `contact_insert_failed: ${insertErr.message}`.slice(0, 300));
      return json({ error: 'Failed to create lead', details: insertErr.message }, 500);
    }

    await finish(200, 'accepted', undefined, { contact_id: contact.id });

    await supabase.from('contact_activities').insert({
      contact_id: contact.id,
      org_id: orgId,
      activity_type: 'note',
      subject: `New ${productCanonical} demo request (website)`,
      description: notes,
      completed_at: new Date().toISOString(),
    });

    console.log(`web-lead-intake: created contact ${contact.id} (${productCanonical}), owner=${contact.assigned_to}`);

    // Relay the raw event to crm — crm owns the decision of whether/how to alert
    // the owner (email + WhatsApp + call). This function does not decide anything
    // about that alert, just forwards what it knows. Fire-and-forget: a failure
    // here must never block lead capture.
    const alertKick = fetch('https://mlvgqudcwlkolsbighnn.supabase.co/functions/v1/lead-alert-notify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: `${firstName} ${lastName || ''}`.trim(),
        phone,
        email,
        company: clean(payload.company),
        product: productCanonical,
        source,
        stage: isDemoIntake ? 'Demo Requested' : 'New',
        page: clean(payload.source_url),
      }),
    }).catch((e) => console.error('lead-alert-notify kick failed:', String(e)));
    try { (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime?.waitUntil?.(alertKick); }
    catch { /* EdgeRuntime unavailable — best-effort only */ }

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
