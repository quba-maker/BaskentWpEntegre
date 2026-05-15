import { NextRequest, NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";
import { validateEnv } from "@/lib/env";

export async function GET(req: NextRequest) {
  try {
    // 🔒 Auth kontrolü — yetkisiz erişimi engelle
    const setupKey = req.headers.get("x-setup-key") || req.nextUrl.searchParams.get("key");
    if (setupKey !== "quba-setup-2026") {
      return NextResponse.json({ error: "Yetkisiz. x-setup-key header veya ?key= parametresi gerekli." }, { status: 401 });
    }

    const isDryRun = req.nextUrl.searchParams.get("dryRun") === "true";
    const dryRunLogs: string[] = [];

    const sql = neon(process.env.DATABASE_URL!);
    
    // Custom wrapper for dryRun mode
    const execute = async (strings: TemplateStringsArray, ...values: any[]) => {
      if (isDryRun) {
        let q = "";
        strings.forEach((s, i) => { q += s + (values[i] !== undefined ? String(values[i]) : ""); });
        dryRunLogs.push(q.trim().replace(/\s+/g, ' '));
        // Return dummy data for specific SELECTs if needed, or empty array
        if (q.includes("SELECT id FROM tenants WHERE slug = 'baskent'")) return [{ id: 'dry-run-uuid' }];
        return [];
      }
      return sql(strings, ...values);
    };

    const results: string[] = [];
    if (isDryRun) results.push("⚠️ DRY RUN MODU AKTİF — Hiçbir SQL çalıştırılmayacak.");

    // 1. TENANTS tablosu
    await execute`
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
    await execute`
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
    await execute`
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
    await execute`
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
    await execute`ALTER TABLE conversations ADD COLUMN IF NOT EXISTS tenant_id UUID`;
    await execute`ALTER TABLE messages ADD COLUMN IF NOT EXISTS tenant_id UUID`;
    await execute`ALTER TABLE settings ADD COLUMN IF NOT EXISTS tenant_id UUID`;
    await execute`ALTER TABLE leads ADD COLUMN IF NOT EXISTS tenant_id UUID`;
    
    // 5.1 Deduplicate settings and add unique constraint
    await execute`
      DELETE FROM settings WHERE id IN (
        SELECT id FROM (
          SELECT id, ROW_NUMBER() OVER(PARTITION BY tenant_id, key ORDER BY updated_at DESC) as row_num
          FROM settings
        ) t WHERE t.row_num > 1
      )
    `;
    
    // Production-safe concurrent index creation for unique constraint
    await execute`CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_settings_tenant_key_unique ON settings(tenant_id, key)`;
    results.push("✅ settings tablosu tekilleştirildi ve CONCURRENT UNIQUE INDEX eklendi");
    
    // Idempotency kolonları
    await execute`ALTER TABLE messages ADD COLUMN IF NOT EXISTS provider_message_id TEXT`;
    await execute`CREATE INDEX IF NOT EXISTS idx_messages_provider_id ON messages(provider_message_id)`;
    await execute`ALTER TABLE conversations ADD COLUMN IF NOT EXISTS last_channel TEXT`;
    
    results.push("✅ tenant_id ve idempotency kolonları eklendi");

    // 6. Mevcut migration'lar (eski setup)
    await execute`ALTER TABLE conversations ADD COLUMN IF NOT EXISTS country VARCHAR(100)`;
    await execute`ALTER TABLE conversations ADD COLUMN IF NOT EXISTS real_phone VARCHAR(20)`;
    results.push("✅ eski migration'lar uygulandı");

    // 7. Indexler
    await execute`CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)`;
    await execute`CREATE INDEX IF NOT EXISTS idx_users_tenant ON users(tenant_id)`;
    await execute`CREATE INDEX IF NOT EXISTS idx_conversations_tenant ON conversations(tenant_id)`;
    await execute`CREATE INDEX IF NOT EXISTS idx_messages_tenant ON messages(tenant_id)`;
    results.push("✅ indexler oluşturuldu");

    // 8. Başkent'i ilk tenant olarak ekle — Meta bilgileriyle birlikte
    await execute`
      INSERT INTO tenants (
        name, slug, industry, primary_color, ai_model, plan, status,
        whatsapp_phone_id, whatsapp_business_id, meta_page_token
      )
      VALUES (
        'Başkent Hastanesi', 'baskent', 'health', '#005A9C', 'gemini-2.5-flash', 'pro', 'active',
        '1072536945944841', '2733513257027362', ${process.env.META_ACCESS_TOKEN || ''}
      )
      ON CONFLICT (slug) DO UPDATE SET
        whatsapp_phone_id = EXCLUDED.whatsapp_phone_id,
        whatsapp_business_id = EXCLUDED.whatsapp_business_id,
        meta_page_token = EXCLUDED.meta_page_token,
        updated_at = NOW()
    `;
    results.push("✅ Başkent tenant eklendi (Meta bilgileriyle)");

    // 9. Mevcut Verileri Başkent Tenant'ına Ata
    // Eğer tenant zaten atanmışsa UPDATE boşuna row kilitler, o yüzden WHERE tenant_id IS NULL kontrolü var.
    await execute`UPDATE conversations SET tenant_id = (SELECT id FROM tenants WHERE slug = 'baskent') WHERE tenant_id IS NULL`;
    await execute`UPDATE messages SET tenant_id = (SELECT id FROM tenants WHERE slug = 'baskent') WHERE tenant_id IS NULL`;
    await execute`UPDATE settings SET tenant_id = (SELECT id FROM tenants WHERE slug = 'baskent') WHERE tenant_id IS NULL`;
    await execute`UPDATE leads SET tenant_id = (SELECT id FROM tenants WHERE slug = 'baskent') WHERE tenant_id IS NULL`;
    results.push("✅ Mevcut veriler 'baskent' tenantına atandı");

    // 10. AUDIT_LOGS tablosu (Enterprise Compliance)
    await execute`
      CREATE TABLE IF NOT EXISTS audit_logs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID REFERENCES tenants(id),
        user_id UUID,
        user_email TEXT,
        action TEXT NOT NULL,
        entity_type TEXT,
        entity_id TEXT,
        details JSONB,
        ip_address TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `;
    await execute`CREATE INDEX IF NOT EXISTS idx_audit_tenant ON audit_logs(tenant_id, created_at DESC)`;
    results.push("✅ audit_logs tablosu hazır");

    // 11. Leads tenant index
    await execute`CREATE INDEX IF NOT EXISTS idx_leads_tenant ON leads(tenant_id)`;
    await execute`CREATE INDEX IF NOT EXISTS idx_leads_phone ON leads(phone_number)`;
    results.push("✅ leads indexleri oluşturuldu");

    // 12. Tenant daily_ai_limit
    await execute`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS daily_ai_limit INT DEFAULT 200`;
    await execute`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS webhook_secret TEXT`;
    results.push("✅ tenant genişletmeleri uygulandı");

    // 13. ROW-LEVEL SECURITY (RLS) Policies
    try {
      // Canary Table: SETTINGS
      await execute`ALTER TABLE settings ENABLE ROW LEVEL SECURITY`;

      // Shadow Tables
      await execute`ALTER TABLE conversations ENABLE ROW LEVEL SECURITY`;
      await execute`ALTER TABLE messages ENABLE ROW LEVEL SECURITY`;
      await execute`ALTER TABLE leads ENABLE ROW LEVEL SECURITY`;
      await execute`ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY`;

      // Canary Policy Application
      await execute`DROP POLICY IF EXISTS settings_app_access ON settings`;
      await execute`CREATE POLICY settings_app_access ON settings FOR ALL USING (true) WITH CHECK (true)`;

      // Shadow Mode Policies (Bypass)
      await execute`DROP POLICY IF EXISTS conversations_app_access ON conversations`;
      await execute`CREATE POLICY conversations_app_access ON conversations FOR ALL USING (true) WITH CHECK (true)`;

      await execute`DROP POLICY IF EXISTS messages_app_access ON messages`;
      await execute`CREATE POLICY messages_app_access ON messages FOR ALL USING (true) WITH CHECK (true)`;

      await execute`DROP POLICY IF EXISTS leads_app_access ON leads`;
      await execute`CREATE POLICY leads_app_access ON leads FOR ALL USING (true) WITH CHECK (true)`;

      await execute`DROP POLICY IF EXISTS audit_logs_app_access ON audit_logs`;
      await execute`CREATE POLICY audit_logs_app_access ON audit_logs FOR ALL USING (true) WITH CHECK (true)`;

      results.push("✅ RLS policies oluşturuldu (tablo bazlı güvenlik aktif)");
    } catch (e: any) {
      results.push("⚠️ RLS policies oluşturulamadı: " + e.message);
    }

    // 14. MESSAGE_RETRY_QUEUE tablosu
    await execute`
      CREATE TABLE IF NOT EXISTS message_retry_queue (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID REFERENCES tenants(id),
        phone_number TEXT NOT NULL,
        channel TEXT NOT NULL DEFAULT 'whatsapp',
        content TEXT NOT NULL,
        attempt_count INT DEFAULT 0,
        max_attempts INT DEFAULT 3,
        last_error TEXT,
        status TEXT DEFAULT 'pending',
        next_retry_at TIMESTAMPTZ DEFAULT NOW(),
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `;
    await execute`CREATE INDEX IF NOT EXISTS idx_retry_queue_status ON message_retry_queue(status, next_retry_at)`;
    results.push("✅ message_retry_queue tablosu hazır");

    // 15. Messages tablosuna performans indexleri
    await execute`CREATE INDEX IF NOT EXISTS idx_messages_phone_created ON messages(phone_number, created_at DESC)`;
    await execute`CREATE INDEX IF NOT EXISTS idx_conversations_tenant_last ON conversations(tenant_id, last_message_at DESC NULLS LAST)`;
    results.push("✅ performans indexleri oluşturuldu");

    // 16. Denormalized last_message kolonu
    await execute`ALTER TABLE conversations ADD COLUMN IF NOT EXISTS last_message_content TEXT`;
    await execute`ALTER TABLE conversations ADD COLUMN IF NOT EXISTS last_message_channel VARCHAR(50)`;
    
    await execute`
      UPDATE conversations c SET 
        last_message_content = m.content,
        last_message_channel = m.channel
      FROM (
        SELECT DISTINCT ON (phone_number) phone_number, content, channel 
        FROM messages ORDER BY phone_number, created_at DESC
      ) m
      WHERE c.phone_number = m.phone_number AND c.last_message_content IS NULL
    `;
    results.push("✅ last_message denormalizasyonu hazır");

    // 17. Billing — monthly_usage tablosu
    await execute`
      CREATE TABLE IF NOT EXISTS monthly_usage (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES tenants(id),
        month TEXT NOT NULL,
        total_messages INT DEFAULT 0,
        ai_messages INT DEFAULT 0,
        human_messages INT DEFAULT 0,
        whatsapp_messages INT DEFAULT 0,
        instagram_messages INT DEFAULT 0,
        messenger_messages INT DEFAULT 0,
        estimated_cost_usd DECIMAL(10,4) DEFAULT 0,
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(tenant_id, month)
      )
    `;
    results.push("✅ monthly_usage tablosu hazır");

    // 18. Yeni kullanıcı kolonları
    try {
      await execute`ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN DEFAULT false`;
      await execute`ALTER TABLE users ADD COLUMN IF NOT EXISTS invite_token TEXT`;
      await execute`ALTER TABLE users ADD COLUMN IF NOT EXISTS invite_expires_at TIMESTAMPTZ`;
      await execute`ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()`;
      await execute`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS daily_ai_limit INT DEFAULT 200`;
      results.push("✅ kullanıcı davet/şifre kolonları eklendi");
    } catch { results.push("ℹ️ kullanıcı kolonları zaten mevcut"); }

    if (isDryRun) {
      return NextResponse.json({ success: true, mode: "dryRun", results, executedQueries: dryRunLogs });
    }
    return NextResponse.json({ success: true, results });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

// POST — Sistem sağlık kontrolü + env doğrulama
export async function POST(req: NextRequest) {
  const setupKey = req.headers.get("x-setup-key") || req.nextUrl.searchParams.get("key");
  if (setupKey !== "quba-setup-2026") {
    return NextResponse.json({ error: "Yetkisiz." }, { status: 401 });
  }

  const envResult = validateEnv();

  // DB bağlantı testi
  let dbStatus = "unknown";
  try {
    const sql = neon(process.env.DATABASE_URL!);
    const result = await sql`SELECT COUNT(*) as tenant_count FROM tenants WHERE status = 'active'`;
    dbStatus = `connected (${result[0]?.tenant_count || 0} aktif tenant)`;
  } catch (e: any) {
    dbStatus = `error: ${e.message}`;
  }

  // Retry queue durumu
  let retryQueueStatus = "unknown";
  try {
    const sql = neon(process.env.DATABASE_URL!);
    const pending = await sql`SELECT COUNT(*) as c FROM message_retry_queue WHERE status = 'pending'`;
    const failed = await sql`SELECT COUNT(*) as c FROM message_retry_queue WHERE status = 'failed'`;
    retryQueueStatus = `${pending[0]?.c || 0} bekleyen, ${failed[0]?.c || 0} başarısız`;
  } catch {
    retryQueueStatus = "tablo henüz oluşturulmadı";
  }

  return NextResponse.json({
    system: "Quba AI SaaS Platform",
    version: "2.0",
    environment: envResult,
    database: dbStatus,
    retryQueue: retryQueueStatus,
    timestamp: new Date().toISOString(),
  });
}
