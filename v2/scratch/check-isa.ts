import { Pool } from '@neondatabase/serverless';

async function main() {
  const pool = new Pool({
    connectionString: "postgresql://neondb_owner:npg_x1cmTpdio5qa@ep-orange-hill-alm34j6t-pooler.c-3.eu-central-1.aws.neon.tech/neondb?channel_binding=require&sslmode=require"
  });

  const phoneNumber = '905546833306';

  console.log("=== CONVERSATION FOR ISA ===");
  const conv = await pool.query(`
    SELECT id, phone_number, active_opportunity_id, notes, updated_at
    FROM conversations
    WHERE phone_number = $1;
  `, [phoneNumber]);
  console.log(JSON.stringify(conv.rows, null, 2));

  if (conv.rows.length > 0) {
    const convId = conv.rows[0].id;
    console.log("\n=== CONVERSATION MEMORY FOR ISA ===");
    const mem = await pool.query(`
      SELECT conversation_id, summary_text, buying_intent, sentiment, updated_at
      FROM conversation_memory
      WHERE conversation_id::text = $1::text;
    `, [convId]);
    console.log(JSON.stringify(mem.rows, null, 2));

    console.log("\n=== ACTIVE OPPORTUNITY FOR ISA ===");
    const activeOppId = conv.rows[0].active_opportunity_id;
    if (activeOppId) {
      const opp = await pool.query(`
        SELECT id, patient_name, summary, stage, updated_at
        FROM opportunities
        WHERE id = $1;
      `, [activeOppId]);
      console.log(JSON.stringify(opp.rows, null, 2));
    } else {
      console.log("No active opportunity!");
    }
  }

  await pool.end();
}

main().catch(console.error);
