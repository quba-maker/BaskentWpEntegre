import * as dotenv from 'dotenv';
import { neon } from '@neondatabase/serverless';

dotenv.config({ path: '.env.local' });

async function resetUnsafe() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) return;
  const sql = neon(dbUrl);
  try {
    const rows = await sql`
      SELECT id, phone_number, stage 
      FROM leads 
      WHERE tenant_id = 'caab9ea1-9591-45e4-bbc5-9c9b498982c8'
        AND id::text LIKE '6ad35879%';
    `;
    console.log("Matched leads for 6ad35879:", rows);

    const targetIds = [
      '2d38b528-3254-43dc-91db-3d3bd788a4ca',
      'fc06b68a-cb1b-44fc-86b6-f3fb9bd6d04e',
      rows[0]?.id
    ].filter(Boolean);

    console.log("Resetting stage to 'new' for:", targetIds);

    const resetRes = await sql`
      UPDATE leads
      SET stage = 'new'
      WHERE id IN (${targetIds[0]}, ${targetIds[1]}, ${targetIds[2]})
      RETURNING id, stage;
    `;
    console.log("Successfully reset leads stage:", resetRes);

  } catch (err) {
    console.error(err);
  }
}
resetUnsafe();
