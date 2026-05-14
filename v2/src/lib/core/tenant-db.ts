import { logger } from "./logger";
import { sql } from "@/lib/db";

// ==========================================
// QUBA AI — Tenant-Aware DB Wrapper (RLS Enforced)
// Unsafe raw SQL'i engeller, tenant izolasyonunu DB seviyesinde garanti eder.
// ==========================================

export class TenantDB {
  public readonly tenantId: string;
  private isAdmin: boolean;
  private log = logger.withContext({ module: 'TenantDB' });
  private sql = sql;

  constructor(tenantId: string, isAdmin: boolean = false) {
    if (!tenantId) throw new Error("TenantDB instance requires a valid tenantId");
    this.tenantId = tenantId;
    this.isAdmin = isAdmin;
    this.log = this.log.withContext({ tenantId, isAdmin });
  }

  /**
   * Güvenli raw query executor — RLS Context'i transaction içerisinde basar.
   * String interpolation yerine Parameterized Query'leri [query, params] formatında destekler.
   */
  async executeSafe(query: any, params?: any[]) {
    const startTime = Date.now();
    
    try {
      const q = typeof query === 'string' 
        ? this.sql.query(query, params || []) 
        : query;

      // Neon HTTP Driver stateless'tır.
      // RLS context'inin kaybolmaması için, SET LOCAL sorgusunu 
      // asıl sorguyla beraber tek bir transaction batch'i olarak gönderiyoruz.
      // Postgres SET komutu parametre kabul etmediği için SELECT set_config() kullanıyoruz!
      const result = await this.sql.transaction([
        this.isAdmin 
          ? this.sql`SELECT set_config('quba.is_admin', 'true', true)`
          : this.sql`SELECT set_config('quba.current_tenant', ${this.tenantId}, true)`,
        q
      ]);
      
      const duration = Date.now() - startTime;
      if (duration > 1000) {
        this.log.warn(`🐢 Slow Query Detected`, { durationMs: duration });
      }
      
      // transaction array döndürür, bizim asıl sonucumuz 2. elemanda (index 1)
      return result[1];
    } catch (error: any) {
      this.log.error(`ExecuteSafe query failed (RLS Error?)`, error);
      throw error;
    }
  }

  /**
   * Çoklu query'leri aynı transaction (ve RLS context'i) içerisinde çalıştırır.
   * Lock'lar ve ardışık operasyonlar için kritik!
   */
  async executeTransaction(queries: any[]) {
    const startTime = Date.now();
    try {
      const formattedQueries = queries.map(q => typeof q === 'string' ? this.sql.query(q) : q);
      
      const result = await this.sql.transaction([
        this.isAdmin 
          ? this.sql`SELECT set_config('quba.is_admin', 'true', true)`
          : this.sql`SELECT set_config('quba.current_tenant', ${this.tenantId}, true)`,
        ...formattedQueries
      ]);
      const duration = Date.now() - startTime;
      if (duration > 2000) {
        this.log.warn(`🐢 Slow Transaction Detected`, { durationMs: duration });
      }
      return result.slice(1);
    } catch (error: any) {
      this.log.error(`ExecuteTransaction failed`, error);
      throw error;
    }
  }
}

// Global olarak çağrılacak factory
export function withTenantDB(tenantId: string, isAdmin: boolean = false) {
  return new TenantDB(tenantId, isAdmin);
}
