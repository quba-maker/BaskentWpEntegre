import * as dotenv from 'dotenv';
import { neon } from '@neondatabase/serverless';

dotenv.config({ path: '.env.local' });

async function run() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error("DATABASE_URL is missing");
    return;
  }
  const sql = neon(dbUrl);
  try {
    console.log("=== STARTING CLEANUP OF 3 WRONG LEADS ===");
    
    const targetIds = [
      '2d38b528-3254-43dc-91db-3d3bd788a4ca',
      'fc06b68a-cb1b-44fc-86b6-f3fb9bd6d04e',
      '6ad35879-03f9-4c0a-b1d4-b61a39dc10fa'
    ];

    console.log("Updating stage to 'quarantine' for target IDs:", targetIds);

    const updateRes = await sql`
      UPDATE leads
      SET stage = 'quarantine'
      WHERE id IN (${targetIds[0]}, ${targetIds[1]}, ${targetIds[2]})
        AND tenant_id = 'caab9ea1-9591-45e4-bbc5-9c9b498982c8'
      RETURNING id, stage;
    `;

    console.log("Update result:", updateRes);

    const countRes = await sql`
      SELECT stage, count(*) 
      FROM leads 
      WHERE tenant_id = 'caab9ea1-9591-45e4-bbc5-9c9b498982c8' 
        AND form_name = 'Bilinmeyen Kampanya'
      GROUP BY stage;
    `;
    console.log("New stage counts for Bilinmeyen Kampanya:", countRes);

  } catch (err) {
    console.error("Cleanup failed:", err);
  }
}

run();
