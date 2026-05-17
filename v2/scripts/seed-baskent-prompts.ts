import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";
import { whatsappPrompt, turkcePrompt, foreignPrompt } from "../src/lib/domain/conversation/prompts.js";

config({ path: "../.env.local" });

async function run() {
  try {
    const sql = neon(process.env.DATABASE_URL!);
    
    // 1. Get baskent tenant
    const tenants = await sql`SELECT id FROM tenants WHERE slug = 'baskent'`;
    if (tenants.length === 0) {
      console.log("Baskent tenant not found");
      return;
    }
    const tenantId = tenants[0].id;

    // 2. Insert or update the prompts in bot_prompts
    const prompts = [
      { channel: 'whatsapp', content: whatsappPrompt },
      { channel: 'instagram', content: turkcePrompt },
      { channel: 'foreign', content: foreignPrompt }
    ];

    for (const p of prompts) {
      await sql`
        INSERT INTO bot_prompts (tenant_id, channel, prompt, is_active)
        VALUES (${tenantId}, ${p.channel}, ${p.content}, true)
        ON CONFLICT (tenant_id, channel) DO UPDATE 
        SET prompt = ${p.content}, is_active = true, updated_at = NOW()
      `;
    }

    console.log("✅ Prompts stored in SaaS DB successfully.");

    // 3. Update tenants schema for reminder configurations if they don't exist
    const columns = await sql`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'tenants' AND column_name IN ('reminder_template', 'reminder_hours_before')
    `;
    
    const colNames = columns.map((c: any) => c.column_name);
    if (!colNames.includes('reminder_template')) {
      await sql`ALTER TABLE tenants ADD COLUMN reminder_template TEXT`;
      console.log("✅ Added reminder_template column");
    }
    if (!colNames.includes('reminder_hours_before')) {
      await sql`ALTER TABLE tenants ADD COLUMN reminder_hours_before INT DEFAULT 24`;
      console.log("✅ Added reminder_hours_before column");
    }

    // 4. Update Baskent with a default reminder template if null
    const defaultTemplate = "Merhaba {{patient_name}} 🙏 Yarın {{time}} için planlanan randevunuzu hatırlatmak istiyoruz. Hastanemizde görüşmek üzere!";
    await sql`
      UPDATE tenants 
      SET reminder_template = COALESCE(reminder_template, ${defaultTemplate}) 
      WHERE id = ${tenantId}
    `;
    
    console.log("✅ Reminder config applied to SaaS DB successfully.");

  } catch (error: any) {
    console.error("Error:", error.message);
  }
}

run();
