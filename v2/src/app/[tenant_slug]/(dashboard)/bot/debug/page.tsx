import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { AiDebugPanel } from "@/components/features/ai-observability/AiDebugPanel";

/**
 * AI Debug Panel — Server-side auth guard.
 * Only admin/owner roles can access this page.
 * Production prompt masking is enforced client-side.
 */
export default async function DebugPage() {
  const session = await getSession();
  
  // Auth Guard: Only admin/owner can access debug panel
  if (!session || !['admin', 'owner', 'platform_admin'].includes(session.role)) {
    redirect(`/${session?.tenantSlug || ''}`);
  }

  return (
    <div className="p-6 md:p-8 max-w-6xl mx-auto">
      <AiDebugPanel />
    </div>
  );
}
