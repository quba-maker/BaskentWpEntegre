import { getSession } from "@/lib/auth/session";
import { logger } from "./logger";
import { withTenantDB, TenantDB } from "./tenant-db";

// ==========================================
// QUBA AI — Zero-Trust Server Action Guard
// ==========================================

export interface ActionContext {
  userId: string;
  tenantId: string;
  role: string;
  email: string;
  db: TenantDB; // Her action otomatik olarak güvenli DB instance'ı alır
}

type AllowedRoles = 'owner' | 'admin' | 'agent' | 'viewer' | 'platform_admin';

export interface GuardOptions {
  roles?: AllowedRoles[];
  requireTenant?: boolean; // Platform admin actionları için false olabilir
  actionName: string;
}

export type ActionResponse<T> = {
  success: boolean;
  data?: T;
  error?: string;
  statusCode?: number;
};

/**
 * Tüm Server Action'ları sarmalayan Ana Guard (HOC).
 * İşlemleri:
 * 1. Oturum kontrolü (Auth Check)
 * 2. Rol kontrolü (RBAC)
 * 3. Hata yakalama (Global Error Boundary)
 * 4. Otomatik Audit Log
 * 5. Güvenli DB context'i enjekte etme
 */
export async function withActionGuard<T>(
  options: GuardOptions,
  handler: (ctx: ActionContext) => Promise<T>
): Promise<ActionResponse<T>> {
  const log = logger.withContext({ action: options.actionName });
  const startTime = Date.now();

  try {
    // 1. Auth Check
    const session = await getSession();
    if (!session || !session.userId) {
      log.warn("Unauthorized action attempt (No session)");
      return { success: false, error: "Oturum süresi dolmuş veya yetkisiz.", statusCode: 401 };
    }

    // 2. Tenant Check
    if (options.requireTenant !== false && !session.tenantId) {
      log.warn("Cross-tenant violation attempt (No tenantId in session)", { userId: session.userId });
      return { success: false, error: "Geçersiz firma yetkisi.", statusCode: 403 };
    }

    // 3. RBAC Check
    if (options.roles && !options.roles.includes(session.role as AllowedRoles)) {
      if (session.role !== 'platform_admin') { // Platform admin her şeyi ezer
        log.warn("Permission denied", { userId: session.userId, required: options.roles, actual: session.role });
        return { success: false, error: "Bu işlem için yetkiniz yok.", statusCode: 403 };
      }
    }

    // Context oluştur
    const ctx: ActionContext = {
      userId: session.userId,
      tenantId: session.tenantId!, // Zaten yukarıda guard ettik
      role: session.role,
      email: session.email,
      db: options.requireTenant !== false ? withTenantDB(session.tenantId!, session.role === 'platform_admin') : null as any,
    };

    log.debug(`Action started`, { userId: ctx.userId, tenantId: ctx.tenantId });

    // 4. İş mantığını çalıştır
    const data = await handler(ctx);

    // 5. Başarı Logu
    log.info(`Action completed successfully`, { 
      userId: ctx.userId, 
      tenantId: ctx.tenantId, 
      durationMs: Date.now() - startTime 
    });

    return { success: true, data };

  } catch (error: any) {
    // 6. Global Error Handling
    log.error(`Action crashed with unhandled exception`, error, {
      durationMs: Date.now() - startTime
    });
    
    // Güvenlik: Asla raw error mesajını client'a sızdırma (eğer production'daysan)
    const errorMsg = process.env.NODE_ENV === 'production' 
      ? "Sistemsel bir hata oluştu. Lütfen daha sonra tekrar deneyin."
      : error.message;

    return { success: false, error: errorMsg, statusCode: 500 };
  }
}
