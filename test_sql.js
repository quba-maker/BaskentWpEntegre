import { neon } from '@neondatabase/serverless';
import dotenv from 'dotenv';
dotenv.config({ path: '.env' });

const sql = neon(process.env.DATABASE_URL);
async function run() {
  try {
    const res = await sql`SELECT e.*, c.patient_name, l.form_name, l.city 
        FROM events e 
        LEFT JOIN conversations c ON c.phone_number = e.phone_number
        LEFT JOIN leads l ON l.phone_number = e.phone_number
        WHERE e.event_type = 'appointment_request'
        ORDER BY e.created_at DESC LIMIT 10`;
    console.log("Success:", res.length);
  } catch(e) {
    console.error("SQL Error:", e.message);
  }
}
run();
