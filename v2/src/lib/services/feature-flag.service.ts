import { sql } from '../db';

/**
 * Feature Flag Service — Phase 7
 * Reads tenant-scoped feature flags from the `feature_flags` table.
 * Used by the worker pipeline to gate AI sub-systems.
 */
export class FeatureFlagService {
  private static cache = new Map<string, { flags: Record<string, boolean>; expiresAt: number }>();
  private static TTL_MS = 60_000; // 1 minute cache

  /**
   * Get all feature flags for a tenant (with 1-min cache).
   */
  static async getFlags(tenantId: string): Promise<Record<string, boolean>> {
    const cached = this.cache.get(tenantId);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.flags;
    }

    try {
      const rows = await sql`
        SELECT flag_key, is_enabled
        FROM feature_flags
        WHERE tenant_id = ${tenantId}
      `;
      const flags: Record<string, boolean> = {};
      for (const row of rows) {
        flags[row.flag_key] = row.is_enabled;
      }
      this.cache.set(tenantId, { flags, expiresAt: Date.now() + this.TTL_MS });
      return flags;
    } catch {
      // Table might not exist yet — return empty (all defaults)
      return {};
    }
  }

  /**
   * Check if a specific flag is enabled.
   * Returns true by default if flag doesn't exist (opt-out model).
   */
  static async isEnabled(tenantId: string, flagKey: string, defaultValue = true): Promise<boolean> {
    const flags = await this.getFlags(tenantId);
    return flags[flagKey] ?? defaultValue;
  }

  /**
   * Invalidate cache for a tenant (call after flag toggle).
   */
  static invalidateCache(tenantId: string) {
    this.cache.delete(tenantId);
  }
}
