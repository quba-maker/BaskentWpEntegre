import { logger } from '@/lib/core/logger';

export interface CandidateDraft {
  candidateType: 'tone_rule' | 'policy_rule' | 'answer_pattern' | 'knowledge_hint' | 'forbidden_phrase' | 'cta_rule' | 'identity_rule' | 'risk_warning';
  title: string;
  summary: string;
  suggestedRuleText: string;
  evidenceSummary: string;
  riskLevel: 'low' | 'medium' | 'high' | 'blocked';
  riskTags: string[];
  fingerprint: string;
  metadata?: any;
}

export class TenantLearningCandidateService {
  private static log = logger.withContext({ module: 'TenantLearningCandidate' });

  /**
   * Scans tenant_learning_events and generates learning candidates.
   */
  public static async generateCandidatesForTenant(
    db: any,
    tenantId: string,
    options: {
      limit?: number;
      since?: string;
      channelId?: string;
      writeMode?: boolean;
    } = {}
  ): Promise<CandidateDraft[]> {
    const limit = options.limit || 100;
    const since = options.since;
    const channelId = options.channelId;
    const writeMode = !!options.writeMode;

    this.log.info('Starting candidate generation process', { tenantId, limit, since, channelId, writeMode });

    // 1. Build Query
    let queryText = `
      SELECT id, tenant_id, organization_id, channel_id, conversation_id, message_id, 
             source_type, patient_message_text, ai_generated_text, human_final_text, 
             diff_summary, changed_ratio, removed_phrases, added_phrases, risk_tags, 
             outcome_signal, status, idempotency_key, metadata, created_at
      FROM tenant_learning_events
      WHERE tenant_id = $1
        AND status = 'captured'
    `;
    const queryParams: any[] = [tenantId];

    let paramIndex = 2;
    if (since) {
      queryText += ` AND created_at >= $${paramIndex}`;
      queryParams.push(new Date(since));
      paramIndex++;
    }
    if (channelId) {
      queryText += ` AND channel_id = $${paramIndex}`;
      queryParams.push(channelId);
      paramIndex++;
    }

    queryText += ` ORDER BY created_at ASC LIMIT $${paramIndex}`;
    queryParams.push(limit);

    const events = await db.executeSafe({
      text: queryText,
      values: queryParams
    }) as any[];

    this.log.info(`Fetched ${events.length} captured events for tenant candidate analysis`, { tenantId });

    const candidates: CandidateDraft[] = [];

    // 2. Loop and apply deterministic heuristics
    for (const event of events) {
      const generated = this.analyzeEvent(event);
      for (const draft of generated) {
        candidates.push(draft);

        if (writeMode) {
          await this.upsertCandidate(db, event, draft);
        }
      }
    }

    return candidates;
  }

  /**
   * Evaluates a single event and produces candidate drafts
   */
  private static analyzeEvent(event: any): CandidateDraft[] {
    const drafts: CandidateDraft[] = [];
    const changedRatio = parseFloat(event.changed_ratio || '0');
    const removedPhrases = event.removed_phrases || [];
    const riskTags = event.risk_tags || [];
    const outcomeSignal = event.outcome_signal || 'unknown';
    const sourceType = event.source_type;
    const diffSummary = event.diff_summary || {};
    const aiLength = diffSummary.aiLength || 0;
    const humanLength = diffSummary.humanLength || 0;

    // Detect if contains sensitive data flag is set
    const containsSensitive = event.metadata?.contains_sensitive_data === true;

    // Helper to compute escalated risk level
    const resolveRiskLevel = (baseRisk: 'low' | 'medium' | 'high' | 'blocked'): 'low' | 'medium' | 'high' | 'blocked' => {
      if (baseRisk === 'blocked') return 'blocked';
      if (containsSensitive) {
        return 'high';
      }
      return baseRisk;
    };

    // Heuristic 1: tone_rule / forbidden_phrase
    if (sourceType === 'human_edited_ai_draft') {
      // Check removed cliché bot phrases
      const clicheKeywords = ['anladim', 'yardimci', 'kusura', 'bakmayin', 'yardim', 'sorunuzu', 'iletmek'];
      const removedCliches = removedPhrases.filter((p: string) => 
        clicheKeywords.some(k => p.toLowerCase().includes(k))
      );

      for (const phrase of removedCliches) {
        // Enforce KVKK: Suggested rule and summary must be completely abstract
        const cleanPhrase = phrase.replace(/[^a-zA-ZğüşıöçĞÜŞİÖÇ ]/g, '').trim();
        if (cleanPhrase.length > 2) {
          drafts.push({
            candidateType: 'forbidden_phrase',
            title: 'Bot Cliche Greeting Phrase Avoidance',
            summary: 'Operator removed bot-like cliché phrases from the final response.',
            suggestedRuleText: `Do not use the word '${cleanPhrase}' in AI answers or greeting statements.`,
            evidenceSummary: `Cliché phrase '${cleanPhrase}' was removed by operators from drafts.`,
            riskLevel: resolveRiskLevel('low'),
            riskTags: ['tone', 'cliche'],
            fingerprint: `forbidden_phrase:removed_word:${cleanPhrase.toLowerCase()}`
          });
        }
      }

      // Changed ratio > 0.35 indicates massive stylistic changes
      if (changedRatio > 0.35) {
        drafts.push({
          candidateType: 'tone_rule',
          title: 'Operatör Tarzı Kısaltma ve Sadeleştirme',
          summary: 'Operatörler yapay zeka taslağını kısalttı veya mesajın dilini sadeleştirdi.',
          suggestedRuleText: 'Gereksiz karşılama ifadeleri kullanmadan, kısa ve net cevaplar tercih edin.',
          evidenceSummary: `Taslak yanıt uzunluğu operatör tarafından azaltıldı. (Yapay zeka uzunluğu: ${aiLength}, insan uzunluğu: ${humanLength}).`,
          riskLevel: resolveRiskLevel('low'),
          riskTags: ['tone', 'style'],
          fingerprint: 'tone_rule:style_shortening'
        });
      }

      // Heuristic 2: cta_rule
      if (diffSummary.ctaRemoved === true) {
        drafts.push({
          candidateType: 'cta_rule',
          title: 'Randevu CTA Optimizasyonu',
          summary: 'Operatörler randevu davetini veya geri arama isteğini taslaklardan kaldırdı.',
          suggestedRuleText: 'Kullanıcı açıkça talep etmedikçe randevu veya arama tekliflerini tekrarlamaktan kaçının.',
          evidenceSummary: "Arama/randevu planlama CTA'i operatör tarafından kaldırıldı.",
          riskLevel: resolveRiskLevel('low'),
          riskTags: ['cta', 'scheduling'],
          fingerprint: 'cta_rule:cta_removed'
        });
      }

      // Heuristic 3: policy_rule (Price/Doctor modifications)
      if (diffSummary.priceRemoved === true) {
        drafts.push({
          candidateType: 'policy_rule',
          title: 'Fiyat Bilgisi Kısıtlaması',
          summary: 'Operatörler taslak yanıttan fiyat ayrıntılarını kaldırdı veya değiştirdi.',
          suggestedRuleText: 'Hekim muayenesinden önce net/kesin paket fiyat bilgisi vermeyin.',
          evidenceSummary: 'Fiyat bilgisi operatör tarafından değiştirildi.',
          riskLevel: resolveRiskLevel('high'),
          riskTags: ['policy', 'pricing'],
          fingerprint: 'policy_rule:price_removed'
        });
      }
      if (diffSummary.doctorRemoved === true) {
        drafts.push({
          candidateType: 'policy_rule',
          title: 'Hekim Atama Bilgisi Kısıtlaması',
          summary: 'Operatörler taslak yanıttan hekim isimlerini kaldırdı veya değiştirdi.',
          suggestedRuleText: 'Klinik triyaj tamamlanmadan önce kesin hekim ataması beyan etmeyin.',
          evidenceSummary: 'Hekim ismi referansı operatör tarafından değiştirildi.',
          riskLevel: resolveRiskLevel('high'),
          riskTags: ['policy', 'doctor'],
          fingerprint: 'policy_rule:doctor_removed'
        });
      }

      // Heuristic 4: identity_rule
      if (riskTags.includes('identity') && changedRatio > 0.20) {
        drafts.push({
          candidateType: 'identity_rule',
          title: 'Persona ve İmza Sadeleştirmesi',
          summary: 'Operatörler bot tanıtımlarını veya firma karşılama imzalarını kaldırdı/sadeleştirdi.',
          suggestedRuleText: 'Görüşme akışlarında botun kendini tanıtma sıklığını ve imza kullanımlarını asgariye indirin.',
          evidenceSummary: 'Kendini tanıtma persona detayları taslakta değiştirildi.',
          riskLevel: resolveRiskLevel('low'),
          riskTags: ['identity', 'greeting'],
          fingerprint: 'identity_rule:persona_modified'
        });
      }

      // Heuristic 5: knowledge_hint
      if (riskTags.includes('medical_claim') && changedRatio > 0.15) {
        drafts.push({
          candidateType: 'knowledge_hint',
          title: 'Tıbbi Yönlendirme ve Kılavuz Uyumu',
          summary: 'AI taslağı ve insan yanıtı tıbbi açıklamalarda farklılık gösterdi.',
          suggestedRuleText: 'İşlemleri onaylamadan önce klinik bölüm eşlemelerini ve yönergelerini doğrulayın.',
          evidenceSummary: 'Tıbbi iddia parametreleri operatör tarafından değiştirildi.',
          riskLevel: resolveRiskLevel('high'),
          riskTags: ['knowledge', 'medical'],
          fingerprint: 'knowledge_hint:medical_claim'
        });
      }
    }

    // Heuristic 6: answer_pattern (from manual_reply)
    if (sourceType === 'manual_reply') {
      const containsPrice = riskTags.includes('price');
      const containsDoctor = riskTags.includes('doctor');

      if (containsPrice) {
        drafts.push({
          candidateType: 'answer_pattern',
          title: 'Operatör Standart Fiyat Yanıt Şablonu',
          summary: 'Operatörler fiyat sorularını muayene öncelikli standart bir çerçevede yanıtlıyor.',
          suggestedRuleText: 'Fiyat sorulduğunda, nihai ücretlerin klinik kontrollerden sonra belirleneceğini açıklayın.',
          evidenceSummary: 'Operatör fiyat sorgusu yanıt kalıbı tespit edildi.',
          riskLevel: resolveRiskLevel('medium'),
          riskTags: ['pattern', 'pricing'],
          fingerprint: 'answer_pattern:price_inquiry'
        });
      }
      if (containsDoctor) {
        drafts.push({
          candidateType: 'answer_pattern',
          title: 'Operatör Standart Hekim Planlama Şablonu',
          summary: 'Operatörler doğrudan hekim taahhüdü yerine ilgili bölümün genel takvimini sunuyor.',
          suggestedRuleText: 'Yanıtı tekil hekim taahhütleri yerine klinik birimlerin uygunluğuna odaklayın.',
          evidenceSummary: 'Operatör hekim atama sorgusu kalıbı tespit edildi.',
          riskLevel: resolveRiskLevel('medium'),
          riskTags: ['pattern', 'doctor'],
          fingerprint: 'answer_pattern:doctor_inquiry'
        });
      }
    }

    // Heuristic 7: risk_warning
    if (outcomeSignal === 'patient_angry' || sourceType === 'human_takeover') {
      drafts.push({
        candidateType: 'risk_warning',
        title: 'Kullanıcı Memnuniyetsizliği Önleme Uyarısı',
        summary: 'Görüşme kullanıcının tepkisine yol açtı veya operatörün anında devralmasını gerektirdi.',
        suggestedRuleText: 'Yanıt tonunu daha az robotik olacak şekilde ayarlayın veya doğrudan insan operatöre yönlendirin.',
        evidenceSummary: 'Olumsuz müşteri psikolojisi veya devralma sinyali kaydedildi.',
        riskLevel: resolveRiskLevel('medium'),
        riskTags: ['risk', 'takeover'],
        fingerprint: 'risk_warning:frustration_detected'
      });
    }

    // Heuristic 8: Blocked candidate classification
    // If the event has riskTags including medical_claim and contains sensitive data, classify as blocked
    const hasMedicalClaim = riskTags.includes('medical_claim');
    if (hasMedicalClaim && containsSensitive) {
      drafts.push({
        candidateType: 'knowledge_hint',
        title: 'Kişisel Klinik Bilgi İçeren Riskli Aday',
        summary: 'Tekil hastaya ait hassas klinik bilgi veya kişisel sağlık detayı tespit edildi.',
        suggestedRuleText: 'Tedavi veya ameliyat planları otomatik öğrenmeye uygun değildir, manuel değerlendirilir.',
        evidenceSummary: 'Hassas tekil hasta klinik iddiası tespit edildi.',
        riskLevel: 'blocked',
        riskTags: ['knowledge', 'blocked', 'phi'],
        fingerprint: 'knowledge_hint:blocked_clinical_details',
        metadata: { runtime_eligible: false }
      });
    }

    return drafts;
  }

  /**
   * Persists or updates the candidate with unique index checks and idempotency event tracking.
   */
  private static async upsertCandidate(db: any, event: any, draft: CandidateDraft): Promise<void> {
    try {
      // 1. Fetch existing candidate matching tenant_id, candidate_type and fingerprint
      const existing = await db.executeSafe({
        text: `
          SELECT id, source_event_ids, confidence_score, metadata 
          FROM tenant_learning_candidates
          WHERE tenant_id = $1 
            AND candidate_type = $2 
            AND fingerprint = $3
        `,
        values: [event.tenant_id, draft.candidateType, draft.fingerprint]
      }) as any[];

      if (existing && existing.length > 0) {
        const record = existing[0];
        const sourceEventIds = record.source_event_ids || [];

        // Check if event.id is already processed
        if (sourceEventIds.includes(event.id)) {
          this.log.info('Event already processed for candidate, skipping to prevent confidence inflation', {
            candidateId: record.id,
            eventId: event.id
          });
          return;
        }

        // New event: Add uniquely and increment confidence score by 0.5
        const updatedIds = [...sourceEventIds, event.id];
        const newScore = (parseFloat(record.confidence_score) + 0.5).toFixed(2);
        
        const metadata = {
          ...(record.metadata || {}),
          updated_by_event: event.id,
          runtime_eligible: draft.riskLevel !== 'blocked'
        };

        await db.executeSafe({
          text: `
            UPDATE tenant_learning_candidates
            SET source_event_ids = $1,
                confidence_score = $2,
                metadata = $3,
                updated_at = NOW()
            WHERE id = $4
          `,
          values: [JSON.stringify(updatedIds), newScore, JSON.stringify(metadata), record.id]
        });

        this.log.info('Updated existing learning candidate', {
          candidateId: record.id,
          newScore,
          totalEvidence: updatedIds.length
        });
      } else {
        // Create new candidate
        const metadata = {
          ...(draft.metadata || {}),
          runtime_eligible: draft.riskLevel !== 'blocked'
        };

        await db.executeSafe({
          text: `
            INSERT INTO tenant_learning_candidates (
              tenant_id, organization_id, channel_id, conversation_id,
              source_event_ids, candidate_type, title, summary,
              suggested_rule_text, evidence_summary, confidence_score,
              risk_level, risk_tags, status, fingerprint, metadata
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'pending', $14, $15)
          `,
          values: [
            event.tenant_id,
            event.organization_id || null,
            event.channel_id || null,
            event.conversation_id || null,
            JSON.stringify([event.id]),
            draft.candidateType,
            draft.title,
            draft.summary,
            draft.suggestedRuleText,
            draft.evidenceSummary,
            '1.00',
            draft.riskLevel,
            JSON.stringify(draft.riskTags),
            draft.fingerprint,
            JSON.stringify(metadata)
          ]
        });

        this.log.info('Created new learning candidate', {
          tenantId: event.tenant_id,
          type: draft.candidateType,
          fingerprint: draft.fingerprint
        });
      }
    } catch (err) {
      this.log.error('Failed to upsert candidate', err as Error);
    }
  }
}
