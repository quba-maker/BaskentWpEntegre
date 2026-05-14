import { logger } from "@/lib/core/logger";

export interface PolicyEvaluation {
  isApproved: boolean;
  filteredResponse: string;
  rejectionReason?: string;
  needsHandover?: boolean;
}

/**
 * 🛡️ Response Policy Engine
 * LLM'den dönen response'u inceler ve Workflow kurallarına uygunluğunu denetler.
 * AI'nin son authority olmasını engeller.
 */
export class ResponsePolicyEngine {
  private log = logger.withContext({ module: 'ResponsePolicyEngine' });
  private bannedPhrases = [
    'kesinlikle iyileşirsiniz', 
    'garanti veriyoruz', 
    '%100 sonuç', 
    'asla yan etkisi yoktur'
  ];

  public evaluate(llmResponse: string, language: string): PolicyEvaluation {
    let text = llmResponse;
    const lowerText = text.toLowerCase();

    // 1. Yasaklı İfade Kontrolü (Medical Disclaimer Safety)
    for (const phrase of this.bannedPhrases) {
      if (lowerText.includes(phrase)) {
        this.log.warn(`🚨 Policy Violation: AI used banned phrase: [${phrase}]`);
        return {
          isApproved: false,
          filteredResponse: "Size bu konuda daha sağlıklı bilgi verebilmek için medikal danışmanımızın sizinle iletişime geçmesini sağlayacağım.",
          rejectionReason: 'Banned Phrase Detected',
          needsHandover: true
        };
      }
    }

    // 2. Halüsinasyon Sınır Kontrolü (Too long = likely hallucinating)
    if (text.length > 1500) {
      this.log.warn(`⚠️ Length Violation: AI response too long (${text.length} chars). Truncating.`);
      text = text.substring(0, 1500) + "... \n[Sistem Notu: Kalan kısım kısaltıldı. Detaylar için uzmanımızla görüşebilirsiniz.]";
    }

    // 3. Multilingual Policy (Basit kontrol: Eğer TR sorulmadıysa ve AI TR ürettiyse)
    if (language !== 'Turkish' && text.includes('Teşekkürler')) {
      this.log.warn(`⚠️ Language Violation: AI might be responding in Turkish despite ${language} instruction.`);
      // Strict fallback could be applied here
    }

    return {
      isApproved: true,
      filteredResponse: text
    };
  }
}
