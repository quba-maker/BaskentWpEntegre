export type InboxActionIntent =
  | 'conversation_closed'
  | 'date_pending_followup'
  | 'call_request'
  | 'appointment_request'
  | 'no_action';

export function resolveInboxActionIntent(text: string): InboxActionIntent {
  if (!text) return 'no_action';

  const normalized = text
    .replace(/İ/g, 'i')
    .replace(/I/g, 'ı')
    .toLowerCase()
    .trim();

  // 1. conversation_closed (Thank you and goodbye)
  const closedKeywords = [
    'teşekkür', 'tesekkur', 'teşekkürler', 'tesekkurler', 'sağol', 'sagol', 'sağolasın',
    'görüşmek üzere', 'gorusmek uzere', 'hoşçakal', 'hoscakal', 'hoşçakalın', 'hoscakalin',
    'iyi günler', 'iyi gunler', 'iyi akşamlar', 'iyi aksamlar', 'iyi çalışmalar', 'iyi calismalar'
  ];
  if (closedKeywords.some(kw => normalized.includes(kw))) {
    return 'conversation_closed';
  }

  // 2. date_pending_followup (Postponing, pending date)
  const pendingKeywords = [
    'netleşince', 'netlesince', 'belirleyince', 'belli olunca', 'sonra yazar',
    'şu an belli değil', 'su an belli degil', 'belli değil', 'belli degil',
    'daha sonra dönüş', 'daha sonra donus', 'daha sonra döne', 'daha sonra done',
    'daha sonra yazar', 'netleştiğinde', 'netlestiginde'
  ];
  if (pendingKeywords.some(kw => normalized.includes(kw))) {
    return 'date_pending_followup';
  }

  // 3. call_request (Call requests)
  const callKeywords = [
    'arama', 'telefonla', 'arayın', 'arayin', 'ararsanız', 'ararsaniz',
    'arayabilirsiniz', 'irtibata geç', 'irtibata gec', 'telefon numarası',
    'telefon numarasi', 'tel no', 'arasınlar', 'arasinlar'
  ];
  if (callKeywords.some(kw => normalized.includes(kw))) {
    return 'call_request';
  }

  // 4. appointment_request (Appointment requests)
  const appointmentKeywords = [
    'randevu', 'gelmek istiyorum', 'geleceğim', 'gelecegim', 'muayene',
    'gün alabilir', 'gun alabilir', 'tarih alabilir', 'fiyat', 'ücret', 'ucret'
  ];
  if (appointmentKeywords.some(kw => normalized.includes(kw))) {
    return 'appointment_request';
  }

  return 'no_action';
}
