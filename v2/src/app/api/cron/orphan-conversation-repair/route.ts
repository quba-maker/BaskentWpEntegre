import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // 1. Find conversations missing customer profiles but with valid phones
    // (Actual logic would try to link them to customerProfiles here)
    
    // For now, just count them to log
    const orphans = await sql`
      SELECT count(id) as count 
      FROM conversations 
      WHERE customer_id IS NULL AND phone_number IS NOT NULL
    `;

    return NextResponse.json({ 
      success: true, 
      orphanCount: orphans[0]?.count || 0,
      message: `Found ${orphans[0]?.count || 0} orphaned conversations.`
    });
  } catch (error: any) {
    console.error('Orphan repair error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
