import { Sidebar } from "@/components/layout/sidebar";
import { DashboardProviders } from "@/components/layout/dashboard-providers";
import { LayoutDashboard, MessageSquare, ClipboardList, Settings, Bot, BarChart3 } from "lucide-react";
import Link from "next/link";
import { getSession } from "@/lib/auth/session";

// ==========================================
// Dashboard Layout — Sidebar + Mobile Nav
// Mobile nav is now role-aware (mirrors sidebar logic)
// ==========================================

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  const slug = session?.tenantSlug || "";
  const role = session?.role;
  const isAdmin = role === "platform_admin" || role === "admin" || role === "owner";
  const canManageBot = role !== "viewer";

  return (
    <div className="h-full flex flex-col md:flex-row overflow-hidden">
      {/* Desktop Sidebar */}
      <div className="hidden md:flex h-full">
        <Sidebar />
      </div>

      {/* Main Content */}
      <main className="flex-1 overflow-auto h-full flex flex-col relative pb-[env(safe-area-inset-bottom)] md:pb-0">
        <DashboardProviders>
          {children}
        </DashboardProviders>
      </main>

      {/* Mobile Bottom Navigation (iOS Style, Role-Aware) */}
      <nav className="md:hidden flex-none w-full h-[72px] bg-white/80 backdrop-blur-[30px] border-t border-black/5 flex items-center justify-around px-2 z-50 pb-[env(safe-area-inset-bottom)] overflow-x-auto no-scrollbar">
        <MobileNavLink href={`/${slug}`} icon={<LayoutDashboard className="w-6 h-6" />} label="Panel" />
        <MobileNavLink href={`/${slug}/inbox`} icon={<MessageSquare className="w-6 h-6" />} label="Mesajlar" active />
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

function MobileNavLink({ href, icon, label, active }: { href: string; icon: React.ReactNode; label: string; active?: boolean }) {
  return (
    <Link
      href={href}
      className={`flex flex-col items-center gap-1 p-2 transition-colors ${
        active ? "text-[--q-blue]" : "text-[--q-text-secondary] hover:text-[--q-blue]"
      }`}
    >
      {icon}
      <span className="text-[10px] font-medium">{label}</span>
    </Link>
  );
}
