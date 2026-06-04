import { withTenantDB } from '@/lib/core/tenant-db';
import { normalizePhone } from '@/lib/utils/normalize-phone';

export class IdentityEngine {

  /**
   * Flow: Webhook -> normalizePhone() -> find/create customer_profiles -> return customerId
   */
  static async resolveIdentity(params: {
    tenantId: string;
    phoneNumber: string;
    email?: string;
    firstName?: string;
    lastName?: string;
    source?: 'manual' | 'form' | 'patient_statement' | 'whatsapp_profile' | 'ai_extracted' | 'phone_fallback';
    allPhones?: string[];
  }): Promise<string> {
    const { tenantId, phoneNumber, email, firstName, lastName, source = 'whatsapp_profile', allPhones } = params;

    if (!phoneNumber) {
      throw new Error('[IdentityEngine] Phone number is required for identity resolution.');
    }

    const { normalizePhoneForIdentity } = await import('@/lib/utils/phone-identity');

    const idObj = normalizePhoneForIdentity(phoneNumber);
    const normalizedPhone = idObj.e164 || idObj.digits;

    const searchPhones = new Set<string>();
    searchPhones.add(normalizedPhone);
    if (allPhones && allPhones.length > 0) {
      for (const p of allPhones) {
        const parsedId = normalizePhoneForIdentity(p);
        const norm = parsedId.e164 || parsedId.digits;
        if (norm) searchPhones.add(norm);
      }
    }
    const phonesList = Array.from(searchPhones);

    try {
      const db = withTenantDB(tenantId);
      let cid: string;

      const existing = await db.executeSafe({
        text: `SELECT id, first_name, primary_phone FROM customer_profiles WHERE tenant_id = $1 AND primary_phone = ANY($2)`,
        values: [tenantId, phonesList]
      }) as any[];

      if (existing.length > 1) {
        console.warn(`[IdentityEngine] COLLISION: Multiple customer profiles found for phones ${phonesList.join(', ')}. Linking requires manual review.`);
        
        // Find if one matches the primary phone exactly
        const exactPrimaryMatch = existing.find(p => p.primary_phone === normalizedPhone);
        if (exactPrimaryMatch) {
          cid = exactPrimaryMatch.id;
        } else {
          // If no profile matches the primary phone exactly, create a new one to avoid wrong merge
          const result = await db.executeSafe({
            text: `
              INSERT INTO customer_profiles (tenant_id, primary_phone, primary_email, first_name, last_name)
              VALUES ($1, $2, $3, $4, $5)
              RETURNING id;
            `,
            values: [tenantId, normalizedPhone, email || null, firstName || null, lastName || null]
          }) as any[];
          cid = result[0].id;
        }

        // Flag needs_manual_review on the conversation tag and insert system timeline message
        try {
          await db.executeSafe({
            text: `
              UPDATE conversations
              SET tags = CASE 
                WHEN tags IS NULL OR tags = '' OR tags = '[]' THEN '["needs_manual_review"]'
                WHEN tags::jsonb @> '["needs_manual_review"]' THEN tags
                ELSE (tags::jsonb || '["needs_manual_review"]'::jsonb)::text
              END
              WHERE tenant_id = $1 AND phone_number = ANY($2)
            `,
            values: [tenantId, phonesList]
          });

          // Insert system message for each conversation
          for (const phone of phonesList) {
            const conv = await db.executeSafe({
              text: `SELECT id FROM conversations WHERE phone_number = $1 AND tenant_id = $2`,
              values: [phone, tenantId]
            }) as any[];
            if (conv.length > 0) {
              await db.executeSafe({
                text: `INSERT INTO messages (tenant_id, conversation_id, phone_number, direction, content, channel, status)
                       VALUES ($1, $2, $3, 'system', $4, 'whatsapp', 'sent')`,
                values: [
                  tenantId,
                  conv[0].id,
                  phone,
                  `[Sistem Uyarısı] Çoklu telefon çakışması tespit edildi. Bu konuşma manuel inceleme gerektiriyor.`
                ]
              });
            }
          }

          // Write audit log
          await db.executeSafe({
            text: `INSERT INTO ai_audit_logs (tenant_id, action, reasoning_summary, result_summary)
                   VALUES ($1, $2, $3, $4)`,
            values: [
              tenantId,
              'identity_collision_detected',
              'Multiple customer profiles found matching allPhones array during resolveIdentity',
              JSON.stringify({
                phones: phonesList,
                profiles_found: existing.map(e => ({ id: e.id, name: e.first_name })),
                assigned_customer_id: cid
              })
            ]
          });
        } catch (tagErr) {
          console.warn('[IdentityEngine] Failed to flag needs_manual_review for collision', tagErr);
        }
      } else if (existing.length === 1) {
        cid = existing[0].id;
        const currentName = existing[0].first_name;
        
        let shouldUpdate = false;
        const isPhoneLike = !currentName || /^[0-9+\-\s()]+$/.test(currentName);
        const isIsimsiz = /isimsiz/i.test(currentName || '');

        if (!currentName || isPhoneLike || isIsimsiz) {
          shouldUpdate = true;
        } else if (source === 'manual' || source === 'form') {
          shouldUpdate = true;
        }

        if (shouldUpdate && firstName && firstName.trim() !== '' && firstName !== currentName) {
          await db.executeSafe({
            text: `
              UPDATE customer_profiles 
              SET first_name = $1, 
                  primary_email = COALESCE(primary_email, $2),
                  updated_at = NOW() 
              WHERE id = $3
            `,
            values: [firstName, email || null, cid]
          });
        }
      } else {
        const result = await db.executeSafe({
          text: `
            INSERT INTO customer_profiles (tenant_id, primary_phone, primary_email, first_name, last_name)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING id;
          `,
          values: [tenantId, normalizedPhone, email || null, firstName || null, lastName || null]
        }) as any[];
        cid = result[0].id;
      }

      // Retroactive SaaS identity merge for orphaned records
      try {
        // 1. High-confidence exact matches
        await db.executeSafe({
          text: `
            UPDATE leads
            SET customer_id = $1
            WHERE tenant_id = $2 
              AND customer_id IS NULL
              AND (
                phone_number = $3
                OR (
                  raw_data IS NOT NULL 
                  AND raw_data != ''
                  AND raw_data LIKE '%_all_phones%'
                  AND (
                    CASE
                      WHEN jsonb_typeof(raw_data::jsonb->'_all_phones') = 'array' 
                        THEN (raw_data::jsonb->'_all_phones') @> jsonb_build_array($3)
                      WHEN jsonb_typeof(raw_data::jsonb->'_all_phones') = 'string' 
                        THEN (raw_data::jsonb->>'_all_phones')::jsonb @> jsonb_build_array($3)
                      ELSE false
                    END
                  )
                )
              )
          `,
          values: [cid, tenantId, normalizedPhone]
        });
        
        await db.executeSafe({
          text: `
            UPDATE conversations
            SET customer_id = $1
            WHERE tenant_id = $2
              AND customer_id IS NULL
              AND phone_number = $3
          `,
          values: [cid, tenantId, normalizedPhone]
        });

        // 2. Safe suffix match fallback (checked for uniqueness and country compatibility)
        const suffix = normalizedPhone.slice(-10);

        const leadCandidates = await db.executeSafe({
          text: `SELECT id, phone_number FROM leads WHERE tenant_id = $1 AND customer_id IS NULL AND RIGHT(phone_number, 10) = $2`,
          values: [tenantId, suffix]
        }) as any[];

        if (leadCandidates.length === 1) {
          const cand = leadCandidates[0];
          const idCand = normalizePhoneForIdentity(cand.phone_number);
          const idOrig = normalizePhoneForIdentity(normalizedPhone);
          if (idCand.nationalSuffix === idOrig.nationalSuffix && idCand.countryHint === idOrig.countryHint) {
            await db.executeSafe({
              text: `UPDATE leads SET customer_id = $1 WHERE id = $2 AND tenant_id = $3`,
              values: [cid, cand.id, tenantId]
            });
          }
        }

        const convCandidates = await db.executeSafe({
          text: `SELECT id, phone_number FROM conversations WHERE tenant_id = $1 AND customer_id IS NULL AND RIGHT(phone_number, 10) = $2`,
          values: [tenantId, suffix]
        }) as any[];

        if (convCandidates.length === 1) {
          const cand = convCandidates[0];
          const idCand = normalizePhoneForIdentity(cand.phone_number);
          const idOrig = normalizePhoneForIdentity(normalizedPhone);
          if (idCand.nationalSuffix === idOrig.nationalSuffix && idCand.countryHint === idOrig.countryHint) {
            await db.executeSafe({
              text: `UPDATE conversations SET customer_id = $1 WHERE id = $2 AND tenant_id = $3`,
              values: [cid, cand.id, tenantId]
            });
          }
        }
      } catch (mergeError) {
        console.warn('[IdentityEngine] Non-fatal: Orphaned records merge failed', mergeError);
      }

      return cid;
    } catch (error) {
      console.error('[IdentityEngine] Failed to resolve identity:', error);
      throw error;
    }
  }

  static async linkConversation(tenantId: string, conversationId: string, customerId: string): Promise<void> {
    const db = withTenantDB(tenantId);
    await db.executeSafe({
      text: `
        UPDATE conversations 
        SET customer_id = $1, updated_at = NOW()
        WHERE id = $2 AND tenant_id = $3;
      `,
      values: [customerId, conversationId, tenantId]
    });
  }

  static async linkLead(tenantId: string, leadId: string, customerId: string): Promise<void> {
    const db = withTenantDB(tenantId);
    await db.executeSafe({
      text: `
        UPDATE leads 
        SET customer_id = $1
        WHERE id = $2 AND tenant_id = $3;
      `,
      values: [customerId, leadId, tenantId]
    });
  }
  private static sanitizeFormFacts(rawData: any): string[] {
    if (!rawData) return [];
    let formObj: any = rawData;
    if (typeof rawData === 'string') {
      try {
        formObj = JSON.parse(rawData);
      } catch {
        return [];
      }
    }
    if (!formObj || typeof formObj !== 'object') return [];

    const facts: string[] = [];
    const getVal = (keys: string[]) => {
      for (const key of keys) {
        if (key in formObj) {
          const val = formObj[key];
          if (val !== undefined && val !== null && String(val).trim() !== '') {
            return String(val).trim();
          }
        }
      }
      return null;
    };

    const name = getVal(['full_name', 'ad_soyad', 'name']);
    const age = getVal(['yas', 'yaş', 'age']);
    const country = getVal(['ulke', 'ülke', 'country', 'nerede_yaşıyorsunuz']);
    const complaint = getVal(['sikayet', 'şikayet', 'şikayetiniz_nedir', 'sikayetiniz_nedir']);
    const duration = getVal(['sure', 'süre', 'ne_kadardir_suruyor']);
    const randevu = getVal(['randevu_ayi', 'randevu_tarihi', 'ne_zaman_gelmek_istiyorsunuz']);
    const phone = getVal(['telefon', 'phone']);

    if (name) facts.push(`Hastanın adı: ${name}.`);
    if (age) facts.push(`Hastanın yaşı: ${age}.`);
    if (country) facts.push(`Hastanın yaşadığı ülke/yer: ${country}.`);
    if (complaint) facts.push(`Hastanın şikayeti: ${complaint}.`);
    if (duration) facts.push(`Hastanın şikayet süresi: ${duration}.`);
    if (randevu) facts.push(`Hastanın randevu/gelme planı: ${randevu}.`);
    if (phone) facts.push(`Hastanın iletişim numarası: ${phone}.`);

    return facts;
  }

  /**
   * Unified context based ONLY on customer_id, no fuzzy matching here.
   */
  static async getContext(tenantId: string, customerId: string, conversationId?: string): Promise<any> {
    try {
      const db = withTenantDB(tenantId);
      const profiles = await db.executeSafe({
        text: `SELECT * FROM customer_profiles WHERE id = $1 AND tenant_id = $2`,
        values: [customerId, tenantId]
      }) as any[];
      const profile = profiles[0];
      if (!profile) return null;

      const leads = await db.executeSafe({
        text: `
          SELECT id, form_name, raw_data 
          FROM leads 
          WHERE tenant_id = $1 AND customer_id = $2
          ORDER BY created_at DESC 
          LIMIT 1
        `,
        values: [tenantId, customerId]
      }) as any[];
      const lead = leads[0];

      let memory = null;
      if (conversationId) {
         const memories = await db.executeSafe({
           text: `SELECT * FROM conversation_memory WHERE conversation_id = $1 AND tenant_id = $2`,
           values: [conversationId, tenantId]
         }) as any[];
         memory = memories[0];
      }

      // ── Step 1: Explicit active_opportunity_id from conversation ──
      let opportunity = null;
      let resolvedFrom = 'none';

      if (conversationId) {
        const convRows = await db.executeSafe({
          text: `SELECT active_opportunity_id FROM conversations WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
          values: [conversationId, tenantId]
        }) as any[];
        const activeOppId = convRows[0]?.active_opportunity_id;
        if (activeOppId) {
          const oppRows = await db.executeSafe({
            text: `SELECT * FROM opportunities WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
            values: [activeOppId, tenantId]
          }) as any[];
          if (oppRows.length > 0) {
            opportunity = oppRows[0];
            resolvedFrom = 'explicit_active_id';
          }
        }
      }

      // ── Step 2: Active opportunity in same conversation + tenant ──
      if (!opportunity && conversationId) {
        const oppRows = await db.executeSafe({
          text: `
            SELECT * FROM opportunities 
            WHERE conversation_id = $1 AND tenant_id = $2 
              AND stage NOT IN ('lost', 'not_qualified', 'arrived')
            ORDER BY updated_at DESC
            LIMIT 1
          `,
          values: [conversationId, tenantId]
        }) as any[];
        if (oppRows.length > 0) {
          opportunity = oppRows[0];
          resolvedFrom = 'active_conv_opp';
        }
      }

      // ── Step 3: Same lead/form active opportunity ──
      if (!opportunity && lead) {
        const leadIdQuery = await db.executeSafe({
          text: `SELECT id, linked_opportunity_id FROM leads WHERE tenant_id = $1 AND customer_id = $2 ORDER BY created_at DESC LIMIT 1`,
          values: [tenantId, customerId]
        }) as any[];
        if (leadIdQuery.length > 0) {
          const lId = leadIdQuery[0].id;
          const lLinkedOppId = leadIdQuery[0].linked_opportunity_id;
          
          if (lLinkedOppId) {
            const oppRows = await db.executeSafe({
              text: `
                SELECT * FROM opportunities 
                WHERE id = $1 AND tenant_id = $2 
                  AND stage NOT IN ('lost', 'not_qualified', 'arrived')
                LIMIT 1
              `,
              values: [lLinkedOppId, tenantId]
            }) as any[];
            if (oppRows.length > 0) {
              opportunity = oppRows[0];
              resolvedFrom = 'lead_linked_active_opp';
            }
          }
          
          if (!opportunity) {
            const oppRows = await db.executeSafe({
              text: `
                SELECT * FROM opportunities 
                WHERE lead_id = $1 AND tenant_id = $2 
                  AND stage NOT IN ('lost', 'not_qualified', 'arrived')
                ORDER BY updated_at DESC
                LIMIT 1
              `,
              values: [lId, tenantId]
            }) as any[];
            if (oppRows.length > 0) {
              opportunity = oppRows[0];
              resolvedFrom = 'lead_id_active_opp';
            }
          }
        }
      }

      // ── Step 4: Fallback - Latest non-terminal (inactive/terminal in same conversation and tenant) ──
      if (!opportunity && conversationId) {
        const oppRows = await db.executeSafe({
          text: `
            SELECT * FROM opportunities 
            WHERE conversation_id = $1 AND tenant_id = $2
              AND stage IN ('lost', 'not_qualified', 'arrived')
            ORDER BY updated_at DESC
            LIMIT 1
          `,
          values: [conversationId, tenantId]
        }) as any[];
        if (oppRows.length > 0) {
          opportunity = oppRows[0];
          resolvedFrom = 'inactive_conv_opp_fallback';
        }
      }

      // ═══ B2 FIX: Outreach context for form lead bot handoff ═══
      let outreachContext = null;
      if (lead) {
        try {
          const leadRows = await db.executeSafe({
            text: `SELECT id FROM leads WHERE tenant_id = $1 AND customer_id = $2 ORDER BY created_at DESC LIMIT 1`,
            values: [tenantId, customerId]
          }) as any[];

          if (leadRows.length > 0) {
            const leadId = leadRows[0].id;

            const outreachRows = await db.executeSafe({
              text: `SELECT action, metadata, created_at FROM outreach_logs 
                     WHERE lead_id = $1 AND tenant_id = $2 
                     ORDER BY created_at DESC LIMIT 10`,
              values: [leadId, tenantId]
            }) as any[];

            if (outreachRows.length > 0) {
              const greetingSent = outreachRows.some((r: any) => r.action === 'greeting_sent');
              const botActivated = outreachRows.some((r: any) => r.action === 'bot_activated');
              const lastCallRow = outreachRows.find((r: any) => 
                ['called_reached', 'called_missed', 'callback_scheduled'].includes(r.action)
              );

              outreachContext = {
                source: 'form_lead',
                greetingSent,
                botActivated,
                lastCallAction: lastCallRow?.action || null,
                lastCallNote: lastCallRow?.metadata?.note || null,
              };
            }
          }
        } catch (ocErr) {
          console.warn('[IdentityEngine] Non-fatal: outreachContext query failed', ocErr);
        }
      }

      // ── Step 5: Active task & bot directive loading ──
      let activeTask = null;
      let activeBotDirective = null;
      try {
        if (opportunity) {
          const taskRows = await db.executeSafe({
            text: `SELECT id, task_type, title, metadata FROM follow_up_tasks 
                   WHERE opportunity_id = $1 AND tenant_id = $2 AND status IN ('pending', 'in_progress')
                   ORDER BY created_at DESC LIMIT 1`,
            values: [opportunity.id, tenantId]
          }) as any[];
          activeTask = taskRows[0] || null;
        } else if (conversationId) {
          const taskRows = await db.executeSafe({
            text: `SELECT id, task_type, title, metadata FROM follow_up_tasks 
                   WHERE conversation_id = $1 AND tenant_id = $2 AND status IN ('pending', 'in_progress')
                   ORDER BY created_at DESC LIMIT 1`,
            values: [conversationId, tenantId]
          }) as any[];
          activeTask = taskRows[0] || null;
        }

        if (activeTask) {
          const taskMeta = activeTask.metadata || {};
          const state = taskMeta.bot_directive_state;
          if (state && state.directive_status === 'pending') {
            activeBotDirective = state.active_bot_directive;
          } else if (taskMeta.active_bot_directive) {
            // Backward compatibility check
            const isPending = taskMeta.bot_teyit_sent || taskMeta.bot_hatirlat_sent || taskMeta.bot_devret_sent;
            if (isPending) {
              activeBotDirective = taskMeta.active_bot_directive;
            }
          }
        }
      } catch (taskErr) {
        console.warn('[IdentityEngine] Non-fatal: active task query failed', taskErr);
      }

      return {
        profile,
        latestForm: lead ? { name: lead.form_name, data: lead.raw_data } : null,
        patient_known_facts: lead ? IdentityEngine.sanitizeFormFacts(lead.raw_data) : [],
        memory: memory ? {
           summary: memory.summary_text,
           intent: memory.buying_intent,
           sentiment: memory.sentiment,
           objections: memory.objections
        } : null,
        opportunity: opportunity ? {
           id: opportunity.id,
           summary: opportunity.summary,
           ai_reason: opportunity.ai_reason,
           patient_name: opportunity.patient_name,
           country: opportunity.country,
           department: opportunity.department,
           travel_date: opportunity.travel_date,
           stage: opportunity.stage,
           resolvedFrom
        } : null,
        outreachContext,
        active_task: activeTask ? {
          id: activeTask.id,
          task_type: activeTask.task_type,
          title: activeTask.title,
          active_bot_directive: activeBotDirective,
          metadata: typeof activeTask.metadata === 'string'
            ? JSON.parse(activeTask.metadata)
            : (activeTask.metadata || {})
        } : null,
      };
    } catch (e) {
      console.error('[IdentityEngine] Failed to get context', e);
      return null;
    }
  }
}
