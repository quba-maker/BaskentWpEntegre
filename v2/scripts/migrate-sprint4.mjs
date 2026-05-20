import { neon } from '@neondatabase/serverless';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const sql = neon(process.env.DATABASE_URL);

async function run() {
  console.log("Running Sprint 4.0 migrations...");
  await sql`
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
  await sql`CREATE INDEX IF NOT EXISTS idx_tenant_semantic_rules ON tenant_semantic_rules(tenant_id)`;
  
  await sql`
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
  await sql`CREATE INDEX IF NOT EXISTS idx_ai_context_memory ON ai_context_memory(tenant_id, entity_type)`;
  
  await sql`
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
  await sql`CREATE INDEX IF NOT EXISTS idx_pipeline_events ON pipeline_events(tenant_id, event_type)`;
  console.log("Sprint 4.0 migrations applied successfully.");
}

run().catch(console.error);
