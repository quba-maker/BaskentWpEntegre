const { neon } = require('@neondatabase/serverless');
require('dotenv').config({ path: '.env.local' });

const sql = neon(process.env.DATABASE_URL);

async function run() {
  try {
    const tenantId = 'caab9ea1-9591-45e4-bbc5-9c9b498982c8';
    const users = await sql`SELECT id, email FROM users WHERE tenant_id = ${tenantId} AND email = 'admin@baskent.com'`;
    const userId = users[0].id;
    console.log("User:", users[0]);

    // Let's run getGlobalUnreadCount SQL query
    const rows = await sql.query(`
      SELECT COALESCE(SUM(unread_sub.unread), 0)::int as total_unread
      FROM (
        SELECT 
          (
            SELECT COUNT(*)::int 
            FROM messages m_unread
            WHERE m_unread.conversation_id = c.id
              AND m_unread.tenant_id = c.tenant_id
              AND m_unread.direction = 'in'
              AND (m_unread.media_metadata IS NULL OR COALESCE(m_unread.media_metadata->'native'->>'message_type', '') != 'reaction')
              AND m_unread.created_at > COALESCE(
                (SELECT last_read_at FROM conversation_read_states rs WHERE rs.tenant_id = c.tenant_id AND rs.user_id = $2 AND rs.conversation_id = c.id),
                '1970-01-01'::timestamptz
              )
          ) as unread
        FROM conversations c
        WHERE c.tenant_id = $1
      ) unread_sub
    `, [tenantId, userId]);

    console.log("Total unread query result:", rows);

    // Let's also query individual conversations and their unread counts
    const individual = await sql.query(`
      SELECT c.id, c.patient_name,
        (
          SELECT COUNT(*)::int 
          FROM messages m_unread
          WHERE m_unread.conversation_id = c.id
            AND m_unread.tenant_id = c.tenant_id
            AND m_unread.direction = 'in'
            AND (m_unread.media_metadata IS NULL OR COALESCE(m_unread.media_metadata->'native'->>'message_type', '') != 'reaction')
            AND m_unread.created_at > COALESCE(
              (SELECT last_read_at FROM conversation_read_states rs WHERE rs.tenant_id = c.tenant_id AND rs.user_id = $2 AND rs.conversation_id = c.id),
              '1970-01-01'::timestamptz
            )
        ) as unread
      FROM conversations c
      WHERE c.tenant_id = $1
      ORDER BY unread DESC
      LIMIT 10
    `, [tenantId, userId]);
    console.log("Top 10 unread conversations:", individual);

  } catch (err) {
    console.error(err);
  }
}
run();
