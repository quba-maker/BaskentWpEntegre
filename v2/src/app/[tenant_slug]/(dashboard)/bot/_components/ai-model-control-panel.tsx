import { Cpu, Check } from "lucide-react";

// ==========================================
// AI MODEL CONTROL PANEL
// Authority: AI model selection
// Data owner: ai_model bot setting
// ==========================================

const AI_MODELS = [
  { id: 'gemini-3.5-flash', name: 'Gemini 3.5 Flash', desc: 'Başkent kalite tercihi', speed: 78, cost: 70, iq: 96, color: 'var(--q-purple)' },
  { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', desc: 'Ekonomik denge', speed: 88, cost: 35, iq: 84, color: 'var(--q-blue)' },
  { id: 'gemini-2.5-flash-lite', name: 'Gemini 2.5 Flash Lite', desc: 'En ekonomik', speed: 96, cost: 18, iq: 64, color: 'var(--q-green)' },
  { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', desc: 'Güçlü ama pahalı', speed: 48, cost: 92, iq: 98, color: 'var(--q-purple)' },
];

interface AIModelControlPanelProps {
  currentModel: string;
  onModelChange: (modelId: string) => void;
}

export function AIModelControlPanel({ currentModel, onModelChange }: AIModelControlPanelProps) {
  return (
    <div className="mt-8">
      <h2 className="text-lg font-bold text-[--q-text-primary] mb-4 flex items-center gap-2">
        <Cpu className="w-5 h-5 text-[--q-text-secondary]" />
        Yapay Zeka Modeli
      </h2>
      <div className="bg-white rounded-2xl border border-[--q-border-default] shadow-sm p-5">
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
          {AI_MODELS.map(m => {
            const isActive = currentModel === m.id;
            return (
              <button
                key={m.id}
                onClick={() => onModelChange(m.id)}
                className={`relative p-4 rounded-xl border-2 transition-all text-left ${
                  isActive ? 'border-[' + m.color + '] bg-[' + m.color + ']/5' : 'border-[--q-border-default] hover:border-black/10'
                }`}
              >
                {isActive && <div className="absolute top-3 right-3 w-5 h-5 rounded-full flex items-center justify-center" style={{backgroundColor: m.color}}><Check className="w-3 h-3 text-white" /></div>}
                <p className="text-sm font-bold text-[--q-text-primary] mb-0.5">{m.name}</p>
                <p className="text-[11px] text-[--q-text-secondary] mb-3">{m.desc}</p>
                <p className="text-[10px] text-[--q-text-tertiary] mb-3 font-mono">{m.id}</p>
                <div className="space-y-1.5">
                  {[{label: 'Hız', val: m.speed}, {label: 'Zeka', val: m.iq}, {label: 'Maliyet', val: m.cost}].map(bar => (
                    <div key={bar.label} className="flex items-center gap-2">
                      <span className="text-[10px] text-[--q-text-secondary] w-10">{bar.label}</span>
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
