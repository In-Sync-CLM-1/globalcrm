-- Event v4: tighten the opener from ~30s to ~16s.
--
-- v3 test call (679b4837…) showed Tara deliver the full opener, then both
-- sides went silent — zero user turns captured, zero LLM tokens. The opener
-- was ~70 words / ~30 seconds; long enough that the prospect lost the thread,
-- and Bolna's transcriber never picked up a return turn. Moving the "three
-- lifts" detail (visibility / engagement / opportunity capture) out of the
-- welcome and into the LLM's first conversational turn after the binary
-- validation lands. Keeps the moat introduced, leaves room for response.

UPDATE public.ai_call_scripts
   SET opening = 'Hi {first_name}, this is Tara from In-Sync. We have built Event — a platform that runs corporate events and conferences end to end, with AI driving the engagement layer. Quick check — does your team run events, conferences, or webinars?',
       updated_at = now()
 WHERE id = '5ced1200-333e-4da7-be7f-112ccbb293c0';
