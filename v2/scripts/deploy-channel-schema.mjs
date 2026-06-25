import { neon } from '@neondatabase/serverless';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error("❌ DATABASE_URL eksik!");
  process.exit(1);
}

const sql = neon(DATABASE_URL);

async function deployChannelSchema() {
  console.log("🚀 Starting SaaS Channel Groups Schema Deployment...");

  try {
    // 1. channel_groups
    await sql`
      CREATE TABLE IF NOT EXISTS channel_groups (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        description TEXT,
        status TEXT DEFAULT 'active',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `;
    console.log("✅ Created channel_groups table");

    // 2. channels
    await sql`
      CREATE TABLE IF NOT EXISTS channels (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        group_id UUID NOT NULL REFERENCES channel_groups(id) ON DELETE CASCADE,
        provider TEXT NOT NULL,
        identifier TEXT NOT NULL,
        name TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `;
    console.log("✅ Created channels table");

    // 3. channel_integrations
    await sql`
      CREATE TABLE IF NOT EXISTS channel_integrations (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        channel_id UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
        provider TEXT NOT NULL,
        credentials_encrypted TEXT NOT NULL,
        health_status TEXT DEFAULT 'healthy',
        last_sync_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(channel_id, provider)
      )
    `;
    console.log("✅ Created channel_integrations table");

    // 4. channel_ai_profiles
    await sql`
      CREATE TABLE IF NOT EXISTS channel_ai_profiles (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        group_id UUID NOT NULL REFERENCES channel_groups(id) ON DELETE CASCADE,
        ai_model TEXT DEFAULT 'gemini-2.5-flash',
        temperature NUMERIC(3,2) DEFAULT 0.7,
        aggression_level TEXT DEFAULT 'medium',
        language_profile TEXT DEFAULT 'tr-TR',
        business_hours_json JSONB DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(group_id)
      )
    `;
    console.log("✅ Created channel_ai_profiles table");

    // 5. channel_prompts
    await sql`
      CREATE TABLE IF NOT EXISTS channel_prompts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        group_id UUID REFERENCES channel_groups(id) ON DELETE CASCADE,
        tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
        name TEXT,
        prompt_type TEXT NOT NULL DEFAULT 'system',
        prompt_text TEXT NOT NULL,
        version INT DEFAULT 1,
        metadata JSONB DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `;
    await sql`ALTER TABLE channel_prompts ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb`;
    console.log("✅ Created channel_prompts table");

    // 6. channel_prompt_bindings
    await sql`
      CREATE TABLE IF NOT EXISTS channel_prompt_bindings (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        channel_id UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
        prompt_id UUID NOT NULL REFERENCES channel_prompts(id) ON DELETE CASCADE,
        priority INT DEFAULT 100,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(channel_id, prompt_id)
      )
    `;
    console.log("✅ Created channel_prompt_bindings table");

    // 7. workflow_runs
    await sql`
      CREATE TABLE IF NOT EXISTS workflow_runs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        channel_id UUID REFERENCES channels(id) ON DELETE CASCADE,
        conversation_id UUID,
        status TEXT DEFAULT 'queued',
        triggered_by TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `;
    console.log("✅ Created workflow_runs table");

    // 8. workflow_steps
    await sql`
      CREATE TABLE IF NOT EXISTS workflow_steps (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        run_id UUID NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
        step_type TEXT NOT NULL,
        status TEXT DEFAULT 'pending',
        payload JSONB,
        error_log TEXT,
        started_at TIMESTAMPTZ,
        completed_at TIMESTAMPTZ
      )
    `;
    console.log("✅ Created workflow_steps table");

    // 9. channel_events
    await sql`
      CREATE TABLE IF NOT EXISTS channel_events (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        channel_id UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
        event_type TEXT NOT NULL,
        payload JSONB,
        status TEXT DEFAULT 'success',
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `;
    console.log("✅ Created channel_events table");

    // 10. Modifying conversations and leads gracefully
    // Check if conversations table exists before altering
    const convCheck = await sql`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'conversations'
      );
    `;
    if (convCheck[0].exists) {
      await sql`ALTER TABLE conversations ADD COLUMN IF NOT EXISTS channel_id UUID REFERENCES channels(id) ON DELETE SET NULL`;
      console.log("✅ Added channel_id to conversations");
    } else {
      console.log("⚠️ conversations table does not exist. Skipping ALTER TABLE.");
    }

    const leadsCheck = await sql`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'leads'
      );
    `;
    if (leadsCheck[0].exists) {
      await sql`ALTER TABLE leads ADD COLUMN IF NOT EXISTS channel_id UUID REFERENCES channels(id) ON DELETE SET NULL`;
      console.log("✅ Added channel_id to leads");
    } else {
      console.log("⚠️ leads table does not exist. Skipping ALTER TABLE.");
    }

    // 11. Indexes
    await sql`CREATE INDEX IF NOT EXISTS idx_channel_groups_tenant ON channel_groups(tenant_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_channels_group ON channels(group_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_channels_identifier ON channels(identifier)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_workflow_runs_conv ON workflow_runs(conversation_id)`;
    
    if (convCheck[0].exists) {
      await sql`CREATE INDEX IF NOT EXISTS idx_conversations_channel ON conversations(channel_id)`;
    }

    console.log("🎉 Phase 0 Deployment Complete!");
    process.exit(0);

  } catch (err) {
    console.error("❌ Deployment failed:", err);
    process.exit(1);
  }
}

deployChannelSchema();
