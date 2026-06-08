import { config } from 'dotenv';
config({ path: '.env.local' });
import { Pool } from '@neondatabase/serverless';

async function run() {
  const client = new Pool({
    connectionString: process.env.DATABASE_URL
  });
  
  try {
    const conversationId = '5ab1e196-47cb-4a6e-bf01-78f81f8e4ef9'; // Ömer Ali Kerküklü
    const tenantId = 'caab9ea1-9591-45e4-bbc5-9c9b498982c8';
    
    console.log("Running EXPLAIN ANALYZE on current getMessages query...");
    const explainRes = await client.query({
      text: `
        EXPLAIN ANALYZE
        SELECT id, content as text, direction, status, model_used,
               media_type, media_url, media_metadata, provider_message_id,
               EXTRACT(EPOCH FROM COALESCE(provider_timestamp, created_at)) * 1000 as created_at_ms
        FROM messages
        WHERE conversation_id = $1::uuid 
          AND (tenant_id = $2::uuid)
          AND (
            $3::timestamptz IS NULL
            OR COALESCE(provider_timestamp, created_at) < $3::timestamptz
            OR (
              COALESCE(provider_timestamp, created_at) = $3::timestamptz
              AND id < $4::uuid
            )
          )
        ORDER BY COALESCE(provider_timestamp, created_at) DESC, id DESC
        LIMIT $5
      `,
      values: [conversationId, tenantId, null, null, 30]
    });
    
    console.log("Execution Plan:\n");
    explainRes.rows.forEach(r => console.log(r['QUERY PLAN']));

  } catch (err) {
    console.error("ERROR:", err);
  } finally {
    await client.end();
  }
}
run();
