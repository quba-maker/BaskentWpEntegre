require('dotenv').config();
const { neon } = require('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);

async function test() {
  try {
    const q = ''; const campaign = ''; const stage = '';
    let leads;
      if (q && campaign && stage) {
        leads = await sql`SELECT * FROM leads WHERE (patient_name ILIKE ${'%'+q+'%'} OR phone_number ILIKE ${'%'+q+'%'} OR city ILIKE ${'%'+q+'%'}) AND form_name = ${campaign} AND stage = ${stage} ORDER BY created_at DESC LIMIT 300`;
      } else if (q && campaign) {
        leads = await sql`SELECT * FROM leads WHERE (patient_name ILIKE ${'%'+q+'%'} OR phone_number ILIKE ${'%'+q+'%'} OR city ILIKE ${'%'+q+'%'}) AND form_name = ${campaign} ORDER BY created_at DESC LIMIT 300`;
      } else if (q && stage) {
        leads = await sql`SELECT * FROM leads WHERE (patient_name ILIKE ${'%'+q+'%'} OR phone_number ILIKE ${'%'+q+'%'} OR city ILIKE ${'%'+q+'%'}) AND stage = ${stage} ORDER BY created_at DESC LIMIT 300`;
      } else if (campaign && stage) {
        leads = await sql`SELECT * FROM leads WHERE form_name = ${campaign} AND stage = ${stage} ORDER BY created_at DESC LIMIT 300`;
      } else if (q) {
        leads = await sql`SELECT * FROM leads WHERE (patient_name ILIKE ${'%'+q+'%'} OR phone_number ILIKE ${'%'+q+'%'} OR city ILIKE ${'%'+q+'%'}) ORDER BY created_at DESC LIMIT 300`;
      } else if (campaign) {
        leads = await sql`SELECT * FROM leads WHERE form_name = ${campaign} ORDER BY created_at DESC LIMIT 300`;
      } else if (stage) {
        leads = await sql`SELECT * FROM leads WHERE stage = ${stage} ORDER BY created_at DESC LIMIT 300`;
      } else {
        leads = await sql`SELECT * FROM leads ORDER BY created_at DESC LIMIT 300`;
      }
    console.log("Leads fetched successfully! Count:", leads.length);

    const campaigns = await sql`SELECT DISTINCT form_name FROM leads WHERE form_name IS NOT NULL AND form_name != '' ORDER BY form_name`;
    console.log("Campaigns fetched:", campaigns.length);

  } catch(e) {
    console.error("DB Error:", e);
  }
}
test();
