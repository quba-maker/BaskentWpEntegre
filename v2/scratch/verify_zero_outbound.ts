import { neon } from '@neondatabase/serverless';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const sql = neon(process.env.DATABASE_URL!);

async function run() {
  console.log("=== ZERO-OUTBOUND TEST SCRIPT ===");
  const tenantId = '11111111-1111-1111-1111-111111111111';

  // State Before
  console.log("\n--- STATE BEFORE ---");
  const msgOutBefore = await sql`SELECT count(*) FROM messages WHERE direction = 'out' AND tenant_id = ${tenantId}`;
  const logWaBefore = await sql`SELECT count(*) FROM outreach_logs WHERE channel = 'whatsapp' AND tenant_id = ${tenantId}`;
  const logAppOpenedBefore = await sql`SELECT count(*) FROM outreach_logs WHERE action = 'whatsapp_app_opened_for_greeting' AND tenant_id = ${tenantId}`;
  
  console.log("messages.direction='out':", msgOutBefore[0].count);
  console.log("outreach_logs.channel='whatsapp':", logWaBefore[0].count);
  console.log("outreach_logs.action='whatsapp_app_opened_for_greeting':", logAppOpenedBefore[0].count);

  console.log("\n--- NORMALIZATION EXAMPLES ---");
  const testPhones = [
    '+90 535 828 70 95',
    '0535 828 70 95',
    '5358287095',
    '+49 176 34355747'
  ];
  for (const p of testPhones) {
    const digits = p.replace(/\D/g, '');
    let clean = digits;
    if (clean.length === 10 && clean.startsWith('5')) {
      clean = '90' + clean;
    } else if (clean.length === 11 && clean.startsWith('05')) {
      clean = '90' + clean.substring(1);
    }
    console.log(`"${p}" -> "${clean}"`);
  }

  const cleanPhone = '905358287095';
  const draftText = "Merhaba, Başkent Üniversitesi Konya Hastanesi’nden, doldurduğunuz form doğrultusunda sizinle iletişime geçiyoruz.";
  const waUrl = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(draftText)}`;
  console.log(`\nWA.ME URL EXAMPLES:\n${waUrl}`);

}

run().catch(console.error);
