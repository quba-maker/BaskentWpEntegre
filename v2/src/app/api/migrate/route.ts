import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';

export async function GET() {
  try {
    // 1. Add provider_message_id
    await sql`ALTER TABLE messages ADD COLUMN IF NOT EXISTS provider_message_id TEXT`;
    
    // 2. Create index
    await sql`CREATE INDEX IF NOT EXISTS idx_messages_provider_id ON messages(provider_message_id)`;
    
    return NextResponse.json({ success: true, message: 'Migration completed: provider_message_id column and index added successfully!' });
  } catch (error: any) {
    console.error('Migration failed:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
