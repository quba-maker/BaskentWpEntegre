import { getSetting } from "@/lib/db"; // V2 version of getSetting or direct DB access
import { TenantDB } from "./tenant-db";

export interface SystemFeatureFlags {
  USE_V2_STORAGE: boolean;
  USE_V2_CLASSIFIER: boolean;
  USE_V2_PROMPTS: boolean;
  USE_V2_RUNTIME: boolean; // %100 V2 Cutover (Legacy OFF)
  SHADOW_MODE_ENABLED: boolean;
  CANARY_TRAFFIC_PERCENTAGE: number;
}

/**
 * 🚩 Feature Flag Engine
 * Rollover, Canary ve Shadow operasyonlarını güvenle yönetir.
 * "Golden Tenant" Başkent için ayarları DB'den (settings tablosu) dinamik okur.
 */
export class FeatureFlagService {
  private db: TenantDB;

  constructor(db: TenantDB) {
    this.db = db;
  }

  async getFlags(): Promise<SystemFeatureFlags> {
    try {
      const res = await this.db.executeSafe(`
        SELECT key, value FROM settings 
        WHERE tenant_id = '${this.db.tenantId}' 
          AND key IN (
            'USE_V2_STORAGE', 
            'USE_V2_CLASSIFIER', 
            'USE_V2_PROMPTS', 
            'USE_V2_RUNTIME', 
            'SHADOW_MODE_ENABLED', 
            'CANARY_TRAFFIC_PERCENTAGE'
          )
      `);
      
      const map: Record<string, any> = {};
      res.forEach((r: any) => map[r.key] = r.value);

      return {
        USE_V2_STORAGE: map['USE_V2_STORAGE'] === 'true',
        USE_V2_CLASSIFIER: map['USE_V2_CLASSIFIER'] === 'true',
        USE_V2_PROMPTS: map['USE_V2_PROMPTS'] === 'true',
        USE_V2_RUNTIME: map['USE_V2_RUNTIME'] === 'true',
        SHADOW_MODE_ENABLED: map['SHADOW_MODE_ENABLED'] !== 'false', // Default true for Phase 4
        CANARY_TRAFFIC_PERCENTAGE: parseInt(map['CANARY_TRAFFIC_PERCENTAGE'] || '0')
      };
    } catch (e) {
      // Fallback: Safe defaults (All V2 disabled, Shadow enabled)
      return {
        USE_V2_STORAGE: false,
        USE_V2_CLASSIFIER: false,
        USE_V2_PROMPTS: false,
        USE_V2_RUNTIME: false,
        SHADOW_MODE_ENABLED: true,
        CANARY_TRAFFIC_PERCENTAGE: 0
      };
    }
  }

  /**
   * Canary rollout için deterministik trafik yönlendirmesi.
   * Telefon numarasına göre hashing yaparak aynı kullanıcıyı hep aynı runtime'da tutar.
   */
  shouldUseCanary(phoneNumber: string, percentage: number): boolean {
    if (percentage <= 0) return false;
    if (percentage >= 100) return true;
    
    let hash = 0;
    for (let i = 0; i < phoneNumber.length; i++) {
      hash = ((hash << 5) - hash) + phoneNumber.charCodeAt(i);
      hash |= 0;
    }
    
    return Math.abs(hash) % 100 < percentage;
  }
}
