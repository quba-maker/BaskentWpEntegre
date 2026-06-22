/**
 * 🚫 Deterministic Intent Detector (P1A-FIX5)
 * 
 * Post-LLM safety net: scans raw message text for explicit
 * cancellation, data deletion, reset, opt-out, and new identity signals.
 * Overrides CRM extraction if LLM missed clear customer intent.
 * 
 * Pure function — no DB, no env dependencies.
 */

export interface IntentDetection {
  // Cancellation / opt-out
  explicit_cancellation: boolean;
  opt_out_requested: boolean;
  should_stop_follow_up: boolean;
  // Data deletion / privacy (KVKK/GDPR)
  data_deletion_request: boolean;
  privacy_request_pending: boolean;
  // Conversation reset
  reset_conversation_requested: boolean;
  // New identity / treatment interest
  new_identity_detected: boolean;
  new_treatment_interest: boolean;
  // Detected name (if new identity pattern matched)
  detected_name: string | null;
  // Matched phrases for audit
  matched_phrases: string[];
}

// Legacy compat export
export type CancellationDetection = IntentDetection;

// ══════════════════════════════════════════════
// CANCELLATION PHRASE PATTERNS
// ══════════════════════════════════════════════

const CANCELLATION_PHRASES: RegExp[] = [
  // Turkish — core cancellation
  /gel[e]?meyece[gğ]/i,           // gelmeyeceğim, gelemeyeceğim
  /vazge[cç]ti[mk]/i,             // vazgeçtim, vazgeçtik
  /vazge[cç]iyorum/i,             // vazgeçiyorum
  /iptal\s*(et|edin|edelim|ediyorum|istiyorum)/i,  // iptal et, iptal edin
  /randevuyu?\s*(iptal|iptale)/i,  // randevuyu iptal
  /istemiyorum/i,                  // istemiyorum
  /ilgilenmiyorum/i,               // ilgilenmiyorum
  /art[iı]k\s+gerek\s+yok/i,      // artık gerek yok
  /g[oö]r[uü][sş]mek\s+istemiyorum/i, // görüşmek istemiyorum
  /gelme[ky]\s*(istemiyorum|niyetim\s+yok)/i, // gelmek istemiyorum
  /ba[sş]ka\s+hastane(?:ye|de|den)?\s+(?:gittim|gidece[gğ]im|gitmeye\s+karar|tercih\s+ettim)/i, // kesin başka hastane tercihi
  /ba[sş]ka\s+yere?\s+gi[dt]/i,    // başka yere gitti
  /gelmiyorum/i,                   // gelmiyorum
  /gelmeyece[gğ]iz/i,             // gelmeyeceğiz  
  /gele?miyorum/i,                 // gelemiyorum
  // English
  /i\s+won'?t\s+come/i,
  /cancel\s+(my\s+)?appointment/i,
  /i\s+don'?t\s+want/i,
  /not\s+interested/i,
  /no\s+longer\s+interested/i,
  /i('?m|\s+am)\s+not\s+coming/i,
  /changed?\s+my\s+mind/i,
  /i'?m?\s+cancell?ing/i,
  // Arabic
  /لا أريد/,
  /ألغي/,
  /لن أحضر/,
  /لا تتصلوا/,
  // German
  /ich\s+komme\s+nicht/i,
  /ich\s+m[oö]chte\s+nicht/i,
  /termin\s+absagen/i,
  /stornieren/i,
  /kein\s+interesse/i,
];

const OPT_OUT_PHRASES: RegExp[] = [
  // Turkish
  /aramay[iı]n/i,
  /beni\s+aramay[iı]n/i,
  /beni\s+bir\s+daha\s+arama/i,
  /rahats[iı]z\s+etmeyin/i,
  /mesaj\s+atmay[iı]n/i,
  /yazmay[iı]n/i,
  /ileti[sş]im\s+kurmay[iı]n/i,
  // English
  /don'?t\s+call\s+me/i,
  /stop\s+calling/i,
  /stop\s+messaging/i,
  /leave\s+me\s+alone/i,
  /unsubscribe/i,
  // Arabic
  /لا تتصل/,
  /لا ترسل/,
  // German
  /rufen?\s+sie\s+mich\s+nicht\s+an/i,
  /hören?\s+sie\s+auf/i,
];

// ══════════════════════════════════════════════
// DATA DELETION / PRIVACY PATTERNS (KVKK/GDPR)
// ══════════════════════════════════════════════

const DATA_DELETION_PHRASES: RegExp[] = [
  // Turkish
  /bilgilerimi\s+sil/i,
  /beni\s+unut/i,
  /verilerimi\s+sil/i,
  /kayd[iı]m[iı]\s+sil/i,
  /ki[sş]isel\s+verileri?m/i,
  /veri\s+silme/i,
  /hesab[iı]m[iı]\s+sil/i,
  /silip\s+at/i,
  /beni\s+sistemden\s+sil/i,
  /kay[iı]t\s+silme/i,
  /kvkk/i,
  /gdpr/i,
  // English
  /delete\s+my\s+(data|info|account|record)/i,
  /forget\s+me/i,
  /erase\s+my/i,
  /right\s+to\s+be\s+forgotten/i,
  /remove\s+my\s+data/i,
  // Arabic
  /احذف\s+بياناتي/,
  /امسح\s+معلوماتي/,
  // German
  /l[oö]schen?\s+sie\s+meine\s+daten/i,
  /meine\s+daten\s+l[oö]schen/i,
  /recht\s+auf\s+vergessenwerden/i,
];

// ══════════════════════════════════════════════
// CONVERSATION RESET PATTERNS
// ══════════════════════════════════════════════

const RESET_PHRASES: RegExp[] = [
  // Turkish
  /ba[sş]tan\s+ba[sş]la/i,           // baştan başlayalım
  /s[iı]f[iı]rdan\s+ba[sş]la/i,      // sıfırdan başlayalım
  /yeniden\s+ba[sş]la/i,             // yeniden başlayalım
  /temiz\s+sayfa/i,                   // temiz sayfa açalım
  /en\s+ba[sş]a\s+d[oö]n/i,          // en başa dönelim
  /herşeyi\s+s[iı]f[iı]rla/i,        // herşeyi sıfırla
  /her\s+[sş]eyi\s+s[iı]f[iı]rla/i,  // her şeyi sıfırla
  // English
  /start\s+over/i,
  /start\s+from\s+scratch/i,
  /fresh\s+start/i,
  /reset\s+everything/i,
  /begin\s+again/i,
  // Arabic
  /ابدأ\s+من\s+جديد/,
  /من\s+البداية/,
  // German
  /von\s+vorne\s+anfangen/i,
  /neu\s+anfangen/i,
];

// ══════════════════════════════════════════════
// NEW IDENTITY / NEW TREATMENT PATTERNS
// ══════════════════════════════════════════════

// "ben [İsim]" or "ben [ülke]'den/dan [İsim]" patterns
const NEW_IDENTITY_PATTERNS: RegExp[] = [
  // "ben Mehmet" / "ben Ali" / "benim adım Mehmet"
  /ben\s+([A-ZÇĞİÖŞÜa-zçğıöşü]{2,})\b/i,
  /benim\s+ad[iı]m\s+([A-ZÇĞİÖŞÜa-zçğıöşü]{2,})/i,
  /ad[iı]m\s+([A-ZÇĞİÖŞÜa-zçğıöşü]{2,})/i,
  // "ben Irak'tan Mehmet"
  /ben\s+[A-ZÇĞİÖŞÜa-zçğıöşü]+[''`]?(?:dan|den|tan|ten)\s+([A-ZÇĞİÖŞÜa-zçğıöşü]{2,})/i,
  // English
  /my\s+name\s+is\s+([A-Za-z]{2,})/i,
  /i\s+am\s+([A-Za-z]{2,})/i,
  // Arabic
  /اسمي\s+(\S{2,})/,
  /أنا\s+(\S{2,})/,
];

const NEW_TREATMENT_PHRASES: RegExp[] = [
  // Turkish
  /bilgi\s+almak\s+istiyorum/i,
  /bilgi\s+almak\s+isterim/i,
  /tedavi\s+i[cç]in/i,
  /ameliyat\s+i[cç]in/i,
  /sa[cç]\s+ekimi/i,
  /t[uü]p\s+bebek/i,
  /g[oö]z\s+ameliyat/i,
  /di[sş]\s+tedavi/i,
  /estetik/i,
  /burun\s+e?ste?ti[gğ]i/i,
  /obezite/i,
  /organ\s+nakli/i,
  /check.?up/i,
  // English
  /i\s+want\s+to\s+(get|have)\s+treatment/i,
  /hair\s+transplant/i,
  /ivf|in\s+vitro/i,
  /eye\s+surgery/i,
  /dental/i,
  /cosmetic\s+surgery/i,
  // German
  /haartransplantation/i,
  /behandlung/i,
  /augenoperation/i,
];

// ══════════════════════════════════════════════
// DETECTOR
// ══════════════════════════════════════════════

export function detectCancellation(messageText: string): IntentDetection {
  if (!messageText || messageText.length < 3) {
    return {
      explicit_cancellation: false, opt_out_requested: false,
      should_stop_follow_up: false, data_deletion_request: false,
      privacy_request_pending: false, reset_conversation_requested: false,
      new_identity_detected: false, new_treatment_interest: false,
      detected_name: null, matched_phrases: [],
    };
  }

  const normalizedText = messageText
    .toLowerCase()
    .replace(/[''`]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();

  const matched: string[] = [];

  // 1. Cancellation
  let cancellation = false;
  for (const pattern of CANCELLATION_PHRASES) {
    if (pattern.test(normalizedText)) {
      cancellation = true;
      matched.push(`cancellation:${pattern.source}`);
      break;
    }
  }

  // 2. Opt-out
  let optOut = false;
  for (const pattern of OPT_OUT_PHRASES) {
    if (pattern.test(normalizedText)) {
      optOut = true;
      matched.push(`opt_out:${pattern.source}`);
      break;
    }
  }

  // 3. Data deletion / privacy
  let dataDeletion = false;
  for (const pattern of DATA_DELETION_PHRASES) {
    if (pattern.test(normalizedText)) {
      dataDeletion = true;
      matched.push(`data_deletion:${pattern.source}`);
      break;
    }
  }

  // 4. Conversation reset
  let resetConversation = false;
  for (const pattern of RESET_PHRASES) {
    if (pattern.test(normalizedText)) {
      resetConversation = true;
      matched.push(`reset:${pattern.source}`);
      break;
    }
  }

  // 5. New identity
  let newIdentity = false;
  let detectedName: string | null = null;
  for (const pattern of NEW_IDENTITY_PATTERNS) {
    const match = normalizedText.match(pattern);
    if (match && match[1]) {
      // Filter common false positives (pronouns, greetings)
      const name = match[1];
      const falsePositives = ['de', 'da', 'bir', 'ne', 'bu', 'şu', 'o', 've', 'ile', 'ben', 'sen', 'biz', 'siz', 
        'merhaba', 'selam', 'günaydın', 'hello', 'hi', 'hey', 'iyi', 'teşekkür', 'tamam', 'evet', 'hayır',
        'am', 'is', 'are', 'the', 'and', 'for', 'not', 'but', 'you', 'all', 'can', 'her', 'was', 'one'];
      if (!falsePositives.includes(name.toLowerCase()) && name.length >= 2) {
        newIdentity = true;
        detectedName = name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();
        matched.push(`new_identity:${pattern.source}→${detectedName}`);
        break;
      }
    }
  }

  // 6. New treatment interest
  let newTreatment = false;
  for (const pattern of NEW_TREATMENT_PHRASES) {
    if (pattern.test(normalizedText)) {
      newTreatment = true;
      matched.push(`treatment:${pattern.source}`);
      break;
    }
  }

  // Privacy request = data deletion or KVKK/GDPR mention
  const privacyPending = dataDeletion;

  return {
    explicit_cancellation: cancellation || optOut,
    opt_out_requested: optOut,
    should_stop_follow_up: cancellation || optOut || dataDeletion,
    data_deletion_request: dataDeletion,
    privacy_request_pending: privacyPending,
    reset_conversation_requested: resetConversation,
    new_identity_detected: newIdentity,
    new_treatment_interest: newTreatment,
    detected_name: detectedName,
    matched_phrases: matched,
  };
}

const CONFIRMATION_PHRASES: RegExp[] = [
  /evet\s+ge[cç]erli/i,
  /ge[cç]erlidir/i,
  /teyit\s+ediyorum/i,
  /evet\s+teyit/i,
  /onayl[iı]yorum/i,
  /evet\s+onay/i,
  /uygundur/i,
  /evet\s+uygun/i,
  /uygunum/i,
  /^\s*olur\s*$/i,
  /^\s*tamam\s*$/i,
  /evet\s+uygundur/i,
  /do[gğ]rudur/i,
  /evet\s+do[gğ]ru/i,
  /g[oö]r[uü][sş]elim/i,
  /tamamd[iı]r/i,
  /okey/i,
  /^\s*evet\s*$/i,
  /i\s+confirm/i,
  /yes\s+confirm/i,
  /sounds\s+good/i,
  /all\s+good/i,
  /correct/i
];

export function detectConfirmation(messageText: string): boolean {
  if (!messageText || messageText.length < 2) return false;
  
  const normalizedText = messageText
    .toLowerCase()
    .replace(/[''`]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();

  for (const pattern of CONFIRMATION_PHRASES) {
    if (pattern.test(normalizedText)) {
      return true;
    }
  }
  
  return false;
}
