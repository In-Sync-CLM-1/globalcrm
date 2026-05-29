-- Event v7: synth model turbo_v2_5 → multilingual_v2 + style 0.4.
--
-- v6 test call: Anushri voice + speed 0.95 + temp 0.7 felt warmer, BUT
-- questions ended as statements — eleven_turbo_v2_5 is latency-optimized and
-- has weak rising intonation. multilingual_v2 is ~400ms slower but produces
-- clear interrogative rises, and style 0.4 adds the dynamic variation that
-- separates a question from a flat assertion.
--
-- Bolna agent recreated (tools_config / synth changes are not patchable).
-- Old agent 8ec429ad… deleted; new agent c41616c4-f256-4207-838c-9b078ede9123
-- linked to the script.

UPDATE public.ai_call_scripts
   SET bolna_agent_id = 'c41616c4-f256-4207-838c-9b078ede9123',
       updated_at = now()
 WHERE id = '5ced1200-333e-4da7-be7f-112ccbb293c0';
