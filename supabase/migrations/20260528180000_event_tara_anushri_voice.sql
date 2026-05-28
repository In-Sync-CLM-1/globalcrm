-- Event v6: switch Tara's voice (Riya Rao → Anushri) and warm up the opener.
--
-- Feedback after the v5 test call: pitch felt matter-of-fact and clipped
-- expressions like "Quick check" did not land. Two changes:
--   1. Voice switched from Riya Rao (vYENaCJHl4vFKNDYPr8y) to Anushri
--      (zFLlkq72ysbq1TWC0Mlx) — the schema's newer default; different tonal
--      profile, more expressive.
--   2. Opener re-phrased to drop "Quick check —" and add a warmer lead-in
--      ("I wanted to quickly tell you about a platform we have built").
--
-- The Bolna agent must be RECREATED (PATCH silently ignores tools_config /
-- synthesizer changes). New agent is created via scripts/create-event-bolna-agent.mjs
-- (now parameterised for voice + synth-tuning), bolna_agent_id is relinked
-- below, and the old agent ca01b4eb… is deleted.

UPDATE public.ai_call_scripts
   SET voice_id   = 'zFLlkq72ysbq1TWC0Mlx',
       voice_name = 'Anushri',
       opening    = 'Hi {first_name}, this is Tara from In-Sync. I wanted to quickly tell you about a platform we have built called Event — it takes the manual work out of running corporate events and conferences, with AI handling a lot of the engagement piece. Does your team run events or conferences?',
       updated_at = now()
 WHERE id = '5ced1200-333e-4da7-be7f-112ccbb293c0';

-- Relink to the freshly-built agent (Anushri voice, speed 0.95, temp 0.7).
-- Old agent ca01b4eb-56f5-4cae-957b-89f561201b82 has been deleted from Bolna.
UPDATE public.ai_call_scripts
   SET bolna_agent_id = '8ec429ad-a339-4bad-9461-06462540a4c5',
       updated_at = now()
 WHERE id = '5ced1200-333e-4da7-be7f-112ccbb293c0';
