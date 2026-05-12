import Link from "next/link";
import { 
  LayoutDashboard, 
  MessageSquare, 
  ClipboardList, 
  Calendar, 
  Settings, 
  Users,
  Link2,
  Bot
} from "lucide-react";

export function Sidebar() {
  return (
    <aside className="w-64 border-r border-white/50 bg-white/40 backdrop-blur-[30px] h-full flex flex-col shadow-[1px_0_20px_rgba(0,0,0,0.03)] z-20">
      <div className="p-6 border-b border-black/5 flex items-center justify-between">
        <h1 className="text-xl font-bold tracking-tight text-foreground">OmniCRM</h1>
      </div>
      
      <nav className="flex-1 p-4 space-y-1.5">
        <Link 
          href="/" 
          className="flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors"
        >
          <LayoutDashboard className="w-5 h-5 opacity-70" />
          Dashboard
        </Link>
        <Link 
          href="/inbox" 
          className="flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors"
        >
          <MessageSquare className="w-5 h-5 opacity-70" />
          Hasta Takibi
        </Link>
        <Link 
          href="/forms" 
          className="flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors"
        >
          <ClipboardList className="w-5 h-5 opacity-70" />
          Form Yönetimi
        </Link>
        <Link 
          href="/calendar" 
          className="flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors"
        >
          <Calendar className="w-5 h-5 opacity-70" />
          Randevular
        </Link>
        <Link 
          href="/integrations" 
          className="flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors"
        >
          <Link2 className="w-5 h-5 opacity-70" />
          Entegrasyonlar
        </Link>
        <Link 
          href="/bot" 
          className="flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors"
        >
          <Bot className="w-5 h-5 opacity-70" />
          Bot Yönetimi
        </Link>
      </nav>

      <div className="p-4 border-t border-border/40">
        <Link 
          href="/settings" 
          className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-sidebar-foreground hover:bg-sidebar-accent hover:text-foreground transition-all duration-200"
        >
          <Settings className="w-5 h-5 opacity-60" />
          Ayarlar
        </Link>
      </div>
    </aside>
  );
}
