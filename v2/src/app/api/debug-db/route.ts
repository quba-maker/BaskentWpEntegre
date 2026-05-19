import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';

export async function GET() {
  const columns = await sql`
    SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'conversation_memory'
  `;
  return NextResponse.json({ columns });
}
