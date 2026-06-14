/**
 * P0.11: HumanTonePolicy
 * Generates concise (5-8 line) tone directives for the prompt builder.
 * Encapsulates warm tone, empathy, emoji usage, and recovery behaviors
 * that were present in the original "good" prompt version.
 * 
 * Does NOT bloat the prompt — always returns a compact directive block.
 */

export interface HumanTonePolicyInput {
  isHealthcare: boolean;
  isFirstAssistantTurn: boolean;
  angryPatientMode: boolean;
  replyLanguage: string;
  isRepeatDetected: boolean;
}

export class HumanTonePolicy {
  /**
   * Builds a compact (5-8 line) human tone directive for prompt injection.
   * Language-aware: adapts examples and phrasing to reply language.
   */
  public static buildDirective(input: HumanTonePolicyInput): string {
    const { isHealthcare, isFirstAssistantTurn, angryPatientMode, replyLanguage, isRepeatDetected } = input;

    const lines: string[] = [];

    // Core tone & WhatsApp natural style
    if (replyLanguage === 'tr') {
      lines.push('- İnsan gibi doğal konuş, robotik cümleler veya "Kusura bakmayınız" (bunun yerine "Kusura bakmayın/Haklısınız") kullanma.');
      lines.push('- En fazla 2-3 kısa, doğal cümle/paragraf kullan. Uzun, resmi ("olabilirsiniz/bildirebilirsiniz" vb.) açıklamalardan kaçın.');
      lines.push('- Her cevapta "hangi konuda bilgi almak istersiniz?" diye sorma.');
      lines.push('- Kullanıcı bilgi verdiyse önce bilgiyi aldığını kabul et, sonra süreci ilerlet.');
      
      if (isHealthcare) {
        lines.push('- Sağlık konusunda ciddi ve saygılı ol. Uygun yerde "Geçmiş olsun" veya "Anlıyorum" de.');
      } else {
        lines.push('- Sıcak ve profesyonel ol. Empati göster.');
      }
    } else if (replyLanguage === 'en') {
      lines.push('- Speak naturally like a human. Avoid robotic/formulaic language.');
      lines.push('- Max 2-3 short, natural sentences. Acknowledge user input before advancing.');
      if (isHealthcare) {
        lines.push('- Be empathetic and respectful. Use phrases like "I understand" when appropriate.');
      } else {
        lines.push('- Be warm and professional. Show empathy.');
      }
    } else if (replyLanguage === 'de') {
      lines.push('- Natürlich und menschlich kommunizieren. Keine robotischen Formulierungen.');
      lines.push('- Kurze Sätze verwenden.');
      lines.push('- Einfühlsam und professionell sein.');
    } else if (replyLanguage === 'ar') {
      lines.push('- تحدث بشكل طبيعي وإنساني. تجنب العبارات الآلية.');
      lines.push('- اجعل الجمل قصيرة.');
      lines.push('- كن متعاطفاً ومحترفاً.');
    } else {
      lines.push('- Speak naturally like a human. Avoid robotic language.');
      lines.push('- Be warm, empathetic and professional.');
    }

    // Energy matching
    if (replyLanguage === 'tr') {
      lines.push('- Kullanıcının enerjisine uyum sağla: kısa selama kısa, detaylı soruya detaylı cevap.');
    } else {
      lines.push('- Match the user\'s energy: short greeting → short reply, detailed question → detailed answer.');
    }

    // Angry patient recovery
    if (angryPatientMode) {
      if (replyLanguage === 'tr') {
        lines.push('- ⚠️ Kullanıcı memnuniyetsiz/kızgın. Kesinlikle reset selamı (merhaba vb.) atma. Sakin ve toparlayıcı ol. Kısa özür + toparlama yap. Savunmaya geçme.');
      } else {
        lines.push('- ⚠️ User seems frustrated. Do NOT send greetings. Apologize briefly and recover. Don\'t be defensive.');
      }
    }

    // Repeat guard
    if (isRepeatDetected) {
      if (replyLanguage === 'tr') {
        lines.push('- 🔁 SON MESAJLARDA AYNI CEVABI VERDİN. Kesinlikle tekrarlama. Yeni yaklaşımla cevap ver.');
      } else {
        lines.push('- 🔁 YOU REPEATED THE SAME RESPONSE. Do NOT repeat. Give a fresh, different answer.');
      }
    }

    // Emoji guidance
    if (replyLanguage === 'tr') {
      lines.push('- Uygun yerde max 1 emoji kullan (😊🙏). Abartma.');
    } else {
      lines.push('- Use max 1 emoji where appropriate (😊🙏). Don\'t overdo it.');
    }

    return lines.join('\n');
  }
}
