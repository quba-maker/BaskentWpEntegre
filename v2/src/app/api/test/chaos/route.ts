import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';

export async function POST(request: Request) {
  // Protect this route strongly in production
  if (process.env.NODE_ENV === 'production' && request.headers.get('x-chaos-secret') !== process.env.CHAOS_SECRET) {
    return NextResponse.json({ error: 'Unauthorized Chaos Invocation' }, { status: 403 });
  }

  try {
    const url = new URL(request.url);
    const action = url.searchParams.get('action');

    switch (action) {
      case 'simulate_deadlock': {
        // Find a random open conversation and lock it indefinitely in the past
        const deadlocked = await sql`
          UPDATE conversations
          SET active_workflow_run_id = gen_random_uuid(),
              workflow_lock_expires_at = NOW() - INTERVAL '1 hour'
          WHERE status = 'open'
          RETURNING id;
        `;
        return NextResponse.json({ success: true, action, affected: deadlocked.length });
      }
      
      case 'simulate_queue_lag': {
        // Insert dummy pending webhook events
        const payload = JSON.stringify({ chaos: true, timestamp: Date.now() });
        const lagEvents = await sql`
          INSERT INTO webhook_events (tenant_id, provider, event_type, payload, status)
          SELECT t.id, 'meta', 'messages', ${payload}::jsonb, 'pending'
          FROM tenants t LIMIT 1
          RETURNING id;
        `;
        return NextResponse.json({ success: true, action, affected: lagEvents.length });
      }

      case 'overload_tenant_budget': {
        // Max out a tenant's budget
        const overloaded = await sql`
          UPDATE tenants
          SET tokens_used = token_budget + 100
          WHERE status = 'active'
          RETURNING id;
        `;
        return NextResponse.json({ success: true, action, affected: overloaded.length });
      }

      default:
        return NextResponse.json({ error: 'Invalid chaos action' }, { status: 400 });
    }
  } catch (error: any) {
    console.error('Chaos simulation failed:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
