/**
 * 🚫 Deterministic Cancellation Detector
 * 
 * Post-LLM safety net: scans raw message text for explicit
 * cancellation/opt-out phrases. Overrides CRM extraction if
 * LLM missed clear customer cancellation signals.
 * 
 * Pure function — no DB, no env dependencies.
 */

export interface CancellationDetection {
  explicit_cancellation: boolean;
  opt_out_requested: boolean;
  should_stop_follow_up: boolean;
  matched_phrases: string[];
}

// ══════════════════════════════════════════════
// CANCELLATION PHRASE PATTERNS
// ══════════════════════════════════════════════

const CANCELLATION_PHRASES: RegExp[] = [
  // Turkish — core cancellation
  /gel[e]?meyece[gğ]/i,           // gelmeyeceğim, gelemeyeceğim, gelmeyeceğiz
  /vazge[cç]ti[mk]/i,             // vazgeçtim, vazgeçtik
  /vazge[cç]iyorum/i,             // vazgeçiyorum
  /iptal\s*(et|edin|edelim|ediyorum|istiyorum)/i,  // iptal et, iptal edin, iptal edelim
  /randevuyu?\s*(iptal|iptale)/i,  // randevuyu iptal, randevu iptale
  /istemiyorum/i,                  // istemiyorum
  /ilgilenmiyorum/i,               // ilgilenmiyorum
  /art[iı]k\s+gerek\s+yok/i,      // artık gerek yok
  /g[oö]r[uü][sş]mek\s+istemiyorum/i, // görüşmek istemiyorum
  /gelme[ky]\s*(istemiyorum|niyetim\s+yok)/i, // gelmek istemiyorum
  /ba[sş]ka\s+hastane/i,           // başka hastaneye gitti
  /ba[sş]ka\s+yere?\s+gi[dt]/i,    // başka yere gitti/gidiyorum
  /gelmiyorum/i,                   // gelmiyorum
  /gelmeyece[gğ]iz/i,             // gelmeyeceğiz  
  /gele?miyorum/i,                 // gelemiyorum, gelmiyorum
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
  /aramayın/i,
  /beni\s+aramayın/i,
  /beni\s+bir\s+daha\s+arama/i,
  /rahatsız\s+etmeyin/i,
  /mesaj\s+atmayın/i,
  /yazmayın/i,
  /iletişim\s+kurmayın/i,
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
// DETECTOR
// ══════════════════════════════════════════════

/**
 * Detect explicit cancellation / opt-out from raw message text.
 * This is a deterministic safety net — if the message contains
 * clear cancellation phrases, we override LLM output.
 */
export function detectCancellation(messageText: string): CancellationDetection {
  if (!messageText || messageText.length < 3) {
    return { explicit_cancellation: false, opt_out_requested: false, should_stop_follow_up: false, matched_phrases: [] };
  }

  const normalizedText = messageText
    .toLowerCase()
    .replace(/[''`]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();

  const matched: string[] = [];

  let cancellation = false;
  for (const pattern of CANCELLATION_PHRASES) {
    if (pattern.test(normalizedText)) {
      cancellation = true;
      matched.push(pattern.source);
      break; // One match is enough
    }
  }

  let optOut = false;
  for (const pattern of OPT_OUT_PHRASES) {
    if (pattern.test(normalizedText)) {
      optOut = true;
      matched.push(pattern.source);
      break;
    }
  }

  return {
    explicit_cancellation: cancellation || optOut, // opt-out implies cancellation
    opt_out_requested: optOut,
    should_stop_follow_up: cancellation || optOut,
    matched_phrases: matched,
  };
}
