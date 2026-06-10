import * as dotenv from 'dotenv';
import { neon } from '@neondatabase/serverless';

dotenv.config({ path: '.env.local' });

async function runDryRun() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error("DATABASE_URL is missing in env");
    return;
  }

  const sql = neon(dbUrl);
  try {
    console.log("=== STARTING KANTİNA DRY-RUN AUDIT ===");

    // Fetch candidate leads from the wrong sync run (created since 11 Haz 00:00 Turkish time / 2026-06-10 21:00 UTC)
    // with campaign = "Bilinmeyen Kampanya"
    const candidates = await sql`
      SELECT 
        l.id, 
        l.tenant_id, 
        l.phone_number,
        l.form_name,
        l.created_at,
        l.raw_data,
        l.notes,
        l.stage
      FROM leads l
      WHERE l.tenant_id = 'caab9ea1-9591-45e4-bbc5-9c9b498982c8'
        AND l.created_at >= '2026-06-10 21:00:00+00'
        AND l.form_name = 'Bilinmeyen Kampanya';
    `;

    console.log(`Total candidate leads found: ${candidates.length}`);

    let allowedTabsCount = 0;
    let disallowedTabsCount = 0;
    let unknownCampaignCount = 0;
    let outboundCount = 0;
    let conversationCount = 0;
    let manualNoteCount = 0;
    let safeToQuarantine = 0;
    let unsafeToQuarantine = 0;

    const allowedTabs = [
      "TR-ORTADOĞU-ORTAPEDİ-BF 2026 FORM",
      "TR-ORTADOĞU-KARDİYOLOJİ 2026 (v2)",
      "Gurbetçiler Form Randevu",
      "Gurbetçiler Form Randevu-Kardiyoloji (2)"
    ];

    const unsafeReasons: string[] = [];

    for (const lead of candidates) {
      let rawObj: any = {};
      let tabName = 'unknown';
      try {
        rawObj = typeof lead.raw_data === 'string' ? JSON.parse(lead.raw_data) : (lead.raw_data || {});
        tabName = rawObj._sheet_name || rawObj.sheet_name || 'unknown';
      } catch (err) {}

      // 1. Allowed / Disallowed check
      if (allowedTabs.includes(tabName)) {
        allowedTabsCount++;
      } else {
        disallowedTabsCount++;
      }

      // 2. Unknown campaign check
      if (lead.form_name === 'Bilinmeyen Kampanya' || !lead.form_name) {
        unknownCampaignCount++;
      }

      // 3. Check for outbound messages or conversations
      // We look up if there is any conversation linked by phone or customer_id
      const convs = await sql`
        SELECT c.id, 
               (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id AND m.direction = 'out') as outbound_msg_count,
               (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) as total_msg_count
        FROM conversations c
        WHERE c.tenant_id = ${lead.tenant_id}
          AND (c.customer_id = ${lead.customer_id} OR c.phone_number = ${lead.phone_number});
      `;

      let hasOutbound = false;
      let hasConversation = false;

      if (convs.length > 0) {
        hasConversation = true;
        for (const c of convs) {
          if (parseInt(c.outbound_msg_count) > 0) {
            hasOutbound = true;
          }
        }
      }

      if (hasOutbound) outboundCount++;
      if (hasConversation) conversationCount++;

      // 4. Check for manual notes or user actions
      // (e.g. if the note is different from raw notes or modified, or if notes column is filled manually)
      let hasManualAction = false;
      if (lead.notes && lead.notes.trim() !== '') {
        // If note was imported from sheets, it matches raw_data notes, otherwise it's manual
        const rawNote = rawObj.notes || rawObj.Notlar || rawObj.not || '';
        if (lead.notes.trim() !== rawNote.trim()) {
          hasManualAction = true;
          manualNoteCount++;
        }
      }

      // 5. Verification of safety
      const isSafe = !hasOutbound && !hasManualAction; // Safe if no outbound messages sent and no manual notes added
      if (isSafe) {
        safeToQuarantine++;
      } else {
        unsafeToQuarantine++;
        unsafeReasons.push(`Lead ${lead.id.substring(0, 8)}... - HasOutbound: ${hasOutbound}, HasManualNote: ${hasManualAction}`);
      }
    }

    console.log(`\n=== DRY-RUN AUDIT REPORT ===`);
    console.log(`1. Son hatalı sync ile gelen aday kayıt sayısı: ${candidates.length}`);
    console.log(`2. AllowedTabs dışından gelen aday sayısı: ${disallowedTabsCount}`);
    console.log(`3. Bilinmeyen Kampanya aday sayısı: ${unknownCampaignCount}`);
    console.log(`4. Outbound görmüş aday sayısı: ${outboundCount}`);
    console.log(`5. Conversation/message bulunan aday sayısı: ${conversationCount}`);
    console.log(`6. Manual note/user action bulunan aday sayısı: ${manualNoteCount}`);
    console.log(`7. Karantinaya alınabilir güvenli aday sayısı: ${safeToQuarantine}`);
    console.log(`8. Karantinaya alınmaması gereken aday sayısı: ${unsafeToQuarantine}`);

    if (unsafeReasons.length > 0) {
      console.log(`\nUnsafe leads details:`, unsafeReasons);
    } else {
      console.log(`\nAll candidates are safe to quarantine!`);
    }

  } catch (err) {
    console.error("Dry-run audit query failed:", err);
  }
}

runDryRun();
