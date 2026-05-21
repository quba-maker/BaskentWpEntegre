const { neon } = require("@neondatabase/serverless");
require("dotenv").config({ path: ".env.local" });

async function verify() {
  const sql = neon(process.env.DATABASE_URL);

  console.log("╔══════════════════════════════════════════════════════╗");
  console.log("║   PHASE 2A — CREDENTIAL ISOLATION VERIFICATION      ║");
  console.log("╚══════════════════════════════════════════════════════╝\n");

  // 1. Check ALLOW_ENV_CREDENTIAL_FALLBACK
  console.log("─── 1. ENV FALLBACK FLAG ───");
  const flag = process.env.ALLOW_ENV_CREDENTIAL_FALLBACK;
  console.log(`  ALLOW_ENV_CREDENTIAL_FALLBACK = ${flag || '(not set)'}`);
  console.log(`  Effective: ${flag === 'true' ? '⚠️ ENABLED (legacy mode)' : '✅ DISABLED (strict isolation)'}`);

  // 2. Check V2 channel credentials exist for baskent
  console.log("\n─── 2. V2 CHANNEL CREDENTIALS ───");
  const v2Creds = await sql`
    SELECT c.id as channel_id, c.provider, c.identifier,
           ci.id as integration_id,
           CASE WHEN ci.credentials_encrypted IS NOT NULL AND ci.credentials_encrypted != '' THEN 'YES' ELSE 'NO' END as has_token,
           t.slug
    FROM channels c
    JOIN channel_groups cg ON c.group_id = cg.id
    JOIN tenants t ON cg.tenant_id = t.id
    LEFT JOIN channel_integrations ci ON ci.channel_id = c.id
    WHERE t.slug = 'baskent'
    ORDER BY c.provider
  `;
  v2Creds.forEach(r => {
    const icon = r.has_token === 'YES' ? '✅' : '⚠️';
    console.log(`  ${icon} ${r.provider} | identifier=${r.identifier} | has_token=${r.has_token} | channel=${r.channel_id}`);
  });

  const whatsappWithToken = v2Creds.filter(r => r.provider === 'whatsapp' && r.has_token === 'YES');
  console.log(`\n  WhatsApp channels with V2 token: ${whatsappWithToken.length}`);
  console.log(`  Result: ${whatsappWithToken.length > 0 ? '✅ V2 CREDENTIALS AVAILABLE' : '⚠️ WILL FALLBACK TO V1'}`);

  // 3. Check V1 legacy token on tenants table
  console.log("\n─── 3. V1 LEGACY CREDENTIALS ───");
  const v1Creds = await sql`
    SELECT slug,
           CASE WHEN meta_page_token IS NOT NULL AND meta_page_token != '' THEN 'YES' ELSE 'NO' END as has_meta_token,
           CASE WHEN whatsapp_phone_id IS NOT NULL AND whatsapp_phone_id != '' THEN 'YES' ELSE 'NO' END as has_phone_id
    FROM tenants WHERE slug = 'baskent'
  `;
  v1Creds.forEach(r => {
    console.log(`  ${r.slug}: meta_token=${r.has_meta_token} | phone_id=${r.has_phone_id}`);
  });

  // 4. Simulate credential resolution chain
  console.log("\n─── 4. CREDENTIAL RESOLUTION CHAIN SIMULATION ───");
  
  // Simulate what CredentialsService does for WhatsApp
  const waResult = await sql`
    SELECT ci.credentials_encrypted, c.identifier, c.id as channel_id
    FROM channels c
    JOIN channel_groups cg ON c.group_id = cg.id
    LEFT JOIN channel_integrations ci ON ci.channel_id = c.id
    WHERE cg.tenant_id = (SELECT id FROM tenants WHERE slug = 'baskent')
      AND c.provider = 'whatsapp'
    LIMIT 1
  `;
  
  if (waResult.length > 0 && waResult[0].credentials_encrypted) {
    let parsed;
    try { parsed = JSON.parse(waResult[0].credentials_encrypted); } catch { parsed = null; }
    const hasToken = parsed?.accessToken ? true : !!waResult[0].credentials_encrypted;
    console.log(`  WhatsApp: V2 token found = ${hasToken ? '✅ YES' : '❌ NO'}`);
    console.log(`  identifier (phone_number_id) = ${waResult[0].identifier}`);
    console.log(`  → Credential source will be: v2_channels`);
  } else {
    console.log(`  WhatsApp: V2 token = ❌ NOT FOUND`);
    console.log(`  → Will attempt V1 fallback`);
    
    const v1 = await sql`SELECT meta_page_token, whatsapp_phone_id FROM tenants WHERE slug = 'baskent'`;
    if (v1[0]?.meta_page_token) {
      console.log(`  → V1 fallback: meta_page_token found ✅`);
      console.log(`  → Credential source will be: v1_legacy`);
    } else {
      console.log(`  → V1 fallback: ❌ NO TOKEN`);
      console.log(`  → ENV fallback: ${flag === 'true' ? '⚠️ WILL USE ENV' : '🛡️ BLOCKED (flag disabled)'}`);
    }
  }

  // 5. Cross-tenant risk check
  console.log("\n─── 5. CROSS-TENANT RISK CHECK ───");
  const tenants = await sql`SELECT id, slug, status FROM tenants WHERE status = 'active'`;
  console.log(`  Active tenants: ${tenants.length}`);
  for (const t of tenants) {
    const chCreds = await sql`
      SELECT c.provider,
        CASE WHEN ci.credentials_encrypted IS NOT NULL AND ci.credentials_encrypted != '' THEN 'v2' ELSE 'none' END as cred_source
      FROM channels c
      JOIN channel_groups cg ON c.group_id = cg.id
      LEFT JOIN channel_integrations ci ON ci.channel_id = c.id
      WHERE cg.tenant_id = ${t.id}
    `;
    const hasCreds = chCreds.some(c => c.cred_source === 'v2');
    console.log(`  ${hasCreds ? '✅' : '⚠️'} ${t.slug} (${t.id.substring(0,8)}...) | channels: ${chCreds.length} | v2_creds: ${hasCreds}`);
  }

  console.log("\n╔══════════════════════════════════════════════════════╗");
  console.log("║   VERIFICATION COMPLETE                             ║");
  console.log("╚══════════════════════════════════════════════════════╝");
}

verify().catch(e => console.error("Verification error:", e));
