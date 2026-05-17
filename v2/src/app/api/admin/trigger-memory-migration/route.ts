import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { MemoryEngine } from '@/lib/services/ai/engines/memory';
import { logger } from '@/lib/core/logger';

const log = logger.withContext({ module: 'MemoryMigrationApi' });

// ==========================================
// QUBA AI — Historical Memory Migration
// ==========================================
// Bu endpoint, sistemde daha önce var olan ama "conversation_memory"
// tablosunda henüz özeti olmayan konuşmaların geçmişini
// MemoryEngine ile özetler.

export async function POST(req: Request) {
  try {
    const authHeader = req.headers.get('authorization');
    if (authHeader !== `Bearer ${process.env.CRON_SECRET || 'dev-secret'}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { tenantId, limit = 10 } = await req.json();
    if (!tenantId) {
      return NextResponse.json({ error: 'tenantId is required' }, { status: 400 });
    }

    log.info(`[MEMORY_MIGRATION_START] Starting migration for tenant: ${tenantId}, limit: ${limit}`);

    // Find conversations without memory
    const pendingConversations = await sql`
      SELECT c.id as conversation_id
      FROM conversations c
      LEFT JOIN conversation_memory m ON c.id = m.conversation_id
      WHERE c.tenant_id = ${tenantId}
        AND c.message_count > 0
        AND m.id IS NULL
      ORDER BY c.last_message_at DESC
      LIMIT ${limit}
    `;

    log.info(`[MEMORY_MIGRATION_BATCH] Found ${pendingConversations.length} conversations to migrate`);

    let successCount = 0;
    let failCount = 0;

    for (const conv of pendingConversations) {
      try {
        await MemoryEngine.summarizeConversation(tenantId, conv.conversation_id);
        successCount++;
        log.info(`[MEMORY_MIGRATION_OK] Migrated conv: ${conv.conversation_id}`);
      } catch (err) {
        failCount++;
        log.error(`[MEMORY_MIGRATION_FAIL] Failed on conv: ${conv.conversation_id}`, err as Error);
      }
    }

    log.info(`[MEMORY_MIGRATION_DONE] Migration finished. Success: ${successCount}, Fail: ${failCount}`);

    return NextResponse.json({
      success: true,
      processed: pendingConversations.length,
      successCount,
      failCount
    });
  } catch (error: any) {
    log.error(`[MEMORY_MIGRATION_FATAL] Unexpected error`, error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
