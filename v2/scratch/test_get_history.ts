import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });


const TENANT_ID = 'caab9ea1-9591-45e4-bbc5-9c9b498982c8'; // baskent
const PHONE_NUMBER = '905546833306';

async function run() {
  const { TenantDB } = await import('../src/lib/core/tenant-db');
  const { ConversationService } = await import('../src/lib/services/conversation.service');

  const db = new TenantDB(TENANT_ID);
  const service = new ConversationService(db);

  console.log(`Fetching history for phone ${PHONE_NUMBER} and tenant ${TENANT_ID}...`);
  const history = await service.getHistory(PHONE_NUMBER, 20);
  console.log('History items count:', history.length);
  console.log('History:');
  console.log(JSON.stringify(history, null, 2));
  
  const hasSystemMessages = history.some((h: any) => h.content.includes('servis dışı') || h.role === 'system');
  if (hasSystemMessages) {
    console.error('❌ FAILED: System messages are present in history!');
  } else {
    console.log('✅ SUCCESS: System messages are filtered out of history.');
  }
}

run().catch(console.error);
