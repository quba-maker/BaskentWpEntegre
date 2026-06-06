import 'dotenv/config';
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL!);

async function main() {
  const tenantRes = await sql`SELECT id FROM tenants WHERE slug = 'baskent' LIMIT 1`;
  const tenantId = tenantRes[0].id;

  const profileRes = await sql`
    SELECT cap.greeting_language FROM channel_ai_profiles cap
    JOIN channel_groups cg ON cap.group_id = cg.id
    WHERE cg.tenant_id = ${tenantId}::uuid AND cg.status = 'active'
    ORDER BY cg.sort_order ASC LIMIT 1
  `;
  console.log("PROFILE RESULT:", profileRes);
}

main().catch(console.error);
