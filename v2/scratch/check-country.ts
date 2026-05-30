import { Pool } from '@neondatabase/serverless';

async function main() {
  const pool = new Pool({
    connectionString: "postgresql://neondb_owner:npg_x1cmTpdio5qa@ep-orange-hill-alm34j6t-pooler.c-3.eu-central-1.aws.neon.tech/neondb?channel_binding=require&sslmode=require"
  });

  const phoneNumber = '905546833306';

  console.log("=== COUNTRY CHECK FOR ISA ===");
  const conv = await pool.query(`
    SELECT id, country, department, active_opportunity_id
    FROM conversations
    WHERE phone_number = $1;
  `, [phoneNumber]);
  console.log("Conversation Country/Dept:", JSON.stringify(conv.rows, null, 2));

  if (conv.rows.length > 0) {
    const activeOppId = conv.rows[0].active_opportunity_id;
    if (activeOppId) {
      const opp = await pool.query(`
        SELECT id, country, department, patient_name
        FROM opportunities
        WHERE id = $1;
      `, [activeOppId]);
      console.log("Opportunity Country/Dept:", JSON.stringify(opp.rows, null, 2));
    }
  }

  await pool.end();
}

main().catch(console.error);
