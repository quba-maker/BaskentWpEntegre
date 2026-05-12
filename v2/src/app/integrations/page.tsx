"use client";

import { useState, useEffect } from "react";
import { Link2, Save, FileSpreadsheet, CheckCircle2, ChevronRight, Activity, Copy, DownloadCloud, Trash2 } from "lucide-react";
import { getGoogleSheetsConfig, saveGoogleSheetsConfig, fetchGoogleSheetsTabs } from "@/app/actions/integrations";
import { syncGoogleSheets, deleteAllLeads } from "@/app/actions/forms";

export default function IntegrationsPage() {
  const [activeTab, setActiveTab] = useState("all");
  const [config, setConfig] = useState<any>({ spreadsheetId: "", activeSheets: [] });
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isFetching, setIsFetching] = useState(false);
  const [isSyncingOld, setIsSyncingOld] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [availableTabs, setAvailableTabs] = useState<any[]>([]);

  useEffect(() => {
    loadConfig();
  }, []);

  const loadConfig = async () => {
    const res = await getGoogleSheetsConfig();
    if (res.success && res.config) {
      setConfig(res.config);
      if (res.config.spreadsheetId) {
        handleFetchTabs(res.config.spreadsheetId);
      }
    }
    setIsLoading(false);
  };

  const handleFetchTabs = async (id: string) => {
    setIsFetching(true);
    const res = await fetchGoogleSheetsTabs(id);
    if (res.success) {
      setAvailableTabs(res.tabs);
    } else {
      setAvailableTabs([]);
    }
    setIsFetching(false);
  };

  const handleSave = async () => {
    setIsSaving(true);
    const res = await saveGoogleSheetsConfig(config);
    if (res.success) {
      alert("Entegrasyon ayarları kaydedildi!");
    } else {
      alert("Hata: " + res.error);
    }
    setIsSaving(false);
  };

  const toggleSheet = (title: string) => {
    const current = config.activeSheets || [];
    if (current.includes(title)) {
      setConfig({ ...config, activeSheets: current.filter((t: string) => t !== title) });
    } else {
      setConfig({ ...config, activeSheets: [...current, title] });
    }
  };

  const handleSyncOld = async () => {
    setIsSyncingOld(true);
    const res = await syncGoogleSheets();
    setIsSyncingOld(false);
    if (res.success) {
      alert("Eski kayıtlar başarıyla içeri aktarıldı: " + res.message);
    } else {
      alert("Hata: " + res.error);
    }
  };

  const handleReset = async () => {
    if (!confirm("DİKKAT! Veritabanındaki tüm mevcut form/hasta kayıtları kalıcı olarak silinecek. Onaylıyor musunuz?")) return;
    
    setIsDeleting(true);
    const res = await deleteAllLeads();
    setIsDeleting(false);
    
    if (res.success) {
      alert("✅ " + res.message);
    } else {
      alert("Hata: " + res.error);
    }
  };

  const webhookScript = `
function onEdit(e) {
  var sheetName = e.source.getActiveSheet().getName();
  var url = "https://BAŞKENT_CRM_DOMAIN.com/api/sheets-webhook"; // Gerçek domain ile değiştirin
  var range = e.range;
  var row = range.getRow();
  
  if (row <= 1) return; // Başlık satırını atla
  
  var headers = e.source.getActiveSheet().getRange(1, 1, 1, e.source.getActiveSheet().getLastColumn()).getValues()[0];
  var values = e.source.getActiveSheet().getRange(row, 1, 1, e.source.getActiveSheet().getLastColumn()).getValues()[0];
  
  var payload = {
    sheetName: sheetName,
    row: row,
    data: {}
  };
  
  for(var i=0; i<headers.length; i++){
    if(headers[i]) payload.data[headers[i]] = values[i];
  }
  
  var options = {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(payload)
  };
  
  UrlFetchApp.fetch(url, options);
}
  `.trim();

  return (
    <div className="p-4 md:p-8 h-full flex flex-col relative overflow-y-auto">
      {/* Background blobs for premium feel */}
      <div className="absolute top-0 right-0 w-[600px] h-[600px] bg-green-400/5 rounded-full blur-[100px] pointer-events-none -z-10" />

      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight text-[#1D1D1F] flex items-center gap-2">
          <Link2 className="w-8 h-8 text-[#007AFF]" />
          Entegrasyon Merkezi
        </h1>
        <p className="text-[#86868B] mt-2 text-base font-medium">Dış sistemleri bağlayın ve otonom veri akışı sağlayın</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Main Content */}
        <div className="lg:col-span-2 space-y-6">
          
          {/* Google Sheets Integration Card */}
          <div className="bg-white/60 backdrop-blur-xl border border-white/60 rounded-2xl p-6 shadow-[0_8px_30px_rgb(0,0,0,0.04)] relative overflow-hidden">
            <div className="flex items-start justify-between mb-6">
              <div className="flex items-center gap-4">
                <div className="w-14 h-14 bg-[#0F9D58]/10 rounded-2xl flex items-center justify-center border border-[#0F9D58]/20">
                  <FileSpreadsheet className="w-7 h-7 text-[#0F9D58]" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-[#1D1D1F]">Google Sheets</h2>
                  <p className="text-[#86868B] text-sm font-medium">Satış temsilcilerinin doldurduğu formları otonom içeri aktarın</p>
                </div>
              </div>
              <div className="px-3 py-1 bg-green-500/10 text-green-600 text-xs font-bold uppercase tracking-wider rounded-full border border-green-500/20 flex items-center gap-1">
                <Activity className="w-3 h-3" /> Aktif
              </div>
            </div>

            <div className="space-y-5">
              <div>
                <label className="block text-xs font-bold text-[#86868B] uppercase tracking-wider mb-2">Google Spreadsheet ID</label>
                <div className="flex gap-2">
                  <input 
                    type="text" 
                    value={config.spreadsheetId}
                    onChange={(e) => setConfig({ ...config, spreadsheetId: e.target.value })}
                    placeholder="1oSKJ-iYiZPltYUQ73_O-FaFdelhwAwtf09wVKKVs1GQ" 
                    className="flex-1 px-4 py-2.5 bg-white border border-black/10 rounded-xl text-sm font-medium focus:ring-2 focus:ring-[#0F9D58]/40 outline-none transition-all"
                  />
                  <button 
                    onClick={() => handleFetchTabs(config.spreadsheetId)}
                    disabled={isFetching || !config.spreadsheetId}
                    className="px-4 py-2.5 bg-[#0F9D58]/10 text-[#0F9D58] font-bold text-sm rounded-xl hover:bg-[#0F9D58]/20 transition-colors disabled:opacity-50"
                  >
                    {isFetching ? "..." : "Bağlan"}
                  </button>
                </div>
              </div>

              {availableTabs.length > 0 && (
                <div className="animate-in slide-in-from-top-2">
                  <label className="block text-xs font-bold text-[#86868B] uppercase tracking-wider mb-2">Aktif Sekmeler (Sadece Seçilenlerden Veri Alınır)</label>
                  <div className="flex flex-wrap gap-2">
                    {availableTabs.map((tab) => {
                      const isActive = (config.activeSheets || []).includes(tab.title);
                      return (
                        <button
                          key={tab.id}
                          onClick={() => toggleSheet(tab.title)}
                          className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-sm font-semibold transition-all ${isActive ? 'bg-[#0F9D58] text-white border-[#0F9D58] shadow-[0_2px_10px_rgba(15,157,88,0.3)]' : 'bg-white text-[#1D1D1F] border-black/10 hover:border-black/30'}`}
                        >
                          {isActive && <CheckCircle2 className="w-4 h-4" />}
                          {tab.title}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="pt-4 border-t border-black/5 flex flex-col sm:flex-row gap-3 justify-between items-center">
                <div className="flex gap-2">
                  <button 
                    onClick={handleSyncOld}
                    disabled={isSyncingOld || availableTabs.length === 0}
                    className="w-full sm:w-auto px-4 py-2.5 bg-white border border-black/10 text-[#1D1D1F] text-sm font-semibold rounded-xl hover:bg-black/5 transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
                    title="Seçili sekmelerdeki geçmiş kayıtları bir defaya mahsus çeker"
                  >
                    <DownloadCloud className={`w-4 h-4 ${isSyncingOld ? 'animate-bounce' : ''}`} />
                    {isSyncingOld ? "Aktarılıyor..." : "Eski Kayıtları İçeri Aktar"}
                  </button>

                  <button 
                    onClick={handleReset}
                    disabled={isDeleting}
                    className="w-full sm:w-auto px-4 py-2.5 bg-red-50 border border-red-100 text-red-600 text-sm font-semibold rounded-xl hover:bg-red-100 transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
                    title="Veritabanındaki tüm lead'leri siler"
                  >
                    <Trash2 className="w-4 h-4" />
                    {isDeleting ? "Siliniyor..." : "Tümünü Sıfırla"}
                  </button>
                </div>

                <button 
                  onClick={handleSave}
                  disabled={isSaving}
                  className="w-full sm:w-auto px-6 py-2.5 bg-black text-white text-sm font-bold rounded-xl hover:bg-black/80 transition-colors flex items-center justify-center gap-2"
                >
                  <Save className="w-4 h-4" />
                  {isSaving ? "Kaydediliyor..." : "Ayarları Kaydet"}
                </button>
              </div>
            </div>
          </div>
          
        </div>

        {/* Sidebar / Instructions */}
        <div className="space-y-6">
          <div className="bg-white/60 backdrop-blur-xl border border-[#007AFF]/20 rounded-2xl p-6 shadow-[0_8px_30px_rgb(0,122,255,0.05)]">
            <h3 className="text-sm font-bold text-[#1D1D1F] uppercase tracking-wider mb-4 flex items-center gap-2">
              <Activity className="w-4 h-4 text-[#007AFF]" />
              Sıfır Maliyetli Otonom Yapı (Push)
            </h3>
            <p className="text-sm text-[#86868B] leading-relaxed font-medium mb-4">
              Aşağıdaki kod sayesinde, Google Sheets'e yeni bir satır eklendiği saniye CRM sistemine otomatik aktarılır.
            </p>

            <div className="space-y-4 mb-4">
              <div className="flex gap-3">
                <div className="w-6 h-6 rounded-full bg-[#007AFF]/10 text-[#007AFF] font-bold flex items-center justify-center flex-shrink-0 text-sm">1</div>
                <p className="text-sm font-medium text-[#1D1D1F]">E-tablonuzda üst menüden <strong className="text-[#007AFF]">Uzantılar &gt; Apps Script</strong> seçeneğine tıklayın.</p>
              </div>
              <div className="flex gap-3">
                <div className="w-6 h-6 rounded-full bg-[#007AFF]/10 text-[#007AFF] font-bold flex items-center justify-center flex-shrink-0 text-sm">2</div>
                <p className="text-sm font-medium text-[#1D1D1F]">Açılan ekrandaki tüm yazıları silip aşağıdaki kodu kopyalayın ve yapıştırın.</p>
              </div>
              <div className="flex gap-3">
                <div className="w-6 h-6 rounded-full bg-[#007AFF]/10 text-[#007AFF] font-bold flex items-center justify-center flex-shrink-0 text-sm">3</div>
                <p className="text-sm font-medium text-[#1D1D1F]">Yukarıdan <strong>Kaydet (💾)</strong> ikonuna basın. İşlem bu kadar!</p>
              </div>
            </div>
            
            <div className="relative group">
              <button 
                onClick={() => navigator.clipboard.writeText(webhookScript)}
                className="absolute top-2 right-2 p-1.5 bg-white/10 hover:bg-white/20 rounded-md text-white/70 hover:text-white transition-colors"
                title="Kodu Kopyala"
              >
                <Copy className="w-4 h-4" />
              </button>
              <pre className="bg-[#1D1D1F] text-[#F5F5F7] p-4 rounded-xl text-xs overflow-x-auto font-mono leading-relaxed shadow-inner">
                {webhookScript}
              </pre>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
