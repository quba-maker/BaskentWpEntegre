export interface LanguageContext {
  detected_patient_language: string;
  reply_language: string;
  language_confidence: 'high' | 'low' | 'unknown';
  language_detection_source: 'latest_patient_message' | 'form_intro_text' | 'conversation_history' | 'unknown';
}

export function detectLanguage(
  content: string,
  history: { role: 'user' | 'assistant' | 'system'; content: string }[] = []
): LanguageContext {
  const cleanInput = (content || '').trim();
  
  // 1. Clean form fields to extract the introductory sentence/greeting
  let targetText = cleanInput;
  
  // Find first colon-delimited field like "full_name:" or "şikayetiniz_nedir:"
  // Must avoid matching colons inside normal sentences (e.g. "Şikayetim şu: bel ağrısı").
  // So we look for typical form field structures: word/phrase at start of line followed by colon.
  const lines = cleanInput.split('\n').map(l => l.trim()).filter(Boolean);
  
  const formFieldRegex = /^(?:[a-zA-Z0-9_şğüöışçüâîûŞĞÜÖIŞÇÜÂÎÛ\s-]+)\s*:/;
  let firstFieldLineIndex = -1;
  for (let i = 0; i < lines.length; i++) {
    if (formFieldRegex.test(lines[i])) {
      firstFieldLineIndex = i;
      break;
    }
  }

  if (firstFieldLineIndex > 0) {
    // There is text before the first form field
    targetText = lines.slice(0, firstFieldLineIndex).join(' ').trim();
  } else if (firstFieldLineIndex === 0) {
    // Form starts immediately. Try to find any lines that are NOT form fields.
    const nonFieldLines = lines.filter(l => !formFieldRegex.test(l));
    if (nonFieldLines.length > 0) {
      targetText = nonFieldLines.join(' ').trim();
    } else {
      // Fallback: strip fields completely to analyze values only
      targetText = lines.map(l => {
        const parts = l.split(':');
        return parts.slice(1).join(':').trim();
      }).filter(Boolean).join(' ').trim();
    }
  } else {
    // No fields detected, use first line as primary signal
    if (lines.length > 0) {
      targetText = lines[0];
    }
  }

  if (!targetText) {
    targetText = cleanInput;
  }

  // 2. Score language matches on the cleaned text
  const scoreText = (text: string) => {
    const txt = text.toLowerCase();
    let scores = { tr: 0, de: 0, en: 0, ar: 0 };
    
    // ARABIC
    const arabicRegex = /[\u0600-\u06FF]/;
    const arabicCharCount = (txt.match(/[\u0600-\u06FF]/g) || []).length;
    if (arabicCharCount > 3) {
      scores.ar += arabicCharCount * 2;
    }

    // TURKISH
    // Turkish-only characters (excluding ö, ü as they overlap with German)
    const trCharCount = (txt.match(/[ışğçIŞĞÇ]/g) || []).length;
    scores.tr += trCharCount * 3;
    
    const trWords = [
      'merhaba', 'selam', 'formu', 'doldurdum', 'fıtık', 'boyun', 'ağrı', 'bel',
      'hastalık', 'randevu', 'doktor', 'muayene', 'bilgi', 'ücret', 'fiyat',
      'tedavi', 'ameliyat', 'türkçe', 'evet', 'hayır', 'lütfen', 'teşekkür',
      'yazabilir', 'misiniz', 'günler'
    ];
    const trParticles = ['ve', 'bir', 'bu', 'için', 'gibi', 'kadar', 'ile', 'veya', 'ama', 'var', 'yok', 'mu', 'mi'];

    // GERMAN
    // German-only character
    const deCharCount = (txt.match(/[ß]/g) || []).length;
    scores.de += deCharCount * 3;
    
    const deWords = [
      'hallo', 'guten', 'tag', 'formular', 'ausgefüllt', 'schmerz', 'arzt',
      'termin', 'bitte', 'danke', 'hilfe', 'kontakt', 'deutsch', 'ja', 'nein',
      'ich', 'habe', 'dein', 'mein', 'wirklich', 'schmerzen', 'rücken', 'knee',
      'und', 'das', 'ist', 'sie', 'es', 'zu', 'für', 'mit', 'von', 'auf', 'an',
      'bei', 'nach', 'aus', 'um', 'über', 'vor', 'unter', 'wir', 'uns', 'ihr',
      'schreiben'
    ];
    
    // ENGLISH
    const enWords = [
      'hello', 'hi', 'filled', 'form', 'pain', 'knee', 'back', 'doctor',
      'appointment', 'please', 'thank', 'thanks', 'yes', 'no', 'help', 'english',
      'would', 'could', 'should', 'spine', 'hip', 'treatment', 'and', 'the',
      'is', 'it', 'to', 'for', 'with', 'of', 'in', 'on', 'at', 'by', 'from',
      'about', 'have', 'has', 'had', 'continue', 'write'
    ];

    const countWordMatches = (words: string[], weight: number) => {
      let score = 0;
      for (const w of words) {
        const regex = new RegExp(`\\b${w}\\b`, 'i');
        if (regex.test(txt)) {
          score += weight;
        }
      }
      return score;
    };

    scores.tr += countWordMatches(trWords, 5) + countWordMatches(trParticles, 2);
    scores.de += countWordMatches(deWords, 5);
    scores.en += countWordMatches(enWords, 5);

    return scores;
  };

  // 3. Evaluate results
  const scores = scoreText(targetText);
  let bestLang = 'tr';
  let maxScore = 0;
  
  for (const [lang, score] of Object.entries(scores)) {
    if (score > maxScore) {
      maxScore = score;
      bestLang = lang;
    }
  }

  let confidence: 'high' | 'low' | 'unknown' = 'low';
  let source: 'latest_patient_message' | 'form_intro_text' | 'conversation_history' | 'unknown' = 'unknown';

  if (maxScore >= 3) {
    confidence = 'high';
    source = cleanInput.includes(':') ? 'form_intro_text' : 'latest_patient_message';
  } else {
    // 4. Fallback: Search conversation history for latest high-confidence patient language
    let foundInHistory = false;
    for (let i = history.length - 1; i >= 0; i--) {
      const msg = history[i];
      if (msg.role === 'user') {
        const histScores = scoreText(msg.content);
        let histBest = 'tr';
        let histMax = 0;
        for (const [lang, score] of Object.entries(histScores)) {
          if (score > histMax) {
            histMax = score;
            histBest = lang;
          }
        }
        if (histMax >= 3) {
          bestLang = histBest;
          confidence = 'high';
          source = 'conversation_history';
          foundInHistory = true;
          break;
        }
      }
    }

    if (!foundInHistory) {
      // 5. Final fallback: check the entire text without stripping fields
      const fallbackScores = scoreText(cleanInput);
      let fallbackBest = 'tr';
      let fallbackMax = 0;
      for (const [lang, score] of Object.entries(fallbackScores)) {
        if (score > fallbackMax) {
          fallbackMax = score;
          fallbackBest = lang;
        }
      }
      if (fallbackMax >= 3) {
        bestLang = fallbackBest;
        confidence = 'high';
        source = 'latest_patient_message';
      } else {
        // If it's a short/ambiguous greeting or keyword (like "Ok", "Hi", "👍"), 
        // we fallback to 'tr' but keep confidence as unknown.
        bestLang = 'tr';
        confidence = 'unknown';
        source = 'unknown';
      }
    }
  }

  // 6. Map language codes to Turkish names for system prompt injection
  const langNames: Record<string, string> = {
    tr: 'Türkçe',
    de: 'Almanca',
    en: 'İngilizce',
    ar: 'Arapça'
  };

  return {
    detected_patient_language: langNames[bestLang] || 'Türkçe',
    reply_language: langNames[bestLang] || 'Türkçe',
    language_confidence: confidence,
    language_detection_source: source
  };
}
