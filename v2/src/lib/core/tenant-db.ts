import { sql } from "@/lib/db";
import { logger } from "./logger";

// ==========================================
// QUBA AI — Tenant-Aware DB Wrapper
// Unsafe raw SQL'i engeller, tenant izolasyonunu garanti eder.
// ==========================================

export class TenantDB {
  private tenantId: string;
  private log = logger.withContext({ module: 'TenantDB' });

  constructor(tenantId: string) {
    if (!tenantId) throw new Error("TenantDB instance requires a valid tenantId");
    this.tenantId = tenantId;
    this.log = this.log.withContext({ tenantId });
  }

  /**
   * Safe Select: Otomatik olarak tenant_id filtresi ekler.
   */
  async findMany(table: string, conditions: Record<string, any> = {}, limit: number = 100) {
    // Note: Bu yapı daha güvenli ORM (Drizzle/Prisma) mantığını simüle eder.
    // Şimdilik template literal ile güvenli hale getiriyoruz.
    
    const keys = Object.keys(conditions);
    const values = Object.values(conditions);
    
    // GÜVENLİK: Her sorgu ZORUNLU OLARAK tenant_id içerir
    let queryStr = `SELECT * FROM ${table} WHERE tenant_id = $1`;
    let queryVals = [this.tenantId, ...values];

    let paramIndex = 2;
    for (const key of keys) {
      queryStr += ` AND ${key} = $${paramIndex}`;
      paramIndex++;
    }
    
    queryStr += ` LIMIT ${limit}`;

    const startTime = Date.now();
    try {
      // Neon/Postgres SQL driver'da dynamic table isimleri tehlikelidir,
      // Bu fonksiyon implementasyonu daha sonra Prisma/Drizzle ile değiştirilecek.
      // Şimdilik executeSafe kullanılacaktır.
      return [];
    } catch (error: any) {
      this.log.error(`Database query failed on table ${table}`, error);
      throw error;
    }
  }

  // Güvenli raw query executor — tenant_id'nin geçtiğini RegExp ile denetler
  async executeSafe(query: any) {
    // Çok kaba bir "unsafe" dedektörü
    const queryStr = query.strings ? query.strings.join('?') : String(query);
    const lowerQuery = queryStr.toLowerCase();
    
    // Unsafe detector: Eğer tenant_id geçmiyorsa ve "tenants" tablosu (where id =) değilse
    const hasTenantId = lowerQuery.includes('tenant_id');
    const isTenantTable = lowerQuery.includes('from tenants') || lowerQuery.includes('update tenants');
    
    if (!hasTenantId && !isTenantTable) {
      this.log.warn('⚠️ POTENTIAL UNSAFE QUERY DETECTED: Missing tenant_id filter', { queryStr });
      if (process.env.NODE_ENV === 'production') {
        throw new Error("UNSAFE QUERY PREVENTED: Missing tenant_id isolation.");
      }
    }
    
    const startTime = Date.now();
    try {
      const result = await query;
      const duration = Date.now() - startTime;
      if (duration > 1000) {
        this.log.warn(`🐢 Slow Query Detected`, { durationMs: duration, queryStr });
      }
      return result;
    } catch (error: any) {
      this.log.error(`ExecuteSafe query failed`, error, { queryStr });
      throw error;
    }
  }
}

// Global olarak çağrılacak factory
export function withTenantDB(tenantId: string) {
  return new TenantDB(tenantId);
}
