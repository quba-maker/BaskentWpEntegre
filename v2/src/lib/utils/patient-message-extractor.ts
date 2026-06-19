export interface MessageExtraction {
  complaint: string | null;
  departmentCandidate: string | null;
  departmentConfidence: 'high' | 'medium' | 'low';
  countryCandidate: string | null;
  countryConfidence: 'high' | 'medium' | 'low';
  callIntent: string | null;
  appointmentIntent: string | null;
  medicalDocumentStatus: 'none' | 'waiting' | 'sent' | 'received' | 'reviewed' | null;
  desiredCallTime: string | null;
  source: 'deterministic' | 'ai' | 'none';
}

const HIGH_CONFIDENCE_KEYWORDS: { keywords: string[]; department: string }[] = [
  { keywords: ['çarpıntı', 'kalp', 'kalp doktoru', 'ritim', 'kalp krizi', 'bypass', 'kardiyoloji'], department: 'Kardiyoloji' },
  { keywords: ['diz', 'diz ağrısı', 'menisküs', 'eklem', 'kireçlenme', 'dizim ağrıyor', 'diz protezi', 'kalça protezi', 'kırık', 'kalça', 'protez', 'omuz', 'bağ yaralanması'], department: 'Ortopedi' },
  { keywords: ['bel fıtığı', 'boyun fıtığı', 'fıtık', 'omurga', 'omurilik', 'sinir sıkışması', 'nöroşirürji', 'beyin cerrahisi'], department: 'Beyin Cerrahi' },
  { keywords: ['diş', 'implant', 'dolgu', 'kanal tedavisi', 'zirkonyum'], department: 'Diş' },
  { keywords: ['göz', 'görme', 'katarakt', 'retina'], department: 'Göz' },
  { keywords: ['saç ekimi', 'sac ekimi', 'saç ekim'], department: 'Saç Ekimi' },
  { keywords: ['check-up', 'genel kontrol', 'check up'], department: 'Check-Up' },
  { keywords: ['kulak çınlaması', 'çınlama', 'tinnitus', 'kulak', 'işitme', 'boğaz', 'burun', 'geniz', 'bademcik', 'burun tıkanıklığı', 'sinüzit'], department: 'KBB' }
];

const MEDIUM_CONFIDENCE_KEYWORDS: { keywords: string[]; department: string }[] = [
  { keywords: ['bel ağrısı', 'siyatik', 'bel', 'boyun ağrısı'], department: 'Beyin Cerrahi' },
  { keywords: ['baş ağrısı', 'bas agrisi', 'migren'], department: 'Nöroloji' },
  { keywords: ['genel ağrı', 'her yerim ağrıyor'], department: 'Fizik Tedavi' }
];

/**
 * Parses patient message content deterministically.
 */
export function extractFromPatientMessageDeterministic(content: string): MessageExtraction {
  const result: MessageExtraction = {
    complaint: null,
    departmentCandidate: null,
    departmentConfidence: 'low',
    countryCandidate: null,
    countryConfidence: 'low',
    callIntent: null,
    appointmentIntent: null,
    medicalDocumentStatus: null,
    desiredCallTime: null,
    source: 'none'
  };

  if (!content || !content.trim()) return result;

  const lower = content.toLowerCase().trim();

  // 1. Resolve department candidates from high confidence keywords
  for (const group of HIGH_CONFIDENCE_KEYWORDS) {
    for (const kw of group.keywords) {
      if (lower.includes(kw)) {
        result.departmentCandidate = group.department;
        result.departmentConfidence = 'high';
        result.complaint = kw;
        result.source = 'deterministic';
        break;
      }
    }
    if (result.departmentCandidate) break;
  }

  // 2. Fallback to medium confidence keywords (cannot write to DB directly, UI candidate only)
  if (!result.departmentCandidate) {
    for (const group of MEDIUM_CONFIDENCE_KEYWORDS) {
      for (const kw of group.keywords) {
        if (lower.includes(kw)) {
          result.departmentCandidate = group.department;
          result.departmentConfidence = 'medium';
          result.complaint = kw;
          result.source = 'deterministic';
          break;
        }
      }
      if (result.departmentCandidate) break;
    }
  }

  return result;
}

/**
 * Guardrail check to determine if a message contains meaningful medical/intent signal
 * to run the AI fallback extractor. Filters out short/generic messages.
 */
export function shouldRunAiExtractor(
  content: string,
  direction: string,
  msgType: string,
  hasManualLock: boolean
): boolean {
  // 1. Reject if not patient inbound
  if (direction !== 'in') return false;

  // 2. Reject if reaction, system message, or status event
  if (msgType === 'reaction' || msgType === 'status' || (direction as string) === 'system') return false;

  // 3. Reject if conversation has manual locks
  if (hasManualLock) return false;

  const clean = content.trim().toLowerCase();

  // 4. Reject short messages (length <= 3)
  if (clean.length <= 3) return false;

  // 5. Reject generic chat patterns with no medical intent
  const genericPatterns = [
    /^\s*(tamam|ok|okey|yes|no|evet|hayir|hayır|tmm|olur|uygun|peki)\s*$/i,
    /^\s*(merhaba|selam|selamlar|slm|mrb|hi|hello|hey|iyi günler|iyi aksamlar)\s*$/i,
    /^\s*[👍😂👋👏🔥❤️✨🌸🙏🏼🤔🤨]+$/i,
    /^\s*[\.\?\!\,]+\s*$/i
  ];

  for (const regex of genericPatterns) {
    if (regex.test(clean)) {
      return false;
    }
  }

  return true;
}
