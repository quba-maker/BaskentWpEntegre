import { withTenantDB } from "@/lib/core/tenant-db";

// ==========================================
// QUBA AI — Audit Logger (Enterprise)
// Kritik işlemleri loglar: login, delete, role change, settings update
// ==========================================

export async function logAudit(params: {
  tenantId?: string | null;
  userId?: string | null;
  userEmail?: string | null;
  impersonatorId?: string | null; // Added for Platform Admin Impersonation
  action: string;
  entityType?: string;
  entityId?: string;
  details?: Record<string, any>;
}) {
  try {
    const tenantId = params.tenantId || 'admin-system';
    const isPlatformContext = !params.tenantId;
    const db = withTenantDB(tenantId, isPlatformContext);

    await db.executeSafe({
      text: `
        INSERT INTO audit_logs (tenant_id, user_id, user_email, impersonator_id, action, entity_type, entity_id, details)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
      `,
      values: [
        params.tenantId || null,
        params.userId || null,
        params.userEmail || null,
        params.impersonatorId || null,
        params.action,
        params.entityType || null,
        params.entityId || null,
        params.details ? JSON.stringify(params.details) : null
      ]
    });
  } catch (e: any) {
    // Audit log asla ana işlemi bloklamaz
    // Audit yazma hatası — sessizce yutmuyoruz ama logger kullanıyoruz
    const { logger } = await import("@/lib/core/logger");
    logger.withContext({ module: 'AuditLog' }).error("Audit log yazılamadı", e instanceof Error ? e : new Error(String(e)));
  }
}
