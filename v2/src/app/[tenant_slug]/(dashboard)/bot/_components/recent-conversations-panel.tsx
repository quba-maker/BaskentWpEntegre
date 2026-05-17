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
  whatsapp: '#25D366',
  instagram: '#E1306C',
  messenger: '#007AFF',
};

const PHASE_LABELS: Record<string, string> = {
  greeting: 'Karşılama',
  discovery: 'Keşif',
  trust: 'Güven',
  time_confirm: 'Zaman',
  handover: 'Devir',
};

const TEMP_COLORS: Record<string, string> = {
  cold: '#007AFF',
  warm: '#FF9500',
  hot: '#FF3B30',
};

export function RecentConversationsPanel({ conversations }: RecentConversationsPanelProps) {
  if (conversations.length === 0) return null;

  return (
    <div className="mt-8">
      <h2 className="text-lg font-bold text-[#1D1D1F] mb-4 flex items-center gap-2">
        <MessagesSquare className="w-5 h-5 text-[#86868B]" />
        Son Bot Konuşmaları
      </h2>
      <div className="bg-white rounded-2xl border border-black/5 shadow-sm divide-y divide-black/5">
        {conversations.map((c, i) => (
          <div key={i} className="flex items-center justify-between px-5 py-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0" style={{backgroundColor: (CHANNEL_COLORS[c.channel] || '#86868B') + '15'}}>
                <MessageSquare className="w-3.5 h-3.5" style={{color: CHANNEL_COLORS[c.channel] || '#86868B'}} />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-bold text-[#1D1D1F] truncate">{c.name}</p>
                  {c.department && <span className="text-[10px] px-1.5 py-0.5 bg-[#5856D6]/10 text-[#5856D6] rounded font-semibold shrink-0">{c.department}</span>}
                </div>
                <p className="text-[11px] text-[#86868B] truncate">{c.lastMessage || '—'}</p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{backgroundColor: (TEMP_COLORS[c.temperature] || '#86868B') + '15', color: TEMP_COLORS[c.temperature] || '#86868B'}}>
                {PHASE_LABELS[c.phase] || c.phase || '—'}
              </span>
              <span className="text-[11px] text-[#86868B] font-medium">{c.botMsgCount} bot</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
