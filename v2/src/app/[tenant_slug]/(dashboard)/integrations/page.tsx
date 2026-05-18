"use client";

import { useState, useEffect } from "react";
import { Link2, Save, FileSpreadsheet, CheckCircle2, Activity, Copy, DownloadCloud, Trash2, MessageSquare, Hash, Webhook, ShieldAlert } from "lucide-react";
import { getGoogleSheetsConfig, saveGoogleSheetsConfig, fetchGoogleSheetsTabs, getMetaIntegrationConfig, saveMetaIntegrationConfig } from "@/app/actions/integrations";
import { syncGoogleSheets, deleteAllLeads } from "@/app/actions/forms";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { PageShell, PageHeader, SectionCard } from "@/components/governance";

export default function IntegrationsPage() {
  const [activeTab, setActiveTab] = useState("meta"); // meta | sheets | webhook
  const [sheetsConfig, setSheetsConfig] = useState<any>({ spreadsheetId: "", activeSheets: [] });
  const [metaConfig, setMetaConfig] = useState<any>({
    meta_app_id: "", meta_app_secret: "", whatsapp_phone_id: "", whatsapp_business_id: "",
    meta_page_token: "", meta_page_id: "", instagram_id: ""
  });
  
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isFetching, setIsFetching] = useState(false);
  const [isSyncingOld, setIsSyncingOld] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [availableTabs, setAvailableTabs] = useState<any[]>([]);
  const [saveMsg, setSaveMsg] = useState("");
  const confirm = useConfirm();

  const domain = typeof window !== 'undefined' ? window.location.origin : 'https://YOUR_DOMAIN';

  useEffect(() => {
    loadConfig();
  }, []);

  const loadConfig = async () => {
    setIsLoading(true);
    const [sheetsRes, metaRes] = await Promise.all([
      getGoogleSheetsConfig(),
      getMetaIntegrationConfig()
    ]);

    if (sheetsRes.success && sheetsRes.config) {
      setSheetsConfig(sheetsRes.config);
      if (sheetsRes.config.spreadsheetId) handleFetchTabs(sheetsRes.config.spreadsheetId);
    }
    
    if (metaRes.success && metaRes.config) {
      setMetaConfig({
        meta_app_id: metaRes.config.meta_app_id || "",
        meta_app_secret: metaRes.config.meta_app_secret || "",
        whatsapp_phone_id: metaRes.config.whatsapp_phone_id || "",
        whatsapp_business_id: metaRes.config.whatsapp_business_id || "",
        meta_page_token: metaRes.config.meta_page_token || "",
        meta_page_id: metaRes.config.meta_page_id || "",
        instagram_id: metaRes.config.instagram_id || ""
      });
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

  const handleSaveSheets = async () => {
    setIsSaving(true);
    setSaveMsg("");
    const res = await saveGoogleSheetsConfig(sheetsConfig);
    if (res.success) setSaveMsg("✅ Google Sheets ayarları kaydedildi!");
    else setSaveMsg(`❌ Hata: ${res.error}`);
    setIsSaving(false);
    setTimeout(() => setSaveMsg(""), 3000);
  };

  const handleSaveMeta = async () => {
    setIsSaving(true);
    setSaveMsg("");
    const res = await saveMetaIntegrationConfig(metaConfig);
    if (res.success) setSaveMsg("✅ Meta (WhatsApp & Instagram) ayarları kaydedildi!");
    else setSaveMsg(`❌ Hata: ${res.error}`);
    setIsSaving(false);
    setTimeout(() => setSaveMsg(""), 3000);
  };

  const toggleSheet = (title: string) => {
    const current = sheetsConfig.activeSheets || [];
    if (current.includes(title)) {
      setSheetsConfig({ ...sheetsConfig, activeSheets: current.filter((t: string) => t !== title) });
    } else {
      setSheetsConfig({ ...sheetsConfig, activeSheets: [...current, title] });
    }
  };

  const handleSyncOld = async () => {
    setIsSyncingOld(true);
    const res = await syncGoogleSheets();
    setIsSyncingOld(false);
    if (res.success) setSaveMsg("✅ Eski kayıtlar başarıyla içeri aktırıldı: " + res.message);
    else setSaveMsg("❌ Hata: " + res.error);
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
    
    if (res.success) setSaveMsg("✅ " + res.message);
    else setSaveMsg("❌ Hata: " + res.error);
    setTimeout(() => setSaveMsg(""), 4000);
  };

  return (
    <PageShell>
      <PageHeader
        icon={Link2}
        title="Entegrasyon Merkezi"
        subtitle="SaaS Altyapısı: WhatsApp API, Instagram ve Google Sheets'i bağlayın"
        iconGradient={{ from: "var(--q-purple)", to: "var(--q-blue)" }}
      />

      {/* TABS */}
      <div className="flex border-b mb-6" style={{ borderColor: "var(--q-border-default)" }}>
        <button 
          onClick={() => setActiveTab('meta')}
          className={`pb-3 px-4 text-sm font-bold transition-colors ${activeTab === 'meta' ? 'border-b-2' : ''}`}
          style={{ 
            color: activeTab === 'meta' ? 'var(--q-text-primary)' : 'var(--q-text-secondary)',
            borderColor: activeTab === 'meta' ? 'var(--q-text-primary)' : 'transparent'
          }}
        >
          Meta (WhatsApp & IG)
        </button>
        <button 
          onClick={() => setActiveTab('sheets')}
          className={`pb-3 px-4 text-sm font-bold transition-colors ${activeTab === 'sheets' ? 'border-b-2' : ''}`}
          style={{ 
            color: activeTab === 'sheets' ? 'var(--q-text-primary)' : 'var(--q-text-secondary)',
            borderColor: activeTab === 'sheets' ? 'var(--q-text-primary)' : 'transparent'
          }}
        >
          Google Sheets
        </button>
        <button 
          onClick={() => setActiveTab('webhook')}
          className={`pb-3 px-4 text-sm font-bold transition-colors ${activeTab === 'webhook' ? 'border-b-2' : ''}`}
          style={{ 
            color: activeTab === 'webhook' ? 'var(--q-text-primary)' : 'var(--q-text-secondary)',
            borderColor: activeTab === 'webhook' ? 'var(--q-text-primary)' : 'transparent'
          }}
        >
          SaaS Webhook & Güvenlik
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Main Content Area */}
        <div className="lg:col-span-2 space-y-6">
          
          {/* TAB 1: META */}
          {activeTab === 'meta' && (
            <SectionCard>
              <div className="flex items-start justify-between mb-6">
                <div className="flex items-center gap-4">
                  <div className="w-14 h-14 rounded-2xl flex items-center justify-center" style={{ backgroundColor: "var(--q-whatsapp-bg)", border: "1px solid var(--q-whatsapp)" }}>
                    <MessageSquare className="w-7 h-7" style={{ color: "var(--q-whatsapp)" }} />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold" style={{ color: "var(--q-text-primary)" }}>Meta Entegrasyonu</h2>
                    <p className="text-sm font-medium" style={{ color: "var(--q-text-secondary)" }}>SaaS ortamınız için WhatsApp, IG ve Messenger bağlayın</p>
                  </div>
                </div>
              </div>

              <div className="space-y-6">
                {/* Meta App Config */}
                <div className="p-4 rounded-xl" style={{ backgroundColor: "var(--q-bg-secondary)", border: "1px solid var(--q-border-default)" }}>
                  <h3 className="text-sm font-bold uppercase tracking-wider mb-4" style={{ color: "var(--q-text-primary)" }}>1. Meta Uygulama Bilgileri</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold mb-1" style={{ color: "var(--q-text-secondary)" }}>App ID</label>
                      <input type="text" value={metaConfig.meta_app_id} onChange={(e) => setMetaConfig({...metaConfig, meta_app_id: e.target.value})} className="w-full px-3 py-2 bg-white rounded-lg text-sm border focus:ring-1 outline-none transition-all" style={{ borderColor: "var(--q-border-strong)" }} />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold mb-1" style={{ color: "var(--q-text-secondary)" }}>App Secret</label>
                      <input type="password" value={metaConfig.meta_app_secret} onChange={(e) => setMetaConfig({...metaConfig, meta_app_secret: e.target.value})} className="w-full px-3 py-2 bg-white rounded-lg text-sm border focus:ring-1 outline-none transition-all" style={{ borderColor: "var(--q-border-strong)" }} />
                    </div>
                    <div className="md:col-span-2">
                      <label className="block text-xs font-semibold mb-1" style={{ color: "var(--q-text-secondary)" }}>Sistem Kullanıcısı Tokenı (Permanent Access Token)</label>
                      <input type="text" value={metaConfig.meta_page_token} onChange={(e) => setMetaConfig({...metaConfig, meta_page_token: e.target.value})} className="w-full px-3 py-2 bg-white rounded-lg text-sm border focus:ring-1 outline-none transition-all font-mono" style={{ borderColor: "var(--q-border-strong)" }} />
                    </div>
                  </div>
                </div>

                {/* WhatsApp Config */}
                <div className="p-4 rounded-xl" style={{ backgroundColor: "var(--q-bg-secondary)", border: "1px solid var(--q-border-default)" }}>
                  <h3 className="text-sm font-bold uppercase tracking-wider mb-4 flex items-center gap-2" style={{ color: "var(--q-text-primary)" }}>
                    <MessageSquare className="w-4 h-4" style={{ color: "var(--q-whatsapp)" }}/> 2. WhatsApp API
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold mb-1" style={{ color: "var(--q-text-secondary)" }}>Phone Number ID</label>
                      <input type="text" value={metaConfig.whatsapp_phone_id} onChange={(e) => setMetaConfig({...metaConfig, whatsapp_phone_id: e.target.value})} className="w-full px-3 py-2 bg-white rounded-lg text-sm border focus:ring-1 outline-none transition-all" style={{ borderColor: "var(--q-border-strong)" }} />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold mb-1" style={{ color: "var(--q-text-secondary)" }}>WhatsApp Business ID (WABA)</label>
                      <input type="text" value={metaConfig.whatsapp_business_id} onChange={(e) => setMetaConfig({...metaConfig, whatsapp_business_id: e.target.value})} className="w-full px-3 py-2 bg-white rounded-lg text-sm border focus:ring-1 outline-none transition-all" style={{ borderColor: "var(--q-border-strong)" }} />
                    </div>
                  </div>
                </div>

                {/* Instagram/Facebook Config */}
                <div className="p-4 rounded-xl" style={{ backgroundColor: "var(--q-bg-secondary)", border: "1px solid var(--q-border-default)" }}>
                  <h3 className="text-sm font-bold uppercase tracking-wider mb-4 flex items-center gap-2" style={{ color: "var(--q-text-primary)" }}>
                    <Hash className="w-4 h-4" style={{ color: "var(--q-instagram)" }}/> 3. Instagram & Messenger
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold mb-1" style={{ color: "var(--q-text-secondary)" }}>Facebook Page ID</label>
                      <input type="text" value={metaConfig.meta_page_id} onChange={(e) => setMetaConfig({...metaConfig, meta_page_id: e.target.value})} className="w-full px-3 py-2 bg-white rounded-lg text-sm border focus:ring-1 outline-none transition-all" style={{ borderColor: "var(--q-border-strong)" }} />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold mb-1" style={{ color: "var(--q-text-secondary)" }}>Instagram Account ID</label>
                      <input type="text" value={metaConfig.instagram_id} onChange={(e) => setMetaConfig({...metaConfig, instagram_id: e.target.value})} className="w-full px-3 py-2 bg-white rounded-lg text-sm border focus:ring-1 outline-none transition-all" style={{ borderColor: "var(--q-border-strong)" }} />
                    </div>
                  </div>
                </div>

                <div className="pt-4 flex justify-between items-center" style={{ borderTop: "1px solid var(--q-border-default)" }}>
                  {saveMsg && <p className="text-[13px] font-medium" style={{ color: saveMsg.startsWith('✅') ? 'var(--q-green)' : 'var(--q-red)' }}>{saveMsg}</p>}
                  {!saveMsg && <div />}
                  <button onClick={handleSaveMeta} disabled={isSaving} className="px-6 py-2.5 text-white text-sm font-bold rounded-xl transition-colors flex items-center gap-2" style={{ backgroundColor: "var(--q-text-primary)" }}>
                    <Save className="w-4 h-4" /> {isSaving ? "Kaydediliyor..." : "Meta Ayarlarını Kaydet"}
                  </button>
                </div>
              </div>
            </SectionCard>
          )}

          {/* TAB 2: SHEETS */}
          {activeTab === 'sheets' && (
             <SectionCard>
             <div className="flex items-start justify-between mb-6">
               <div className="flex items-center gap-4">
                 <div className="w-14 h-14 rounded-2xl flex items-center justify-center" style={{ backgroundColor: "var(--q-green-bg)", border: "1px solid var(--q-google)" }}>
                   <FileSpreadsheet className="w-7 h-7" style={{ color: "var(--q-google)" }} />
                 </div>
                 <div>
                   <h2 className="text-xl font-bold" style={{ color: "var(--q-text-primary)" }}>Google Sheets</h2>
                   <p className="text-sm font-medium" style={{ color: "var(--q-text-secondary)" }}>Satış formlarını otonom içeri aktarın</p>
                 </div>
               </div>
             </div>
 
             <div className="space-y-5">
               <div>
                 <label className="block text-xs font-bold uppercase tracking-wider mb-2" style={{ color: "var(--q-text-secondary)" }}>Google Spreadsheet ID</label>
                 <div className="flex gap-2">
                   <input 
                     type="text" 
                     value={sheetsConfig.spreadsheetId}
                     onChange={(e) => setSheetsConfig({ ...sheetsConfig, spreadsheetId: e.target.value })}
                     placeholder="1oSKJ..." 
                     className="flex-1 px-4 py-2.5 bg-white rounded-xl text-sm font-medium focus:ring-2 outline-none transition-all"
                     style={{ border: "1px solid var(--q-border-strong)" }}
                   />
                   <button 
                     onClick={() => handleFetchTabs(sheetsConfig.spreadsheetId)}
                     disabled={isFetching || !sheetsConfig.spreadsheetId}
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
                       const isActive = (sheetsConfig.activeSheets || []).includes(tab.title);
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
                   <button onClick={handleSyncOld} disabled={isSyncingOld || availableTabs.length === 0} className="w-full sm:w-auto px-4 py-2.5 bg-white text-sm font-semibold rounded-xl transition-colors flex items-center justify-center gap-2 disabled:opacity-50" style={{ border: "1px solid var(--q-border-strong)", color: "var(--q-text-primary)" }}>
                     <DownloadCloud className={`w-4 h-4 ${isSyncingOld ? 'animate-bounce' : ''}`} />
                     {isSyncingOld ? "Aktarılıyor..." : "Eski Kayıtları İçeri Aktar"}
                   </button>
                   <button onClick={handleReset} disabled={isDeleting} className="w-full sm:w-auto px-4 py-2.5 text-sm font-semibold rounded-xl transition-colors flex items-center justify-center gap-2 disabled:opacity-50" style={{ backgroundColor: "var(--q-red-bg)", color: "var(--q-red)", border: "1px solid var(--q-red)" }}>
                     <Trash2 className="w-4 h-4" />
                     {isDeleting ? "Siliniyor..." : "Tümünü Sıfırla"}
                   </button>
                 </div>
 
                 <button onClick={handleSaveSheets} disabled={isSaving} className="w-full sm:w-auto px-6 py-2.5 text-white text-sm font-bold rounded-xl transition-colors flex items-center justify-center gap-2" style={{ backgroundColor: "var(--q-text-primary)" }}>
                   <Save className="w-4 h-4" /> {isSaving ? "Kaydediliyor..." : "Ayarları Kaydet"}
                 </button>
               </div>
               {saveMsg && <p className="text-[13px] font-medium" style={{ color: saveMsg.startsWith('✅') ? 'var(--q-green)' : 'var(--q-red)' }}>{saveMsg}</p>}
             </div>
           </SectionCard>
          )}

          {/* TAB 3: WEBHOOK */}
          {activeTab === 'webhook' && (
            <SectionCard>
              <div className="flex items-start justify-between mb-6">
                <div className="flex items-center gap-4">
                  <div className="w-14 h-14 rounded-2xl flex items-center justify-center" style={{ backgroundColor: "var(--q-purple-bg)", border: "1px solid var(--q-purple)" }}>
                    <Webhook className="w-7 h-7" style={{ color: "var(--q-purple)" }} />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold" style={{ color: "var(--q-text-primary)" }}>Webhook Uç Noktası</h2>
                    <p className="text-sm font-medium" style={{ color: "var(--q-text-secondary)" }}>Gelen mesajların CRM'e iletilmesi için Meta'ya eklenecek adres.</p>
                  </div>
                </div>
              </div>

              <div className="p-5 rounded-xl border mb-6" style={{ backgroundColor: "var(--q-bg-secondary)", borderColor: "var(--q-border-default)" }}>
                <label className="block text-xs font-bold uppercase tracking-wider mb-2" style={{ color: "var(--q-text-secondary)" }}>Callback URL</label>
                <div className="flex gap-2">
                  <input type="text" readOnly value={`${domain}/api/webhook`} className="flex-1 px-4 py-3 bg-white rounded-lg text-sm font-mono border outline-none" style={{ borderColor: "var(--q-border-strong)", color: "var(--q-text-primary)" }} />
                  <button onClick={() => navigator.clipboard.writeText(`${domain}/api/webhook`)} className="px-4 py-3 text-white text-sm font-bold rounded-lg hover:opacity-90 transition-opacity" style={{ backgroundColor: "var(--q-text-primary)" }}>Kopyala</button>
                </div>
                
                <div className="mt-4">
                  <label className="block text-xs font-bold uppercase tracking-wider mb-2" style={{ color: "var(--q-text-secondary)" }}>Verify Token (Doğrulama Anahtarı)</label>
                  <p className="text-sm font-medium mb-2" style={{ color: "var(--q-text-secondary)" }}>Meta Developer panelinde bu değeri doğrulama tokenı olarak girin:</p>
                  <div className="flex gap-2">
                    <input type="text" readOnly value="quba-ai-super-secret-verify-token-2026" className="flex-1 px-4 py-3 bg-white rounded-lg text-sm font-mono border outline-none" style={{ borderColor: "var(--q-border-strong)", color: "var(--q-text-primary)" }} />
                    <button onClick={() => navigator.clipboard.writeText(`quba-ai-super-secret-verify-token-2026`)} className="px-4 py-3 text-sm font-bold rounded-lg border hover:bg-gray-50 transition-colors" style={{ borderColor: "var(--q-border-strong)", color: "var(--q-text-primary)" }}>Kopyala</button>
                  </div>
                </div>
              </div>

              <div className="p-4 rounded-xl flex gap-3" style={{ backgroundColor: "var(--q-orange-bg)", border: "1px solid var(--q-orange)" }}>
                <ShieldAlert className="w-5 h-5 shrink-0" style={{ color: "var(--q-orange)" }} />
                <div>
                  <h4 className="text-sm font-bold" style={{ color: "var(--q-orange)" }}>Güvenlik Notu</h4>
                  <p className="text-sm mt-1" style={{ color: "var(--q-text-secondary)" }}>Webhook adresinize gelen tüm istekler, göndericinin Meta olduğunu doğrulamak için `X-Hub-Signature-256` ile doğrulanır. Bunun çalışması için "Meta Ayarları" sekmesinde <strong>App Secret</strong> alanını doldurmuş olmanız zorunludur.</p>
                </div>
              </div>
            </SectionCard>
          )}
          
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          <SectionCard>
            <h3 className="text-sm font-bold uppercase tracking-wider mb-4 flex items-center gap-2" style={{ color: "var(--q-text-primary)" }}>
              <Activity className="w-4 h-4" style={{ color: "var(--q-blue)" }} />
              Kurulum Rehberi
            </h3>
            
            {activeTab === 'meta' && (
              <div className="space-y-4">
                <p className="text-sm font-medium mb-2" style={{ color: "var(--q-text-secondary)" }}>Meta API bağlantısı için şu adımları izleyin:</p>
                {[
                  "<b>developers.facebook.com</b> adresine gidin ve uygulamanızı açın.",
                  "<b>App Settings > Basic</b> bölümünden App ID ve App Secret değerlerini kopyalayın.",
                  "<b>WhatsApp > API Setup</b> menüsünden Phone Number ID ve Business Account ID'nizi alın.",
                  "Permanent Access Token oluşturmak için <b>Business Settings > System Users</b> adımını kullanın.",
                  "Tüm bilgileri girip kaydedin."
                ].map((text, i) => (
                  <div key={i} className="flex gap-3">
                    <div className="w-6 h-6 rounded-full font-bold flex items-center justify-center flex-shrink-0 text-sm" style={{ backgroundColor: "var(--q-blue-bg)", color: "var(--q-blue)" }}>{i + 1}</div>
                    <p className="text-sm font-medium" style={{ color: "var(--q-text-primary)" }} dangerouslySetInnerHTML={{ __html: text }} />
                  </div>
                ))}
              </div>
            )}

            {activeTab === 'sheets' && (
              <div className="space-y-4">
                <p className="text-sm font-medium mb-2" style={{ color: "var(--q-text-secondary)" }}>Sıfır Maliyetli Otonom Yapı (Push):</p>
                {[
                  "Google Sheets'te <b>Uzantılar > Apps Script</b> menüsüne girin.",
                  "Açılan ekrana soldaki örnek kodu kopyalayın (eski entegrasyon ekranındaki kod).",
                  "Kaydet ikonuna basın. İşlem bu kadar!"
                ].map((text, i) => (
                  <div key={i} className="flex gap-3">
                    <div className="w-6 h-6 rounded-full font-bold flex items-center justify-center flex-shrink-0 text-sm" style={{ backgroundColor: "var(--q-green-bg)", color: "var(--q-green)" }}>{i + 1}</div>
                    <p className="text-sm font-medium" style={{ color: "var(--q-text-primary)" }} dangerouslySetInnerHTML={{ __html: text }} />
                  </div>
                ))}
              </div>
            )}

            {activeTab === 'webhook' && (
              <div className="space-y-4">
                <p className="text-sm font-medium mb-2" style={{ color: "var(--q-text-secondary)" }}>Webhook kurulumu:</p>
                {[
                  "Meta Developer paneline gidin.",
                  "WhatsApp > Configuration bölümüne girin.",
                  "Edit butonuna tıklayıp Callback URL ve Verify Token'ı yapıştırın.",
                  "<b>messages</b> aboneliğini (subscription) aktif edin."
                ].map((text, i) => (
                  <div key={i} className="flex gap-3">
                    <div className="w-6 h-6 rounded-full font-bold flex items-center justify-center flex-shrink-0 text-sm" style={{ backgroundColor: "var(--q-purple-bg)", color: "var(--q-purple)" }}>{i + 1}</div>
                    <p className="text-sm font-medium" style={{ color: "var(--q-text-primary)" }} dangerouslySetInnerHTML={{ __html: text }} />
                  </div>
                ))}
              </div>
            )}
            
          </SectionCard>
        </div>

      </div>
    </PageShell>
  );
}
