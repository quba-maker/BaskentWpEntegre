import { sql } from "@/lib/db";

// ==========================================
// QUBA AI — Audit Logger (Enterprise)
// Kritik işlemleri loglar: login, delete, role change, settings update
// ==========================================

export async function logAudit(params: {
  tenantId?: string | null;
  userId?: string | null;
  userEmail?: string | null;
  action: string;
  entityType?: string;
  entityId?: string;
  details?: Record<string, any>;
}) {
  try {
    await sql`
      INSERT INTO audit_logs (tenant_id, user_id, user_email, action, entity_type, entity_id, details)
      VALUES (
        ${params.tenantId || null},
        ${params.userId || null},
        ${params.userEmail || null},
        ${params.action},
        ${params.entityType || null},
        ${params.entityId || null},
        ${params.details ? JSON.stringify(params.details) : null}
      )
    `;
  } catch (e: any) {
    // Audit log asla ana işlemi bloklamaz
    console.error("[AUDIT] Log yazılamadı:", e.message);
  }
}
