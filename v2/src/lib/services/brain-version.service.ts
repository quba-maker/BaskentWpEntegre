import { sql } from '@/lib/db';
import { logger } from '@/lib/core/logger';
import crypto from 'crypto';

/**
 * 🧠 Brain Version Service — Phase 6 Prompt Safety
 * 
 * Her prompt değişikliğini versiyonlar, hash'ler ve
 * rollback desteği sağlar. Production-grade prompt yönetimi.
 */

const log = logger.withContext({ module: 'BrainVersionService' });

export class BrainVersionService {

  /**
   * Save a new version of the brain (prompt + knowledge).
   * Automatically increments version number and marks as active.
   */
  static async saveVersion(params: {
    tenantId: string;
    systemPrompt: string;
    knowledge?: Record<string, any>;
    changedBy?: string;
    changeSummary?: string;
  }): Promise<{ versionNumber: number; promptHash: string }> {
    const { tenantId, systemPrompt, knowledge, changedBy, changeSummary } = params;

    // Calculate prompt hash for integrity verification
    const promptHash = crypto.createHash('sha256').update(systemPrompt || '').digest('hex');

    // Get next version number
    const latestVersion = await sql`
      SELECT COALESCE(MAX(version_number), 0) as max_version
      FROM brain_versions
      WHERE tenant_id = ${tenantId}
    `;
    const nextVersion = (parseInt(latestVersion[0]?.max_version) || 0) + 1;

    // Deactivate all previous versions
    await sql`
      UPDATE brain_versions SET is_active = false WHERE tenant_id = ${tenantId}
    `;

    // Insert new version
    await sql`
      INSERT INTO brain_versions (
        tenant_id, version_number, system_prompt, knowledge_snapshot,
        changed_by, change_summary, prompt_hash, is_active
      ) VALUES (
        ${tenantId}, ${nextVersion}, ${systemPrompt},
        ${knowledge ? JSON.stringify(knowledge) : null}::jsonb,
        ${changedBy || 'admin'}, ${changeSummary || `Version ${nextVersion}`},
        ${promptHash}, true
      )
    `;

    log.info(`[BRAIN_VERSIONED] v${nextVersion} saved for tenant`, { tenantId, promptHash: promptHash.substring(0, 12) });

    return { versionNumber: nextVersion, promptHash };
  }

  /**
   * Get version history for a tenant.
   */
  static async getHistory(tenantId: string, limit = 20): Promise<any[]> {
    return await sql`
      SELECT id, version_number, changed_by, change_summary, prompt_hash, 
             is_active, created_at,
             LEFT(system_prompt, 200) as prompt_preview
      FROM brain_versions
      WHERE tenant_id = ${tenantId}
      ORDER BY version_number DESC
      LIMIT ${limit}
    `;
  }

  /**
   * Get a specific version's full content.
   */
  static async getVersion(tenantId: string, versionNumber: number): Promise<any | null> {
    const rows = await sql`
      SELECT * FROM brain_versions
      WHERE tenant_id = ${tenantId} AND version_number = ${versionNumber}
    `;
    return rows[0] || null;
  }

  /**
   * Rollback to a specific version — restores prompt to that snapshot.
   * Returns the restored prompt text.
   */
  static async rollback(tenantId: string, versionNumber: number): Promise<string | null> {
    const version = await this.getVersion(tenantId, versionNumber);
    if (!version) return null;

    // Deactivate all, activate target
    await sql`UPDATE brain_versions SET is_active = false WHERE tenant_id = ${tenantId}`;
    await sql`UPDATE brain_versions SET is_active = true WHERE tenant_id = ${tenantId} AND version_number = ${versionNumber}`;

    // Update the actual tenant brain prompt in settings (key-value table)
    await sql`
      UPDATE settings 
      SET value = ${version.system_prompt}, updated_at = NOW()
      WHERE tenant_id = ${tenantId} AND key = 'system_prompt_whatsapp'
    `;

    log.info(`[BRAIN_ROLLBACK] Rolled back to v${versionNumber}`, { tenantId });

    return version.system_prompt;
  }

  /**
   * Get the currently active version for a tenant.
   */
  static async getActiveVersion(tenantId: string): Promise<any | null> {
    const rows = await sql`
      SELECT * FROM brain_versions
      WHERE tenant_id = ${tenantId} AND is_active = true
      ORDER BY version_number DESC
      LIMIT 1
    `;
    return rows[0] || null;
  }
}
