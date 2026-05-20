import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';

export async function GET(request: Request) {
  // Verify authorization (e.g., cron secret or QStash signature)
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Release locks older than 5 minutes
    const unlocked = await sql`
      UPDATE conversations
      SET active_workflow_run_id = NULL, workflow_lock_expires_at = NULL
      WHERE workflow_lock_expires_at < NOW()
      RETURNING id;
    `;

    return NextResponse.json({ 
      success: true, 
      unlockedCount: unlocked.length,
      message: `Unlocked ${unlocked.length} stale conversations.`
    });
  } catch (error: any) {
    console.error('Stale workflow unlocker error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
