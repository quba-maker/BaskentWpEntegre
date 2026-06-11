ALTER TABLE channel_ai_profiles
  ADD COLUMN IF NOT EXISTS response_delay_seconds integer DEFAULT 5;

ALTER TABLE channel_ai_profiles
  ADD COLUMN IF NOT EXISTS response_style text DEFAULT 'balanced';

DO $$
BEGIN
  ALTER TABLE channel_ai_profiles
    ADD CONSTRAINT channel_ai_profiles_response_delay_seconds_check
    CHECK (response_delay_seconds IS NULL OR (response_delay_seconds >= 2 AND response_delay_seconds <= 30));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE channel_ai_profiles
    ADD CONSTRAINT channel_ai_profiles_response_style_check
    CHECK (response_style IS NULL OR response_style IN ('short', 'balanced', 'detailed'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
