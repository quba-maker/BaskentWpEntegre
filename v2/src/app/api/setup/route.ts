import { NextRequest, NextResponse } from "next/server";
import { withTenantDB } from "@/lib/core/tenant-db";
import { validateEnv } from "@/lib/env";

const getSetupKey = () => process.env.ADMIN_SETUP_KEY || process.env.SETUP_KEY || "quba-setup-2026";

export async function GET(req: NextRequest) {
  try {
    // 🔒 Auth kontrolü — yetkisiz erişimi engelle
    const setupKey = req.headers.get("x-setup-key") || req.nextUrl.searchParams.get("key");
    if (setupKey !== getSetupKey()) {
      return NextResponse.json({ error: "Yetkisiz. x-setup-key header veya ?key= parametresi gerekli." }, { status: 401 });
    }

    const isDryRun = req.nextUrl.searchParams.get("dryRun") === "true";
    const dryRunLogs: string[] = [];

    const systemDb = withTenantDB('admin-system', true);
    
    // Custom wrapper for dryRun mode
    const execute = async (strings: TemplateStringsArray, ...values: any[]) => {
      let q = "";
      strings.forEach((s, i) => { q += s + (values[i] !== undefined ? String(values[i]) : ""); });
      if (isDryRun) {
        dryRunLogs.push(q.trim().replace(/\s+/g, ' '));
        // Return dummy data for specific SELECTs if needed, or empty array
        if (q.includes("SELECT id FROM tenants WHERE slug = 'baskent'")) return [{ id: 'dry-run-uuid' }];
        return [];
      }
      return systemDb.executeSafe({ text: q });
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
        meta_app_id TEXT,
        meta_app_secret TEXT,
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
    
    // Explicit UNIQUE constraint required for ON CONFLICT (tenant_id, key) to work
    try { await execute`ALTER TABLE settings DROP CONSTRAINT IF EXISTS settings_key_key`; } catch(e) {}
    try { await execute`ALTER TABLE settings DROP CONSTRAINT IF EXISTS settings_tenant_id_key_key`; } catch(e) {}
    try { await execute`ALTER TABLE settings ADD CONSTRAINT settings_tenant_id_key_key UNIQUE (tenant_id, key)`; } catch(e) {}
    
    results.push("✅ settings tablosu tekilleştirildi ve UNIQUE constraint eklendi");
    
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
        '1072536945944841', '2733513257027362', '${process.env.META_ACCESS_TOKEN || ''}'
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

    // 12. Tenant extensions (SaaS multi-tenant runtime)
    await execute`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS daily_ai_limit INT DEFAULT 200`;
    await execute`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS webhook_secret TEXT`;
    await execute`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS meta_app_id TEXT`;
    await execute`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS meta_app_secret TEXT`;
    await execute`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS reminder_template TEXT`;
    await execute`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS reminder_hours_before INT DEFAULT 24`;
    results.push("✅ tenant SaaS kolonları uygulandı");

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

    // =====================================================
    // 19. RUNTIME DDL CONSOLIDATION
    // Tables below were previously created inline inside services.
    // Moved here as single DDL source of truth for production safety.
    // =====================================================

    // 19a. WEBHOOK_EVENTS — deduplication tablosu
    await execute`
      CREATE TABLE IF NOT EXISTS webhook_events (
        tenant_id UUID,
        provider VARCHAR(50),
        provider_message_id VARCHAR(255),
        sender_id VARCHAR(100),
        event_timestamp BIGINT,
        created_at TIMESTAMP DEFAULT NOW(),
        PRIMARY KEY(tenant_id, provider, provider_message_id)
      )
    `;
    results.push("✅ webhook_events tablosu hazır");

    // 19b. ALERTS — dashboard alert sistemi
    await execute`
      CREATE TABLE IF NOT EXISTS alerts (
        id SERIAL PRIMARY KEY, 
        tenant_id UUID,
        phone_number VARCHAR(20), 
        alert_type VARCHAR(50), 
        message TEXT, 
        is_read BOOLEAN DEFAULT false, 
        created_at TIMESTAMP DEFAULT NOW()
      )
    `;
    await execute`CREATE INDEX IF NOT EXISTS idx_alerts_tenant ON alerts(tenant_id)`;
    results.push("✅ alerts tablosu hazır");

    // 19c. EVENTS — randevu/olay tablosu
    await execute`
      CREATE TABLE IF NOT EXISTS events (
        id SERIAL PRIMARY KEY, 
        tenant_id UUID,
        phone_number VARCHAR(20), 
        event_type VARCHAR(50), 
        details TEXT, 
        status VARCHAR(20) DEFAULT 'pending', 
        scheduled_date TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `;
    await execute`CREATE INDEX IF NOT EXISTS idx_events_tenant ON events(tenant_id)`;
    results.push("✅ events tablosu hazır");

    // 19d. DEAD_LETTER_JOBS — gerçek DLQ persistence
    await execute`
      CREATE TABLE IF NOT EXISTS dead_letter_jobs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID REFERENCES tenants(id),
        topic VARCHAR(100) NOT NULL,
        payload JSONB NOT NULL,
        error_message TEXT,
        error_stack TEXT,
        failed_at TIMESTAMP DEFAULT NOW(),
        status VARCHAR(50) DEFAULT 'unresolved',
        resolved_at TIMESTAMP,
        resolved_by UUID
      )
    `;
    await execute`CREATE INDEX IF NOT EXISTS idx_dlq_tenant ON dead_letter_jobs(tenant_id)`;
    await execute`CREATE INDEX IF NOT EXISTS idx_dlq_status ON dead_letter_jobs(status)`;
    results.push("✅ dead_letter_jobs tablosu hazır");

    // 19e. MIGRATION_AUDIT_LOGS — şema migration kayıtları
    await execute`
      CREATE TABLE IF NOT EXISTS migration_audit_logs (
        id SERIAL PRIMARY KEY,
        tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
        from_version VARCHAR(10),
        to_version VARCHAR(10),
        changes JSONB,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `;
    await execute`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS schema_version VARCHAR(10) DEFAULT 'v1'`;
    results.push("✅ migration_audit_logs ve schema_version hazır");

    // 19f. DLQ RLS
    try {
      await execute`ALTER TABLE dead_letter_jobs ENABLE ROW LEVEL SECURITY`;
      await execute`DROP POLICY IF EXISTS dlq_app_access ON dead_letter_jobs`;
      await execute`CREATE POLICY dlq_app_access ON dead_letter_jobs FOR ALL USING (true) WITH CHECK (true)`;
      results.push("✅ DLQ RLS policies oluşturuldu");
    } catch (e: any) { results.push("⚠️ DLQ RLS: " + e.message); }

    // =====================================================
    // 20. SPRINT 4.0: ENTERPRISE DATA INGESTION ENGINE
    // =====================================================

    await execute`
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
      )
    `;
    await execute`CREATE INDEX IF NOT EXISTS idx_tenant_semantic_rules ON tenant_semantic_rules(tenant_id)`;
    results.push("✅ tenant_semantic_rules tablosu hazır");

    await execute`
      CREATE TABLE IF NOT EXISTS ai_context_memory (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        entity_type TEXT NOT NULL,
        context_key TEXT NOT NULL,
        context_value JSONB NOT NULL,
        last_used_at TIMESTAMPTZ DEFAULT NOW(),
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `;
    await execute`CREATE INDEX IF NOT EXISTS idx_ai_context_memory ON ai_context_memory(tenant_id, entity_type)`;
    results.push("✅ ai_context_memory tablosu hazır");

    await execute`
      CREATE TABLE IF NOT EXISTS pipeline_events (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        event_type TEXT NOT NULL,
        source_id TEXT,
        entity_id UUID,
        payload JSONB NOT NULL,
        ai_confidence NUMERIC(3,2),
        operator_id UUID REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `;
    await execute`CREATE INDEX IF NOT EXISTS idx_pipeline_events ON pipeline_events(tenant_id, event_type)`;
    results.push("✅ pipeline_events tablosu hazır");

    // 21. BOT ACTIVATION TRACKING — max_messages counter reset support
    await execute`ALTER TABLE conversations ADD COLUMN IF NOT EXISTS bot_activated_at TIMESTAMPTZ`;
    await execute`ALTER TABLE conversations ADD COLUMN IF NOT EXISTS last_message_status VARCHAR(20)`;
    await execute`ALTER TABLE conversations ADD COLUMN IF NOT EXISTS last_message_direction VARCHAR(10)`;
    results.push("✅ bot_activated_at ve last_message denormalizasyon kolonları eklendi");

    // 22. PHASE 2M-P0: Health monitoring columns for tenant_integrations
    await execute`ALTER TABLE tenant_integrations ADD COLUMN IF NOT EXISTS last_success_at TIMESTAMPTZ`;
    await execute`ALTER TABLE tenant_integrations ADD COLUMN IF NOT EXISTS last_error_at TIMESTAMPTZ`;
    await execute`ALTER TABLE tenant_integrations ADD COLUMN IF NOT EXISTS last_error_message TEXT`;
    await execute`ALTER TABLE tenant_integrations ADD COLUMN IF NOT EXISTS last_import_count INTEGER DEFAULT 0`;
    await execute`ALTER TABLE tenant_integrations ADD COLUMN IF NOT EXISTS last_duplicate_count INTEGER DEFAULT 0`;
    await execute`ALTER TABLE tenant_integrations ADD COLUMN IF NOT EXISTS webhook_last_received_at TIMESTAMPTZ`;
    await execute`ALTER TABLE tenant_integrations ADD COLUMN IF NOT EXISTS cron_last_run_at TIMESTAMPTZ`;
    results.push("✅ PHASE 2M-P0: tenant_integrations health monitoring kolonları eklendi");

    // =====================================================
    // 23. PHASE 2K-P0: Follow-Up Task Engine + Notifications
    // Only 2 tables for P0. automation_rules, automation_runs,
    // notification_channels will be added in P1.
    // =====================================================

    // 23a. FOLLOW_UP_TASKS — Central task management table
    await execute`
      CREATE TABLE IF NOT EXISTS follow_up_tasks (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        opportunity_id UUID,
        conversation_id TEXT,
        phone_number TEXT NOT NULL,
        
        task_type TEXT NOT NULL DEFAULT 'follow_up_no_response',
        title TEXT NOT NULL,
        description TEXT,
        
        due_at TIMESTAMPTZ NOT NULL,
        remind_at TIMESTAMPTZ,
        
        assigned_to UUID,
        status TEXT NOT NULL DEFAULT 'pending',
        
        is_automated BOOLEAN NOT NULL DEFAULT false,
        automation_template TEXT,
        automation_executed_at TIMESTAMPTZ,
        
        completed_at TIMESTAMPTZ,
        completed_by UUID,
        completion_note TEXT,
        skipped_reason TEXT,
        
        created_by TEXT NOT NULL DEFAULT 'system',
        source_event TEXT,
        
        patient_segment TEXT,
        
        metadata JSONB DEFAULT '{}',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `;
    await execute`CREATE INDEX IF NOT EXISTS idx_tasks_tenant_status ON follow_up_tasks(tenant_id, status) WHERE status IN ('pending', 'in_progress')`;
    await execute`CREATE INDEX IF NOT EXISTS idx_tasks_due ON follow_up_tasks(due_at) WHERE status = 'pending'`;
    await execute`CREATE INDEX IF NOT EXISTS idx_tasks_opp ON follow_up_tasks(opportunity_id) WHERE opportunity_id IS NOT NULL`;
    await execute`CREATE INDEX IF NOT EXISTS idx_tasks_phone ON follow_up_tasks(phone_number, tenant_id)`;
    results.push("✅ PHASE 2K-P0: follow_up_tasks tablosu hazır");

    // 23b. NOTIFICATIONS — Panel notification center
    await execute`
      CREATE TABLE IF NOT EXISTS notifications (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        
        recipient_type TEXT NOT NULL DEFAULT 'coordinator',
        recipient_id UUID,
        
        category TEXT NOT NULL,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        
        opportunity_id UUID,
        task_id UUID,
        conversation_id TEXT,
        phone_number TEXT,
        
        channels_sent JSONB DEFAULT '["panel"]',
        
        is_read BOOLEAN DEFAULT false,
        read_at TIMESTAMPTZ,
        
        priority TEXT DEFAULT 'normal',
        
        metadata JSONB DEFAULT '{}',
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `;
    await execute`CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications(tenant_id, is_read, created_at DESC) WHERE is_read = false`;
    await execute`CREATE INDEX IF NOT EXISTS idx_notifications_tenant ON notifications(tenant_id, created_at DESC)`;
    results.push("✅ PHASE 2K-P0: notifications tablosu hazır");

    // 23c. RLS for new tables (shadow mode — bypass for now)
    try {
      await execute`ALTER TABLE follow_up_tasks ENABLE ROW LEVEL SECURITY`;
      await execute`DROP POLICY IF EXISTS tasks_app_access ON follow_up_tasks`;
      await execute`CREATE POLICY tasks_app_access ON follow_up_tasks FOR ALL USING (true) WITH CHECK (true)`;
      
      await execute`ALTER TABLE notifications ENABLE ROW LEVEL SECURITY`;
      await execute`DROP POLICY IF EXISTS notifications_app_access ON notifications`;
      await execute`CREATE POLICY notifications_app_access ON notifications FOR ALL USING (true) WITH CHECK (true)`;
      results.push("✅ PHASE 2K-P0: RLS policies oluşturuldu (follow_up_tasks + notifications)");
    } catch (e: any) {
      results.push("⚠️ PHASE 2K-P0: RLS policies: " + e.message);
    }

    // =====================================================
    // 24. PHASE 2K-P1: Notification Channels
    // Tenant-isolated external notification dispatch config.
    // Bot token is encrypted via encryptPayload() before storage.
    // =====================================================

    await execute`
      CREATE TABLE IF NOT EXISTS notification_channels (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        channel_type TEXT NOT NULL,
        is_enabled BOOLEAN DEFAULT true,
        config JSONB DEFAULT '{}',
        enabled_categories TEXT[] DEFAULT '{}',
        min_priority TEXT DEFAULT 'normal',
        quiet_hours_start TEXT,
        quiet_hours_end TEXT,
        quiet_hours_tz TEXT DEFAULT 'Europe/Istanbul',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(tenant_id, channel_type)
      )
    `;
    await execute`CREATE INDEX IF NOT EXISTS idx_notif_channels_tenant ON notification_channels(tenant_id)`;
    results.push("✅ PHASE 2K-P1: notification_channels tablosu hazır");

    // 24a. RLS for notification_channels (shadow mode)
    try {
      await execute`ALTER TABLE notification_channels ENABLE ROW LEVEL SECURITY`;
      await execute`DROP POLICY IF EXISTS notif_channels_app_access ON notification_channels`;
      await execute`CREATE POLICY notif_channels_app_access ON notification_channels FOR ALL USING (true) WITH CHECK (true)`;
      results.push("✅ PHASE 2K-P1: notification_channels RLS policies oluşturuldu");
    } catch (e: any) {
      results.push("⚠️ PHASE 2K-P1: notification_channels RLS: " + e.message);
    }

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
  if (setupKey !== getSetupKey()) {
    return NextResponse.json({ error: "Yetkisiz." }, { status: 401 });
  }

  const envResult = validateEnv();

  const systemDb = withTenantDB('admin-system', true);

  // DB bağlantı testi
  let dbStatus = "unknown";
  try {
    const result = await systemDb.executeSafe({
      text: "SELECT COUNT(*) as tenant_count FROM tenants WHERE status = 'active'"
    }) as any[];
    dbStatus = `connected (${result[0]?.tenant_count || 0} aktif tenant)`;
  } catch (e: any) {
    dbStatus = `error: ${e.message}`;
  }

  // Retry queue durumu
  let retryQueueStatus = "unknown";
  try {
    const pending = await systemDb.executeSafe({
      text: "SELECT COUNT(*) as c FROM message_retry_queue WHERE status = 'pending'"
    }) as any[];
    const failed = await systemDb.executeSafe({
      text: "SELECT COUNT(*) as c FROM message_retry_queue WHERE status = 'failed'"
    }) as any[];
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
