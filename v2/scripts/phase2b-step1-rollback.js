/**
 * ═══════════════════════════════════════════════════════════════
 *  PHASE 2B — STEP 1: ROLLBACK
 *  Revert channel_prompts back to placeholder text
 * ═══════════════════════════════════════════════════════════════
 * 
 *  USE ONLY IF: Migration caused data corruption or unintended
 *  side effects. Since production reads from settings (V1),
 *  rollback is purely cosmetic until BrainResolver is switched.
 * ═══════════════════════════════════════════════════════════════
 */

const { neon } = require("@neondatabase/serverless");
require("dotenv").config({ path: ".env.local" });

const ROLLBACK_DATA = {
  '9b736e84-5a70-4eed-a398-249863201962': {
    name: 'WhatsApp System Prompt',
    text: 'Sen Başkent Üniversitesi Konya Hastanesi danışmanısın. Samimi, kısa, doğal yaz. Fiyat verme, randevuya yönlendir.',
    version: 1
  },
  '98255b9e-a526-4767-95dd-45877ad5abec': {
    name: 'Social TR Prompt',
    text: "Sen Başkent Üniversitesi Konya Uygulama ve Araştırma Merkezi'nin Türkçe sosyal medya sayfalarının (Instagram/Facebook) hasta danışmanısın. Adın yok, bireysel kimlik kullanmazsın. Kurumu temsil edersin.",
    version: 1
  },
  'e8194c41-dc4b-41fd-a4ab-43ca52b08f02': {
    name: 'Social Foreign Prompt',
    text: 'You are the English/Arabic support agent for Baskent University.',
    version: 1
  }
};

async function rollback() {
  const sql = neon(process.env.DATABASE_URL);

  console.log("╔═══════════════════════════════════════════════════════════╗");
  console.log("║  PHASE 2B STEP 1 — ROLLBACK                             ║");
  console.log("╚═══════════════════════════════════════════════════════════╝\n");

  for (const [id, data] of Object.entries(ROLLBACK_DATA)) {
    const result = await sql`
      UPDATE channel_prompts 
      SET prompt_text = ${data.text},
          version = ${data.version},
          updated_at = NOW()
      WHERE id = ${id}::uuid
      RETURNING id, name, LENGTH(prompt_text) as chars, version
    `;
    const r = result[0];
    console.log(`  ↩️  ${r.name} | chars=${r.chars} | version=${r.version}`);
  }

  console.log("\n  ✅ Rollback complete — placeholder text restored.");
}

rollback().catch(e => {
  console.error("❌ ROLLBACK FAILED:", e.message);
  process.exit(1);
});
