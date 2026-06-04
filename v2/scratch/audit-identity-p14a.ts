import { neon } from '@neondatabase/serverless';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const sql = neon(process.env.DATABASE_URL!);

async function main() {
  console.log("═══ P1.4-A IDENTITY FOUNDATION — DRY-RUN AUDIT ═══\n");

  // 1. Total conversations
  const totalConv = await sql`SELECT COUNT(*)::int as cnt FROM conversations`;
  console.log(`1. Total Conversations: ${totalConv[0].cnt}`);

  // 2. "İsimsiz" or NULL patient_name
  const isimsiz = await sql`
    SELECT COUNT(*)::int as cnt FROM conversations 
    WHERE patient_name IS NULL OR TRIM(patient_name) = '' OR LOWER(TRIM(patient_name)) = 'isimsiz'
  `;
  console.log(`2. İsimsiz/NULL patient_name: ${isimsiz[0].cnt}`);

  // 3. Conversations where form has a name but conversation is İsimsiz
  const formHasNameButIsimsiz = await sql`
    SELECT COUNT(DISTINCT c.id)::int as cnt
    FROM conversations c
    JOIN leads l ON l.phone_number LIKE '%' || RIGHT(c.phone_number, 10) || '%'
      AND l.tenant_id = c.tenant_id
    WHERE (c.patient_name IS NULL OR TRIM(c.patient_name) = '' OR LOWER(TRIM(c.patient_name)) = 'isimsiz')
      AND l.patient_name IS NOT NULL AND TRIM(l.patient_name) != ''
  `;
  console.log(`3. Form has name but conv İsimsiz: ${formHasNameButIsimsiz[0].cnt}`);

  // 4. Conversations with form raw_data containing full_name but conv is İsimsiz
  const formRawNameButIsimsiz = await sql`
    SELECT COUNT(DISTINCT c.id)::int as cnt
    FROM conversations c
    JOIN leads l ON l.phone_number LIKE '%' || RIGHT(c.phone_number, 10) || '%'
      AND l.tenant_id = c.tenant_id
    WHERE (c.patient_name IS NULL OR TRIM(c.patient_name) = '' OR LOWER(TRIM(c.patient_name)) = 'isimsiz')
      AND l.raw_data IS NOT NULL
      AND (l.raw_data::text LIKE '%full_name%' OR l.raw_data::text LIKE '%Full Name%' OR l.raw_data::text LIKE '%ad_soyad%')
  `;
  console.log(`4. Form raw_data has full_name but conv İsimsiz: ${formRawNameButIsimsiz[0].cnt}`);

  // 5. Conversations with WhatsApp profile name in media_metadata
  const waProfileName = await sql`
    SELECT COUNT(DISTINCT conversation_id)::int as cnt
    FROM messages
    WHERE media_metadata IS NOT NULL 
      AND media_metadata::text LIKE '%whatsapp_profile_name%'
  `;
  console.log(`5. Messages with WhatsApp profile name: ${waProfileName[0].cnt}`);

  // 6. Conversations with opportunity requester_name
  const oppRequester = await sql`
    SELECT COUNT(DISTINCT c.id)::int as cnt
    FROM conversations c
    JOIN opportunities o ON o.id = c.active_opportunity_id AND o.tenant_id = c.tenant_id
    WHERE o.requester_name IS NOT NULL AND TRIM(o.requester_name) != ''
  `;
  console.log(`6. Conversations with opp requester_name: ${oppRequester[0].cnt}`);

  // 7. Conversations with opportunity patient_name
  const oppPatientName = await sql`
    SELECT COUNT(DISTINCT c.id)::int as cnt
    FROM conversations c
    JOIN opportunities o ON o.id = c.active_opportunity_id AND o.tenant_id = c.tenant_id
    WHERE o.patient_name IS NOT NULL AND TRIM(o.patient_name) != ''
  `;
  console.log(`7. Conversations with opp patient_name: ${oppPatientName[0].cnt}`);

  // 8. Country fields status
  const convCountry = await sql`
    SELECT COUNT(*)::int as cnt FROM conversations 
    WHERE country IS NOT NULL AND TRIM(country) != ''
  `;
  console.log(`\n8. Conversations with country set: ${convCountry[0].cnt}`);

  const oppCountry = await sql`
    SELECT COUNT(*)::int as cnt FROM opportunities 
    WHERE country IS NOT NULL AND TRIM(country) != ''
  `;
  console.log(`9. Opportunities with country set: ${oppCountry[0].cnt}`);

  // 10. Country mismatch: opp country vs conv country
  const countryMismatch = await sql`
    SELECT COUNT(DISTINCT c.id)::int as cnt
    FROM conversations c
    JOIN opportunities o ON o.id = c.active_opportunity_id AND o.tenant_id = c.tenant_id
    WHERE c.country IS NOT NULL AND TRIM(c.country) != ''
      AND o.country IS NOT NULL AND TRIM(o.country) != ''
      AND LOWER(TRIM(c.country)) != LOWER(TRIM(o.country))
  `;
  console.log(`10. Country mismatch (conv vs opp): ${countryMismatch[0].cnt}`);

  // 11. Nickname-suspect names (containing underscore or digits)
  const nicknameSuspect = await sql`
    SELECT COUNT(*)::int as cnt FROM conversations 
    WHERE patient_name IS NOT NULL AND TRIM(patient_name) != ''
      AND (patient_name ~ '[0-9]' OR patient_name LIKE '%_%')
  `;
  console.log(`\n11. Nickname-suspect names (digits/underscore): ${nicknameSuspect[0].cnt}`);

  // 12. Sample nickname-suspect names
  const nicknameSamples = await sql`
    SELECT patient_name, phone_number FROM conversations 
    WHERE patient_name IS NOT NULL AND TRIM(patient_name) != ''
      AND (patient_name ~ '[0-9]' OR patient_name LIKE '%\\_%' ESCAPE '\\')
    LIMIT 15
  `;
  console.log(`12. Nickname samples:`);
  nicknameSamples.forEach((r: any) => console.log(`    "${r.patient_name}" — ${r.phone_number}`));

  // 13. Customer profiles stats
  const customerTotal = await sql`SELECT COUNT(*)::int as cnt FROM customer_profiles`;
  const customerNoName = await sql`
    SELECT COUNT(*)::int as cnt FROM customer_profiles 
    WHERE first_name IS NULL OR TRIM(first_name) = ''
  `;
  console.log(`\n13. Total customer_profiles: ${customerTotal[0].cnt}`);
  console.log(`14. customer_profiles without first_name: ${customerNoName[0].cnt}`);

  // 14. Leads with form country info
  const leadsWithCountry = await sql`
    SELECT COUNT(*)::int as cnt FROM leads 
    WHERE raw_data IS NOT NULL 
      AND (raw_data::text LIKE '%country%' OR raw_data::text LIKE '%ülke%' OR raw_data::text LIKE '%nerede%')
  `;
  console.log(`15. Leads with country in raw_data: ${leadsWithCountry[0].cnt}`);

  // 15. Sample İsimsiz conversations with form data
  const isimsizWithForm = await sql`
    SELECT c.id, c.phone_number, c.patient_name as conv_name, l.patient_name as form_name, 
           l.raw_data::text as raw_data_snippet
    FROM conversations c
    JOIN leads l ON l.phone_number LIKE '%' || RIGHT(c.phone_number, 10) || '%'
      AND l.tenant_id = c.tenant_id
    WHERE (c.patient_name IS NULL OR TRIM(c.patient_name) = '' OR LOWER(TRIM(c.patient_name)) = 'isimsiz')
      AND (l.patient_name IS NOT NULL AND TRIM(l.patient_name) != '')
    LIMIT 5
  `;
  console.log(`\n16. Sample İsimsiz with form name:`);
  isimsizWithForm.forEach((r: any) => {
    console.log(`    conv_name="${r.conv_name || 'NULL'}" | form_name="${r.form_name}" | phone=${r.phone_number}`);
  });

  // 16. WhatsApp profile names stored in messages
  const waProfileSamples = await sql`
    SELECT DISTINCT 
      media_metadata->'native'->>'whatsapp_profile_name' as wa_name,
      phone_number
    FROM messages
    WHERE media_metadata IS NOT NULL 
      AND media_metadata->'native'->>'whatsapp_profile_name' IS NOT NULL
    LIMIT 20
  `;
  console.log(`\n17. Sample WhatsApp profile names from messages:`);
  waProfileSamples.forEach((r: any) => console.log(`    "${r.wa_name}" — ${r.phone_number}`));

  // 17. Check if conversations table has whatsapp profile name column
  const convCols = await sql`
    SELECT column_name FROM information_schema.columns 
    WHERE table_name = 'conversations' 
      AND column_name IN ('whatsapp_profile_name', 'name_source', 'name_confidence', 'name_locked')
  `;
  console.log(`\n18. Identity columns in conversations table: ${convCols.length > 0 ? convCols.map((c: any) => c.column_name).join(', ') : 'NONE'}`);

  // 18. Check customer_profiles columns
  const cpCols = await sql`
    SELECT column_name FROM information_schema.columns 
    WHERE table_name = 'customer_profiles'
  `;
  console.log(`19. customer_profiles columns: ${cpCols.map((c: any) => c.column_name).join(', ')}`);

  // 19. Opportunities columns check
  const oppCols = await sql`
    SELECT column_name FROM information_schema.columns 
    WHERE table_name = 'opportunities'
    AND column_name IN ('requester_name', 'patient_name', 'country', 'patient_relation', 'phone_number')
  `;
  console.log(`20. Key opportunity columns: ${oppCols.map((c: any) => c.column_name).join(', ')}`);

  console.log("\n═══ DRY-RUN AUDIT COMPLETE ═══");
}

main().catch(console.error);
