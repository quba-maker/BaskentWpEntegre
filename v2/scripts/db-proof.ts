import { config } from 'dotenv';
config({ path: '.env.local' });
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL!);

async function run() {
  try {
    // 1. Reply test
    const replyResult = await sql`
      SELECT media_metadata->'native'->>'reply_to_provider_message_id' as reply_id, 
             media_metadata->'native'->'quoted_message_snapshot' as snapshot
      FROM messages 
      WHERE media_metadata->'native'->>'reply_to_provider_message_id' IS NOT NULL 
      ORDER BY created_at DESC LIMIT 1
    `;
    console.log('--- REPLY TEST ---');
    console.log(replyResult[0]);

    // 2. Reaction test
    const reactionResult = await sql`
      SELECT media_metadata->'native'->'reaction_payload' as reaction_payload,
             media_metadata->'native'->>'message_type' as message_type,
             direction
      FROM messages 
      WHERE media_metadata->'native'->'reaction_payload' IS NOT NULL 
      ORDER BY created_at DESC LIMIT 1
    `;
    console.log('--- REACTION TEST ---');
    console.log(reactionResult[0]);

    // 3. Interactive test
    const interactiveResult = await sql`
      SELECT media_metadata->'native'->'interactive_payload' as interactive_payload,
             content
      FROM messages 
      WHERE media_metadata->'native'->'interactive_payload' IS NOT NULL 
      ORDER BY created_at DESC LIMIT 1
    `;
    console.log('--- INTERACTIVE TEST ---');
    console.log(interactiveResult[0]);

    // 4. Media caption test
    const mediaCaptionResult = await sql`
      SELECT media_metadata->'native'->>'media_caption' as caption,
             media_type, media_url
      FROM messages 
      WHERE media_metadata->'native'->>'media_caption' IS NOT NULL 
      ORDER BY created_at DESC LIMIT 1
    `;
    console.log('--- MEDIA CAPTION TEST ---');
    console.log(mediaCaptionResult[0]);
  } catch(e) {
    console.error(e);
  }
}

run();
