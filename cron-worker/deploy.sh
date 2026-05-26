#!/usr/bin/env bash
# Deploys one Cloudflare Worker per cron (each triggers a single edge function on
# its own schedule, so they don't collide). Replaces the in-database pg_net crons,
# which intermittently fail DNS. Re-runnable / idempotent.
#
# Needs in env: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, SUPABASE_SERVICE_ROLE_KEY
# Run from anywhere: bash cron-worker/deploy.sh
set -uo pipefail
cd "$(dirname "$0")"

: "${SUPABASE_SERVICE_ROLE_KEY:?set SUPABASE_SERVICE_ROLE_KEY}"
: "${CLOUDFLARE_API_TOKEN:?set CLOUDFLARE_API_TOKEN}"

# worker-suffix | TARGET_FN (edge function slug) | cron schedule
JOBS=(
  "dispatcher|pipeline-action-dispatcher|* * * * *"
  "dialer|ai-bulk-call|* * * * *"
  "translit|transliterate-pending|* * * * *"
  "ai-bolna-daily-insights|ai-bolna-daily-insights|5 12 * * *"
  "ai-bolna-reconcile|ai-bolna-reconcile|*/30 * * * *"
  "ai-callback-dispatcher|ai-callback-dispatcher|*/5 * * * *"
  "ai-script-propose|ai-script-propose|15 12 * * *"
  "automation-email-sender|automation-email-sender|*/5 * * * *"
  "check-next-actions|check-next-actions|*/5 * * * *"
  "daily-lead-scoring|daily-lead-scoring|0 2 * * *"
  "send-payment-reminders|send-payment-reminders|0 10 * * *"
  "subscription-status-checker|subscription-status-checker|0 1 * * *"
  "demo-reminders|demo-reminders|*/5 * * * *"
  "exotel-sync-call-logs|exotel-sync-call-logs|*/5 * * * *"
  "generate-coaching-plans|generate-coaching-plans|10 13 * * *"
  "migrate-recording-to-r2|migrate-recording-to-r2|0 13 * * *"
  "generate-monthly-invoices|generate-monthly-invoices|0 2 1 * *"
  "queue-processor|queue-processor|*/5 * * * *"
  "scheduled-messages-processor|scheduled-messages-processor|*/5 * * * *"
  "transcribe-and-analyze-recordings|transcribe-and-analyze-recordings|5 13 * * *"
)

ok=0; fail=0
for entry in "${JOBS[@]}"; do
  IFS='|' read -r suffix fn sched <<< "$entry"
  name="globalcrm-cron-$suffix"
  cat > .tmp.toml <<EOF
name = "$name"
main = "src/index.js"
compatibility_date = "2026-05-01"
vars = { TARGET_FN = "$fn" }
[triggers]
crons = ["$sched"]
EOF
  if wrangler deploy --config .tmp.toml >/dev/null 2>&1; then
    printf '%s' "$SUPABASE_SERVICE_ROLE_KEY" | wrangler secret put SUPABASE_SERVICE_ROLE_KEY --name "$name" >/dev/null 2>&1
    echo "OK    $name -> $fn ($sched)"; ok=$((ok+1))
  else
    echo "FAIL  $name -> $fn"; fail=$((fail+1))
  fi
done
rm -f .tmp.toml
echo "---- deployed $ok, failed $fail ----"
