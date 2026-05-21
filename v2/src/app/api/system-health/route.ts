import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';

export async function GET(request: Request) {
  // Protect this route in production
  if (process.env.NODE_ENV === 'production' && request.headers.get('x-admin-secret') !== process.env.ADMIN_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  try {
    // 1. Queue Lag
    const pendingWebhooks = await sql`SELECT count(*) FROM webhook_events WHERE status = 'pending'`;
    const failedWebhooks = await sql`SELECT count(*) FROM webhook_events WHERE status = 'failed'`;

    // 2. Active Locks
    const activeLocks = await sql`SELECT count(*) FROM conversations WHERE active_workflow_run_id IS NOT NULL AND workflow_lock_expires_at > NOW()`;
    const staleLocks = await sql`SELECT count(*) FROM conversations WHERE active_workflow_run_id IS NOT NULL AND workflow_lock_expires_at <= NOW()`;

    // 3. DLQ
    const dlqJobs = await sql`SELECT count(*) FROM dead_letter_jobs WHERE resolved = FALSE`;

    // 4. Token Budget
    const tenantsOverBudget = await sql`SELECT count(*) FROM tenants WHERE tokens_used >= token_budget`;

    return NextResponse.json({
      success: true,
      data: {
        queue: {
          lag: parseInt(pendingWebhooks[0].count),
          failed: parseInt(failedWebhooks[0].count),
        },
        locks: {
          active: parseInt(activeLocks[0].count),
          stale: parseInt(staleLocks[0].count),
        },
        dlq: {
          unresolved: parseInt(dlqJobs[0].count),
        },
        tenants: {
          overBudget: parseInt(tenantsOverBudget[0].count),
        },
        timestamp: new Date().toISOString()
      }
    });

  } catch (error: any) {
    console.error('System Health metric fetch failed:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
