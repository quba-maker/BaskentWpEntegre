import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { AiControlTower } from "@/components/features/ai-control/AiControlTower";

/**
 * AI Control Tower — Phase 7
 * Enterprise AI Orchestration Dashboard
 * Admin/Owner only.
 */
export default async function AiControlPage() {
  let session;
  
  try {
    session = await getSession();
  } catch {
    redirect('/');
  }
  
  if (!session || !['admin', 'owner', 'platform_admin'].includes(session.role)) {
    redirect(`/${session?.tenantSlug || ''}`);
  }

  return (
    <div className="p-4 md:p-6 lg:p-8 max-w-[1400px] mx-auto">
      <AiControlTower />
    </div>
  );
}
