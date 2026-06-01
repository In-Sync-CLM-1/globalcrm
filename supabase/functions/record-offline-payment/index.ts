import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.58.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type PaymentFor = 'wallet' | 'subscription';
type OfflineMethod = 'bank_transfer' | 'upi' | 'cheque' | 'cash' | 'card_machine' | 'other';

interface RecordRequest {
  org_id: string;
  payment_for: PaymentFor;
  amount: number;
  method: OfflineMethod;
  reference?: string;          // UTR / cheque no / txn id
  notes?: string;
  // subscription-only
  billing_period?: 'monthly' | 'quarterly' | 'annual';
  invoice_id?: string;
  received_on?: string;        // ISO date the money actually arrived (optional)
}

const METHOD_LABEL: Record<OfflineMethod, string> = {
  bank_transfer: 'Bank transfer',
  upi: 'UPI',
  cheque: 'Cheque',
  cash: 'Cash',
  card_machine: 'Card machine',
  other: 'Other',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // 1. Authenticate the caller from their JWT.
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) throw new Error('Unauthorized');

    const authClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    );
    const { data: { user }, error: userError } = await authClient.auth.getUser(
      authHeader.replace('Bearer ', '')
    );
    if (userError || !user) throw new Error('Unauthorized');

    // 2. Service-role client for the privileged work.
    const db = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // 3. Only a platform admin may record a payment that wasn't taken online.
    //    (Crediting money / unlocking an account must never be self-service.)
    const { data: caller } = await db
      .from('profiles')
      .select('is_platform_admin, first_name, last_name')
      .eq('id', user.id)
      .single();

    if (!caller?.is_platform_admin) {
      return new Response(
        JSON.stringify({ error: 'Only platform admins can record offline payments.' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 4. Validate input.
    const body: RecordRequest = await req.json();
    const { org_id, payment_for, method, reference, notes, billing_period, invoice_id, received_on } = body;
    const amount = Number(body.amount);

    if (!org_id) throw new Error('Organisation is required.');
    if (!(amount > 0)) throw new Error('Amount must be greater than zero.');
    if (payment_for !== 'wallet' && payment_for !== 'subscription') {
      throw new Error('payment_for must be "wallet" or "subscription".');
    }
    const methodLabel = METHOD_LABEL[method] ?? 'Offline';
    const refSuffix = reference ? ` · ${reference}` : '';
    const recordedBy = [caller.first_name, caller.last_name].filter(Boolean).join(' ') || user.email;
    const nowIso = new Date().toISOString();

    // The amount the admin enters is the total received, GST INCLUSIVE. Only the
    // ex-GST base is wallet money (GST is paid to the government). Back it out
    // from the active GST rate so offline credit matches the Razorpay path.
    const { data: pricing } = await db
      .from('subscription_pricing')
      .select('gst_percentage')
      .eq('is_active', true)
      .maybeSingle();
    const gstPct = Number(pricing?.gst_percentage ?? 18);
    const baseAmount = Math.round((amount / (1 + gstPct / 100)) * 100) / 100;
    const gstAmount = Math.round((amount - baseAmount) * 100) / 100;
    // Wallet gets the ex-GST base; a subscription invoice is settled at the full
    // received amount (the invoice total already includes GST).
    const creditAmount = payment_for === 'wallet' ? baseAmount : amount;

    // Current state — used to decide whether clearing the lock must also reactivate
    // a subscription that had been suspended/cancelled for non-payment.
    const { data: subRow } = await db
      .from('organization_subscriptions')
      .select('subscription_status, wallet_balance')
      .eq('org_id', org_id)
      .single();
    const prevStatus = (subRow?.subscription_status as string | undefined) ?? null;

    // 5. One payment_transactions row of record (mirrors the Razorpay shape, but
    //    marked offline so it's auditable and never confused with an online charge).
    const { data: paymentTxn, error: txnError } = await db
      .from('payment_transactions')
      .insert({
        org_id,
        invoice_id: payment_for === 'subscription' ? (invoice_id || null) : null,
        transaction_type: payment_for === 'subscription' ? 'subscription_payment' : 'wallet_topup',
        amount,
        payment_status: 'success',
        payment_method: `offline_${method}`,
        initiated_by: user.id,
        initiated_at: nowIso,
        completed_at: nowIso,
        metadata: {
          offline: true,
          method,
          method_label: methodLabel,
          reference: reference || null,
          notes: notes || null,
          received_on: received_on || null,
          recorded_by: recordedBy,
          recorded_by_id: user.id,
          billing_period: billing_period || null,
          gst_percentage: gstPct,
          base_amount: baseAmount,
          gst_amount: gstAmount,
        },
      })
      .select()
      .single();

    if (txnError) throw txnError;

    if (payment_for === 'subscription') {
      // Settle the invoice if one was named.
      if (invoice_id) {
        await db
          .from('subscription_invoices')
          .update({
            paid_amount: amount,
            payment_status: 'paid',
            paid_at: nowIso,
            updated_at: nowIso,
          })
          .eq('id', invoice_id);
      }

      // Restore the subscription and advance the next billing date by the cadence.
      const period = billing_period || 'monthly';
      const monthsToAdd = period === 'annual' ? 12 : period === 'quarterly' ? 3 : 1;
      const nextBillingDate = new Date();
      nextBillingDate.setMonth(nextBillingDate.getMonth() + monthsToAdd);

      await db
        .from('organization_subscriptions')
        .update({
          subscription_status: 'active',
          billing_period: period,
          last_payment_date: nowIso,
          next_billing_date: nextBillingDate.toISOString().split('T')[0],
          suspension_date: null,
          suspension_reason: null,
          updated_at: nowIso,
        })
        .eq('org_id', org_id);

      await db.from('organizations').update({ services_enabled: true }).eq('id', org_id);
    } else {
      // Wallet top-up — credit the balance and write an audited wallet ledger row.
      const before = Number(subRow?.wallet_balance || 0);
      const after = before + creditAmount;

      await db
        .from('organization_subscriptions')
        .update({ wallet_balance: after, wallet_last_topup_date: nowIso, updated_at: nowIso })
        .eq('org_id', org_id);

      await db.from('wallet_transactions').insert({
        org_id,
        transaction_type: 'topup',
        amount: creditAmount,
        balance_before: before,
        balance_after: after,
        payment_transaction_id: paymentTxn.id,
        description: `Offline payment (excl. GST) — ${methodLabel}${refSuffix}`,
        admin_reason: notes || `₹${amount} received incl. GST · recorded by ${recordedBy}`,
        created_by: user.id,
      });
    }

    // 5b. Unlock the org. Offline-billing orgs carry NO wallet reserve floor, so
    //     set the minimum to zero (any positive balance counts as "in service"),
    //     and reactivate the subscription if it had been suspended/cancelled for
    //     non-payment. Recording an admin payment always restores access —
    //     is_org_locked() recomputes live, so the lock lifts immediately.
    const unlock: Record<string, unknown> = { wallet_minimum_balance: 0, updated_at: nowIso };
    if (prevStatus === 'suspended_locked' || prevStatus === 'cancelled') {
      unlock.subscription_status = 'active';
      unlock.suspension_date = null;
      unlock.suspension_reason = null;
    }
    await db.from('organization_subscriptions').update(unlock).eq('org_id', org_id);
    await db.from('organizations').update({ services_enabled: true }).eq('id', org_id);

    // 6. Best-effort receipt email to the org (never blocks the record).
    try {
      await db.functions.invoke('send-subscription-email', {
        body: {
          org_id,
          template_type: 'payment_successful',
          data: { amount, payment_id: `offline:${methodLabel}${refSuffix}` },
        },
      });
    } catch (_) { /* email is non-critical */ }

    console.log(`Offline ${payment_for} payment of ₹${amount} recorded for org ${org_id} by ${recordedBy}`);

    return new Response(
      JSON.stringify({ success: true, payment_transaction_id: paymentTxn.id }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error in record-offline-payment:', error);
    const message = error instanceof Error ? error.message : 'Unknown error occurred';
    return new Response(
      JSON.stringify({ error: message }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
