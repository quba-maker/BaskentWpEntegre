import Link from "next/link";
import { 
  MessageSquare, 
  ClipboardList, 
  Calendar, 
  Settings, 
  Link2,
  Bot,
  LogOut,
  BarChart3,
  Shield
} from "lucide-react";
import { getSession, logout } from "@/lib/auth/session";
import { redirect } from "next/navigation";

// ==========================================
// QUBA AI — Sidebar (Server Component)
// ==========================================

async function handleLogout() {
  "use server";
  await logout();
  redirect("/login");
}

export async function Sidebar() {
  const session = await getSession();

  return (
    <aside className="w-64 border-r border-white/50 bg-white/40 backdrop-blur-[30px] h-full flex flex-col shadow-[1px_0_20px_rgba(0,0,0,0.03)] z-20">
      {/* Quba AI Branding */}
      <div className="p-5 border-b border-black/5">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-[#007AFF] to-[#5856D6] flex items-center justify-center shadow-sm">
            <Bot className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-[15px] font-bold tracking-tight text-[#1D1D1F]">Quba AI</h1>
            <p className="text-[10px] text-[#86868B] font-medium">
              {session?.tenantName || "Platform"}
            </p>
          </div>
        </div>
      </div>
      
      {/* Navigation */}
      <nav className="flex-1 p-3 space-y-0.5">
        <NavLink href="/inbox" icon={<MessageSquare className="w-[18px] h-[18px]" />} label="Mesajlar" />
        <NavLink href="/forms" icon={<ClipboardList className="w-[18px] h-[18px]" />} label="Formlar" />
        <NavLink href="/calendar" icon={<Calendar className="w-[18px] h-[18px]" />} label="Randevular" />
        <NavLink href="/bot" icon={<Bot className="w-[18px] h-[18px]" />} label="Bot Yönetimi" />
        <NavLink href="/integrations" icon={<Link2 className="w-[18px] h-[18px]" />} label="Entegrasyonlar" />
      </nav>

      {/* User & Logout */}
      <div className="p-3 border-t border-black/5 space-y-1">
        {session?.role === "owner" && (
          <NavLink href="/admin" icon={<Shield className="w-[18px] h-[18px]" />} label="Süper Admin" />
        )}
        <NavLink href="/settings" icon={<Settings className="w-[18px] h-[18px]" />} label="Ayarlar" />
        
        {session && (
          <div className="mt-2 pt-2 border-t border-black/5">
            <div className="flex items-center gap-3 px-3 py-2">
              <div className="w-8 h-8 rounded-full bg-[#007AFF]/10 flex items-center justify-center text-[#007AFF] text-xs font-bold">
                {session.name?.charAt(0)?.toUpperCase() || "Q"}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-medium text-[#1D1D1F] truncate">{session.name}</p>
                <p className="text-[10px] text-[#86868B] truncate">{session.email}</p>
              </div>
            </div>
            <form action={handleLogout}>
              <button
                type="submit"
                className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-[13px] font-medium text-[#FF3B30] hover:bg-red-50 transition-colors"
              >
                <LogOut className="w-[18px] h-[18px]" />
                Çıkış Yap
              </button>
            </form>
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
      className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-[13px] font-medium text-[#3C3C43] hover:bg-black/[0.04] hover:text-[#1D1D1F] transition-all duration-150"
    >
      <span className="opacity-60">{icon}</span>
      {label}
    </Link>
  );
}
