import { neon } from '@neondatabase/serverless';
import 'dotenv/config';

async function main() {
  const sql = neon(process.env.DATABASE_URL);
  const tenantId = '43c08749-ecc3-452f-a48d-60cd631986f8';
  
  // Instagram bot durumunu kontrol et
  const igSetting = await sql`SELECT * FROM settings WHERE tenant_id = ${tenantId} AND key = 'channel_instagram_enabled'`;
  console.log("Instagram Setting:", igSetting);
  
  // Eğer yoksa veya false ise true yapalım (test için)
  if (igSetting.length === 0) {
     await sql`INSERT INTO settings (tenant_id, key, value) VALUES (${tenantId}, 'channel_instagram_enabled', 'true')`;
     console.log("Setting inserted to TRUE");
  } else if (igSetting[0].value === 'false') {
     await sql`UPDATE settings SET value = 'true' WHERE tenant_id = ${tenantId} AND key = 'channel_instagram_enabled'`;
     console.log("Setting updated to TRUE");
  }
}
main().catch(console.error);
