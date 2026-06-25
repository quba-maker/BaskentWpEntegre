ALTER TABLE channel_prompts
  ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;
