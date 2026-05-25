import { TenantDB } from '@/lib/core/tenant-db';
import { logger } from '@/lib/core/logger';

// ==========================================
// Profile Enrichment Service (SaaS-Ready)
// ==========================================
// Resolves Instagram IGSID / Messenger PSID to real names
// Uses Meta Graph API: GET /{user_id}?fields=name,username
//
// Design:
//   - Tenant-isolated: uses per-channel access token
//   - Idempotent: skips if already enriched (patient_name set)
//   - Non-blocking: errors don't break message pipeline
//   - Multi-provider: Instagram + Messenger support
// ==========================================

interface EnrichmentResult {
  name: string | null;
  username: string | null;
  profilePic: string | null;
}

export class ProfileEnrichmentService {
  private db: TenantDB;
  private log = logger.withContext({ module: 'ProfileEnrichment' });

  constructor(db: TenantDB) {
    this.db = db;
  }

  /**
   * Enrich a conversation's contact profile from Meta Graph API
   * Called after incoming message is saved, non-blocking
   */
  async enrichIfNeeded(params: {
    tenantId: string;
    conversationId: string;
    phoneNumber: string;  // Actually IGSID or PSID for social channels
    channel: string;
    accessToken: string;
    customerId?: string;
  }): Promise<void> {
    const { tenantId, conversationId, phoneNumber, channel, accessToken, customerId } = params;

    // Only enrich Instagram and Messenger (WhatsApp already sends profile name)
    if (!['instagram', 'meta_instagram', 'messenger'].includes(channel)) return;

    try {
      // Check if already enriched (patient_name is not null and not the raw ID)
      const existing = await this.db.executeSafe({
        text: `SELECT patient_name FROM conversations WHERE id = $1 AND tenant_id = $2`,
        values: [conversationId, tenantId]
      }) as any[];

      const currentName = existing?.[0]?.patient_name;
      
      // Skip if already has a real name (not just the numeric ID)
      if (currentName && currentName !== phoneNumber && !/^\d{10,}$/.test(currentName)) {
        return;
      }

      // Fetch profile from Meta Graph API
      const profile = await this.fetchMetaProfile(phoneNumber, channel, accessToken);
      
      if (!profile.name && !profile.username) {
        this.log.info('Profile enrichment: no data returned', { phoneNumber, channel });
        return;
      }

      // Determine display name: prefer full name, fallback to @username
      const displayName = profile.name || (profile.username ? `@${profile.username}` : null);
      
      if (!displayName) return;

      // Update conversation patient_name
      await this.db.executeSafe({
        text: `
          UPDATE conversations 
          SET patient_name = COALESCE(NULLIF(patient_name, $3), $4),
              updated_at = NOW()
          WHERE id = $1 AND tenant_id = $2
        `,
        values: [conversationId, tenantId, phoneNumber, displayName]
      });

      // Update customer_profiles if exists
      if (customerId) {
        await this.db.executeSafe({
          text: `
            UPDATE customer_profiles 
            SET first_name = COALESCE(NULLIF(first_name, ''), $3),
                updated_at = NOW()
            WHERE id = $1 AND tenant_id = $2
          `,
          values: [customerId, tenantId, displayName]
        });
      }

      this.log.info('Profile enriched', { 
        conversationId, 
        channel,
        displayName,
        hasUsername: !!profile.username,
        hasProfilePic: !!profile.profilePic
      });

    } catch (error: any) {
      // Non-fatal: never break the message pipeline for profile enrichment
      this.log.warn('Profile enrichment failed (non-fatal)', {
        phoneNumber,
        channel,
        error: error.message
      });
    }
  }

  /**
   * Fetch user profile from Meta Graph API
   */
  private async fetchMetaProfile(
    userId: string, 
    channel: string, 
    accessToken: string
  ): Promise<EnrichmentResult> {
    const isInstagram = channel === 'instagram' || channel === 'meta_instagram';
    
    // Instagram: GET /{IGSID}?fields=name,username&access_token=...
    // Messenger: GET /{PSID}?fields=name,profile_pic&access_token=...
    const fields = isInstagram 
      ? 'name,username' 
      : 'name,profile_pic';

    const url = `https://graph.facebook.com/v19.0/${userId}?fields=${fields}&access_token=${accessToken}`;

    try {
      const response = await fetch(url, { 
        method: 'GET',
        signal: AbortSignal.timeout(5000) // 5s timeout
      });

      if (!response.ok) {
        const errorBody = await response.text().catch(() => '');
        this.log.warn('Meta Graph API profile fetch failed', {
          userId,
          status: response.status,
          errorSnippet: errorBody.substring(0, 200)
        });
        return { name: null, username: null, profilePic: null };
      }

      const data = await response.json();
      
      return {
        name: data.name || null,
        username: data.username || null,
        profilePic: data.profile_pic || null,
      };
    } catch (error: any) {
      this.log.warn('Meta Graph API profile fetch error', {
        userId,
        error: error.message
      });
      return { name: null, username: null, profilePic: null };
    }
  }
}
