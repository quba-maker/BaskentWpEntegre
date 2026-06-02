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
  }): Promise<string> {
    const { tenantId, phoneNumber, email, firstName, lastName } = params;

    if (!phoneNumber) {
      throw new Error('[IdentityEngine] Phone number is required for identity resolution.');
    }

    const normalizedPhone = normalizePhone(phoneNumber);

    try {
      const db = withTenantDB(tenantId);
      const result = await db.executeSafe({
        text: `
          INSERT INTO customer_profiles (tenant_id, primary_phone, primary_email, first_name, last_name)
          VALUES ($1, $2, $3, $4, $5)
          ON CONFLICT (tenant_id, primary_phone) DO UPDATE SET
            primary_email = COALESCE(customer_profiles.primary_email, EXCLUDED.primary_email),
            first_name = COALESCE(customer_profiles.first_name, EXCLUDED.first_name),
            last_name = COALESCE(customer_profiles.last_name, EXCLUDED.last_name),
            updated_at = NOW()
          RETURNING id;
        `,
        values: [tenantId, normalizedPhone, email || null, firstName || null, lastName || null]
      }) as any[];
      const cid = result[0].id;

      // Retroactive SaaS identity merge for orphaned records
      try {
        await db.executeSafe({
          text: `
            UPDATE leads
            SET customer_id = $1
            WHERE tenant_id = $2 
              AND customer_id IS NULL
              AND phone_number LIKE '%' || RIGHT($3, 10) || '%'
          `,
          values: [cid, tenantId, normalizedPhone]
        });
        
        await db.executeSafe({
          text: `
            UPDATE conversations
            SET customer_id = $1
            WHERE tenant_id = $2
              AND customer_id IS NULL
              AND phone_number LIKE '%' || RIGHT($3, 10) || '%'
          `,
          values: [cid, tenantId, normalizedPhone]
        });
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
          active_bot_directive: activeBotDirective
        } : null,
      };
    } catch (e) {
      console.error('[IdentityEngine] Failed to get context', e);
      return null;
    }
  }
}
