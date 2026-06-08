const { neon } = require('@neondatabase/serverless');
require('dotenv').config({ path: '.env.local' });

const sql = neon(process.env.DATABASE_URL);

async function run() {
  try {
    const tenantId = 'caab9ea1-9591-45e4-bbc5-9c9b498982c8';
    console.log("Using Tenant ID:", tenantId);

    // 2. Get a user for this tenant
    const users = await sql`SELECT id, email FROM users WHERE tenant_id = ${tenantId} LIMIT 1`;
    if (users.length === 0) {
      console.log("No users found for this tenant!");
      return;
    }
    const userId = users[0].id;
    console.log("Found User:", users[0]);

    // 3. Get some conversations for this tenant
    const conversations = await sql`
      SELECT id, phone_number FROM conversations 
      WHERE tenant_id = ${tenantId} 
      LIMIT 5
    `;
    if (conversations.length === 0) {
      console.log("No conversations found!");
      return;
    }
    const conversationIds = conversations.map(c => c.id);
    console.log("Found Conversation IDs:", conversationIds);

    // 4. Try running the proposed safe query
    console.log("Simulating proposed safe unread query...");
    const values = [tenantId, conversationIds, userId];
    
    const queryStr = `
      WITH target_conversations AS (
        SELECT c.id
        FROM conversations c
        WHERE c.tenant_id = $1
          AND c.id = ANY($2::uuid[])
      ),
      ranked_messages AS (
        SELECT 
          m.conversation_id,
          m.id AS message_id,
          m.created_at,
          ROW_NUMBER() OVER (
            PARTITION BY m.conversation_id 
            ORDER BY COALESCE(m.provider_timestamp, m.created_at) DESC, m.id DESC
          ) as rnk
        FROM messages m
        JOIN target_conversations tc ON tc.id = m.conversation_id
        WHERE m.tenant_id = $1
          AND m.direction = 'in'
          AND (m.media_metadata IS NULL OR COALESCE(m.media_metadata->'native'->>'message_type', '') != 'reaction')
      ),
      last_inbound AS (
        SELECT conversation_id, created_at AS last_inbound_at
        FROM ranked_messages
        WHERE rnk = 1
      ),
      second_last_inbound AS (
        SELECT conversation_id, message_id AS last_read_message_id
        FROM ranked_messages
        WHERE rnk = 2
      ),
      upsert_states AS (
        INSERT INTO conversation_read_states (tenant_id, user_id, conversation_id, last_read_at, last_read_message_id, updated_at)
        SELECT 
          $1 as tenant_id,
          $3 as user_id,
          li.conversation_id,
          li.last_inbound_at - interval '1 millisecond' as last_read_at,
          sli.last_read_message_id as last_read_message_id,
          NOW() as updated_at
        FROM last_inbound li
        LEFT JOIN second_last_inbound sli ON sli.conversation_id = li.conversation_id
        ON CONFLICT (tenant_id, user_id, conversation_id)
        DO UPDATE SET
          last_read_at = EXCLUDED.last_read_at,
          last_read_message_id = EXCLUDED.last_read_message_id,
          updated_at = NOW()
        RETURNING conversation_id, last_read_at
      ),
      unread_counts AS (
        SELECT 
          m.conversation_id,
          COUNT(*)::int AS cnt
        FROM messages m
        JOIN upsert_states us ON us.conversation_id = m.conversation_id
        WHERE m.tenant_id = $1
          AND m.direction = 'in'
          AND (m.media_metadata IS NULL OR COALESCE(m.media_metadata->'native'->>'message_type', '') != 'reaction')
          AND m.created_at > us.last_read_at
        GROUP BY m.conversation_id
      )
      SELECT 
        us.conversation_id, 
        us.last_read_at,
        li.last_inbound_at,
        COALESCE(uc.cnt, 1)::int AS unread_count
      FROM upsert_states us
      JOIN last_inbound li ON li.conversation_id = us.conversation_id
      LEFT JOIN unread_counts uc ON uc.conversation_id = us.conversation_id;
    `;
    const result = await sql.query(queryStr, values);

    console.log("SQL execution succeeded! Result:", result);

  } catch (err) {
    console.error("SQL execution failed with error:", err);
  }
}

run();
