-- Inbound demo-request qualify calls must NOT be gated by the cold-calling
-- window — someone who just asked for a demo should be called right away.
-- Flag the stage-action so pipeline-action-dispatcher runs it regardless of window.
ALTER TABLE public.pipeline_stage_actions
  ADD COLUMN IF NOT EXISTS ignore_window boolean NOT NULL DEFAULT false;

UPDATE public.pipeline_stage_actions a
  SET ignore_window = true
  FROM public.pipeline_stages s
  WHERE a.stage_id = s.id
    AND s.org_id = '61f7f96d-e80c-4d9b-a765-8eb32bd3c70d'
    AND s.name = 'Demo Requested'
    AND a.action_type = 'call';
