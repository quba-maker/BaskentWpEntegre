import { Globe, Save, CheckCircle, Loader2 } from "lucide-react";
import { SaveButton } from "./shared";

// ==========================================
// KNOWLEDGE BASE PANEL
// Authority: Bot knowledge data (prices, FAQ, rules)
// Data owner: bot_knowledge_prices, bot_knowledge_rules
// ==========================================

interface KnowledgeBasePanelProps {
  knowledgePrices: string;
  knowledgeRules: string;
  onPricesChange: (value: string) => void;
  onRulesChange: (value: string) => void;
  saving: boolean;
  saved: boolean;
  onSave: () => void;
}

export function KnowledgeBasePanel({
  knowledgePrices,
  knowledgeRules,
  onPricesChange,
  onRulesChange,
  saving,
  saved,
  onSave,
}: KnowledgeBasePanelProps) {
  return (
    <div className="mt-8">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-bold text-[#1D1D1F] flex items-center gap-2">
          <Globe className="w-5 h-5 text-[#86868B]" />
          Bot Bilgi Bankası (Kolay Yönetim)
        </h2>
        <SaveButton
          saving={saving}
          saved={saved}
          onClick={onSave}
          label="Bilgileri Kaydet"
          color="#34C759"
        />
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Fiyat Listesi */}
        <div className="bg-white rounded-2xl border border-black/5 shadow-sm p-0 flex flex-col overflow-hidden">
          <div className="px-5 py-3 border-b border-black/5 bg-black/[0.02]">
            <h3 className="text-sm font-bold text-[#1D1D1F]">Fiyat Listesi ve Hizmetler</h3>
            <p className="text-[11px] text-[#86868B]">Kurumun fiyat listesini buraya yapıştırın.</p>
          </div>
          <textarea
            value={knowledgePrices}
            onChange={(e) => onPricesChange(e.target.value)}
            className="flex-1 p-5 min-h-[200px] text-[13px] font-medium text-[#1D1D1F] bg-transparent outline-none resize-none placeholder:text-[#C7C7CC]"
            placeholder={"Örn:\n- Lazer Epilasyon (Tüm Vücut): 2500 TL\n- Cilt Bakımı: 1000 TL"}
          />
        </div>

        {/* SSS ve Kurallar */}
        <div className="bg-white rounded-2xl border border-black/5 shadow-sm p-0 flex flex-col overflow-hidden">
          <div className="px-5 py-3 border-b border-black/5 bg-black/[0.02]">
            <h3 className="text-sm font-bold text-[#1D1D1F]">Sıkça Sorulan Sorular / Kurallar</h3>
            <p className="text-[11px] text-[#86868B]">Hastaların sık sorduğu soruları ve cevapları yazın.</p>
          </div>
          <textarea
            value={knowledgeRules}
            onChange={(e) => onRulesChange(e.target.value)}
            className="flex-1 p-5 min-h-[200px] text-[13px] font-medium text-[#1D1D1F] bg-transparent outline-none resize-none placeholder:text-[#C7C7CC]"
            placeholder={"Örn:\nS: Taksit yapıyor musunuz?\nC: Kredi kartlarına vade farksız 3 taksit imkanımız var.\n\nKURAL: Muayene ücretsizdir ancak randevu alınması zorunludur."}
          />
        </div>
      </div>
    </div>
  );
}
