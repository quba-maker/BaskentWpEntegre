import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';

export async function GET() {
  try {
    // Sadece mevcut leadleri temizle (Form kayıtları)
    await sql`TRUNCATE TABLE leads RESTART IDENTITY CASCADE;`;
    
    // Opsiyonel olarak conversations ve messages tablolarını da temizleyebiliriz
    // await sql`TRUNCATE TABLE conversations RESTART IDENTITY CASCADE;`;
    // await sql`TRUNCATE TABLE messages RESTART IDENTITY CASCADE;`;

    return NextResponse.json({ success: true, message: 'All old leads wiped successfully.' });
  } catch (error: any) {
    console.error('Reset error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
