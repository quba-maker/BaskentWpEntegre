import 'dotenv/config';
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL!);

async function main() {
  const leads = await sql`
    SELECT id, patient_name, form_name, phone_number, created_at 
    FROM leads 
    WHERE patient_name ILIKE '%Halil%' OR patient_name ILIKE '%Hanay%'
    ORDER BY created_at DESC
  `;
  console.log("Halil leads:", leads);
}

main().catch(console.error);
