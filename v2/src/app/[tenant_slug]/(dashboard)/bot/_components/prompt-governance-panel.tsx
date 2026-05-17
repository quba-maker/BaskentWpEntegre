import { RotateCcw, Save, Check } from "lucide-react";
import { type BotChannel } from "./shared";
import { useConfirm } from "@/components/ui/confirm-dialog";

// ==========================================
// PROMPT GOVERNANCE PANEL
// Authority: System prompt editing, saving, resetting
// Data owner: system_prompt_* bot settings
// ==========================================

interface PromptGovernancePanelProps {
  channels: BotChannel[];
  activeTab: string;
  onTabChange: (tab: string) => void;
  prompts: Record<string, string>;
  onPromptChange: (channelId: string, value: string) => void;
  settings: Record<string, any>;
  saving: string | null;
  saved: string | null;
  onSave: (channelId: string) => void;
  onResetToDefault: (channelId: string) => void;
}

export function PromptGovernancePanel({
  channels,
  activeTab,
  onTabChange,
  prompts,
  onPromptChange,
  settings,
  saving,
  saved,
  onSave,
  onResetToDefault,
}: PromptGovernancePanelProps) {
  const confirm = useConfirm();
  const activeChannel = channels.find(c => c.id === activeTab)!;

  const handleReset = async () => {
    const ok = await confirm({
      title: "Varsayılana Dön",
      message: "Başkent Hastanesi varsayılan prompt'u yüklenecek. Mevcut düzenlemeleriniz kaybolacak. Kalıcı olması için ayrıca \"Kaydet\" butonuna basmanız gerekiyor.",
      confirmLabel: "Varsayılanı Yükle",
      variant: "warning",
    });
    if (ok) onResetToDefault(activeTab);
  };

  return (
    <div className="flex-1 flex flex-col">
      {/* Tab Bar */}
      <div className="flex items-center gap-1 p-1 bg-black/[0.04] rounded-xl mb-6 w-fit">
        {channels.map(ch => {
          const Icon = ch.icon;
          return (
            <button
              key={ch.id}
              onClick={() => onTabChange(ch.id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all duration-200 ${
                activeTab === ch.id
                  ? "bg-white text-[#1D1D1F] shadow-sm"
                  : "text-[#86868B] hover:text-[#1D1D1F]"
              }`}
            >
              <Icon className="w-4 h-4" />
              <span className="hidden md:inline">{ch.label}</span>
            </button>
          );
        })}
      </div>

      {/* Editor Card */}
      <div className="bg-white rounded-2xl border border-black/5 shadow-sm overflow-hidden flex-1 flex flex-col">
        {/* Editor Header */}
        <div className="px-6 py-4 border-b border-black/5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div 
              className="w-8 h-8 rounded-lg flex items-center justify-center"
              style={{ backgroundColor: `${activeChannel.color}15` }}
            >
              <activeChannel.icon className="w-4 h-4" style={{ color: activeChannel.color }} />
            </div>
            <div>
              <h3 className="text-base font-bold text-[#1D1D1F]">{activeChannel.label} Prompt</h3>
              <p className="text-[11px] text-[#86868B] font-medium">
                {settings[activeChannel.promptKey]?.updated_at 
                  ? `Son güncelleme: ${new Date(settings[activeChannel.promptKey].updated_at).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}`
                  : "Varsayılan prompt kullanılıyor"
                }
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Reset Button */}
            <button
              onClick={handleReset}
              className="px-3 py-1.5 text-xs font-semibold text-[#FF9500] bg-[#FF9500]/10 border border-[#FF9500]/20 rounded-lg hover:bg-[#FF9500]/20 transition-colors flex items-center gap-1.5"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Varsayılana Dön
            </button>

            {/* Save Button */}
            <button
              onClick={() => onSave(activeTab)}
              disabled={saving === activeTab}
              className={`px-4 py-1.5 text-xs font-bold rounded-lg transition-all flex items-center gap-1.5 ${
                saved === activeTab
                  ? "bg-[#34C759] text-white"
                  : "bg-[#007AFF] text-white hover:bg-[#0056CC] shadow-sm"
              }`}
            >
              {saving === activeTab ? (
                <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : saved === activeTab ? (
                <Check className="w-3.5 h-3.5" />
              ) : (
                <Save className="w-3.5 h-3.5" />
              )}
              {saved === activeTab ? "Kaydedildi!" : "Kaydet"}
            </button>
          </div>
        </div>

        {/* Textarea */}
        <div className="flex-1 p-0">
          <textarea
            value={prompts[activeTab] || ""}
            onChange={(e) => onPromptChange(activeTab, e.target.value)}
            className="w-full h-full min-h-[400px] p-6 text-[13px] leading-relaxed font-mono text-[#1D1D1F] bg-[#FAFAFA] border-0 outline-none resize-none placeholder:text-[#C7C7CC]"
            placeholder={`${activeChannel.label} için sistem prompt'unu buraya yazın...`}
            spellCheck={false}
          />
        </div>
      </div>
    </div>
  );
}
