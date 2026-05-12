import { NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";

export async function GET() {
  try {
    const sql = neon(process.env.DATABASE_URL!);
    
    // Core columns
    await sql`ALTER TABLE conversations ADD COLUMN IF NOT EXISTS country VARCHAR(100)`;
    await sql`ALTER TABLE conversations ADD COLUMN IF NOT EXISTS real_phone VARCHAR(20)`;
    
    // Performance Indexes
    await sql`CREATE INDEX IF NOT EXISTS idx_conversations_phone ON conversations(phone_number)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_conversations_last_message ON conversations(last_message_at DESC)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_messages_phone ON messages(phone_number)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at DESC)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_leads_phone ON leads(phone_number)`;
    
    return NextResponse.json({ success: true, message: "DB schemas and performance indexes updated successfully" });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message });
  }
}
