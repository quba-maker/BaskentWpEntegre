import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const TENANT_ID = "caab9ea1-9591-45e4-bbc5-9c9b498982c8";
const USER_ID = "75429184-1111-4444-8888-999999999999"; // dummy user id

async function run() {
  const { withTenantDB } = await import("../src/lib/core/tenant-db");
  const db = withTenantDB(TENANT_ID, true);

  console.log("=========================================");
  console.log("🔍 Explaining Core Inbox Queries");
  console.log("=========================================");

  // 1. Explain getMessages query
  console.log("\n--- EXPLAIN getMessages query ---");
  const phoneLike = "%77086223402%";
  const limit = 50;
  const offset = 0;
  
  try {
    const explainMessages = await db.executeSafe({
      text: `
        EXPLAIN
        SELECT id, content as text, direction, status, model_used,
               media_type, media_url, media_metadata, provider_message_id,
               EXTRACT(EPOCH FROM COALESCE(provider_timestamp, created_at)) * 1000 as created_at_ms
        FROM messages
        WHERE phone_number LIKE $1 
          AND (tenant_id = $2)
        ORDER BY COALESCE(provider_timestamp, created_at) DESC
        LIMIT $3 OFFSET $4
      `,
      values: [phoneLike, TENANT_ID, limit, offset]
    }) as any[];
    
    explainMessages.forEach(r => console.log(r["QUERY PLAN"]));
  } catch (err: any) {
    console.error("Failed getMessages explain:", err.message);
  }

  // 2. Explain getConversations query
  console.log("\n--- EXPLAIN getConversations query ---");
  try {
    const explainConvs = await db.executeSafe({
      text: `
        EXPLAIN
        SELECT 
          c.id as conversation_id,
          c.phone_number as id,
          c.patient_name as name,
          c.last_message_at,
          m.content as last_message,
          (
            SELECT COUNT(*)::int 
            FROM messages m_unread
            WHERE m_unread.conversation_id = c.id
              AND m_unread.tenant_id = c.tenant_id
              AND m_unread.direction = 'in'
              AND m_unread.created_at > COALESCE(
                (SELECT last_read_at FROM conversation_read_states rs WHERE rs.tenant_id = c.tenant_id AND rs.user_id = $3 AND rs.conversation_id = c.id),
                '1970-01-01'::timestamptz
              )
          ) as unread
        FROM conversations c
        LEFT JOIN LATERAL (
          SELECT content
          FROM messages 
          WHERE conversation_id = c.id 
            AND tenant_id = c.tenant_id
            AND direction IN ('in', 'out')
          ORDER BY created_at DESC 
          LIMIT 1
        ) m ON true
        WHERE c.tenant_id = $1
        ORDER BY c.last_message_at DESC NULLS LAST
        LIMIT $2 OFFSET 0
      `,
      values: [TENANT_ID, limit, USER_ID]
    }) as any[];
    
    explainConvs.forEach(r => console.log(r["QUERY PLAN"]));
  } catch (err: any) {
    console.error("Failed getConversations explain:", err.message);
  }

  process.exit(0);
}

run().catch(console.error);
