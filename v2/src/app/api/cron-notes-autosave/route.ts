import { NextResponse } from "next/server";
import { sql } from "@/lib/db";

// ========================================================
// QUBA AI — 24 Saatlik Otonom CRM Not Otomatik Kaydetme Cron Job
// Vercel Cron: Saatlik çalışır
// vercel.json → { "path": "/api/cron-notes-autosave", "schedule": "0 * * * *" }
// ========================================================

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  // Vercel cron güvenliği
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    if (process.env.CRON_SECRET) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  try {
    // 1. 24 saat inaktif, not alanı boş olan ve AI özeti bulunan görüşmeleri tespit et
    const targetConversations = await sql`
      SELECT 
        c.id as conversation_id, 
        c.phone_number, 
        c.tenant_id, 
        mem.summary_text as ai_summary
      FROM conversations c
      INNER JOIN conversation_memory mem ON mem.conversation_id::text = c.id::text
      WHERE (c.notes IS NULL OR TRIM(c.notes) = '')
        AND mem.summary_text IS NOT NULL AND TRIM(mem.summary_text) != ''
        AND c.last_message_at < NOW() - INTERVAL '24 hours'
    `;

    const records = Array.isArray(targetConversations) ? targetConversations : [];
    
    if (records.length === 0) {
      return NextResponse.json({
        success: true,
        message: "Otomatik kaydedilecek 24 saatlik inaktif görüşme bulunamadı.",
        processedCount: 0,
        timestamp: new Date().toISOString()
      });
    }

    let processedCount = 0;
    const SHEET_URL = process.env.GOOGLE_SHEET_UPDATE_URL || process.env.GOOGLE_SHEET_URL;

    // 2. Her bir kayıt için veritabanlarını güncelle ve Google Sheets'e push gönder
    for (const row of records) {
      const { conversation_id, phone_number, tenant_id, ai_summary } = row;
      if (!ai_summary || !phone_number) continue;

      // a. conversations tablosundaki notes alanını güncelle
      await sql`
        UPDATE conversations 
        SET notes = ${ai_summary} 
        WHERE id = ${conversation_id}
      `;

      // b. Son 10 haneli telefon numarası eşleşmesiyle leads tablosunu güncelle (lead'in notu boşsa)
      const phoneSuffix = String(phone_number).slice(-10);
      await sql`
        UPDATE leads
        SET notes = ${ai_summary}
        WHERE (phone_number = ${phone_number} OR phone_number LIKE ${'%' + phoneSuffix})
          AND tenant_id = ${tenant_id}
          AND (notes IS NULL OR TRIM(notes) = '')
      `;

      // c. Google Sheets senkronizasyonunu gerçekleştir
      if (SHEET_URL) {
        try {
          await fetch(SHEET_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'updateNoteByPhone',
              phone: phone_number,
              note: ai_summary
            })
          });
        } catch (sheetErr) {
          console.error(`[Cron Autosave] Google Sheets sync failed for ${phone_number}:`, sheetErr);
        }
      }

      processedCount++;
    }

    return NextResponse.json({
      success: true,
      message: `Başarıyla ${processedCount} adet inaktif görüşme AI özeti otonom olarak kaydedildi ve Sheets'e senkronize edildi.`,
      processedCount,
      timestamp: new Date().toISOString()
    });

  } catch (err: any) {
    console.error("[Cron Autosave Error]:", err);
    return NextResponse.json({
      success: false,
      error: err.message || "Bilinmeyen bir hata oluştu."
    }, { status: 500 });
  }
}
