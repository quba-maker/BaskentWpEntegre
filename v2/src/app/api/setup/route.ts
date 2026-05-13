import { NextRequest, NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";

export async function GET(req: NextRequest) {
  try {
    const sql = neon(process.env.DATABASE_URL!);
    const results: string[] = [];

    // 1. TENANTS tablosu
    await sql`
      CREATE TABLE IF NOT EXISTS tenants (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name TEXT NOT NULL,
        slug TEXT UNIQUE NOT NULL,
        industry TEXT NOT NULL DEFAULT 'general',
        logo_url TEXT,
        primary_color TEXT DEFAULT '#007AFF',
        meta_page_id TEXT,
        meta_page_token TEXT,
        instagram_id TEXT,
        whatsapp_phone_id TEXT,
        whatsapp_business_id TEXT,
        ai_model TEXT DEFAULT 'gemini-2.5-flash',
        max_bot_messages INT DEFAULT 8,
        timezone TEXT DEFAULT 'Europe/Istanbul',
        plan TEXT DEFAULT 'starter',
        monthly_message_limit INT DEFAULT 500,
        status TEXT DEFAULT 'active',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `;
    results.push("✅ tenants tablosu hazır");

    // 2. USERS tablosu
    await sql`
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
      )
    `;
    results.push("✅ users tablosu hazır");

    // 3. BOT_PROMPTS tablosu
    await sql`
      CREATE TABLE IF NOT EXISTS bot_prompts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        channel TEXT NOT NULL,
        prompt TEXT NOT NULL,
        is_active BOOLEAN DEFAULT true,
        version INT DEFAULT 1,
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(tenant_id, channel)
      )
    `;
    results.push("✅ bot_prompts tablosu hazır");

    // 4. USAGE_LOG tablosu
    await sql`
      CREATE TABLE IF NOT EXISTS usage_log (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES tenants(id),
        month TEXT NOT NULL,
        total_messages INT DEFAULT 0,
        total_ai_messages INT DEFAULT 0,
        total_tokens_input BIGINT DEFAULT 0,
        total_tokens_output BIGINT DEFAULT 0,
        estimated_cost_usd DECIMAL(10,4) DEFAULT 0,
        UNIQUE(tenant_id, month)
      )
    `;
    results.push("✅ usage_log tablosu hazır");

    // 5. Mevcut tablolara tenant_id ekle
    await sql`ALTER TABLE conversations ADD COLUMN IF NOT EXISTS tenant_id UUID`;
    await sql`ALTER TABLE messages ADD COLUMN IF NOT EXISTS tenant_id UUID`;
    await sql`ALTER TABLE settings ADD COLUMN IF NOT EXISTS tenant_id UUID`;
    results.push("✅ tenant_id kolonları eklendi");

    // 6. Mevcut migration'lar (eski setup)
    await sql`ALTER TABLE conversations ADD COLUMN IF NOT EXISTS country VARCHAR(100)`;
    await sql`ALTER TABLE conversations ADD COLUMN IF NOT EXISTS real_phone VARCHAR(20)`;
    results.push("✅ eski migration'lar uygulandı");

    // 7. Indexler
    await sql`CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_users_tenant ON users(tenant_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_conversations_tenant ON conversations(tenant_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_messages_tenant ON messages(tenant_id)`;
    results.push("✅ indexler oluşturuldu");

    // 8. Başkent'i ilk tenant olarak ekle
    await sql`
      INSERT INTO tenants (name, slug, industry, primary_color, ai_model, plan, status)
      VALUES ('Başkent Hastanesi', 'baskent', 'health', '#005A9C', 'gemini-2.5-flash', 'pro', 'active')
      ON CONFLICT (slug) DO NOTHING
    `;
    results.push("✅ Başkent tenant eklendi");

    return NextResponse.json({ success: true, results });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
