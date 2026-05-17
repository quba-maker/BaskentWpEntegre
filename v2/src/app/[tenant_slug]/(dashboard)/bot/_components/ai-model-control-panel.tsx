import { Cpu, Check } from "lucide-react";

// ==========================================
// AI MODEL CONTROL PANEL
// Authority: AI model selection
// Data owner: ai_model bot setting
// ==========================================

const AI_MODELS = [
  { id: 'gemini-2.5-flash-lite', name: 'Flash Lite', desc: 'Hızlı & Ekonomik', speed: 95, cost: 20, iq: 60, color: '#34C759' },
  { id: 'gemini-2.5-flash', name: 'Flash', desc: 'Dengeli (Önerilen)', speed: 85, cost: 40, iq: 85, color: '#007AFF' },
  { id: 'gemini-2.5-pro', name: 'Pro', desc: 'Güçlü & Pahalı', speed: 50, cost: 90, iq: 98, color: '#5856D6' },
];

interface AIModelControlPanelProps {
  currentModel: string;
  onModelChange: (modelId: string) => void;
}

export function AIModelControlPanel({ currentModel, onModelChange }: AIModelControlPanelProps) {
  return (
    <div className="mt-8">
      <h2 className="text-lg font-bold text-[#1D1D1F] mb-4 flex items-center gap-2">
        <Cpu className="w-5 h-5 text-[#86868B]" />
        Yapay Zeka Modeli
      </h2>
      <div className="bg-white rounded-2xl border border-black/5 shadow-sm p-5">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {AI_MODELS.map(m => {
            const isActive = currentModel === m.id;
            return (
              <button
                key={m.id}
                onClick={() => onModelChange(m.id)}
                className={`relative p-4 rounded-xl border-2 transition-all text-left ${
                  isActive ? 'border-[' + m.color + '] bg-[' + m.color + ']/5' : 'border-black/5 hover:border-black/10'
                }`}
              >
                {isActive && <div className="absolute top-3 right-3 w-5 h-5 rounded-full flex items-center justify-center" style={{backgroundColor: m.color}}><Check className="w-3 h-3 text-white" /></div>}
                <p className="text-sm font-bold text-[#1D1D1F] mb-0.5">{m.name}</p>
                <p className="text-[11px] text-[#86868B] mb-3">{m.desc}</p>
                <div className="space-y-1.5">
                  {[{label: 'Hız', val: m.speed}, {label: 'Zeka', val: m.iq}, {label: 'Maliyet', val: m.cost}].map(bar => (
                    <div key={bar.label} className="flex items-center gap-2">
                      <span className="text-[10px] text-[#86868B] w-10">{bar.label}</span>
                      <div className="flex-1 h-1.5 bg-black/5 rounded-full overflow-hidden">
                        <div className="h-full rounded-full transition-all" style={{width: `${bar.val}%`, backgroundColor: m.color}} />
                      </div>
                    </div>
                  ))}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
