import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.join(__dirname, '../.env.local') });

async function main() {
  const tenantId = 'caab9ea1-9591-45e4-bbc5-9c9b498982c8';
  const conversationId = '8f738423-6213-44e6-8ac0-3a10bc7835bb';

  const { withTenantDB } = await import('../src/lib/core/tenant-db');
  const db = withTenantDB(tenantId, true);

  console.log('=== P0.7 — Conversation Unlock ===\n');

  // Query state before update
  const before = await db.executeSafe({
    text: `SELECT status, autopilot_enabled, metadata FROM conversations WHERE id = $1`,
    values: [conversationId]
  }) as any[];

  console.log('Before update:');
  console.log(JSON.stringify(before[0], null, 2));

  if (before[0].status === 'human') {
    // Perform update (only status = 'bot', leave autopilot_enabled and metadata untouched)
    const after = await db.executeSafe({
      text: `UPDATE conversations SET status = 'bot' WHERE id = $1 RETURNING status, autopilot_enabled, metadata`,
      values: [conversationId]
    }) as any[];

    console.log('\nAfter update:');
    console.log(JSON.stringify(after[0], null, 2));
    console.log('\n✅ Unlock completed successfully!');
  } else {
    console.log('\nConversation is already in bot mode. No update performed.');
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
