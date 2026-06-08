import { Sidebar } from "@/components/layout/sidebar";
import { SidebarLayoutWrapper } from "@/components/layout/sidebar-layout-wrapper";
import { DashboardProviders } from "@/components/layout/dashboard-providers";
import { LayoutDashboard, MessageSquare, ClipboardList, Settings, Bot, BarChart3 } from "lucide-react";
import Link from "next/link";
import { getSession } from "@/lib/auth/session";
import { getTenantBootstrapData } from "@/lib/domain/tenant/bootstrap";
import { Metadata } from "next";
import { ImpersonationBanner } from "@/components/layout/impersonation-banner";
import InboxUnreadBadge from "@/components/features/inbox/inbox-unread-badge";

// ==========================================
// Dashboard Layout — Sidebar + Mobile Nav
// ==========================================

export async function generateMetadata({ params }: { params: Promise<{ tenant_slug: string }> }): Promise<Metadata> {
  const resolvedParams = await params;
  const session = await getSession();
  const tenantData = session?.tenantId ? await getTenantBootstrapData(session.tenantId) : null;
  const brandingName = tenantData?.profile.name || "Quba AI";
  
  return {
    title: {
      template: `%s | ${brandingName}`,
      default: `${brandingName} Workspace`,
    },
    themeColor: tenantData?.profile.primary_color || "#007AFF",
    icons: tenantData?.profile.logo_url ? [{ rel: "icon", url: tenantData.profile.logo_url }] : undefined,
  };
}

export default async function DashboardLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ tenant_slug: string }>;
}) {
  const resolvedParams = await params;
  const tenantSlug = resolvedParams.tenant_slug;
  const session = await getSession();

  // Dynamic Auto-Impersonation for Platform Admins visiting different workspaces
  if (session && session.role === "platform_admin" && session.tenantSlug !== tenantSlug && tenantSlug !== "admin") {
    const { withTenantDB } = await import("@/lib/core/tenant-db");
    const db = withTenantDB('admin-system', true);
    const targetTenants = await db.executeSafe({
      text: `SELECT id, slug FROM tenants WHERE slug = $1 AND status = 'active' LIMIT 1`,
      values: [tenantSlug]
    });
    
    if (targetTenants.length > 0) {
      const target = targetTenants[0];
      const { startImpersonation } = await import("@/lib/auth/session");
      const res = await startImpersonation(target.id, target.slug);
      if (res.success) {
        const { redirect } = await import("next/navigation");
        redirect(res.redirectUrl || `/${target.slug}`);
      }
    }
  }

  const slug = session?.tenantSlug || "";
  const role = session?.role;
  const isAdmin = role === "platform_admin" || role === "admin" || role === "owner";
  
  // Fetch tenant bootstrap context
  let tenantData = null;
  if (session?.tenantId) {
    tenantData = await getTenantBootstrapData(session.tenantId);
  }
  
  // Use tenant modules for visibility
  const hasAiFeature = tenantData?.flags?.['ai_orchestrator'] || true; 
  const canManageBot = role !== "viewer" && hasAiFeature;

  return (
    <div className="h-full flex flex-col md:flex-row overflow-hidden" data-tenant={slug}>
      {/* Desktop Sidebar */}
      <SidebarLayoutWrapper>
        <Sidebar tenantData={tenantData} />
      </SidebarLayoutWrapper>

      {/* Main Content */}
      <main className="flex-1 overflow-auto h-full flex flex-col relative pb-[env(safe-area-inset-bottom)] md:pb-0 bg-[--q-light-bg]">
        {session?.impersonatedTenantId && tenantData && (
          <ImpersonationBanner tenantName={tenantData.profile.name} />
        )}
        <DashboardProviders tenantId={session?.tenantId} tenantData={tenantData} role={role} userId={session?.userId}>
          {children}
        </DashboardProviders>
      </main>

      {/* Mobile Bottom Navigation (iOS Style, Role-Aware) */}
      <nav className="md:hidden flex-none w-full h-[72px] bg-white/80 backdrop-blur-[30px] border-t border-black/5 flex items-center justify-around px-2 z-50 pb-[env(safe-area-inset-bottom)] overflow-x-auto no-scrollbar">
        <MobileNavLink href={`/${slug}`} icon={<LayoutDashboard className="w-6 h-6" />} label="Panel" />
        <MobileNavLink href={`/${slug}/inbox`} icon={<MessageSquare className="w-6 h-6" />} label="Mesajlar" active badge={<InboxUnreadBadge />} />
        <MobileNavLink href={`/${slug}/forms`} icon={<ClipboardList className="w-6 h-6" />} label="Formlar" />
        {canManageBot && (
          <>
            <MobileNavLink href={`/${slug}/bot`} icon={<Bot className="w-6 h-6" />} label="Bot" />
            <MobileNavLink href={`/${slug}/analytics`} icon={<BarChart3 className="w-6 h-6" />} label="Analiz" />
          </>
        )}
        {isAdmin && (
          <MobileNavLink href={`/${slug}/settings`} icon={<Settings className="w-6 h-6" />} label="Ayarlar" />
        )}
      </nav>
    </div>
  );
}

function MobileNavLink({ href, icon, label, active, badge }: { href: string; icon: React.ReactNode; label: string; active?: boolean; badge?: React.ReactNode }) {
  return (
    <Link
      href={href}
      className={`relative flex flex-col items-center gap-1 p-2 transition-colors ${
        active ? "text-[--q-blue]" : "text-[--q-text-secondary] hover:text-[--q-blue]"
      }`}
    >
      {icon}
      <span className="text-[10px] font-medium">{label}</span>
      {badge && <div className="absolute top-1 right-2">{badge}</div>}
    </Link>
  );
}
