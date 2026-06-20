export type PendingSlot =
  | 'complaint_duration'
  | 'call_date'
  | 'call_time'
  | 'timezone_clarification'
  | 'confirmation_yes_no'
  | 'transfer_confirmation'
  | 'price_followup'
  | 'complaint_detail'
  | 'arrival_date'
  | 'generic_none';

export class PendingQuestionResolver {
  private static cleanText(str: string): string {
    return str
      .replace(/İ/g, 'i')
      .replace(/I/g, 'ı')
      .replace(/ğ/g, 'g')
      .replace(/ü/g, 'u')
      .replace(/ş/g, 's')
      .replace(/ı/g, 'i')
      .replace(/ö/g, 'o')
      .replace(/ç/g, 'c')
      .toLowerCase()
      .trim();
  }

  /**
   * Identifies what the bot was asking the patient in the last 1-3 assistant messages.
   */
  public static resolve(history: { role: 'user' | 'assistant'; content: string }[]): PendingSlot {
    if (!history || history.length === 0) {
      return 'generic_none';
    }

    // Get assistant messages from history (up to last 3)
    const assistantMessages = history
      .filter((m) => m.role === 'assistant')
      .slice(-3)
      .reverse();

    if (assistantMessages.length === 0) {
      return 'generic_none';
    }

    // We prioritize the most recent assistant message, but can look back up to 3 turns
    for (const msg of assistantMessages) {
      const clean = this.cleanText(msg.content);

      // 1. Complaint Duration
      const durationKeywords = [
        'ne zamandir',
        'ne zamandan',
        'ne kadardir',
        'ne kadar suredir',
        'kac gundur',
        'kac aydir',
        'kac yildir',
        'ne zamandan beri',
        'durum ne zamandir'
      ];
      if (durationKeywords.some(kw => clean.includes(kw))) {
        return 'complaint_duration';
      }

      // 2. Timezone Clarification
      const tzKeywords = [
        'saat dilimi',
        'saat farki',
        'turkiye saat',
        'turkiye saatiyle mi',
        'bize gore mi',
        'konumunuz',
        'hangi ulke',
        'hangi sehir',
        'hangi eyalet',
        'saat hangi'
      ];
      if (tzKeywords.some(kw => clean.includes(kw)) || /saat.*bize.*gore/i.test(clean) || /saat.*turkiye/i.test(clean)) {
        return 'timezone_clarification';
      }

      // 3. Call Time
      const timeKeywords = [
        'saat aralig',
        'saat araligini',
        'uygun saat',
        'hangi saat',
        'saat paylas',
        'saat kac',
        'saat kacta'
      ];
      if (timeKeywords.some(kw => clean.includes(kw)) || /saat.*paylas/i.test(clean) || /uygun.*saat/i.test(clean) || /saat.*belirleyebilir/i.test(clean)) {
        return 'call_time';
      }

      // 4. Call Date
      const dateKeywords = [
        'hangi gun',
        'hangi tarih',
        'ne zaman arayalim',
        'ne zaman arayabiliriz',
        'arama icin gun',
        'gorusme gunu',
        'gun paylas',
        'tarih paylas'
      ];
      if (dateKeywords.some(kw => clean.includes(kw)) || /ne zaman.*arayalim/i.test(clean) || /hangi gun/i.test(clean)) {
        return 'call_date';
      }

      // 5. Transfer Confirmation
      const transferKeywords = [
        'aktaralim mi',
        'baglayalim mi',
        'temsilciye yonlendir',
        'ekibe yonlendir',
        'insan temsilci'
      ];
      if (transferKeywords.some(kw => clean.includes(kw))) {
        return 'transfer_confirmation';
      }

      // 6. Confirmation Yes/No
      const confirmationKeywords = [
        'uygun mu',
        'onayliyor musunuz',
        'dogru mu',
        'ister misiniz',
        'belirleyebilir miyiz',
        'degistirelim mi',
        'aransin mi',
        'goruselim mi'
      ];
      if (confirmationKeywords.some(kw => clean.includes(kw))) {
        return 'confirmation_yes_no';
      }

      // 7. Price Follow-up
      const priceKeywords = [
        'fiyat',
        'ucret',
        'tutar',
        'butce',
        'odeme'
      ];
      if (priceKeywords.some(kw => clean.includes(kw)) && (clean.includes('?') || clean.includes('mi') || clean.includes('mu'))) {
        return 'price_followup';
      }

      // 8. Complaint Detail
      const detailKeywords = [
        'sikayetiniz',
        'rahatsizliginiz',
        'belirtiler',
        'detayli bilgi verebilir misiniz',
        'sorun nedir'
      ];
      if (detailKeywords.some(kw => clean.includes(kw))) {
        return 'complaint_detail';
      }

      // 9. Arrival/Travel Date
      const arrivalDateKeywords = [
        'gelmeyi dusun',
        'gelmeyi planla',
        'ne zaman gel',
        'ziyaret tarihi',
        'tarih araligi',
        'tahmini tarih',
        'tahmini ziyaret',
        'ne zaman gelebilir',
        'ne zaman geleceksiniz',
        'ne zaman gelmeyi dusun',
        'ne zaman gelmeyi planliyor'
      ];
      if (arrivalDateKeywords.some(kw => clean.includes(kw)) || /gelmeyi.*dusun/i.test(clean) || /tahmini.*tarih/i.test(clean)) {
        return 'arrival_date';
      }
    }

    return 'generic_none';
  }
}
