import Link from "next/link";
import { 
  LayoutDashboard,
  MessageSquare, 
  ClipboardList, 
  Settings, 
  Link2,
  Bot,
  LogOut,
  BarChart3,
  Shield,
  Users,
  Eye,
  Terminal,
  Radar,
  ShieldAlert
} from "lucide-react";
import { getSession, logout, stopImpersonation } from "@/lib/auth/session";
import { redirect } from "next/navigation";
import type { TenantBootstrapData } from "@/lib/domain/tenant/bootstrap";

// ==========================================
// QUBA AI — Sidebar (Server Component)
// ==========================================

async function handleLogout() {
  "use server";
  await logout();
  redirect("/login");
}

async function handleStopImpersonation(tenantSlug: string) {
  "use server";
  await stopImpersonation();
  redirect(`/${tenantSlug}/admin`);
}

export async function Sidebar({ tenantData }: { tenantData?: TenantBootstrapData | null }) {
  const session = await getSession();
  
  const brandingName = tenantData?.profile.name || session?.tenantName || "Platform";
  const brandingLogo = tenantData?.profile.logo_url || "/quba-logo.svg";

  return (
    <aside className="w-64 border-r border-white/50 bg-white/40 backdrop-blur-[30px] h-full flex flex-col shadow-[1px_0_20px_rgba(0,0,0,0.03)] z-20">
      {/* Quba AI Branding */}
      <div className="p-5 border-b border-black/5">
        <div className="flex items-center gap-3">
          <img src={brandingLogo} alt={brandingName} className="w-9 h-9 rounded-xl object-cover shadow-sm" />
          <div>
            <h1 className="text-[15px] font-bold tracking-tight text-[--q-text-primary] truncate w-40">{brandingName}</h1>
            <p className="text-[10px] text-[--q-text-secondary] font-medium">
              {session?.impersonatedTenantId ? (
                <span className="text-[--q-purple-alt] font-semibold flex items-center gap-1">
                  <Eye className="w-3 h-3" /> Gözlem Modu
                </span>
              ) : (
                tenantData?.profile.industry === 'health' ? 'Sağlık CRM' : 'Yapay Zeka Platformu'
              )}
            </p>
          </div>
        </div>
      </div>
      
      {/* Navigation */}
      <nav className="flex-1 p-3 space-y-0.5">
        {session?.role === "platform_admin" && !session?.impersonatedTenantId && (
          <div className="mb-2 pb-2 border-b border-black/5">
            <NavLink href={`/${session?.tenantSlug || 'quba'}/admin`} icon={<Shield className="w-[18px] h-[18px]" />} label="Süper Admin" />
          </div>
        )}

        <NavLink href={`/${session?.tenantSlug || ''}`} icon={<LayoutDashboard className="w-[18px] h-[18px]" />} label="Workspace" />
        
        {/* INBOX (Always enabled for now, or check module) */}
        <NavLink href={`/${session?.tenantSlug || ''}/inbox`} icon={<MessageSquare className="w-[18px] h-[18px]" />} label="Mesajlar" />
        
        {/* FORMS */}
        {true && (
          <NavLink href={`/${session?.tenantSlug || ''}/forms`} icon={<ClipboardList className="w-[18px] h-[18px]" />} label="Formlar" />
        )}
        
        {/* AI MODULES */}
        {session?.role !== "viewer" && (
          <NavLink href={`/${session?.tenantSlug || ''}/bot`} icon={<Bot className="w-[18px] h-[18px]" />} label="AI Asistan" />
        )}
        
        {/* ANALYTICS */}
        {session?.role !== "viewer" && (
          <NavLink href={`/${session?.tenantSlug || ''}/analytics`} icon={<BarChart3 className="w-[18px] h-[18px]" />} label="Performans" />
        )}
        
        {/* ADMIN ONLY */}
        {(session?.role === "platform_admin" || session?.role === "admin" || session?.role === "owner") && (
          <NavLink href={`/${session?.tenantSlug || ''}/ai-developer`} icon={<Terminal className="w-[18px] h-[18px]" />} label="AI Developer" />
        )}
        {(session?.role === "platform_admin" || session?.role === "admin" || session?.role === "owner") && (
          <>
            <NavLink href={`/${session?.tenantSlug || ''}/integrations`} icon={<Link2 className="w-[18px] h-[18px]" />} label="Entegrasyonlar" />
            <NavLink href={`/${session?.tenantSlug || ''}/recovery`} icon={<ShieldAlert className="w-[18px] h-[18px]" />} label="Sistem Kurtarma" />
          </>
        )}
      </nav>

      {/* User & Logout */}
      <div className="p-3 border-t border-black/5 space-y-1">
        {(session?.role === "platform_admin" || session?.role === "admin" || session?.role === "owner") && (
          <NavLink href={`/${session?.tenantSlug || ''}/settings`} icon={<Settings className="w-[18px] h-[18px]" />} label="Ayarlar" />
        )}
        
        {session && (
          <div className="mt-2 pt-2 border-t border-black/5">
            <div className="flex items-center gap-3 px-3 py-2">
              <div className="w-8 h-8 rounded-full bg-[--q-blue-bg] flex items-center justify-center text-[--q-blue] text-xs font-bold">
                {session.name?.charAt(0)?.toUpperCase() || "Q"}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-medium text-[--q-text-primary] truncate">{session.name}</p>
                <p className="text-[10px] text-[--q-text-secondary] truncate">{session.email}</p>
              </div>
            </div>
            
            {session.impersonatedTenantId ? (
              <form action={async () => {
                "use server";
                await handleStopImpersonation(session.tenantSlug);
              }}>
                <button
                  type="submit"
                  className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-[13px] font-medium text-[--q-purple-alt] hover:bg-[--q-purple-alt-bg] transition-colors"
                >
                  <LogOut className="w-[18px] h-[18px]" />
                  Gözlem Modundan Çık
                </button>
              </form>
            ) : (
              <form action={handleLogout}>
                <button
                  type="submit"
                  className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-[13px] font-medium text-[--q-red] hover:bg-red-50 transition-colors"
                >
                  <LogOut className="w-[18px] h-[18px]" />
                  Çıkış Yap
                </button>
              </form>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}

// Nav link component
function NavLink({ href, icon, label }: { href: string; icon: React.ReactNode; label: string }) {
  return (
    <Link 
      href={href} 
      className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-[13px] font-medium text-[--q-text-primary] hover:bg-black/[0.04] hover:text-[--q-text-primary] transition-all duration-150"
    >
      <span className="opacity-60">{icon}</span>
      {label}
    </Link>
  );
}
