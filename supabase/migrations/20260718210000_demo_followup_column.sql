-- Post-demo follow-up email (demo-reminders "followup" phase) fires once per
-- demo meeting, ~2h after the slot; this tracks it.
alter table public.contact_activities add column if not exists demo_followup_sent_at timestamptz;
