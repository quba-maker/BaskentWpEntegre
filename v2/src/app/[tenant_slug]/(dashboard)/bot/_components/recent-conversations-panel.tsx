import { MessagesSquare, MessageSquare } from "lucide-react";

// ==========================================
// RECENT CONVERSATIONS PANEL
// Authority: Bot conversation history display (read-only)
// Data owner: getRecentBotConversations() action
// ==========================================

interface RecentConversationsPanelProps {
  conversations: any[];
}

const CHANNEL_COLORS: Record<string, string> = {
  whatsapp: 'var(--q-whatsapp)',
  instagram: 'var(--q-instagram)',
  messenger: 'var(--q-messenger)',
};

const PHASE_LABELS: Record<string, string> = {
  greeting: 'Karşılama',
  discovery: 'Keşif',
  trust: 'Güven',
  time_confirm: 'Zaman',
  handover: 'İnsana Devredildi',
};

const TEMP_COLORS: Record<string, string> = {
  cold: 'var(--q-blue)',
  warm: 'var(--q-orange)',
  hot: 'var(--q-red)',
};

export function RecentConversationsPanel({ conversations }: RecentConversationsPanelProps) {
  if (conversations.length === 0) return null;

  return (
    <div>
      <h2 className="text-lg font-bold mb-4 flex items-center gap-2" style={{ color: "var(--q-text-primary)" }}>
        <MessagesSquare className="w-5 h-5" style={{ color: "var(--q-text-secondary)" }} />
        Son Bot Konuşmaları
      </h2>
      <div className="bg-white rounded-2xl shadow-sm" style={{ border: "1px solid var(--q-border-default)" }}>
        {conversations.map((c, i) => (
          <div key={i} className="flex items-center justify-between px-5 py-3" style={{ borderBottom: i < conversations.length - 1 ? "1px solid var(--q-border-default)" : "none" }}>
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0" style={{backgroundColor: 'var(--q-bg-secondary)'}}>
                <MessageSquare className="w-3.5 h-3.5" style={{color: CHANNEL_COLORS[c.channel] || 'var(--q-text-secondary)'}} />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-bold truncate" style={{ color: "var(--q-text-primary)" }}>{c.name}</p>
                  {c.department && <span className="text-[10px] px-1.5 py-0.5 rounded font-semibold shrink-0" style={{ backgroundColor: "var(--q-purple-bg)", color: "var(--q-purple)" }}>{c.department}</span>}
                </div>
                <p className="text-[11px] truncate" style={{ color: "var(--q-text-secondary)" }}>{c.lastMessage || '—'}</p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{
                backgroundColor: c.status === 'human' ? 'var(--q-orange-bg)' : 'var(--q-bg-secondary)', 
                color: c.status === 'human' ? 'var(--q-orange)' : (TEMP_COLORS[c.temperature] || 'var(--q-text-secondary)')
              }}>
                {c.status === 'human' ? 'İnsana Devredildi' : (PHASE_LABELS[c.phase] || c.phase || '—')}
              </span>
              <span className="text-[11px] font-medium" style={{ color: "var(--q-text-secondary)" }}>{c.botMsgCount} Mesaj</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
