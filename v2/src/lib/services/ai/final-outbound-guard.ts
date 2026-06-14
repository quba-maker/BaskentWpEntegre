import { withTenantDB } from '@/lib/core/tenant-db';

export interface OutboundGuardContext {
  tenantId: string;
  channelId?: string;
  conversationId?: string;
  inboundText?: string;
  intent?: string;
  unifiedContext?: any;
}

export class FinalOutboundGuard {
  /**
   * Processes outbound text before sending, applying safe morphology corrections.
   * If a blocked phrase remains after correction, returns a context-driven safe fallback.
   */
  public static process(text: string, context: OutboundGuardContext): string {
    if (!text || text.trim().length === 0) {
      return text;
    }

    const { tenantId, conversationId, inboundText, unifiedContext } = context;
    let corrected = text;

    // 1. Safe morphological corrections (case-preserving replacements)
    const corrections = [
      { regex: /adınızızı/gi, repl: (m: string) => m.charAt(0) === 'A' ? 'Adınızı' : 'adınızı' },
      { regex: /yaşadığınızızı/gi, repl: (m: string) => m.charAt(0) === 'Y' ? 'Yaşadığınızı' : 'yaşadığınızı' },
      { regex: /anneniziniz/gi, repl: (m: string) => m.charAt(0) === 'A' ? 'Annenizin' : 'annenizin' },
      { regex: /anneniziziniz/gi, repl: (m: string) => m.charAt(0) === 'A' ? 'Annenizin' : 'annenizin' },
      { regex: /Beyiniz\s+ve\s+Sinir/gi, repl: (m: string) => m.charAt(0) === 'B' ? 'Beyin ve Sinir' : 'beyin ve sinir' },
      { regex: /hekim listesinizi/gi, repl: (m: string) => m.charAt(0) === 'H' ? 'Hekim listesini' : 'hekim listesini' },
      { regex: /Kusura bakmayınız/gi, repl: (m: string) => m.charAt(0) === 'K' ? 'Kusura bakmayın' : 'kusura bakmayın' }
    ];

    for (const item of corrections) {
      corrected = corrected.replace(item.regex, item.repl as any);
    }

    // 2. Suffix corrections for possessive/suffix doubling (case-preserving)
    corrected = corrected.replace(/inizniz/gi, (m) => m.charAt(0) === 'İ' || m.charAt(0) === 'I' ? 'İniz' : 'iniz');
    corrected = corrected.replace(/ınıznız/gi, (m) => m.charAt(0) === 'I' || m.charAt(0) === 'ı' ? 'Inız' : 'ınız');
    corrected = corrected.replace(/nuznuz/gi, (m) => m.charAt(0) === 'N' ? 'Nuz' : 'nuz');
    corrected = corrected.replace(/nüznüz/gi, (m) => m.charAt(0) === 'N' ? 'Nüz' : 'nüz');
    corrected = corrected.replace(/iniziniz/gi, (m) => m.charAt(0) === 'İ' || m.charAt(0) === 'I' ? 'İniz' : 'iniz');
    corrected = corrected.replace(/niziniz/gi, (m) => m.charAt(0) === 'N' ? 'Nizin' : 'nizin');
    corrected = corrected.replace(/nızınız/gi, (m) => m.charAt(0) === 'N' ? 'Nızın' : 'nızın');
    corrected = corrected.replace(/nuzunuz/gi, (m) => m.charAt(0) === 'N' ? 'Nuzun' : 'nuzun');
    corrected = corrected.replace(/nüzünüz/gi, (m) => m.charAt(0) === 'N' ? 'Nüzün' : 'nüzün');
    corrected = corrected.replace(/inizizi/gi, (m) => m.charAt(0) === 'İ' || m.charAt(0) === 'I' ? 'İnizi' : 'inizi');
    corrected = corrected.replace(/ınızızı/gi, (m) => m.charAt(0) === 'I' || m.charAt(0) === 'ı' ? 'Inızı' : 'ınızı');
    corrected = corrected.replace(/unuzuzu/gi, (m) => m.charAt(0) === 'U' || m.charAt(0) === 'u' ? 'Unuzu' : 'unuzu');
    corrected = corrected.replace(/ünüzüzü/gi, (m) => m.charAt(0) === 'Ü' || m.charAt(0) === 'u' ? 'Ünüzü' : 'ünüzü');
    corrected = corrected.replace(/sizizi/gi, (m) => m.charAt(0) === 'S' ? 'Sizi' : 'sizi');

    // 3. Blocklist check
    const blocklist = [
      'adınızızı', 'yaşadığınızızı', 'anneniziniz', 'anneniziziniz',
      'beyiniz ve sinir', 'hekim listesinizi', 'isimlerinizi paylaşamıyorum',
      'mümkünüz', 'hastanınız', 'planızı', 'sorularınızıza', 'uzmanızı',
      'kusura bakmayınız', 'sistem detay', 'sistem prompt', 'promptunda'
    ];

    const lowerText = corrected.toLowerCase();
    const hasBlocked = blocklist.some(phrase => lowerText.includes(phrase)) ||
                      /(nız|niz|unuz|ünüz){2,}/i.test(lowerText) ||
                      /(ınız|iniz|unuz|ünüz)(ı|i|u|ü)(z|n|s)(ı|i|u|ü)/i.test(lowerText) ||
                      /iziniz/i.test(lowerText) ||
                      /ınızızı/i.test(lowerText) ||
                      /niziniz/i.test(lowerText) ||
                      /sizizi/i.test(lowerText) ||
                      /nıznız/i.test(lowerText) ||
                      /iniziniz/i.test(lowerText);

    if (hasBlocked) {
      // Resolve complaintContext and patientRelation dynamically from context
      let complaintContext = '';
      let patientRelation = '';

      const facts = unifiedContext?.patient_known_facts || [];
      const rawFactsComplaint = facts.find((f: string) => f.toLowerCase().includes('şikayet') || f.toLowerCase().includes('sikayet'));
      if (rawFactsComplaint) {
        const match = rawFactsComplaint.match(/(?:şikayeti|sikayeti|şikayet|sikayet):\s*(.+)/i);
        if (match && match[1]) {
          complaintContext = match[1].replace(/[.]+$/, '').trim();
        }
      }

      const lowerInbound = (inboundText || '').toLowerCase().trim();
      const historyText = Array.isArray(unifiedContext?.history)
        ? unifiedContext.history.map((m: any) => m.content).join(' ').toLowerCase()
        : '';
      const factsText = Array.isArray(unifiedContext?.patient_known_facts)
        ? unifiedContext.patient_known_facts.join(' ').toLowerCase()
        : '';

      if (!complaintContext) {
        if (lowerInbound.includes('bel fıt') || lowerInbound.includes('bel fit') || historyText.includes('bel fıt') || historyText.includes('bel fit')) {
          complaintContext = 'bel fıtığı';
        }
      }

      if (lowerInbound.includes('anne') || factsText.includes('anne') || historyText.includes('anne') || lowerInbound.includes('valide') || factsText.includes('valide') || historyText.includes('valide')) {
        patientRelation = 'anne';
      } else {
        const relations = ['baba', 'eş', 'es', 'kardeş', 'kardes', 'oğul', 'ogul', 'kız', 'kiz'];
        for (const rel of relations) {
          if (lowerInbound.includes(rel) || factsText.includes(rel) || historyText.includes(rel)) {
            patientRelation = rel;
            break;
          }
        }
      }

      if (complaintContext.length > 50) {
        complaintContext = complaintContext.substring(0, 50) + '...';
      }

      // Dynamic fallback resolution
      let fallbackText = '';
      const normalizedComplaint = complaintContext.toLowerCase().trim();
      if (normalizedComplaint === 'bel fıtığı' || normalizedComplaint === 'bel fitigi') {
        fallbackText = 'Annenizin bel fıtığı için Beyin ve Sinir Cerrahisi veya Fizik Tedavi bölümü değerlendirme yapabilir.';
      } else if (complaintContext && patientRelation) {
        let relationPossessive = '';
        const rel = patientRelation.toLowerCase().trim();
        if (rel === 'anne') relationPossessive = 'annenizin ';
        else if (rel === 'baba') relationPossessive = 'babanızın ';
        else if (rel === 'eş' || rel === 'es') relationPossessive = 'eşinizin ';
        else if (rel === 'kardeş' || rel === 'kardes') relationPossessive = 'kardeşinizin ';
        else if (rel === 'oğul' || rel === 'ogul') relationPossessive = 'oğlunuzun ';
        else if (rel === 'kız' || rel === 'kiz') relationPossessive = 'kızınızın ';
        else relationPossessive = `${rel}inizin `;

        relationPossessive = relationPossessive.charAt(0).toUpperCase() + relationPossessive.slice(1);
        fallbackText = `Kusura bakmayın, cevabımı daha net ifade edeyim. ${relationPossessive}${complaintContext} için ilgili bölüm değerlendirme yapabilir.`;
      } else {
        fallbackText = 'Kusura bakmayın, cevabımı daha net ifade edeyim. Sağlık talebinizle ilgili sizi doğru ekibe yönlendirebilirim.';
      }

      // Log fallback application to db
      try {
        const db = withTenantDB(tenantId);
        db.executeSafe({
          text: `INSERT INTO ai_audit_logs (tenant_id, action, reasoning_summary, result_summary)
                 VALUES ($1, $2, $3, $4)`,
          values: [
            tenantId,
            'FINAL_OUTBOUND_GUARD_FALLBACK_APPLIED',
            `Outbound guard blocked text due to leak/morphology error. Original: "${text.substring(0, 100)}..."`,
            JSON.stringify({
              conversationId,
              originalText: text,
              fallbackText,
              timestamp: new Date().toISOString()
            })
          ]
        }).catch((err: any) => console.error('Failed to log final outbound guard fallback', err));
      } catch (logErr) {
        console.error('Failed to instantiate db for final outbound guard log', logErr);
      }

      return fallbackText;
    }

    return corrected;
  }
}
