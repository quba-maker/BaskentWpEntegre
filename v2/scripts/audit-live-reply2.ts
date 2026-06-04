import { config } from 'dotenv';
config({ path: '.env.local' });
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL!);

async function run() {
  const ids = [
    'wamid.HBgMOTA1NTQ2ODMzMzA2FQIAEhgUM0JBN0E3MzNFMzBGRjcyRkE1RkEA',
    'wamid.HBgMOTA1NTQ2ODMzMzA2FQIAEhgUM0I5NTQ1MjM4RUYxNUM5RjgzQTIA'
  ];

  try {
    for (const id of ids) {
      console.log(`\n--- Auditing ID: ${id} ---`);
      const messages = await sql`
        SELECT id, provider_message_id, direction, content, media_metadata 
        FROM messages 
        WHERE provider_message_id = ${id}
        LIMIT 1
      `;
      if (messages.length > 0) {
        const msg = messages[0];
        console.log('Message ID:', msg.id);
        console.log('Direction:', msg.direction);
        console.log('Content:', msg.content);
        console.log('Media Metadata:', JSON.stringify(msg.media_metadata, null, 2));
      } else {
        console.log('Message not found.');
      }
    }
  } catch(e) {
    console.error(e);
  }
}

run();
