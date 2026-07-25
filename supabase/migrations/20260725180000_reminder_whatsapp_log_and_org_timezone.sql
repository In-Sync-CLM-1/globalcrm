-- Internal reminder WhatsApps (check-next-actions) are sent to a CRM *user*, not
-- to a contact, so they have no contact to attach to. The NOT NULL constraint made
-- every one of those log inserts fail silently, which is why WhatsApp reminder
-- failures left no trace anywhere.
ALTER TABLE public.whatsapp_messages
  ALTER COLUMN contact_id DROP NOT NULL;

-- check-next-actions reads org.settings->>'timezone' and falls back to UTC.
-- Every org had an empty settings object, so the "today's activities" digest that
-- is meant to land at 9:00 AM local was firing at 9:00 AM UTC = 2:30 PM IST.
UPDATE public.organizations
SET settings = COALESCE(settings, '{}'::jsonb) || jsonb_build_object('timezone', 'Asia/Kolkata')
WHERE COALESCE(settings->>'timezone', '') = '';
