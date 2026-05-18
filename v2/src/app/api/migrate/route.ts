import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';

export async function GET() {
  const results: string[] = [];

  try {
    // 0. Detect conversations.id column type (legacy systems use SERIAL/INTEGER, not UUID)
    const convIdType = await sql`
      SELECT data_type FROM information_schema.columns 
      WHERE table_name = 'conversations' AND column_name = 'id'
    `;
    const convIdDataType = convIdType[0]?.data_type || 'unknown';
    results.push(`conversations.id type: ${convIdDataType}`);

    // 1. Add provider_message_id to messages
    await sql`ALTER TABLE messages ADD COLUMN IF NOT EXISTS provider_message_id TEXT`;
    await sql`CREATE INDEX IF NOT EXISTS idx_messages_provider_id ON messages(provider_message_id)`;
    results.push('provider_message_id: OK');

    // 2. Add customer_profiles table
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
    results.push('customer_profiles: OK');

    // 3. Add customer_id to conversations (UUID, references customer_profiles)
    await sql`ALTER TABLE conversations ADD COLUMN IF NOT EXISTS customer_id UUID`;
    results.push('conversations.customer_id: OK');

    // 4. conversation_memory — match conversation_id type to actual conversations.id type
    // Use INTEGER if legacy, otherwise UUID. No FK constraint to avoid type mismatch failures.
    if (convIdDataType === 'integer') {
      await sql`
        CREATE TABLE IF NOT EXISTS conversation_memory (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          conversation_id INTEGER NOT NULL,
          summary_text TEXT,
          buying_intent TEXT,
          sentiment TEXT,
          objections JSONB,
          last_extracted_at TIMESTAMPTZ DEFAULT NOW(),
          UNIQUE(conversation_id)
        );
      `;
    } else {
      await sql`
        CREATE TABLE IF NOT EXISTS conversation_memory (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          conversation_id UUID NOT NULL,
          summary_text TEXT,
          buying_intent TEXT,
          sentiment TEXT,
          objections JSONB,
          last_extracted_at TIMESTAMPTZ DEFAULT NOW(),
          UNIQUE(conversation_id)
        );
      `;
    }
    results.push(`conversation_memory: OK (conv_id type: ${convIdDataType})`);
    
    // 5. AI Module Settings
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
    results.push('ai_module_settings: OK');

    // 6. Ensure conversations has required columns for the worker pipeline
    await sql`ALTER TABLE conversations ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()`;
    await sql`ALTER TABLE conversations ADD COLUMN IF NOT EXISTS last_channel TEXT`;
    results.push('conversations columns: OK');

    // 7. Ensure leads has customer_id for Unified Identity linking
    await sql`ALTER TABLE leads ADD COLUMN IF NOT EXISTS customer_id UUID`;
    results.push('leads.customer_id: OK');

    // 8. Add model_used to messages for AI model tracking
    await sql`ALTER TABLE messages ADD COLUMN IF NOT EXISTS model_used TEXT`;
    results.push('messages.model_used: OK');

    return NextResponse.json({ 
      success: true, 
      message: 'Migration completed successfully!',
      details: results 
    });
  } catch (error: any) {
    console.error('Migration failed:', error);
    return NextResponse.json({ 
      success: false, 
      error: error.message,
      completedSteps: results 
    }, { status: 500 });
  }
}
