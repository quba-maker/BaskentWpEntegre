"use client";

import { useState, useEffect } from "react";
import { Link2, Save, FileSpreadsheet, CheckCircle2, ChevronRight, Activity, Copy, DownloadCloud, Trash2 } from "lucide-react";
import { getGoogleSheetsConfig, saveGoogleSheetsConfig, fetchGoogleSheetsTabs } from "@/app/actions/integrations";
import { syncGoogleSheets, deleteAllLeads } from "@/app/actions/forms";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { PageShell, PageHeader, SectionCard } from "@/components/governance";

export default function IntegrationsPage() {
  const [activeTab, setActiveTab] = useState("all");
  const [config, setConfig] = useState<any>({ spreadsheetId: "", activeSheets: [] });
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isFetching, setIsFetching] = useState(false);
  const [isSyncingOld, setIsSyncingOld] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [availableTabs, setAvailableTabs] = useState<any[]>([]);
  const [saveMsg, setSaveMsg] = useState("");
  const confirm = useConfirm();

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
    setSaveMsg("");
    const res = await saveGoogleSheetsConfig(config);
    if (res.success) {
      setSaveMsg("✅ Entegrasyon ayarları kaydedildi!");
    } else {
      setSaveMsg(`❌ Hata: ${res.error}`);
    }
    setIsSaving(false);
    setTimeout(() => setSaveMsg(""), 3000);
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
      setSaveMsg("✅ Eski kayıtlar başarıyla içeri aktırıldı: " + res.message);
    } else {
      setSaveMsg("❌ Hata: " + res.error);
    }
    setTimeout(() => setSaveMsg(""), 4000);
  };

  const handleReset = async () => {
    const ok = await confirm({
      title: "Tüm Kayıtları Sil",
      message: "DİKKAT! Veritabanındaki tüm form/hasta kayıtları kalıcı olarak silinecek. Bu işlem geri alınamaz.",
      confirmLabel: "Tümünü Sil",
      variant: "danger",
    });
    if (!ok) return;
    
    setIsDeleting(true);
    const res = await deleteAllLeads();
    setIsDeleting(false);
    
    if (res.success) {
      setSaveMsg("✅ " + res.message);
    } else {
      setSaveMsg("❌ Hata: " + res.error);
    }
    setTimeout(() => setSaveMsg(""), 4000);
  };

  const webhookScript = `
function onEdit(e) {
  var sheetName = e.source.getActiveSheet().getName();
  var url = "${typeof window !== 'undefined' ? window.location.origin : 'https://YOUR_DOMAIN'}/api/sheets-webhook";
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
    <PageShell>
      <PageHeader
        icon={Link2}
        title="Entegrasyon Merkezi"
        subtitle="Dış sistemleri bağlayın ve otonom veri akışı sağlayın"
        iconGradient={{ from: "var(--q-green)", to: "var(--q-google)" }}
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Main Content */}
        <div className="lg:col-span-2 space-y-6">
          
          {/* Google Sheets Integration Card */}
          <SectionCard>
            <div className="flex items-start justify-between mb-6">
              <div className="flex items-center gap-4">
                <div className="w-14 h-14 rounded-2xl flex items-center justify-center" style={{ backgroundColor: "var(--q-green-bg)", border: "1px solid var(--q-google)" }}>
                  <FileSpreadsheet className="w-7 h-7" style={{ color: "var(--q-google)" }} />
                </div>
                <div>
                  <h2 className="text-xl font-bold" style={{ color: "var(--q-text-primary)" }}>Google Sheets</h2>
                  <p className="text-sm font-medium" style={{ color: "var(--q-text-secondary)" }}>Satış temsilcilerinin doldurduğu formları otonom içeri aktarın</p>
                </div>
              </div>
              <div className="px-3 py-1 text-xs font-bold uppercase tracking-wider rounded-full flex items-center gap-1"
                style={{ backgroundColor: "var(--q-green-bg)", color: "var(--q-green)", border: "1px solid var(--q-green)" }}>
                <Activity className="w-3 h-3" /> Aktif
              </div>
            </div>

            <div className="space-y-5">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider mb-2" style={{ color: "var(--q-text-secondary)" }}>Google Spreadsheet ID</label>
                <div className="flex gap-2">
                  <input 
                    type="text" 
                    value={config.spreadsheetId}
                    onChange={(e) => setConfig({ ...config, spreadsheetId: e.target.value })}
                    placeholder="1oSKJ-iYiZPltYUQ73_O-FaFdelhwAwtf09wVKKVs1GQ" 
                    className="flex-1 px-4 py-2.5 bg-white rounded-xl text-sm font-medium focus:ring-2 outline-none transition-all"
                    style={{ border: "1px solid var(--q-border-strong)" }}
                  />
                  <button 
                    onClick={() => handleFetchTabs(config.spreadsheetId)}
                    disabled={isFetching || !config.spreadsheetId}
                    className="px-4 py-2.5 font-bold text-sm rounded-xl transition-colors disabled:opacity-50"
                    style={{ backgroundColor: "var(--q-green-bg)", color: "var(--q-google)" }}
                  >
                    {isFetching ? "..." : "Bağlan"}
                  </button>
                </div>
              </div>

              {availableTabs.length > 0 && (
                <div className="animate-in slide-in-from-top-2">
                  <label className="block text-xs font-bold uppercase tracking-wider mb-2" style={{ color: "var(--q-text-secondary)" }}>Aktif Sekmeler (Sadece Seçilenlerden Veri Alınır)</label>
                  <div className="flex flex-wrap gap-2">
                    {availableTabs.map((tab) => {
                      const isActive = (config.activeSheets || []).includes(tab.title);
                      return (
                        <button
                          key={tab.id}
                          onClick={() => toggleSheet(tab.title)}
                          className="flex items-center gap-2 px-3 py-1.5 rounded-lg border text-sm font-semibold transition-all"
                          style={isActive ? {
                            backgroundColor: "var(--q-google)", color: "#fff", borderColor: "var(--q-google)"
                          } : {
                            backgroundColor: "var(--q-bg-primary)", color: "var(--q-text-primary)", borderColor: "var(--q-border-strong)"
                          }}
                        >
                          {isActive && <CheckCircle2 className="w-4 h-4" />}
                          {tab.title}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="pt-4 flex flex-col sm:flex-row gap-3 justify-between items-center" style={{ borderTop: "1px solid var(--q-border-default)" }}>
                <div className="flex gap-2">
                  <button 
                    onClick={handleSyncOld}
                    disabled={isSyncingOld || availableTabs.length === 0}
                    className="w-full sm:w-auto px-4 py-2.5 bg-white text-sm font-semibold rounded-xl transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
                    style={{ border: "1px solid var(--q-border-strong)", color: "var(--q-text-primary)" }}
                    title="Seçili sekmelerdeki geçmiş kayıtları bir defaya mahsus çeker"
                  >
                    <DownloadCloud className={`w-4 h-4 ${isSyncingOld ? 'animate-bounce' : ''}`} />
                    {isSyncingOld ? "Aktarılıyor..." : "Eski Kayıtları İçeri Aktar"}
                  </button>

                  <button 
                    onClick={handleReset}
                    disabled={isDeleting}
                    className="w-full sm:w-auto px-4 py-2.5 text-sm font-semibold rounded-xl transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
                    style={{ backgroundColor: "var(--q-red-bg)", color: "var(--q-red)", border: "1px solid var(--q-red)" }}
                    title="Veritabanındaki tüm lead'leri siler"
                  >
                    <Trash2 className="w-4 h-4" />
                    {isDeleting ? "Siliniyor..." : "Tümünü Sıfırla"}
                  </button>
                </div>

                <button 
                  onClick={handleSave}
                  disabled={isSaving}
                  className="w-full sm:w-auto px-6 py-2.5 text-white text-sm font-bold rounded-xl transition-colors flex items-center justify-center gap-2"
                  style={{ backgroundColor: "var(--q-text-primary)" }}
                >
                  <Save className="w-4 h-4" />
                  {isSaving ? "Kaydediliyor..." : "Ayarları Kaydet"}
                </button>
                {saveMsg && (
                  <p className="text-[13px] font-medium" style={{ color: saveMsg.startsWith('✅') ? 'var(--q-green)' : 'var(--q-red)' }}>
                    {saveMsg}
                  </p>
                )}
              </div>
            </div>
          </SectionCard>
          
        </div>

        {/* Sidebar / Instructions */}
        <div className="space-y-6">
          <SectionCard>
            <h3 className="text-sm font-bold uppercase tracking-wider mb-4 flex items-center gap-2" style={{ color: "var(--q-text-primary)" }}>
              <Activity className="w-4 h-4" style={{ color: "var(--q-blue)" }} />
              Sıfır Maliyetli Otonom Yapı (Push)
            </h3>
            <p className="text-sm leading-relaxed font-medium mb-4" style={{ color: "var(--q-text-secondary)" }}>
              Aşağıdaki kod sayesinde, Google Sheets&apos;e yeni bir satır eklendiği saniye CRM sistemine otomatik aktarılır.
            </p>

            <div className="space-y-4 mb-4">
              {[
                "E-tablonuzda üst menüden <strong>Uzantılar > Apps Script</strong> seçeneğine tıklayın.",
                "Açılan ekrandaki tüm yazıları silip aşağıdaki kodu kopyalayın ve yapıştırın.",
                "Yukarıdan <strong>Kaydet (💾)</strong> ikonuna basın. İşlem bu kadar!"
              ].map((text, i) => (
                <div key={i} className="flex gap-3">
                  <div className="w-6 h-6 rounded-full font-bold flex items-center justify-center flex-shrink-0 text-sm"
                    style={{ backgroundColor: "var(--q-blue-bg)", color: "var(--q-blue)" }}>{i + 1}</div>
                  <p className="text-sm font-medium" style={{ color: "var(--q-text-primary)" }} dangerouslySetInnerHTML={{ __html: text }} />
                </div>
              ))}
            </div>
            
            <div className="relative group">
              <button 
                onClick={() => navigator.clipboard.writeText(webhookScript)}
                className="absolute top-2 right-2 p-1.5 bg-white/10 hover:bg-white/20 rounded-md text-white/70 hover:text-white transition-colors"
                title="Kodu Kopyala"
              >
                <Copy className="w-4 h-4" />
              </button>
              <pre className="p-4 rounded-xl text-xs overflow-x-auto font-mono leading-relaxed shadow-inner"
                style={{ backgroundColor: "var(--q-text-primary)", color: "var(--q-bg-secondary)" }}>
                {webhookScript}
              </pre>
            </div>
          </SectionCard>
        </div>

      </div>
    </PageShell>
  );
}
