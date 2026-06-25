ALTER TABLE ai_audit_logs
  ADD COLUMN IF NOT EXISTS tool_name TEXT,
  ADD COLUMN IF NOT EXISTS action TEXT;

ALTER TABLE ai_audit_logs
  ALTER COLUMN tool_name DROP NOT NULL;

UPDATE ai_audit_logs
SET action = COALESCE(action, tool_name)
WHERE action IS NULL AND tool_name IS NOT NULL;

UPDATE ai_audit_logs
SET tool_name = COALESCE(tool_name, action, 'audit_event')
WHERE tool_name IS NULL;
