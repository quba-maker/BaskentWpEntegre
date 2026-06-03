require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function run() {
  try {
    const oppQuery = `
      SELECT id, phone_number, country, timezone, metadata->>'patient_timezone' as metadata_tz, metadata->>'patient_city' as metadata_city 
      FROM opportunities 
      WHERE country = 'Türkiye' 
        AND (timezone NOT LIKE '%Istanbul%' OR metadata->>'patient_timezone' NOT LIKE '%Istanbul%')
        AND timezone IS NOT NULL
        AND timezone != ''
    `;
    
    const oppRes = await pool.query(oppQuery);
    
    const convQuery = `
      SELECT id, phone_number, country, metadata->>'patient_timezone' as metadata_tz, metadata->>'patient_city' as metadata_city 
      FROM conversations 
      WHERE country = 'Türkiye' 
        AND metadata->>'patient_timezone' NOT LIKE '%Istanbul%'
        AND metadata->>'patient_timezone' IS NOT NULL
        AND metadata->>'patient_timezone' != ''
    `;
    
    const convRes = await pool.query(convQuery);

    console.log(JSON.stringify({
      pollutedOpportunities: oppRes.rows,
      pollutedConversations: convRes.rows
    }, null, 2));

  } catch (error) {
    console.error("Error:", error);
  } finally {
    pool.end();
  }
}

run();
