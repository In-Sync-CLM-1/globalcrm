# GlobalCRM ledger worker

Cloudflare Worker `globalcrm-ledger` that guards the tamper-evident activity ledger (`activity_ledger` and the `ledger_*` tables in Supabase).

- Every 5 minutes: copies new sign-ins and seals new ledger entries into a block.
- Nightly (20:30 UTC): verifies the chain, matches the database against the full copy in R2 bucket `globalcrm-ledger` and the fingerprint copy in Google Drive, adds new blocks to both, and emails ops only if something does not match.

Secrets are set once with `wrangler secret put` and survive deploys. Manual run: `POST https://globalcrm-ledger.<account>.workers.dev/?job=seal|nightly` with the service secret key as Bearer token.
