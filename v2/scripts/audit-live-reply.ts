import { config } from 'dotenv';
config({ path: '.env.local' });
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL!);

async function run() {
  const providerMessageId = 'wamid.HBgMOTA1NTQ2ODMzMzA2FQIAEhgUM0IxNzY4NTU2RTkwNjY0RjMwQTIA';

  try {
    console.log('--- 1. RAW CHANNEL EVENTS ---');
    const channelEvents = await sql`
      SELECT id, event_type, created_at, payload 
      FROM channel_events 
      WHERE payload::text LIKE ${'%' + providerMessageId + '%'}
      ORDER BY created_at DESC
      LIMIT 3
    `;
    console.log(`Found ${channelEvents.length} events matching provider_message_id.`);
    if (channelEvents.length > 0) {
      console.log('Latest event payload:', JSON.stringify(channelEvents[0].payload, null, 2));
    }

    console.log('\n--- 2. MESSAGES TABLE CHECK ---');
    const messages = await sql`
      SELECT id, provider_message_id, direction, content, media_metadata 
      FROM messages 
      WHERE provider_message_id = ${providerMessageId}
      LIMIT 1
    `;
    if (messages.length > 0) {
      const msg = messages[0];
      console.log('Message ID:', msg.id);
      console.log('Direction:', msg.direction);
      console.log('Content:', msg.content);
      console.log('Media Metadata:', JSON.stringify(msg.media_metadata, null, 2));
    } else {
      console.log('Message not found in database with that provider_message_id.');
    }
  } catch(e) {
    console.error(e);
  }
}

run();
