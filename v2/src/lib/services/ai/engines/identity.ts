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
          SELECT form_name, raw_data 
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

      // ═══ B2 FIX: Outreach context for form lead bot handoff ═══
      // When a coordinator has already contacted this form lead (greeting, call, bot activation),
      // produce outreachContext so PromptBuilder can inject it into the bot's system prompt.
      let outreachContext = null;
      if (lead) {
        try {
          // Get the lead_id for this customer's latest lead
          const leadRows = await db.executeSafe({
            text: `SELECT id FROM leads WHERE tenant_id = $1 AND customer_id = $2 ORDER BY created_at DESC LIMIT 1`,
            values: [tenantId, customerId]
          }) as any[];

          if (leadRows.length > 0) {
            const leadId = leadRows[0].id;

            // Fetch outreach history for this lead
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

      return {
        profile,
        latestForm: lead ? { name: lead.form_name, data: lead.raw_data } : null,
        memory: memory ? {
           summary: memory.summary_text,
           intent: memory.buying_intent,
           sentiment: memory.sentiment,
           objections: memory.objections
        } : null,
        outreachContext,
      };
    } catch (e) {
      console.error('[IdentityEngine] Failed to get context', e);
      return null;
    }
  }
}
