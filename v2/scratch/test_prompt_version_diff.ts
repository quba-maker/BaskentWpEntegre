import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.join(__dirname, '../.env.local') });

async function main() {
  const tenantId = 'caab9ea1-9591-45e4-bbc5-9c9b498982c8';
  console.log("=== STARTING PROMPT VERSION DIFF ===");
  console.log(`Tenant ID: ${tenantId}`);

  // Dynamic import to ensure process.env is populated first
  const { withTenantDB } = await import('../src/lib/core/tenant-db');

  const db = withTenantDB(tenantId, true);

  // Fetch active prompt
  const activeRows = await db.executeSafe({
    text: "SELECT prompt_text, name, version FROM channel_prompts WHERE tenant_id = $1 AND name = 'WhatsApp System Prompt' AND is_active = true",
    values: [tenantId]
  }) as any[];

  if (activeRows.length === 0) {
    console.error("No active WhatsApp system prompt found in channel_prompts!");
    return;
  }
  const activePrompt = activeRows[0].prompt_text || '';
  const activeLen = activePrompt.length;
  console.log(`Active Prompt Name: ${activeRows[0].name} (v${activeRows[0].version}), Length: ${activeLen} chars`);

  // Fetch version 25 backup prompt
  const backupRows = await db.executeSafe({
    text: "SELECT system_prompt, version_number, change_summary FROM brain_versions WHERE tenant_id = $1 AND version_number = 25",
    values: [tenantId]
  }) as any[];

  if (backupRows.length === 0) {
    console.error("No version 25 backup prompt found in brain_versions!");
    return;
  }
  const backupPrompt = backupRows[0].system_prompt || '';
  const backupLen = backupPrompt.length;
  console.log(`Backup Prompt: Version ${backupRows[0].version_number} (${backupRows[0].change_summary}), Length: ${backupLen} chars`);

  // Check section occurrences
  const sectionsToCheck = [
    { name: "Identity/Persona", keywords: ["Sen Başkent Üniversitesi", "Rüya'sın", "Adın yok"] },
    { name: "Instructions/Görev", keywords: ["GÖREVİN:", "randevuya yönlendir"] },
    { name: "Hospital Facts", keywords: ["HASTANE BİLGİLERİ:", "Prof. Dr. Mehmet Haberal", "Saracoğlu", "Hocacihan Mahallesi"] },
    { name: "İstanbul Hastanesi Kuralı", keywords: ["İSTANBUL HASTANESİ KURALI", "İstanbul'da hastanemiz yok"] },
    { name: "Haberal Organ Nakli Detayları", keywords: ["Böbrek ve karaciğer nakillerinde", "Medawar Ödülü", "1975:", "1978:", "1988:"] },
    { name: "İkna Teknikleri", keywords: ["İKNA TEKNİKLERİ", "EMPATİ:", "SOSYAL KANIT:", "ACİLİYET (FOMO):", "MİKRO-EVET TEKNİĞİ"] },
    { name: "İtiraz Yönetimi", keywords: ["İTİRAZ YÖNETİMİ:", "\"Pahalı\":", "\"Düşüneyim\":", "\"Uzak/Konya uzak\":"] },
    { name: "Konuşma Akışı / Funnel", keywords: ["KONUŞMA AKIŞI", "Friction Discovery", "Clinical Discovery", "Solution Mapping", "Time Confirm"] },
    { name: "Rapor/Belge Yasağı", keywords: ["RAPOR VARSAYIMI VE BELGE YÖNETİMİ YASAĞI", "Tetkikleriniz var mı?"] },
    { name: "Form Lead Karşılama Mantığı", keywords: ["FORM LEAD / İLK KARŞILAMA", "FORMDAN GELEN HASTAYA CEVAP MANTIĞI"] },
    { name: "Branşa Göre Uyarlama", keywords: ["BRANŞA GÖRE UYARLAMA KURALI", "ortopedik/omurga", "Check-up", "Onkoloji"] },
    { name: "Few-shot Örnekler", keywords: ["FEW-SHOT ÖRNEKLER", "ÖRNEK 1", "ÖRNEK 2", "ÖRNEK 3", "ÖRNEK 4"] },
    { name: "Kararsız Hasta Eskalasyonu", keywords: ["KARARSIZ HASTA ESKALASYONu", "Erken Eskalasyon Tetikleyicileri"] },
    { name: "Doktor Görüşmesi Yasağı", keywords: ["DOKTOR GÖRÜŞMESİ YASAĞI", "Doktor randevusu veya görüşmesi sözü veremezsin"] },
    { name: "Süre/Gün Yasağı", keywords: ["SÜRE/GÜN YASAĞI", "3-5 gün", "1 hafta"] },
    { name: "Yasaklı Boilerplate", keywords: ["ENGELLENEN BOILERPLATE", "Nasıl yardımcı olabilirim", "Sorunuzu anladım"] }
  ];

  console.log("\n=== SECTION CONGRUENCE AUDIT ===");
  console.log(
    "| Section Name | In Backup (24.7k) | In Active (4.2k) | Status |"
  );
  console.log(
    "|--------------|-------------------|------------------|--------|"
  );

  for (const s of sectionsToCheck) {
    const inBackup = s.keywords.every(kw => backupPrompt.includes(kw));
    const inActive = s.keywords.every(kw => activePrompt.includes(kw));
    const inActiveSome = s.keywords.some(kw => activePrompt.includes(kw));

    let status = '❌ MISSING';
    if (inActive) {
      status = '✅ PRESENT';
    } else if (inActiveSome) {
      status = '⚠️ PARTIAL';
    }

    console.log(
      `| ${s.name} | ${inBackup ? 'Yes' : 'No'} | ${inActive ? 'Yes' : (inActiveSome ? 'Partial' : 'No')} | ${status} |`
    );
  }

  console.log("\n=== COMPACT DIFF SUMMARY ===");
  console.log(`- Backup prompt character size is ${backupLen} characters.`);
  console.log(`- Active prompt character size is ${activeLen} characters.`);
  console.log(`- Reduction in base prompt content: ${backupLen - activeLen} characters (${Math.round((backupLen - activeLen)/backupLen * 100)}% smaller).`);
}

main().catch(err => {
  console.error("Error running version diff:", err);
});
