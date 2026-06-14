import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.join(__dirname, '../.env.local') });

async function main() {
  const tenantId = 'caab9ea1-9591-45e4-bbc5-9c9b498982c8';
  const conversationId = '8f738423-6213-44e6-8ac0-3a10bc7835bb';

  const { withTenantDB } = await import('../src/lib/core/tenant-db');
  const db = withTenantDB(tenantId, true);

  console.log('=== P0.9 — Read-only Conversation Root Cause Audit ===\n');

  // Query conversation metadata and status
  const convResult = await db.executeSafe({
    text: `SELECT * FROM conversations WHERE id = $1`,
    values: [conversationId]
  }) as any[];

  console.log('--- Conversation Row ---');
  console.log(JSON.stringify(convResult[0], null, 2));

  // Query associated opportunity details
  if (convResult[0]?.opportunity_id) {
    const oppResult = await db.executeSafe({
      text: `SELECT * FROM opportunities WHERE id = $1`,
      values: [convResult[0].opportunity_id]
    }) as any[];
    console.log('\n--- Opportunity Row ---');
    console.log(JSON.stringify(oppResult[0], null, 2));
  }

  // Query last 15 messages sorted by created_at desc
  const messagesResult = await db.executeSafe({
    text: `SELECT id, direction, content, media_type, created_at FROM messages WHERE conversation_id = $1 ORDER BY created_at DESC LIMIT 15`,
    values: [conversationId]
  }) as any[];

  console.log('\n--- Messages (Last 15, newest first) ---');
  messagesResult.forEach((msg: any) => {
    console.log(`[${msg.created_at}] [${msg.direction.toUpperCase()}] content: "${msg.content}"`);
  });

  // Query pending tasks
  const tasksResult = await db.executeSafe({
    text: `SELECT id, title, task_type, status, metadata, due_date FROM follow_up_tasks WHERE tenant_id = $1 AND conversation_id = $2 ORDER BY created_at DESC`,
    values: [tenantId, conversationId]
  }) as any[];

  console.log('\n--- Associated Tasks ---');
  tasksResult.forEach((task: any) => {
    console.log(`[${task.status.toUpperCase()}] type: "${task.task_type}", title: "${task.title}", due: ${task.due_date}`);
    console.log(`    metadata: ${JSON.stringify(task.metadata)}`);
  });
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
