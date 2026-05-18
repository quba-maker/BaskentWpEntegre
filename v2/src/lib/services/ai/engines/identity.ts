import { sql } from '@/lib/db';

export class IdentityEngine {
  /**
   * Resolves a customer identity by phone number.
   * Creates a new profile if it doesn't exist, otherwise returns the existing one.
   * Merges incoming data (e.g. from forms or WhatsApp) to enrich the profile.
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

    // Normalize phone number (strip non-digits to ensure uniqueness across platforms)
    const normalizedPhone = this.normalizePhone(phoneNumber);

    try {
      // Upsert logic: If the phone exists in the tenant, update missing fields.
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

      return result[0].id;
    } catch (error) {
      console.error('[IdentityEngine] Failed to resolve identity:', error);
      throw error;
    }
  }

  /**
   * Links an existing conversation to a customer_profile.
   */
  static async linkConversation(conversationId: string, customerId: string): Promise<void> {
    await sql`
      UPDATE conversations 
      SET customer_id = ${customerId}, updated_at = NOW()
      WHERE id = ${conversationId};
    `;
  }

  /**
   * Links an existing lead (form submission) to a customer_profile.
   */
  static async linkLead(leadId: string, customerId: string): Promise<void> {
    await sql`
      UPDATE leads 
      SET customer_id = ${customerId}, updated_at = NOW()
      WHERE id = ${leadId};
    `;
  }

  /**
   * Helper to normalize phone numbers (e.g., removing +, spaces, brackets)
   * Converts +90 555 123 45 67 to 905551234567
   */
  static normalizePhone(phone: string): string {
    return phone.replace(/\D/g, ''); 
  }

  /**
   * Fetches unified customer context (Profile + CRM + Form Data + Memory) for AI Orchestration.
   */
  static async getContext(customerId: string, conversationId?: string): Promise<any> {
    try {
      // Get profile
      const profiles = await sql`SELECT * FROM customer_profiles WHERE id = ${customerId}`;
      const profile = profiles[0];
      if (!profile) return null;

      // Get latest form data
      const leads = await sql`
        SELECT form_name, raw_data 
        FROM leads 
        WHERE tenant_id = ${profile.tenant_id} AND (
          customer_id = ${customerId} OR 
          phone_number LIKE '%' || RIGHT(${profile.primary_phone}, 10) || '%'
        )
        ORDER BY created_at DESC 
        LIMIT 1
      `;
      const lead = leads[0];

      // Get memory if conversationId exists
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
