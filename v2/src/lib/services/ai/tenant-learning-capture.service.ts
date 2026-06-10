import { logger } from '@/lib/core/logger';

export interface DiffResult {
  removedPhrases: string[];
  addedPhrases: string[];
  changedRatio: number;
  diffSummary: {
    aiLength: number;
    humanLength: number;
    ctaRemoved: boolean;
    doctorRemoved: boolean;
    priceRemoved: boolean;
    clichesRemoved: boolean;
    shortened: boolean;
    wordDiffCount: number;
  };
}

export class TenantLearningCaptureService {
  private static log = logger.withContext({ module: 'TenantLearningCapture' });

  /**
   * Deterministic word-level diff calculation
   */
  public static calculateDiff(aiText: string, humanText: string): DiffResult {
    const clean = (t: string) => {
      if (!t) return [];
      return t
        .toLowerCase()
        .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?]/g, ' ')
        .split(/\s+/)
        .filter(Boolean);
    };

    const aiWords = clean(aiText);
    const humanWords = clean(humanText);

    const aiSet = new Set(aiWords);
    const humanSet = new Set(humanWords);

    const removed = aiWords.filter(w => !humanSet.has(w));
    const added = humanWords.filter(w => !aiSet.has(w));

    const maxWords = Math.max(aiWords.length, humanWords.length, 1);
    const changedRatio = (added.length + removed.length) / maxWords;

    // Word helpers for heuristics
    const hasWord = (list: string[], keywords: string[]) => 
      list.some(w => keywords.some(k => w.includes(k)));

    const ctaKeywords = ['randevu', 'gorusme', 'arama', 'telefon', 'planla', 'saat', 'gun', 'uygun'];
    const doctorKeywords = ['hekim', 'doktor', 'uzman', 'prof', 'dr', 'cerrah', 'tabip'];
    const priceKeywords = ['fiyat', 'ucret', 'tutar', 'odeme', 'tl', 'euro', 'dolar', 'usd', 'lira'];
    const clicheKeywords = ['anladim', 'yardimci', 'kusura', 'bakmayin', 'yardim'];

    const ctaRemoved = hasWord(removed, ctaKeywords) && !hasWord(added, ctaKeywords);
    const doctorRemoved = hasWord(removed, doctorKeywords) && !hasWord(added, doctorKeywords);
    const priceRemoved = hasWord(removed, priceKeywords) && !hasWord(added, priceKeywords);
    const clichesRemoved = hasWord(removed, clicheKeywords);
    const shortened = (humanText || '').length < (aiText || '').length;

    return {
      removedPhrases: Array.from(new Set(removed)),
      addedPhrases: Array.from(new Set(added)),
      changedRatio: parseFloat(Math.min(changedRatio, 1.0).toFixed(4)),
      diffSummary: {
        aiLength: (aiText || '').length,
        humanLength: (humanText || '').length,
        ctaRemoved,
        doctorRemoved,
        priceRemoved,
        clichesRemoved,
        shortened,
        wordDiffCount: added.length + removed.length
      }
    };
  }

  /**
   * Deterministic Risk Tagging
   */
  public static getRiskTags(text: string): string[] {
    if (!text) return ['unknown'];
    const tags = new Set<string>();
    const lower = text.toLowerCase();

    const priceKeywords = ['fiyat', 'ucret', 'tutar', 'odeme', 'para', 'tl', 'usd', 'euro', 'dolar', '€', '$'];
    const doctorKeywords = ['hekim', 'doktor', 'dr.', 'prof.', 'doc.', 'uzman', 'cerrah'];
    const medicalKeywords = ['ameliyat', 'tedavi', 'operasyon', 'teshis', 'tani', 'klinik', 'hastalik', 'hasta', 'saglik', 'ilac', 'recete'];
    const ctaKeywords = ['randevu', 'gorusme', 'arama', 'telefon', 'planla', 'ulasalim', 'arayalim'];
    const identityKeywords = ['ben', 'asistan', 'danisman', 'hasta danis', 'merhaba', 'ruya'];

    if (priceKeywords.some(k => lower.includes(k))) tags.add('price');
    if (doctorKeywords.some(k => lower.includes(k))) tags.add('doctor');
    if (medicalKeywords.some(k => lower.includes(k))) tags.add('medical_claim');
    if (ctaKeywords.some(k => lower.includes(k))) tags.add('cta');
    if (identityKeywords.some(k => lower.includes(k))) tags.add('identity');
    if (lower.length > 500) tags.add('length');

    if (tags.size === 0) tags.add('unknown');
    return Array.from(tags);
  }

  /**
   * Capture bot autopilot reply
   */
  public static async logAutopilotReply(
    db: any,
    params: {
      tenantId: string;
      channelId?: string;
      conversationId: string;
      messageId?: string;
      aiGeneratedText: string;
      metadata?: any;
    }
  ): Promise<void> {
    try {
      const riskTags = this.getRiskTags(params.aiGeneratedText);
      const idempotencyKey = `${params.tenantId}:${params.conversationId}:${params.messageId || 'auto'}:${Date.now()}:autopilot_reply`;

      await db.executeSafe({
        text: `
          INSERT INTO tenant_learning_events (
            tenant_id, channel_id, conversation_id, message_id, 
            source_type, ai_generated_text, human_final_text, 
            risk_tags, idempotency_key, metadata
          )
          VALUES ($1, $2, $3, $4, 'autopilot_reply', $5, $5, $6, $7, $8)
          ON CONFLICT (idempotency_key) DO NOTHING
        `,
        values: [
          params.tenantId,
          params.channelId || null,
          params.conversationId,
          params.messageId || null,
          params.aiGeneratedText,
          JSON.stringify(riskTags),
          idempotencyKey,
          JSON.stringify({
            ...(params.metadata || {}),
            contains_sensitive_data: true
          })
        ]
      });
    } catch (err) {
      this.log.error('Failed to log autopilot reply', err as Error);
    }
  }

  /**
   * Capture bot smart draft generation
   */
  public static async logSmartDraft(
    db: any,
    params: {
      tenantId: string;
      channelId?: string;
      conversationId: string;
      aiGeneratedText: string;
      metadata?: any;
    }
  ): Promise<void> {
    try {
      const riskTags = this.getRiskTags(params.aiGeneratedText);
      const idempotencyKey = `${params.tenantId}:${params.conversationId}:${Date.now()}:smart_draft`;

      await db.executeSafe({
        text: `
          INSERT INTO tenant_learning_events (
            tenant_id, channel_id, conversation_id, 
            source_type, ai_generated_text, risk_tags, 
            status, idempotency_key, metadata
          )
          VALUES ($1, $2, $3, 'smart_draft', $4, $5, 'captured', $6, $7)
          ON CONFLICT (idempotency_key) DO NOTHING
        `,
        values: [
          params.tenantId,
          params.channelId || null,
          params.conversationId,
          params.aiGeneratedText,
          JSON.stringify(riskTags),
          idempotencyKey,
          JSON.stringify({
            ...(params.metadata || {}),
            original_draft: params.aiGeneratedText,
            contains_sensitive_data: true
          })
        ]
      });
    } catch (err) {
      this.log.error('Failed to log smart draft', err as Error);
    }
  }

  /**
   * Capture human operator message send (resolves draft edits or logs manual replies)
   */
  public static async logOperatorSend(
    db: any,
    params: {
      tenantId: string;
      channelId?: string;
      conversationId: string;
      messageId?: string;
      humanFinalText: string;
      metadata?: any;
    }
  ): Promise<void> {
    try {
      const riskTags = this.getRiskTags(params.humanFinalText);

      // Check if there is a recent uncompleted smart_draft event for this conversation (created in the last 10 minutes)
      const recentDrafts = await db.executeSafe({
        text: `
          SELECT id, ai_generated_text, metadata 
          FROM tenant_learning_events 
          WHERE tenant_id = $1 
            AND conversation_id = $2 
            AND source_type = 'smart_draft'
            AND human_final_text IS NULL
            AND created_at >= NOW() - INTERVAL '10 minutes'
          ORDER BY created_at DESC 
          LIMIT 1
        `,
        values: [params.tenantId, params.conversationId]
      }) as any[];

      if (recentDrafts && recentDrafts.length > 0) {
        const draftEvent = recentDrafts[0];
        const aiText = draftEvent.ai_generated_text;
        const diff = this.calculateDiff(aiText, params.humanFinalText);
        const isExactMatch = diff.changedRatio === 0;

        const updatedMetadata = {
          ...(draftEvent.metadata || {}),
          ...(params.metadata || {}),
          exact_match: isExactMatch,
          contains_sensitive_data: true
        };

        const sourceType = isExactMatch ? 'smart_draft' : 'human_edited_ai_draft';

        await db.executeSafe({
          text: `
            UPDATE tenant_learning_events 
            SET source_type = $1,
                message_id = $2,
                human_final_text = $3,
                diff_summary = $4,
                changed_ratio = $5,
                removed_phrases = $6,
                added_phrases = $7,
                risk_tags = $8,
                metadata = $9,
                status = 'captured'
            WHERE id = $10
              AND tenant_id = $11
          `,
          values: [
            sourceType,
            params.messageId || null,
            params.humanFinalText,
            JSON.stringify(diff.diffSummary),
            diff.changedRatio.toString(),
            JSON.stringify(diff.removedPhrases),
            JSON.stringify(diff.addedPhrases),
            JSON.stringify(riskTags),
            JSON.stringify(updatedMetadata),
            draftEvent.id,
            params.tenantId
          ]
        });
      } else {
        // No recent draft exists; record this as a completely manual reply
        const idempotencyKey = `${params.tenantId}:${params.conversationId}:${params.messageId || 'manual'}:${Date.now()}:manual_reply`;

        await db.executeSafe({
          text: `
            INSERT INTO tenant_learning_events (
              tenant_id, channel_id, conversation_id, message_id, 
              source_type, human_final_text, risk_tags, 
              status, idempotency_key, metadata
            )
            VALUES ($1, $2, $3, $4, 'manual_reply', $5, $6, 'captured', $7, $8)
            ON CONFLICT (idempotency_key) DO NOTHING
          `,
          values: [
            params.tenantId,
            params.channelId || null,
            params.conversationId,
            params.messageId || null,
            params.humanFinalText,
            JSON.stringify(riskTags),
            idempotencyKey,
            JSON.stringify({
              ...(params.metadata || {}),
              contains_sensitive_data: true
            })
          ]
        });
      }
    } catch (err) {
      this.log.error('Failed to log operator send', err as Error);
    }
  }

  /**
   * Capture human takeover (autopilot disabled manually or via validation error)
   */
  public static async logHumanTakeover(
    db: any,
    params: {
      tenantId: string;
      channelId?: string;
      conversationId: string;
      reason: string;
      metadata?: any;
    }
  ): Promise<void> {
    try {
      const idempotencyKey = `${params.tenantId}:${params.conversationId}:${Date.now()}:human_takeover`;

      await db.executeSafe({
        text: `
          INSERT INTO tenant_learning_events (
            tenant_id, channel_id, conversation_id, 
            source_type, outcome_signal, status, 
            idempotency_key, metadata
          )
          VALUES ($1, $2, $3, 'human_takeover', 'human_takeover', 'captured', $4, $5)
          ON CONFLICT (idempotency_key) DO NOTHING
        `,
        values: [
          params.tenantId,
          params.channelId || null,
          params.conversationId,
          idempotencyKey,
          JSON.stringify({
            ...(params.metadata || {}),
            reason: params.reason,
            contains_sensitive_data: false
          })
        ]
      });
    } catch (err) {
      this.log.error('Failed to log human takeover', err as Error);
    }
  }

  /**
   * Capture patient reaction and retrospectively update the last bot event's outcome signal
   */
  public static async logPatientReaction(
    db: any,
    params: {
      tenantId: string;
      channelId?: string;
      conversationId: string;
      messageId: string;
      patientMessageText: string;
    }
  ): Promise<void> {
    try {
      const lower = params.patientMessageText.toLowerCase();

      // Simple anger heuristics (slang, curses or generic frustration)
      const angerKeywords = [
        'sinir', 'bıktım', 'biktim', 'yeter', 'otomatik', 'robot', 'dalga', 'muhatap', 
        'kızgın', 'kizgin', 'sik', 'aptal', 'salak', 'mal', 'gerizekali', 'gerizekalı', 
        'amk', 'lan', 'bok', 'söylemiyorsunuz', 'cevap ver'
      ];
      
      const positiveKeywords = [
        'tesekkur', 'teşekkür', 'sagol', 'sağol', 'tamam', 'harika', 'iyi', 'ok', 
        'randevu al', 'evet', 'uygun', 'olur'
      ];

      let outcomeSignal: 'patient_angry' | 'patient_positive' | 'patient_replied' = 'patient_replied';

      if (angerKeywords.some(k => lower.includes(k))) {
        outcomeSignal = 'patient_angry';
      } else if (positiveKeywords.some(k => lower.includes(k))) {
        outcomeSignal = 'patient_positive';
      }

      const idempotencyKey = `${params.tenantId}:${params.conversationId}:${params.messageId}:patient_reaction`;

      // 1. Log the patient reaction event
      await db.executeSafe({
        text: `
          INSERT INTO tenant_learning_events (
            tenant_id, channel_id, conversation_id, message_id, 
            source_type, patient_message_text, outcome_signal, 
            status, idempotency_key, metadata
          )
          VALUES ($1, $2, $3, $4, 'patient_reaction', $5, $6, 'captured', $7, $8)
          ON CONFLICT (idempotency_key) DO NOTHING
        `,
        values: [
          params.tenantId,
          params.channelId || null,
          params.conversationId,
          params.messageId,
          params.patientMessageText,
          outcomeSignal,
          idempotencyKey,
          JSON.stringify({
            contains_sensitive_data: true
          })
        ]
      });

      // 2. Retrospectively update the outcome signal on the previous bot response event (if any, within last 24 hours)
      const lastBotEvents = await db.executeSafe({
        text: `
          SELECT id 
          FROM tenant_learning_events 
          WHERE tenant_id = $1 
            AND conversation_id = $2 
            AND source_type IN ('autopilot_reply', 'smart_draft', 'human_edited_ai_draft')
            AND created_at < NOW()
            AND created_at >= NOW() - INTERVAL '24 hours'
          ORDER BY created_at DESC 
          LIMIT 1
        `,
        values: [params.tenantId, params.conversationId]
      }) as any[];

      if (lastBotEvents && lastBotEvents.length > 0) {
        await db.executeSafe({
          text: `
            UPDATE tenant_learning_events 
            SET outcome_signal = $1 
            WHERE id = $2
              AND tenant_id = $3
              AND conversation_id = $4
          `,
          values: [outcomeSignal, lastBotEvents[0].id, params.tenantId, params.conversationId]
        });
      }
    } catch (err) {
      this.log.error('Failed to log patient reaction', err as Error);
    }
  }
}
