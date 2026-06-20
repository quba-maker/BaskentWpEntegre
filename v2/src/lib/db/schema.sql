-- =============================================
-- QUBA AI — Multi-Tenant Database Schema
-- Version: 1.0
-- =============================================

-- 1. TENANTS (FİRMALAR)
CREATE TABLE IF NOT EXISTS tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  industry TEXT NOT NULL DEFAULT 'general',
  logo_url TEXT,
  primary_color TEXT DEFAULT '#007AFF',
  sidebar_theme TEXT DEFAULT 'light',
  dashboard_density TEXT DEFAULT 'comfortable',
  ui_mode TEXT DEFAULT 'system',
  workspace_version INT DEFAULT 1,
  
  -- Meta Entegrasyon (Tenant-Isolated)
  meta_app_id TEXT,
  meta_app_secret TEXT,
  meta_page_id TEXT,
  meta_page_token TEXT,
  instagram_id TEXT,
  whatsapp_phone_id TEXT,
  whatsapp_business_id TEXT,
  
  -- Bot Ayarları
  ai_model TEXT DEFAULT 'gemini-2.5-flash',
  max_bot_messages INT DEFAULT 8,
  aggression_level TEXT DEFAULT 'medium',
  timezone TEXT DEFAULT 'Europe/Istanbul',
  
  -- Plan
  plan TEXT DEFAULT 'starter',
  monthly_message_limit INT DEFAULT 500,
  
  status TEXT DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. USERS (KULLANICILAR)
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT DEFAULT 'agent',
  avatar_url TEXT,
  is_active BOOLEAN DEFAULT true,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. CONVERSATIONS (tenant izoleli)
-- Mevcut conversations tablosuna tenant_id ekle
ALTER TABLE conversations 
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;

-- 4. MESSAGES (tenant izoleli)
ALTER TABLE messages 
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;

-- 4.1 LEADS (tenant izoleli - FORMLAR)
ALTER TABLE leads 
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;

-- 5. SETTINGS (tenant izoleli)
-- Mevcut settings tablosuna tenant_id ekle
ALTER TABLE settings 
  ADD COLUMN IF NOT EXISTS tenant_id UUID;

-- 6. BOT_PROMPTS
CREATE TABLE IF NOT EXISTS bot_prompts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  channel TEXT NOT NULL,
  prompt TEXT NOT NULL,
  is_active BOOLEAN DEFAULT true,
  version INT DEFAULT 1,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, channel)
);

-- 7. USAGE_LOG (faturalandırma)
CREATE TABLE IF NOT EXISTS usage_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  month TEXT NOT NULL,
  total_messages INT DEFAULT 0,
  total_ai_messages INT DEFAULT 0,
  total_tokens_input BIGINT DEFAULT 0,
  total_tokens_output BIGINT DEFAULT 0,
  estimated_cost_usd DECIMAL(10,4) DEFAULT 0,
  whatsapp_messages INT DEFAULT 0,
  instagram_messages INT DEFAULT 0,
  UNIQUE(tenant_id, month)
);

-- INDEX'LER
CREATE INDEX IF NOT EXISTS idx_conversations_tenant ON conversations(tenant_id);
CREATE INDEX IF NOT EXISTS idx_messages_tenant ON messages(tenant_id);
CREATE INDEX IF NOT EXISTS idx_messages_phone ON messages(tenant_id, phone_number);
CREATE INDEX IF NOT EXISTS idx_conversations_status ON conversations(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_users_tenant ON users(tenant_id);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_settings_tenant_key ON settings(tenant_id, key);

-- BAŞKENT'İ İLK TENANT OLARAK EKLE — Meta bilgileriyle
INSERT INTO tenants (
  name, slug, industry, primary_color, ai_model, plan, status,
  whatsapp_phone_id, whatsapp_business_id
)
VALUES (
  'Başkent Hastanesi', 'baskent', 'health', '#005A9C', 'gemini-2.5-flash', 'pro', 'active',
  '1072536945944841', '2733513257027362'
)
ON CONFLICT (slug) DO UPDATE SET
  whatsapp_phone_id = EXCLUDED.whatsapp_phone_id,
  whatsapp_business_id = EXCLUDED.whatsapp_business_id,
  updated_at = NOW();

-- Mevcut verilere tenant_id ata (Başkent)
UPDATE conversations SET tenant_id = (SELECT id FROM tenants WHERE slug = 'baskent') WHERE tenant_id IS NULL;
UPDATE messages SET tenant_id = (SELECT id FROM tenants WHERE slug = 'baskent') WHERE tenant_id IS NULL;
UPDATE settings SET tenant_id = (SELECT id FROM tenants WHERE slug = 'baskent') WHERE tenant_id IS NULL;
UPDATE leads SET tenant_id = (SELECT id FROM tenants WHERE slug = 'baskent') WHERE tenant_id IS NULL;

-- =============================================
-- PHASE 1: ENTERPRISE AI CRM OS EXTENSIONS
-- =============================================

-- 8. CUSTOMER PROFILES (Unified Identity)
CREATE TABLE IF NOT EXISTS customer_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  primary_phone TEXT NOT NULL,
  primary_email TEXT,
  first_name TEXT,
  last_name TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, primary_phone)
);

-- Conversations ile Customer bağlantısı
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES customer_profiles(id) ON DELETE SET NULL;

-- Leads ile Customer bağlantısı
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES customer_profiles(id) ON DELETE SET NULL;

-- 9. CONVERSATION MEMORY (Rolling Summaries)
CREATE TABLE IF NOT EXISTS conversation_memory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  summary_text TEXT NOT NULL,
  buying_intent TEXT, -- e.g., HOT, WARM, COLD
  sentiment TEXT,
  objections TEXT[],
  last_message_count INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(conversation_id)
);

-- 10. AI MODULE SETTINGS (Feature Flags & Orchestration)
CREATE TABLE IF NOT EXISTS ai_module_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  module_name TEXT NOT NULL,
  is_active BOOLEAN DEFAULT true,
  config JSONB DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, module_name)
);

-- Yeni Indexler
CREATE INDEX IF NOT EXISTS idx_customer_profiles_tenant ON customer_profiles(tenant_id);
CREATE INDEX IF NOT EXISTS idx_customer_profiles_phone ON customer_profiles(tenant_id, primary_phone);
CREATE INDEX IF NOT EXISTS idx_conversation_memory_conv ON conversation_memory(conversation_id);

-- 11. AI AUDIT LOGS (Phase 5C - Observability Layer)
CREATE TABLE IF NOT EXISTS ai_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id UUID REFERENCES customer_profiles(id) ON DELETE SET NULL,
  conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  tool_name TEXT NOT NULL,
  tool_arguments JSONB,
  validation_passed BOOLEAN DEFAULT true,
  execution_mode TEXT DEFAULT 'production', -- 'sandbox' or 'production'
  execution_duration_ms INT,
  input_tokens INT,
  output_tokens INT,
  cost_usd NUMERIC(10,6),
  ai_confidence NUMERIC(3,2),
  reasoning_summary TEXT,
  result_summary JSONB,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 12. AI RUNTIME METRICS (Cost & Analytics)
CREATE TABLE IF NOT EXISTS ai_runtime_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  total_tokens INT,
  prompt_tokens INT,
  completion_tokens INT,
  estimated_cost_usd NUMERIC(10,6),
  model_name TEXT,
  response_time_ms INT,
  tool_calls_count INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_audit_logs_tenant ON ai_audit_logs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_ai_runtime_metrics_tenant ON ai_runtime_metrics(tenant_id);

-- =============================================
-- SPRINT 4.0: ENTERPRISE DATA INGESTION ENGINE
-- =============================================

-- 13. TENANT SEMANTIC RULES (Learning Loop & Schema Registry)
CREATE TABLE IF NOT EXISTS tenant_semantic_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  source_field TEXT NOT NULL,
  resolved_entity TEXT NOT NULL,
  confidence_threshold NUMERIC(3,2) DEFAULT 0.85,
  is_operator_enforced BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, source_field)
);

-- 14. AI CONTEXT MEMORY (Pipeline Memory)
CREATE TABLE IF NOT EXISTS ai_context_memory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL, -- e.g., 'phone_mapping', 'duplicate_decision'
  context_key TEXT NOT NULL,
  context_value JSONB NOT NULL,
  last_used_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 15. PIPELINE EVENTS (Event-Sourced Architecture)
CREATE TABLE IF NOT EXISTS pipeline_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL, -- 'LeadImported', 'DuplicateMerged', 'TransformationApplied'
  source_id TEXT,
  entity_id UUID, 
  payload JSONB NOT NULL,
  ai_confidence NUMERIC(3,2),
  operator_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tenant_semantic_rules ON tenant_semantic_rules(tenant_id);
CREATE INDEX IF NOT EXISTS idx_ai_context_memory ON ai_context_memory(tenant_id, entity_type);
CREATE INDEX IF NOT EXISTS idx_pipeline_events ON pipeline_events(tenant_id, event_type);

-- 16. AUDIT LOGS (Security & Compliance)
CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  user_email TEXT,
  impersonator_id UUID REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  details JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 17. TENANT INTEGRATIONS (Encrypted)
CREATE TABLE IF NOT EXISTS tenant_integrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  provider TEXT NOT NULL, -- e.g., 'google_sheets'
  credentials JSONB NOT NULL, -- { version: "1.0", provider: "...", encrypted_payload: "..." }
  health_status TEXT DEFAULT 'healthy',
  last_sync_at TIMESTAMPTZ,
  error_log JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, provider)
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant ON audit_logs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tenant_integrations_tenant ON tenant_integrations(tenant_id);

