import { RotateCcw, Save, Check, Shield, UserCircle, ListChecks, Layers } from "lucide-react";
import { type BotChannel } from "./shared";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useState, useEffect } from "react";

// ==========================================
// PROMPT GOVERNANCE PANEL (Modular / Parçalı Yapı)
// Authority: System prompt editing, saving, resetting
// Data owner: system_prompt_* bot settings
// Design: Apple/Linear level premium UX for structured prompting
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
  knowledgePrices: string;
  knowledgeRules: string;
  onPricesChange: (val: string) => void;
  onRulesChange: (val: string) => void;
  onSaveKnowledge: () => void;
}

// Prompt'u parçalara ayırma ve birleştirme mantığı
const parsePrompt = (fullPrompt: string) => {
  const parts = {
    identity: "",
    instructions: "",
    constraints: ""
  };
  
  if (!fullPrompt) return parts;

  // Basit bir regex parser veya string matching
  // Eğer daha önceden parçalı kaydedilmişse başlıklarla ayır
  if (fullPrompt.includes("--- IDENTITY ---")) {
    const idMatch = fullPrompt.match(/--- IDENTITY ---\n([\s\S]*?)(?=\n--- INSTRUCTIONS ---|\n--- CONSTRAINTS ---|$)/);
    const inMatch = fullPrompt.match(/--- INSTRUCTIONS ---\n([\s\S]*?)(?=\n--- CONSTRAINTS ---|$)/);
    const coMatch = fullPrompt.match(/--- CONSTRAINTS ---\n([\s\S]*?)$/);
    
    parts.identity = idMatch ? idMatch[1].trim() : "";
    parts.instructions = inMatch ? inMatch[1].trim() : "";
    parts.constraints = coMatch ? coMatch[1].trim() : "";
  } else {
    // Legacy prompt ise tamamını instructions'a at
    parts.instructions = fullPrompt;
  }
  return parts;
};

const compilePrompt = (identity: string, instructions: string, constraints: string) => {
  let result = "";
  if (identity.trim()) result += `--- IDENTITY ---\n${identity.trim()}\n\n`;
  if (instructions.trim()) result += `--- INSTRUCTIONS ---\n${instructions.trim()}\n\n`;
  if (constraints.trim()) result += `--- CONSTRAINTS ---\n${constraints.trim()}`;
  return result.trim();
};

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
  knowledgePrices,
  knowledgeRules,
  onPricesChange,
  onRulesChange,
  onSaveKnowledge,
}: PromptGovernancePanelProps) {
  const confirm = useConfirm();
  const activeChannel = channels.find(c => c.id === activeTab)!;

  // Local state for modular inputs
  const [identity, setIdentity] = useState("");
  const [instructions, setInstructions] = useState("");
  const [constraints, setConstraints] = useState("");
  const [activeSubTab, setActiveSubTab] = useState<'identity' | 'instructions' | 'constraints'>('instructions');

  // Sync from props
  useEffect(() => {
    const raw = prompts[activeTab] || "";
    const parsed = parsePrompt(raw);
    setIdentity(parsed.identity);
    setInstructions(parsed.instructions);
    setConstraints(parsed.constraints);
  }, [prompts, activeTab]);

  const handleModularChange = (key: 'identity' | 'instructions' | 'constraints', val: string) => {
    let newId = identity;
    let newIn = instructions;
    let newCo = constraints;

    if (key === 'identity') newId = val;
    if (key === 'instructions') newIn = val;
    if (key === 'constraints') newCo = val;

    setIdentity(newId);
    setInstructions(newIn);
    setConstraints(newCo);

    onPromptChange(activeTab, compilePrompt(newId, newIn, newCo));
  };

  const handleReset = async () => {
    const ok = await confirm({
      title: "Varsayılana Dön",
      message: "Varsayılan prompt yüklenecek. Mevcut düzenlemeleriniz kaybolacak. Kalıcı olması için ayrıca \"Kaydet\" butonuna basmanız gerekiyor.",
      confirmLabel: "Varsayılanı Yükle",
      variant: "warning",
    });
    if (ok) onResetToDefault(activeTab);
  };

  return (
    <div className="flex-1 flex flex-col mb-0 mt-0">
      {/* Tab Bar */}
      <div className="flex items-center gap-1 p-1 bg-black/[0.04] rounded-xl mb-4 w-fit">
        {channels.map(ch => {
          const Icon = ch.icon;
          return (
            <button
              key={ch.id}
              onClick={() => onTabChange(ch.id)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold transition-all duration-200 ${
                activeTab === ch.id
                  ? "bg-white text-[--q-text-primary] shadow-sm"
                  : "text-[--q-text-secondary] hover:text-[--q-text-primary]"
              }`}
            >
              <Icon className="w-4 h-4" />
              <span className="hidden md:inline">{ch.label}</span>
            </button>
          );
        })}
      </div>

      {/* Editor Card */}
      <div className="bg-white rounded-2xl border border-[--q-border-default] shadow-sm flex-1 flex flex-col">
        {/* Editor Header */}
        <div className="px-5 py-4 border-b flex items-center justify-between rounded-t-2xl" style={{ borderColor: "var(--q-border-default)", backgroundColor: "var(--q-bg-secondary)" }}>
          <div className="flex items-center gap-4">
            <div 
              className="w-10 h-10 rounded-xl flex items-center justify-center shadow-sm"
              style={{ backgroundColor: `${activeChannel.color}15`, border: `1px solid ${activeChannel.color}30` }}
            >
              <activeChannel.icon className="w-5 h-5" style={{ color: activeChannel.color }} />
            </div>
            <div>
              <h3 className="text-[15px] font-bold text-[--q-text-primary] flex items-center gap-2">
                {activeChannel.label} Yapılandırması
              </h3>
              <p className="text-[11px] text-[--q-text-secondary] font-medium mt-0.5">
                {settings[activeChannel.promptKey]?.updated_at 
                  ? `Son güncelleme: ${new Date(settings[activeChannel.promptKey].updated_at).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`
                  : "Varsayılan prompt kullanılıyor"
                }
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={handleReset}
              className="px-3 py-2 text-[12px] font-bold bg-white border rounded-lg transition-colors flex items-center gap-2 shadow-sm hover:opacity-80"
              style={{ color: "var(--q-orange)", borderColor: "var(--q-border-strong)" }}
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Varsayılana Dön</span>
            </button>

            <button
              onClick={() => onSave(activeTab)}
              disabled={saving === activeTab}
              className="px-4 py-2 text-[12px] font-bold rounded-lg transition-all flex items-center gap-2 shadow-sm text-white disabled:opacity-60"
              style={{ 
                backgroundColor: saved === activeTab ? "var(--q-green)" : "var(--q-blue)" 
              }}
            >
              {saving === activeTab ? (
                <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : saved === activeTab ? (
                <Check className="w-3.5 h-3.5" />
              ) : (
                <Save className="w-3.5 h-3.5" />
              )}
              {saved === activeTab ? "Kaydedildi" : "Kaydet"}
            </button>
          </div>
        </div>

        {/* Sub Tabs */}
        <div className="flex border-b" style={{ borderColor: "var(--q-border-default)", backgroundColor: "var(--q-bg-secondary)" }}>
          <button
            onClick={() => setActiveSubTab('identity')}
            className="flex items-center gap-2 px-5 py-3 text-xs font-semibold transition-all relative"
            style={{
              color: activeSubTab === 'identity' ? "var(--q-blue)" : "var(--q-text-secondary)",
              backgroundColor: activeSubTab === 'identity' ? "white" : "transparent",
              borderBottom: activeSubTab === 'identity' ? "2px solid var(--q-blue)" : "2px solid transparent",
            }}
          >
            <UserCircle className="w-4 h-4" />
            Kimlik & Rol
          </button>
          <button
            onClick={() => setActiveSubTab('instructions')}
            className="flex items-center gap-2 px-5 py-3 text-xs font-semibold transition-all relative"
            style={{
              color: activeSubTab === 'instructions' ? "var(--q-purple)" : "var(--q-text-secondary)",
              backgroundColor: activeSubTab === 'instructions' ? "white" : "transparent",
              borderBottom: activeSubTab === 'instructions' ? "2px solid var(--q-purple)" : "2px solid transparent",
            }}
          >
            <ListChecks className="w-4 h-4" />
            Davranış & Talimatlar
          </button>
          <button
            onClick={() => setActiveSubTab('constraints')}
            className="flex items-center gap-2 px-5 py-3 text-xs font-semibold transition-all relative"
            style={{
              color: activeSubTab === 'constraints' ? "var(--q-red)" : "var(--q-text-secondary)",
              backgroundColor: activeSubTab === 'constraints' ? "white" : "transparent",
              borderBottom: activeSubTab === 'constraints' ? "2px solid var(--q-red)" : "2px solid transparent",
            }}
          >
            <Shield className="w-4 h-4" />
            Kesin Yasaklar
          </button>
        </div>

        {/* Modular Editor Areas */}
        <div className="flex-1 flex flex-col p-5 bg-white rounded-b-2xl">
          {activeSubTab === 'identity' && (
            <textarea
              value={identity}
              onChange={(e) => handleModularChange('identity', e.target.value)}
              className="w-full flex-1 min-h-[300px] p-4 text-[13px] leading-relaxed font-mono text-[--q-text-primary] bg-white border border-[--q-border-default] rounded-xl outline-none resize-none focus:ring-2 ring-[--q-blue] transition-shadow shadow-sm"
              placeholder="Sen Başkent Üniversitesi adına çalışan profesyonel bir asistansın..."
              spellCheck={false}
            />
          )}

          {activeSubTab === 'instructions' && (
            <textarea
              value={instructions}
              onChange={(e) => handleModularChange('instructions', e.target.value)}
              className="w-full flex-1 min-h-[300px] p-4 text-[13px] leading-relaxed font-mono text-[--q-text-primary] bg-white border border-[--q-border-default] rounded-xl outline-none resize-none focus:ring-2 ring-[--q-purple] transition-shadow shadow-sm"
              placeholder="Hastayı dinle, anla ve doğal akışta WhatsApp'a veya Randevuya yönlendir..."
              spellCheck={false}
            />
          )}

          {activeSubTab === 'constraints' && (
            <textarea
              value={constraints}
              onChange={(e) => handleModularChange('constraints', e.target.value)}
              className="w-full flex-1 min-h-[300px] p-4 text-[13px] leading-relaxed font-mono text-[--q-text-primary] bg-white border border-[--q-border-default] rounded-xl outline-none resize-none focus:ring-2 ring-[--q-red] transition-shadow shadow-sm"
              placeholder="ASLA kesin fiyat verme. ASLA doktor ismi verme..."
              spellCheck={false}
            />
          )}
        </div>
      </div>

      {/* Dikey Akış: Bilgi Bankası (Hizmetler & Kurallar) */}
      <div className="mt-6 bg-white rounded-2xl border border-[--q-border-default] shadow-sm flex flex-col">
        <div className="px-5 py-4 border-b flex items-center justify-between rounded-t-2xl" style={{ borderColor: "var(--q-border-default)", backgroundColor: "var(--q-bg-secondary)" }}>
          <div className="flex items-center gap-3">
            <Layers className="w-5 h-5 text-[--q-blue]" />
            <h3 className="text-[15px] font-bold text-[--q-text-primary]">Genel Bilgi Bankası</h3>
          </div>
          <button
            onClick={onSaveKnowledge}
            className="px-4 py-2 text-[12px] font-bold rounded-lg transition-all flex items-center gap-2 shadow-sm text-white hover:opacity-80"
            style={{ backgroundColor: "var(--q-blue)" }}
          >
            <Save className="w-3.5 h-3.5" />
            Bilgileri Kaydet
          </button>
        </div>
        <div className="p-5 flex flex-col gap-5">
          <div>
            <label className="block text-sm font-semibold mb-2 text-[--q-text-primary]">
              Hizmetler ve Fiyatlar (Tüm kanallarda geçerli)
            </label>
            <textarea
              value={knowledgePrices}
              onChange={(e) => onPricesChange(e.target.value)}
              className="w-full min-h-[150px] p-4 text-[13px] leading-relaxed font-mono text-[--q-text-primary] bg-white border border-[--q-border-default] rounded-xl outline-none resize-none focus:ring-2 ring-[--q-blue] transition-shadow shadow-sm"
              placeholder="Saç Ekimi: 2000$\nDiş İmplantı: 500$..."
              spellCheck={false}
            />
          </div>
          <div>
            <label className="block text-sm font-semibold mb-2 text-[--q-text-primary]">
              İşletme Kuralları (Tüm kanallarda geçerli)
            </label>
            <textarea
              value={knowledgeRules}
              onChange={(e) => onRulesChange(e.target.value)}
              className="w-full min-h-[150px] p-4 text-[13px] leading-relaxed font-mono text-[--q-text-primary] bg-white border border-[--q-border-default] rounded-xl outline-none resize-none focus:ring-2 ring-[--q-blue] transition-shadow shadow-sm"
              placeholder="Pazar günleri kapalıyız. Randevusuz hasta kabul edilmez..."
              spellCheck={false}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

