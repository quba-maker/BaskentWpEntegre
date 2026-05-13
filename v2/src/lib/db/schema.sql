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
  
  -- Meta Entegrasyon
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

-- BAŞKENT'İ İLK TENANT OLARAK EKLE
INSERT INTO tenants (name, slug, industry, primary_color, ai_model, plan, status)
VALUES ('Başkent Hastanesi', 'baskent', 'health', '#005A9C', 'gemini-2.5-flash', 'pro', 'active')
ON CONFLICT (slug) DO NOTHING;

-- Mevcut verilere tenant_id ata (Başkent)
-- UPDATE conversations SET tenant_id = (SELECT id FROM tenants WHERE slug = 'baskent') WHERE tenant_id IS NULL;
-- UPDATE messages SET tenant_id = (SELECT id FROM tenants WHERE slug = 'baskent') WHERE tenant_id IS NULL;
-- UPDATE settings SET tenant_id = (SELECT id FROM tenants WHERE slug = 'baskent') WHERE tenant_id IS NULL;
