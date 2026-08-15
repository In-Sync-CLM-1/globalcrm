-- ============================================================
-- Backfill NULL auth token columns
-- ============================================================
-- GoTrue's admin "list users" endpoint scans every row and fails outright if
-- any one of them has NULL in a token column — a single bad row returns
-- 500 "Database error finding users" for the whole listing, not just for that
-- user.
--
-- One row here has email_change = NULL, which is enough to break it. That in
-- turn broke RMPL's app launcher: check-access looks each person up through
-- that endpoint, got a 500, and quietly concluded nobody has a GlobalCRM
-- account — so the GlobalCRM button disappeared for everyone.
--
-- Rows inserted through the auth API always get '' here; rows created by raw
-- SQL leave NULL unless every token column is set explicitly.
-- Idempotent, safe to re-run.
-- ============================================================

UPDATE auth.users
   SET confirmation_token         = COALESCE(confirmation_token, ''),
       recovery_token             = COALESCE(recovery_token, ''),
       email_change               = COALESCE(email_change, ''),
       email_change_token_new     = COALESCE(email_change_token_new, ''),
       email_change_token_current = COALESCE(email_change_token_current, ''),
       phone_change               = COALESCE(phone_change, ''),
       phone_change_token         = COALESCE(phone_change_token, ''),
       reauthentication_token     = COALESCE(reauthentication_token, '')
 WHERE confirmation_token IS NULL
    OR recovery_token IS NULL
    OR email_change IS NULL
    OR email_change_token_new IS NULL
    OR email_change_token_current IS NULL
    OR phone_change IS NULL
    OR phone_change_token IS NULL
    OR reauthentication_token IS NULL;
