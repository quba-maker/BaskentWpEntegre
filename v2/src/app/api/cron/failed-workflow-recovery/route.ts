import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // 1. Move 'pending' workflow runs that are older than 1 hour to 'failed'
    const failedRuns = await sql`
      UPDATE workflow_runs
      SET status = 'failed', updated_at = NOW()
      WHERE status IN ('queued', 'running') AND created_at < NOW() - INTERVAL '1 hour'
      RETURNING id;
    `;

    return NextResponse.json({ 
      success: true, 
      failedCount: failedRuns.length,
      message: `Marked ${failedRuns.length} stale workflow runs as failed.`
    });
  } catch (error: any) {
    console.error('Failed workflow recovery error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
