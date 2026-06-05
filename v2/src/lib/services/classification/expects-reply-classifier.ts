export interface ClassificationResult {
  expectsReply: boolean;
  confidence: 'high' | 'medium' | 'low';
  reason: string;
  category: 'appointment_time' | 'document_request' | 'country_confirmation' | 'call_time' | 'medical_question' | 'final_closing' | 'unknown';
  isClosingMessage: boolean;
}

export class ExpectsReplyClassifier {
  private static cache = new Map<string, ClassificationResult>();

  /**
   * Classify an outbound message to check if it expects a reply from the patient.
   * Utilizes in-memory caching to prevent duplicate string matching operations.
   */
  static classify(text: string): ClassificationResult {
    const rawText = text || '';
    if (this.cache.has(rawText)) {
      return this.cache.get(rawText)!;
    }

    const result = this.performClassification(rawText);
    this.cache.set(rawText, result);
    return result;
  }

  private static performClassification(text: string): ClassificationResult {
    const clean = text.toLowerCase().trim();
    if (!clean) {
      return {
        expectsReply: false,
        confidence: 'high',
        reason: 'Empty message',
        category: 'unknown',
        isClosingMessage: false
      };
    }

    // 1. Blacklist / Closing keywords
    const closingKeywords = [
      "teşekkür ederiz", "teşekkürler", "iyi günler", "randevunuz onaylandı", 
      "görüşmeniz tamamlandı", "yine bekleriz", "talebiniz alınmıştır",
      "iyi akşamlar", "geçmiş olsun", "iyi bayramlar", "mutlu günler",
      "başarılar dileriz", "yardımcı olabildiysek ne mutlu", "hoşçakalın", "kendinize iyi bakın",
      "thank you", "thanks", "have a nice day", "good day", "stay safe"
    ];
    for (const kw of closingKeywords) {
      if (clean.includes(kw)) {
        return {
          expectsReply: false,
          confidence: 'high',
          reason: `Matched closing keyword: "${kw}"`,
          category: 'final_closing',
          isClosingMessage: true
        };
      }
    }

    // 2. Whitelist Call Time keywords
    const callTimeKeywords = ["uygun saat", "ne zaman arayalım", "ne zaman görüşelim", "arama saati", "ne zaman müsait", "görüşme saati", "müsait olduğunuz"];
    if (callTimeKeywords.some(kw => clean.includes(kw))) {
      return {
        expectsReply: true,
        confidence: 'high',
        reason: 'Matched call_time context keyword',
        category: 'call_time',
        isClosingMessage: false
      };
    }

    // 3. Whitelist Country keywords
    const countryKeywords = ["nereden", "nerede yaşıyorsunuz", "hangi ülkede", "nerede ikamet", "yaşadığınız yer"];
    if (countryKeywords.some(kw => clean.includes(kw))) {
      return {
        expectsReply: true,
        confidence: 'high',
        reason: 'Matched country_confirmation context keyword',
        category: 'country_confirmation',
        isClosingMessage: false
      };
    }

    // 4. Whitelist Appointment keywords
    const apptKeywords = ["teyit", "gelmeyi düşünüyor musunuz", "randevu saati", "randevu tarihi", "geliyor musunuz", "gelecek misiniz", "katılım durumunuz"];
    if (apptKeywords.some(kw => clean.includes(kw))) {
      return {
        expectsReply: true,
        confidence: 'high',
        reason: 'Matched appointment_time context keyword',
        category: 'appointment_time',
        isClosingMessage: false
      };
    }

    // Specific contextual medical questions (NO generic 'ağrı', 'tedavi', etc. alone)
    const medicalQuestionKeywords = [
      "şikayetiniz nedir", "rahatsızlığınız nedir", "ağrınız ne", "ağrınız var mı", 
      "tedavi için ne zaman", "ameliyat için ne zaman", "hastalık geçmişiniz nedir",
      "hastalık geçmişinizi paylaşır"
    ];
    if (medicalQuestionKeywords.some(kw => clean.includes(kw))) {
      return {
        expectsReply: true,
        confidence: 'high',
        reason: 'Matched medical_question context keyword',
        category: 'medical_question',
        isClosingMessage: false
      };
    }

    // 6. Contextual Document Request (Exclude attachments or simple sentences)
    // Matches if a request verb is combined with a document keyword
    const requestVerbs = ["paylaşır mısınız", "gönderebilir misiniz", "iletebilir misiniz", "var mı", "yollar mısınız", "gönderir misiniz"];
    const docKeywords = ["rapor", "röntgen", "mr", "film", "tetkik", "sonuç", "belge", "fotoğraf"];
    
    let isDocRequest = false;
    for (const verb of requestVerbs) {
      if (clean.includes(verb)) {
        for (const doc of docKeywords) {
          if (clean.includes(doc)) {
            isDocRequest = true;
            break;
          }
        }
      }
      if (isDocRequest) break;
    }

    if (isDocRequest) {
      return {
        expectsReply: true,
        confidence: 'high',
        reason: 'Matched document_request contextual question pattern',
        category: 'document_request',
        isClosingMessage: false
      };
    }

    // Exclude attachment indicators and system outbound documents
    if (clean.startsWith("📎 belge") || clean.includes("belgenizi ilettik") || clean.includes("dosyanız tarafınıza") || clean.includes("teklif dosyamız ektedir")) {
      return {
        expectsReply: false,
        confidence: 'high',
        reason: 'Matched system document send prefix / template',
        category: 'unknown',
        isClosingMessage: false
      };
    }

    // 7. Soru İşareti (?) kontrolü (Kapanış kelimeleri yoksa soru cümlesidir)
    if (clean.includes('?')) {
      return {
        expectsReply: true,
        confidence: 'medium',
        reason: 'Contains question mark "?" and passed final/closing checks',
        category: 'unknown',
        isClosingMessage: false
      };
    }

    // Varsayılan olarak cevap beklenmeyen durum
    return {
      expectsReply: false,
      confidence: 'low',
      reason: 'No keywords or question mark matched, defaults to no-reply expected',
      category: 'unknown',
      isClosingMessage: false
    };
  }

  /**
   * Helper to clear the classification cache if needed.
   */
  static clearCache(): void {
    this.cache.clear();
  }
}
