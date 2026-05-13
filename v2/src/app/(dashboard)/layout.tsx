import { Sidebar } from "@/components/layout/sidebar";
import { LayoutDashboard, MessageSquare, ClipboardList, Calendar, Settings, Link2 } from "lucide-react";
import Link from "next/link";

// ==========================================
// Dashboard Layout — Sidebar + Mobile Nav
// Sadece giriş yapmış kullanıcılara gösterilir
// ==========================================

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="h-full flex flex-col md:flex-row overflow-hidden">
      {/* Desktop Sidebar */}
      <div className="hidden md:flex h-full">
        <Sidebar />
      </div>

      {/* Main Content */}
      <main className="flex-1 overflow-auto h-full flex flex-col relative pb-[env(safe-area-inset-bottom)] md:pb-0">
        {children}
      </main>

      {/* Mobile Bottom Navigation (iOS Style) */}
      <nav className="md:hidden flex-none w-full h-[72px] bg-white/80 backdrop-blur-[30px] border-t border-black/5 flex items-center justify-around px-2 z-50 pb-[env(safe-area-inset-bottom)]">
        <Link href="/" className="flex flex-col items-center gap-1 p-2 text-[#86868B] hover:text-[#007AFF] transition-colors">
          <LayoutDashboard className="w-6 h-6" />
          <span className="text-[10px] font-medium">Panel</span>
        </Link>
        <Link href="/inbox" className="flex flex-col items-center gap-1 p-2 text-[#007AFF] transition-colors">
          <MessageSquare className="w-6 h-6" />
          <span className="text-[10px] font-medium">Mesajlar</span>
        </Link>
        <Link href="/forms" className="flex flex-col items-center gap-1 p-2 text-[#86868B] hover:text-[#007AFF] transition-colors">
          <ClipboardList className="w-6 h-6" />
          <span className="text-[10px] font-medium">Formlar</span>
        </Link>
        <Link href="/calendar" className="flex flex-col items-center gap-1 p-2 text-[#86868B] hover:text-[#007AFF] transition-colors">
          <Calendar className="w-6 h-6" />
          <span className="text-[10px] font-medium">Takvim</span>
        </Link>
        <Link href="/integrations" className="flex flex-col items-center gap-1 p-2 text-[#86868B] hover:text-[#007AFF] transition-colors">
          <Link2 className="w-6 h-6" />
          <span className="text-[10px] font-medium">Entegre</span>
        </Link>
        <Link href="/settings" className="flex flex-col items-center gap-1 p-2 text-[#86868B] hover:text-[#007AFF] transition-colors">
          <Settings className="w-6 h-6" />
          <span className="text-[10px] font-medium">Ayarlar</span>
        </Link>
      </nav>
    </div>
  );
}
