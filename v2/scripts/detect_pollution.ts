import { config } from 'dotenv';
config({ path: '.env.local' });
import { TenantDB } from '../src/lib/core/tenant-db';

async function run() {
  const db = new TenantDB('baskent');
  
  try {
    const oppQuery = `
      SELECT id, phone_number, country, timezone, metadata->>'patient_timezone' as metadata_tz, metadata->>'patient_city' as metadata_city 
      FROM opportunities 
      WHERE tenant_id = $1 
        AND country = 'Türkiye' 
        AND (timezone NOT LIKE '%Istanbul%' OR metadata->>'patient_timezone' NOT LIKE '%Istanbul%')
        AND timezone IS NOT NULL
        AND timezone != ''
    `;
    
    const oppRes = await db.executeSafe({ text: oppQuery, values: ['baskent'] });
    
    const convQuery = `
      SELECT id, phone_number, country, metadata->>'patient_timezone' as metadata_tz, metadata->>'patient_city' as metadata_city 
      FROM conversations 
      WHERE tenant_id = $1
        AND country = 'Türkiye' 
        AND metadata->>'patient_timezone' NOT LIKE '%Istanbul%'
        AND metadata->>'patient_timezone' IS NOT NULL
        AND metadata->>'patient_timezone' != ''
    `;
    
    const convRes = await db.executeSafe({ text: convQuery, values: ['baskent'] });

    console.log(JSON.stringify({
      pollutedOpportunities: oppRes,
      pollutedConversations: convRes
    }, null, 2));

  } catch (error) {
    console.error("Error:", error);
  }
}

run();
