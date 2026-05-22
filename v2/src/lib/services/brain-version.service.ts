import { sql } from '@/lib/db';
import { logger } from '@/lib/core/logger';
import crypto from 'crypto';

/**
 * 🧠 Brain Version Service — V2 Prompt Safety
 * 
 * Her prompt değişikliğini versiyonlar, hash'ler ve
 * rollback desteği sağlar. Production-grade prompt yönetimi.
 * 
 * V2: Rollback artık channel_prompts tablosuna yazar.
 * Rollback: USE_V2_BRAIN_VERSIONS=false → settings fallback
 */

const log = logger.withContext({ module: 'BrainVersionService' });

function isV2BrainVersionsEnabled(): boolean {
  return process.env.USE_V2_BRAIN_VERSIONS !== 'false'; // default: true
}

// V1 promptKey → V2 channel_prompts.name mapping
function promptKeyToName(promptKey: string): string | null {
  const map: Record<string, string> = {
    'system_prompt_whatsapp': 'WhatsApp System Prompt',
    'system_prompt_tr': 'Social TR Prompt',
    'system_prompt_foreign': 'Social Foreign Prompt',
  };
  return map[promptKey] || null;
}

// Check if prompt_key column exists (cached after first check)
let _hasPromptKeyColumn: boolean | null = null;

async function hasPromptKeyColumn(): Promise<boolean> {
  if (_hasPromptKeyColumn !== null) return _hasPromptKeyColumn;
  try {
    const result = await sql`
      SELECT column_name FROM information_schema.columns 
      WHERE table_name = 'brain_versions' AND column_name = 'prompt_key'
    `;
    _hasPromptKeyColumn = result.length > 0;
  } catch {
    _hasPromptKeyColumn = false;
  }
  return _hasPromptKeyColumn;
}

export class BrainVersionService {

  /**
   * Save a new version of the brain (prompt + knowledge).
   * Automatically increments version number and marks as active for that prompt_key.
   */
  static async saveVersion(params: {
    tenantId: string;
    systemPrompt: string;
    promptKey?: string;
    knowledge?: Record<string, any>;
    changedBy?: string;
    changeSummary?: string;
  }): Promise<{ versionNumber: number; promptHash: string }> {
    const { tenantId, systemPrompt, knowledge, changedBy, changeSummary } = params;
    const promptKey = params.promptKey || 'system_prompt_whatsapp';

    // Calculate prompt hash for integrity verification
    const promptHash = crypto.createHash('sha256').update(systemPrompt || '').digest('hex');

    // Get next version number (global for tenant — maintains simple ordering)
    const latestVersion = await sql`
      SELECT COALESCE(MAX(version_number), 0) as max_version
      FROM brain_versions
      WHERE tenant_id = ${tenantId}
    `;
    const nextVersion = (parseInt(latestVersion[0]?.max_version) || 0) + 1;

    const hasColumn = await hasPromptKeyColumn();

    if (hasColumn) {
      // Deactivate previous versions for the SAME prompt_key only
      await sql`
        UPDATE brain_versions SET is_active = false 
        WHERE tenant_id = ${tenantId} AND prompt_key = ${promptKey}
      `;

      // Insert new version with prompt_key
      await sql`
        INSERT INTO brain_versions (
          tenant_id, version_number, system_prompt, prompt_key, knowledge_snapshot,
          changed_by, change_summary, prompt_hash, is_active
        ) VALUES (
          ${tenantId}, ${nextVersion}, ${systemPrompt}, ${promptKey},
          ${knowledge ? JSON.stringify(knowledge) : null}::jsonb,
          ${changedBy || 'admin'}, ${changeSummary || `Version ${nextVersion}`},
          ${promptHash}, true
        )
      `;
    } else {
      // Fallback: table exists but without prompt_key column
      await sql`
        UPDATE brain_versions SET is_active = false 
        WHERE tenant_id = ${tenantId}
      `;

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
    }

    log.info(`[BRAIN_VERSIONED] v${nextVersion} saved for ${promptKey}`, { tenantId, promptHash: promptHash.substring(0, 12) });

    return { versionNumber: nextVersion, promptHash };
  }

  /**
   * Get version history for a tenant.
   * Returns all prompt versions across all channels.
   */
  static async getHistory(tenantId: string, promptKey?: string, limit = 20): Promise<any[]> {
    const hasColumn = await hasPromptKeyColumn();
    
    if (hasColumn) {
      if (promptKey) {
        return await sql`
          SELECT id, version_number, changed_by, change_summary, prompt_hash, 
                 prompt_key, is_active, created_at,
                 LEFT(system_prompt, 200) as prompt_preview
          FROM brain_versions
          WHERE tenant_id = ${tenantId} AND prompt_key = ${promptKey}
          ORDER BY version_number DESC
          LIMIT ${limit}
        `;
      }
      return await sql`
        SELECT id, version_number, changed_by, change_summary, prompt_hash, 
               prompt_key, is_active, created_at,
               LEFT(system_prompt, 200) as prompt_preview
        FROM brain_versions
        WHERE tenant_id = ${tenantId}
        ORDER BY version_number DESC
        LIMIT ${limit}
      `;
    }

    // Fallback without prompt_key
    if (promptKey) {
      const searchStr = `%${promptKey}%`;
      return await sql`
        SELECT id, version_number, changed_by, change_summary, prompt_hash, 
               is_active, created_at,
               LEFT(system_prompt, 200) as prompt_preview
        FROM brain_versions
        WHERE tenant_id = ${tenantId} AND change_summary LIKE ${searchStr}
        ORDER BY version_number DESC
        LIMIT ${limit}
      `;
    }

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
   * V2: Updates channel_prompts table (runtime source).
   * V1 fallback: Updates settings table.
   */
  static async rollback(tenantId: string, versionNumber: number): Promise<string | null> {
    const version = await this.getVersion(tenantId, versionNumber);
    if (!version) return null;

    // Determine which prompt to update
    const promptKey = version.prompt_key || 'system_prompt_whatsapp';
    const hasColumn = await hasPromptKeyColumn();

    // Mark versions active/inactive in brain_versions
    if (hasColumn) {
      await sql`UPDATE brain_versions SET is_active = false WHERE tenant_id = ${tenantId} AND prompt_key = ${promptKey}`;
    } else {
      await sql`UPDATE brain_versions SET is_active = false WHERE tenant_id = ${tenantId}`;
    }
    
    await sql`UPDATE brain_versions SET is_active = true WHERE tenant_id = ${tenantId} AND version_number = ${versionNumber}`;

    if (isV2BrainVersionsEnabled()) {
      // V2: Update channel_prompts (the actual runtime source)
      const promptName = promptKeyToName(promptKey);
      
      if (promptName) {
        await sql`
          UPDATE channel_prompts 
          SET prompt_text = ${version.system_prompt}, 
              version = version + 1, 
              updated_at = NOW()
          WHERE tenant_id = ${tenantId} 
            AND name = ${promptName} 
            AND is_active = true
        `;
        log.info(`[BRAIN_ROLLBACK_V2] Rolled back ${promptKey} → channel_prompts[${promptName}] to v${versionNumber}`, { tenantId });
      } else {
        log.warn(`[BRAIN_ROLLBACK_V2] Unknown promptKey mapping: ${promptKey}`, { tenantId });
      }
    } else {
      // V1 FALLBACK: Update settings table
      await sql`
        UPDATE settings 
        SET value = ${version.system_prompt}, updated_at = NOW()
        WHERE tenant_id = ${tenantId} AND key = ${promptKey}
      `;
      log.info(`[BRAIN_ROLLBACK_V1] Rolled back ${promptKey} to v${versionNumber} (settings)`, { tenantId });
    }

    return version.system_prompt;
  }

  /**
   * Get the currently active version for a specific prompt key.
   */
  static async getActiveVersion(tenantId: string, promptKey?: string): Promise<any | null> {
    const key = promptKey || 'system_prompt_whatsapp';
    const hasColumn = await hasPromptKeyColumn();

    if (hasColumn) {
      const rows = await sql`
        SELECT * FROM brain_versions
        WHERE tenant_id = ${tenantId} AND is_active = true AND prompt_key = ${key}
        ORDER BY version_number DESC
        LIMIT 1
      `;
      return rows[0] || null;
    }

    const rows = await sql`
      SELECT * FROM brain_versions
      WHERE tenant_id = ${tenantId} AND is_active = true
      ORDER BY version_number DESC
      LIMIT 1
    `;
    return rows[0] || null;
  }
}
