import { PatientKnownFacts } from './conversation-known-facts-resolver';

export class PromptChallengeSafetyPolicy {
  /**
   * Checks if the message content attempts to query system prompts or instructions.
   */
  public static isPromptChallenge(text: string): boolean {
    const clean = (text || '').toLowerCase().trim();
    return ['prompt', 'promt', 'sistem prompt', 'system prompt', 'talimatların', 'sistem talimati', 'sistem talimatı', 'kuralın ne', 'direktifin ne', 'ikna etmen gerekiyor', 'talimatlar'].some(kw => clean.includes(kw));
  }

  /**
   * Checks if the message contains bot/AI accusations.
   */
  public static isBotAccusation(text: string): boolean {
    const clean = (text || '').toLowerCase().trim();
    return ['bot musun', 'sen bot musun', 'are you a bot', 'botsun', 'robot musun', 'yapay zeka', 'yapayzeka', 'gpt', 'gemini', 'openai', 'claude', 'dil modeli', 'hangi model', 'insan mısın', 'insan misin', 'robot'].some(kw => clean.includes(kw));
  }

  /**
   * Generates a safe, polite, non-leaking response to prompt challenges and bot accusations.
   * Never uses the aggressive phrase "Pardon, nereden çıkardınız bunu?".
   */
  public static getChallengeFallbackResponse(
    text: string, 
    facts: PatientKnownFacts, 
    personaName?: string, 
    orgName?: string
  ): string {
    const clean = (text || '').toLowerCase().trim();
    const hasPromptChallenge = this.isPromptChallenge(clean);
    
    const cleanComplaint = facts.complaint ? facts.complaint.trim().toLowerCase() : '';
    const isNeutralOrNoComplaint = 
      cleanComplaint.includes('şikayetim yok') || 
      cleanComplaint.includes('sikayetim yok') ||
      cleanComplaint.includes('şikayetim bulunmuyor') ||
      cleanComplaint.includes('şikayetim bulunmamaktadır') ||
      cleanComplaint === 'yok' ||
      cleanComplaint === 'yoktur' ||
      cleanComplaint.startsWith('şikayetim yok') ||
      cleanComplaint.includes('check-up') ||
      cleanComplaint.includes('checkup');

    const complaint = (!isNeutralOrNoComplaint && facts.complaint) ? facts.complaint.trim() : '';
    const uppercaseComplaint = complaint ? complaint.charAt(0).toUpperCase() + complaint.slice(1) : '';
    
    const wordCount = complaint.split(/\s+/).length;
    const isLongOrComplex = wordCount > 4 || complaint.includes('.') || complaint.includes(',') || complaint.includes(';');

    // For non-healthcare/non-persona generic assistants, return the standard fallback to match regression tests
    if (!personaName && !orgName) {
      if (hasPromptChallenge) {
        return 'Bu teknik konuya girmeden, talebinizle ilgili yardımcı olayım.';
      }
      return 'Talebinizle ilgili yönlendirme yapmak ve yardımcı olmak için buradayım.';
    }

    const orgPhrase = orgName ? ` (${orgName})` : '';

    if (hasPromptChallenge) {
      const targetPhrase = (uppercaseComplaint && !isLongOrComplex)
        ? `${uppercaseComplaint} süreci için de bu şekilde ilerleyebiliriz.` 
        : 'Talebiniz için de bu şekilde ilerleyebiliriz.';
      
      let suffix = "'den ";
      if (orgName && (orgName.endsWith('Hastanesi') || orgName.endsWith('hastanesi') || orgName.endsWith('Kurumu') || orgName.endsWith('kurumu'))) {
        suffix = "'nden ";
      }
      const identityPrefix = personaName 
        ? `Ben ${personaName}, ${orgName ? orgName + suffix : ""}size yardımcı olmaya çalışıyorum. İşleyişle ilgili kurum içi detayları pek paylaşamıyorum; ancak `
        : 'İşleyişle ilgili kurum içi detayları pek paylaşamıyorum; ancak ';

      return `${identityPrefix}şikayetinizi anlamak, sizi doğru bölüme yönlendirmek, randevu ve danışmanlık sürecini açıklamak için çalışıyorum. ${targetPhrase}`;
    }

    // Bot/AI accusation fallback
    const targetQueryPhrase = (uppercaseComplaint && !isLongOrComplex)
      ? ` ${uppercaseComplaint} hakkında bilgi almak isterseniz detayları iletebilir misiniz?`
      : ' Hangi konuda bilgi almak istediğinizi iletebilirsiniz.';
      
    if (personaName) {
      let suffix = "'den ";
      if (orgName && (orgName.endsWith('Hastanesi') || orgName.endsWith('hastanesi') || orgName.endsWith('Kurumu') || orgName.endsWith('kurumu'))) {
        suffix = "'nden ";
      }
      const orgStr = orgName ? `${orgName}${suffix}` : '';
      return `Ben ${personaName}, ${orgStr}size yardımcı olmaya çalışıyorum. Şikayetinizi anlamak, doğru bölüme yönlendirmek ve randevu sürecini netleştirmek için buradayım.${targetQueryPhrase}`;
    }

    return `Merhaba, sizlere WhatsApp üzerinden süreçlerle ilgili yardımcı olan iletişim sorumlusuyum${orgPhrase}. Şikayetinizi anlamak, doğru bölüme yönlendirmek ve randevu sürecini netleştirmek için buradayım.${targetQueryPhrase}`;
  }
}
