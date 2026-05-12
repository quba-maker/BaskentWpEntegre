const { neon } = require('@neondatabase/serverless');

const url = "postgresql://neondb_owner:npg_x1cmTpdio5qa@ep-orange-hill-alm34j6t-pooler.c-3.eu-central-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require";
const sql = neon(url);

async function main() {
  try {
    console.log('Mevcut lead kayıtları siliniyor...');
    await sql`TRUNCATE TABLE leads RESTART IDENTITY CASCADE`;
    console.log('Başarıyla silindi!');
  } catch (err) {
    console.error(err);
  }
}

main();
