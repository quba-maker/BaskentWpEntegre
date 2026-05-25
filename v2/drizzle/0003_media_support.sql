-- =============================================
-- MIGRATION: Media Message Support
-- Version: 2.1 — Medya Mesaj Desteği
-- =============================================

-- 1. Messages tablosuna medya kolonları ekle
ALTER TABLE messages ADD COLUMN IF NOT EXISTS media_type TEXT;
  -- Değerler: 'image' | 'document' | 'audio' | 'video' | 'location' | 'sticker' | NULL (text)

ALTER TABLE messages ADD COLUMN IF NOT EXISTS media_url TEXT;
  -- Vercel Blob kalıcı URL

ALTER TABLE messages ADD COLUMN IF NOT EXISTS media_metadata JSONB DEFAULT '{}'::jsonb;
  -- { filename, mime_type, caption, latitude, longitude, file_size, duration, ... }

-- 2. Media URL üzerinden hızlı sorgulama için index
CREATE INDEX IF NOT EXISTS idx_messages_media_type ON messages(tenant_id, media_type) WHERE media_type IS NOT NULL;

-- 3. Tenant bazlı storage tracking tablosu
CREATE TABLE IF NOT EXISTS tenant_storage_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  month TEXT NOT NULL, -- '2026-05'
  total_files INT DEFAULT 0,
  total_bytes BIGINT DEFAULT 0,
  image_count INT DEFAULT 0,
  document_count INT DEFAULT 0,
  audio_count INT DEFAULT 0,
  video_count INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, month)
);

CREATE INDEX IF NOT EXISTS idx_tenant_storage_usage ON tenant_storage_usage(tenant_id, month);
