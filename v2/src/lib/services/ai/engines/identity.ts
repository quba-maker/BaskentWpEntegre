import { sql } from '@/lib/db';
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
      const result = await sql`
        INSERT INTO customer_profiles (tenant_id, primary_phone, primary_email, first_name, last_name)
        VALUES (${tenantId}, ${normalizedPhone}, ${email || null}, ${firstName || null}, ${lastName || null})
        ON CONFLICT (tenant_id, primary_phone) DO UPDATE SET
          primary_email = COALESCE(customer_profiles.primary_email, EXCLUDED.primary_email),
          first_name = COALESCE(customer_profiles.first_name, EXCLUDED.first_name),
          last_name = COALESCE(customer_profiles.last_name, EXCLUDED.last_name),
          updated_at = NOW()
        RETURNING id;
      `;
      const cid = result[0].id;

      // Retroactive SaaS identity merge for orphaned records
      try {
        await sql`
          UPDATE leads
          SET customer_id = ${cid}
          WHERE tenant_id = ${tenantId} 
            AND customer_id IS NULL
            AND phone_number LIKE '%' || RIGHT(${normalizedPhone}, 10) || '%'
        `;
        
        await sql`
          UPDATE conversations
          SET customer_id = ${cid}
          WHERE tenant_id = ${tenantId}
            AND customer_id IS NULL
            AND phone_number LIKE '%' || RIGHT(${normalizedPhone}, 10) || '%'
        `;
      } catch (mergeError) {
        console.warn('[IdentityEngine] Non-fatal: Orphaned records merge failed', mergeError);
      }

      return cid;
    } catch (error) {
      console.error('[IdentityEngine] Failed to resolve identity:', error);
      throw error;
    }
  }

  static async linkConversation(conversationId: string, customerId: string): Promise<void> {
    await sql`
      UPDATE conversations 
      SET customer_id = ${customerId}, updated_at = NOW()
      WHERE id = ${conversationId};
    `;
  }

  static async linkLead(leadId: string, customerId: string): Promise<void> {
    await sql`
      UPDATE leads 
      SET customer_id = ${customerId}, updated_at = NOW()
      WHERE id = ${leadId};
    `;
  }

  /**
   * Unified context based ONLY on customer_id, no fuzzy matching here.
   */
  static async getContext(customerId: string, conversationId?: string): Promise<any> {
    try {
      const profiles = await sql`SELECT * FROM customer_profiles WHERE id = ${customerId}`;
      const profile = profiles[0];
      if (!profile) return null;

      const leads = await sql`
        SELECT form_name, raw_data 
        FROM leads 
        WHERE tenant_id = ${profile.tenant_id} AND customer_id = ${customerId}
        ORDER BY created_at DESC 
        LIMIT 1
      `;
      const lead = leads[0];

      let memory = null;
      if (conversationId) {
         const memories = await sql`SELECT * FROM conversation_memory WHERE conversation_id = ${conversationId}`;
         memory = memories[0];
      }

      return {
        profile,
        latestForm: lead ? { name: lead.form_name, data: lead.raw_data } : null,
        memory: memory ? {
           summary: memory.summary_text,
           intent: memory.buying_intent,
           sentiment: memory.sentiment,
           objections: memory.objections
        } : null
      };
    } catch (e) {
      console.error('[IdentityEngine] Failed to get context', e);
      return null;
    }
  }
}
