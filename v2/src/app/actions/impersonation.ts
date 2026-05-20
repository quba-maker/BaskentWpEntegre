"use server";

import { stopImpersonation } from "@/lib/auth/session";
import { logAudit } from "@/lib/audit";
import { getSession } from "@/lib/auth/session";

export async function stopImpersonationAction() {
  const session = await getSession();
  if (session && session.impersonatedTenantId) {
    await logAudit({
      tenantId: session.impersonatedTenantId,
      userId: session.userId,
      userEmail: session.email,
      impersonatorId: session.userId,
      action: "impersonation_stopped",
    });
  }
  return stopImpersonation();
}
