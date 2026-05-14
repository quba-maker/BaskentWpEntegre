import { neon } from "@neondatabase/serverless";
import { logger } from "./logger";

// ==========================================
// QUBA AI — Tenant-Aware DB Wrapper (RLS Enforced)
// Unsafe raw SQL'i engeller, tenant izolasyonunu DB seviyesinde garanti eder.
// ==========================================

export class TenantDB {
  private tenantId: string;
  private isAdmin: boolean;
  private log = logger.withContext({ module: 'TenantDB' });
  private sql = neon(process.env.DATABASE_URL!);

  constructor(tenantId: string, isAdmin: boolean = false) {
    if (!tenantId) throw new Error("TenantDB instance requires a valid tenantId");
    this.tenantId = tenantId;
    this.isAdmin = isAdmin;
    this.log = this.log.withContext({ tenantId, isAdmin });
  }

  /**
   * Güvenli raw query executor — RLS Context'i transaction içerisinde basar.
   * Connection pool sızıntısını önler.
   */
  async executeSafe(query: any) {
    const startTime = Date.now();
    
    try {
      // Neon HTTP Driver stateless'tır.
      // RLS context'inin kaybolmaması için, SET LOCAL sorgusunu 
      // asıl sorguyla beraber tek bir transaction batch'i olarak gönderiyoruz.
      const result = await this.sql.transaction([
        this.isAdmin 
          ? this.sql`SET LOCAL quba.is_admin = 'true'`
          : this.sql`SET LOCAL quba.current_tenant = ${this.tenantId}`,
        query
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
      const result = await this.sql.transaction([
        this.isAdmin 
          ? this.sql`SET LOCAL quba.is_admin = 'true'`
          : this.sql`SET LOCAL quba.current_tenant = ${this.tenantId}`,
        ...queries
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
