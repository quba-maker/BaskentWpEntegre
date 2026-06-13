import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.join(__dirname, '../.env.local') });

async function main() {
  const tenantId = 'caab9ea1-9591-45e4-bbc5-9c9b498982c8';
  const conversationId = '8f738423-6213-44e6-8ac0-3a10bc7835bb';

  const { withTenantDB } = await import('../src/lib/core/tenant-db');
  const db = withTenantDB(tenantId, true);

  const res = await db.executeSafe({
    text: `SELECT * FROM conversations WHERE id = $1`,
    values: [conversationId]
  }) as any[];

  console.log('--- TARGET CONVERSATION FULL STATE ---');
  console.log(JSON.stringify(res[0], null, 2));
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
