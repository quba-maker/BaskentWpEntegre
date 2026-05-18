import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';

export async function GET() {
  try {
    // 1. Add provider_message_id
    await sql`ALTER TABLE messages ADD COLUMN IF NOT EXISTS provider_message_id TEXT`;
    await sql`CREATE INDEX IF NOT EXISTS idx_messages_provider_id ON messages(provider_message_id)`;

    // 2. Add customer_profiles table (Missing in Vercel PG)
    await sql`
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
    `;

    // 3. Add customer_id to conversations
    await sql`ALTER TABLE conversations ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES customer_profiles(id) ON DELETE SET NULL`;
    
    // 4. Add conversation_memory table
    await sql`
      CREATE TABLE IF NOT EXISTS conversation_memory (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        summary_text TEXT,
        buying_intent TEXT,
        sentiment TEXT,
        objections JSONB,
        last_extracted_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(conversation_id)
      );
    `;
    
    // 5. Setup AI Module Settings & AI Audit Logs
    await sql`
      CREATE TABLE IF NOT EXISTS ai_module_settings (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        module_name TEXT NOT NULL,
        is_active BOOLEAN DEFAULT true,
        config JSONB DEFAULT '{}'::jsonb,
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(tenant_id, module_name)
      );
    `;

    return NextResponse.json({ success: true, message: 'Migration completed: All missing identity and memory tables have been successfully added!' });
  } catch (error: any) {
    console.error('Migration failed:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
