import { sql } from './db';

async function clearLeads() {
  try {
    console.log("Mevcut form (leads) verileri siliniyor...");
    await sql`TRUNCATE TABLE leads RESTART IDENTITY CASCADE;`;
    console.log("✅ Tüm form verileri başarıyla silindi!");
    process.exit(0);
  } catch (err) {
    console.error("Hata:", err);
    process.exit(1);
  }
}

clearLeads();
