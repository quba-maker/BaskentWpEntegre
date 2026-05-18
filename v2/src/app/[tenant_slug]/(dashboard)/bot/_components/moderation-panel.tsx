import { ShieldAlert, Plus, X } from "lucide-react";

// ==========================================
// MODERATION PANEL
// Authority: Banned words management
// Data owner: bot_banned_words bot setting
// ==========================================

interface ModerationPanelProps {
  bannedWords: string[];
  onAddWord: (word: string) => void;
  onRemoveWord: (index: number) => void;
}

export function ModerationPanel({ bannedWords, onAddWord, onRemoveWord }: ModerationPanelProps) {
  return (
    <div className="mt-8">
      <h2 className="text-lg font-bold mb-4 flex items-center gap-2" style={{ color: "var(--q-text-primary)" }}>
        <ShieldAlert className="w-5 h-5" style={{ color: "var(--q-text-secondary)" }} />
        Yasaklı Kelimeler
      </h2>
      <div className="bg-white rounded-2xl border shadow-sm p-5" style={{ borderColor: "var(--q-border-default)" }}>
        <p className="text-xs mb-3" style={{ color: "var(--q-text-secondary)" }}>Bot bu kelimeleri ASLA kullanmayacak. Prompt&apos;a otomatik enjekte edilir.</p>
        <BannedWordInput onAdd={onAddWord} />
        <div className="flex flex-wrap gap-2">
          {bannedWords.map((w, i) => (
            <span 
              key={i} 
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold"
              style={{ backgroundColor: "color-mix(in srgb, var(--q-red) 10%, transparent)", color: "var(--q-red)" }}
            >
              {w}
              <button onClick={() => onRemoveWord(i)}><X className="w-3 h-3" /></button>
            </span>
          ))}
          {bannedWords.length === 0 && <p className="text-xs" style={{ color: "var(--q-text-placeholder)" }}>Henüz yasaklı kelime eklenmedi</p>}
        </div>
      </div>
    </div>
  );
}

/** Internal sub-component — handles input + submit for banned words */
function BannedWordInput({ onAdd }: { onAdd: (word: string) => void }) {
  const handleSubmit = (input: HTMLInputElement) => {
    const word = input.value.trim();
    if (word) {
      onAdd(word);
      input.value = "";
    }
  };

  return (
    <div className="flex items-center gap-2 mb-4">
      <input
        type="text"
        onKeyDown={e => { if (e.key === 'Enter') handleSubmit(e.currentTarget); }}
        placeholder="Kelime ekle..."
        className="flex-1 px-3 py-2 text-sm border-0 rounded-lg outline-none"
        style={{ backgroundColor: "rgba(0,0,0,0.03)", color: "var(--q-text-primary)" }}
      />
      <button
        onClick={(e) => {
          const input = (e.currentTarget.previousElementSibling as HTMLInputElement);
          handleSubmit(input);
        }}
        className="px-3 py-2 text-white rounded-lg text-sm font-bold"
        style={{ backgroundColor: "var(--q-red)" }}
      >
        <Plus className="w-4 h-4" />
      </button>
    </div>
  );
}
