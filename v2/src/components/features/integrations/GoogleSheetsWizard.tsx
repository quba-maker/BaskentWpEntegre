import React, { useState, useEffect, useCallback } from 'react';
import { IntegrationWizard, WizardStep } from './IntegrationWizard';
import { 
  FileSpreadsheet, CheckCircle2, Loader2, AlertTriangle,
  Columns, ExternalLink, Bot, MessageCircle, Save,
  BrainCircuit, Settings2, Link2
} from 'lucide-react';
import { motion } from 'framer-motion';
import { 
  fetchGoogleSheetsTabs, 
  saveGoogleSheetsConfig, 
  getGoogleSheetsConfig 
} from '@/app/actions/integrations';
import { getBotListForDropdown } from '@/app/actions/integrations';

// Parse spreadsheet ID from URL or raw ID
function parseSpreadsheetId(input: string): string {
  if (!input) return '';
  // Handle full URL: https://docs.google.com/spreadsheets/d/SPREADSHEET_ID/edit...
  const match = input.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (match) return match[1];
  // Handle raw ID
  return input.trim();
}

export function GoogleSheetsWizard({ isOpen, onClose, onComplete }: { isOpen: boolean, onClose: () => void, onComplete: () => void }) {
  
  // ── Core State ──
  const [spreadsheetInput, setSpreadsheetInput] = useState('');
  const [spreadsheetId, setSpreadsheetId] = useState('');
  const [tabs, setTabs] = useState<{ id: number; title: string }[]>([]);
  const [selectedTabs, setSelectedTabs] = useState<string[]>([]);
  const [tabsLoading, setTabsLoading] = useState(false);
  const [tabsError, setTabsError] = useState('');
  
  // ── Routing Config ──
  const [bots, setBots] = useState<{ id: string; displayName: string; color: string }[]>([]);
  const [channels, setChannels] = useState<{ id: string; name: string; provider: string }[]>([]);
  const [selectedBotId, setSelectedBotId] = useState('');
  const [selectedChannelId, setSelectedChannelId] = useState('');
  
  // ── Save State ──
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [saveSuccess, setSaveSuccess] = useState(false);
  
  // ── Load existing config + bots on open ──
  useEffect(() => {
    if (!isOpen) return;
    
    (async () => {
      // Load bots
      const botRes = await getBotListForDropdown();
      if (botRes.success && botRes.bots) {
        setBots(botRes.bots);
        if (botRes.bots.length > 0 && !selectedBotId) {
          setSelectedBotId(botRes.bots[0].id);
        }
      }
      
      // Load existing config
      const cfgRes = await getGoogleSheetsConfig();
      if (cfgRes.success && cfgRes.config) {
        const cfg = cfgRes.config as any;
        if (cfg.spreadsheetId) {
          setSpreadsheetInput(cfg.spreadsheetId);
          setSpreadsheetId(cfg.spreadsheetId);
        }
        if (cfg.activeSheets?.length) {
          setSelectedTabs(cfg.activeSheets);
        }
      }
      
      // Load WhatsApp channels for outbound selection
      try {
        const { getIntegrationHealth } = await import('@/app/actions/integrations');
        const healthRes = await getIntegrationHealth();
        if (healthRes.success && healthRes.channels) {
          const waChannels = (healthRes.channels as any[]).filter(
            (c: any) => c.provider === 'whatsapp' && c.status === 'connected'
          );
          setChannels(waChannels.map((c: any) => ({ id: c.id, name: c.name, provider: c.provider })));
          if (waChannels.length > 0 && !selectedChannelId) {
            setSelectedChannelId(waChannels[0].id);
          }
        }
      } catch (e) {
        console.warn('[GSW] Failed to load channels:', e);
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // ── Fetch Tabs ──
  async function handleFetchTabs() {
    const id = parseSpreadsheetId(spreadsheetInput);
    if (!id) {
      setTabsError('Geçerli bir Spreadsheet ID veya link girin');
      return;
    }
    setSpreadsheetId(id);
    setTabsLoading(true);
    setTabsError('');
    setTabs([]);
    
    const res = await fetchGoogleSheetsTabs(id);
    setTabsLoading(false);
    
    if (res.success && res.tabs) {
      setTabs(res.tabs);
      // Auto-select first tab if none selected
      if (res.tabs.length > 0 && selectedTabs.length === 0) {
        setSelectedTabs([res.tabs[0].title]);
      }
    } else {
      setTabsError(res.error || 'Sheet okunamadı — paylaşım ayarlarını kontrol edin');
    }
  }
  
  function toggleTab(title: string) {
    setSelectedTabs(prev => 
      prev.includes(title) ? prev.filter(t => t !== title) : [...prev, title]
    );
  }

  // ── Save Config ──
  async function handleSave() {
    setSaving(true);
    setSaveError('');
    
    try {
      const res = await saveGoogleSheetsConfig({
        spreadsheetId,
        activeSheets: selectedTabs,
        outbound_channel_id: selectedChannelId || undefined,
        greeting_group_id: selectedBotId || undefined,
      });
      
      if (!res.success) {
        setSaveError(res.error || 'Kayıt hatası');
        setSaving(false);
        return;
      }
      
      setSaveSuccess(true);
      setSaving(false);
    } catch (err) {
      console.error('[GSW] Save error:', err);
      setSaveError('Kayıt sırasında bir hata oluştu');
      setSaving(false);
    }
  }
  
  // ── Handle Finish ──
  function handleFinish() {
    onComplete();
  }

  // ═══════════════════════════════════════════
  // STEP 1: Spreadsheet Connection
  // ═══════════════════════════════════════════
  const Step1Connect = (
    <div className="space-y-5">
      <div className="p-4 bg-blue-50/50 border border-blue-100 rounded-xl">
        <div className="flex items-start gap-3">
          <Link2 className="w-5 h-5 text-blue-600 mt-0.5 flex-shrink-0" />
          <div>
            <h4 className="text-[14px] font-bold text-blue-900 mb-1">Google Sheets Bağlantısı</h4>
            <p className="text-[12px] text-blue-700">
              Sheet linkini veya Spreadsheet ID'sini yapıştırın. Sheet'in <strong>"Bağlantısı olan herkes"</strong> paylaşımının açık olması gerekir.
            </p>
          </div>
        </div>
      </div>
      
      <div>
        <label className="text-[12px] font-bold text-gray-500 uppercase tracking-wider mb-2 block">
          Spreadsheet Link / ID
        </label>
        <div className="flex gap-2">
          <input
            value={spreadsheetInput}
            onChange={e => setSpreadsheetInput(e.target.value)}
            placeholder="https://docs.google.com/spreadsheets/d/... veya Spreadsheet ID"
            className="flex-1 px-4 py-3 rounded-xl border text-[14px] font-medium outline-none focus:ring-2 focus:ring-blue-200 transition-all"
            style={{ borderColor: 'var(--q-border-default)' }}
          />
          <button
            onClick={handleFetchTabs}
            disabled={tabsLoading || !spreadsheetInput.trim()}
            className="px-5 py-3 rounded-xl text-white text-[13px] font-bold flex items-center gap-2 disabled:opacity-50 transition-all hover:opacity-90"
            style={{ backgroundColor: '#0F9D58' }}
          >
            {tabsLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileSpreadsheet className="w-4 h-4" />}
            Bağlan
          </button>
        </div>
        {tabsError && (
          <div className="mt-3 p-3 bg-rose-50 border border-rose-200 rounded-xl flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-500 mt-0.5 flex-shrink-0" />
            <p className="text-[12px] font-medium text-rose-700">{tabsError}</p>
          </div>
        )}
        {spreadsheetId && tabs.length > 0 && (
          <div className="mt-3 p-3 bg-emerald-50 border border-emerald-200 rounded-xl flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            <p className="text-[12px] font-bold text-emerald-700">
              Bağlantı başarılı — {tabs.length} sekme bulundu
            </p>
          </div>
        )}
      </div>
      
      {spreadsheetId && (
        <div className="flex items-center gap-2 text-[11px] font-mono" style={{ color: 'var(--q-text-secondary)' }}>
          <span>ID: {spreadsheetId.slice(0, 20)}...</span>
          <a 
            href={`https://docs.google.com/spreadsheets/d/${spreadsheetId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-blue-600 hover:underline"
          >
            Aç <ExternalLink className="w-3 h-3" />
          </a>
        </div>
      )}
    </div>
  );

  // ═══════════════════════════════════════════
  // STEP 2: Tab Selection
  // ═══════════════════════════════════════════
  const Step2Tabs = (
    <div className="space-y-4">
      <p className="text-[13px] font-medium" style={{ color: 'var(--q-text-secondary)' }}>
        Hangi sekmelerdeki yeni satırlar lead olarak işlensin?
      </p>
      
      {tabs.length > 0 ? (
        <div className="space-y-2">
          {tabs.map(tab => (
            <div
              key={tab.id}
              onClick={() => toggleTab(tab.title)}
              className={`flex items-center p-4 rounded-xl border-2 cursor-pointer transition-all ${
                selectedTabs.includes(tab.title)
                  ? 'border-[#0F9D58] bg-emerald-50/40 shadow-sm'
                  : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
              }`}
            >
              <div className={`w-10 h-10 rounded-lg flex items-center justify-center mr-4 flex-shrink-0 ${
                selectedTabs.includes(tab.title) ? 'bg-emerald-100' : 'bg-gray-100'
              }`}>
                <Columns className={`w-5 h-5 ${selectedTabs.includes(tab.title) ? 'text-emerald-600' : 'text-gray-400'}`} />
              </div>
              <div className="flex-1">
                <h4 className="text-[15px] font-bold" style={{ color: 'var(--q-text-primary)' }}>{tab.title}</h4>
              </div>
              {selectedTabs.includes(tab.title) && (
                <CheckCircle2 className="w-5 h-5 text-emerald-500 flex-shrink-0" />
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="text-center py-8">
          <Columns className="w-12 h-12 mx-auto mb-3 text-gray-300" />
          <p className="text-[13px] font-medium text-gray-500">
            Önce bir spreadsheet bağlayın
          </p>
        </div>
      )}
    </div>
  );

  // ═══════════════════════════════════════════
  // STEP 3: Routing Config
  // ═══════════════════════════════════════════
  const Step3Routing = (
    <div className="space-y-6">
      <div className="p-4 bg-purple-50/50 border border-purple-100 rounded-xl">
        <div className="flex items-start gap-3">
          <Settings2 className="w-5 h-5 text-purple-600 mt-0.5 flex-shrink-0" />
          <div>
            <h4 className="text-[14px] font-bold text-purple-900 mb-1">Yönlendirme Ayarları</h4>
            <p className="text-[12px] text-purple-700">
              Sheet'ten gelen lead'ler hangi WhatsApp kanalı üzerinden karşılanacak ve hangi bot yanıt verecek?
            </p>
          </div>
        </div>
      </div>
      
      {/* Outbound WhatsApp Channel */}
      <div>
        <label className="text-[12px] font-bold text-gray-500 uppercase tracking-wider mb-2 flex items-center gap-1.5">
          <MessageCircle className="w-3.5 h-3.5" /> Outbound WhatsApp Kanalı
        </label>
        <select
          value={selectedChannelId}
          onChange={e => setSelectedChannelId(e.target.value)}
          className="w-full px-4 py-3 rounded-xl border text-[14px] font-medium outline-none bg-white"
          style={{ borderColor: 'var(--q-border-default)' }}
        >
          {channels.length === 0 && (
            <option value="">Aktif WhatsApp kanalı yok</option>
          )}
          {channels.map(ch => (
            <option key={ch.id} value={ch.id}>{ch.name}</option>
          ))}
        </select>
        <p className="text-[11px] mt-1.5 font-medium" style={{ color: 'var(--q-text-secondary)' }}>
          Lead telefon numarasına bu kanal üzerinden mesaj gönderilecek.
        </p>
      </div>
      
      {/* Greeting Bot */}
      <div>
        <label className="text-[12px] font-bold text-gray-500 uppercase tracking-wider mb-2 flex items-center gap-1.5">
          <Bot className="w-3.5 h-3.5" /> Karşılama Botu
        </label>
        <select
          value={selectedBotId}
          onChange={e => setSelectedBotId(e.target.value)}
          className="w-full px-4 py-3 rounded-xl border text-[14px] font-medium outline-none bg-white"
          style={{ borderColor: 'var(--q-border-default)' }}
        >
          {bots.map(b => (
            <option key={b.id} value={b.id}>{b.displayName}</option>
          ))}
        </select>
        <p className="text-[11px] mt-1.5 font-medium" style={{ color: 'var(--q-text-secondary)' }}>
          Otomatik karşılama mesajı bu botun promptu ile oluşturulacak.
        </p>
      </div>
    </div>
  );

  // ═══════════════════════════════════════════
  // STEP 4: Save & Activate
  // ═══════════════════════════════════════════
  const Step4Save = (
    <div className="space-y-6">
      {saveSuccess ? (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="text-center py-8">
          <div className="w-20 h-20 bg-emerald-50 border-[3px] border-emerald-200 rounded-full flex items-center justify-center mx-auto mb-6">
            <CheckCircle2 className="w-10 h-10 text-emerald-500" />
          </div>
          <h3 className="text-[20px] font-bold" style={{ color: 'var(--q-text-primary)' }}>
            Pipeline Aktif!
          </h3>
          <p className="text-[14px] mt-2 font-medium" style={{ color: 'var(--q-text-secondary)' }}>
            Google Sheets → Lead → WhatsApp akışı kaydedildi.
          </p>
          <div className="mt-6 space-y-2 max-w-sm mx-auto text-left">
            <div className="flex items-center gap-2 text-[12px] p-2 bg-gray-50 rounded-lg">
              <FileSpreadsheet className="w-4 h-4 text-[#0F9D58]" />
              <span className="font-medium">Sheet: {spreadsheetId.slice(0, 16)}...</span>
            </div>
            <div className="flex items-center gap-2 text-[12px] p-2 bg-gray-50 rounded-lg">
              <Columns className="w-4 h-4 text-blue-500" />
              <span className="font-medium">Sekmeler: {selectedTabs.join(', ')}</span>
            </div>
            {channels.find(c => c.id === selectedChannelId) && (
              <div className="flex items-center gap-2 text-[12px] p-2 bg-gray-50 rounded-lg">
                <MessageCircle className="w-4 h-4 text-emerald-500" />
                <span className="font-medium">WhatsApp: {channels.find(c => c.id === selectedChannelId)?.name}</span>
              </div>
            )}
            {bots.find(b => b.id === selectedBotId) && (
              <div className="flex items-center gap-2 text-[12px] p-2 bg-gray-50 rounded-lg">
                <Bot className="w-4 h-4 text-purple-500" />
                <span className="font-medium">Bot: {bots.find(b => b.id === selectedBotId)?.displayName}</span>
              </div>
            )}
          </div>
        </motion.div>
      ) : (
        <>
          {/* Config Summary */}
          <div className="bg-white rounded-xl border p-5 space-y-3" style={{ borderColor: 'var(--q-border-default)' }}>
            <h4 className="text-[14px] font-bold" style={{ color: 'var(--q-text-primary)' }}>Yapılandırma Özeti</h4>
            <div className="space-y-2">
              <div className="flex items-center justify-between text-[13px]">
                <span className="font-medium" style={{ color: 'var(--q-text-secondary)' }}>Spreadsheet</span>
                <span className="font-bold font-mono text-[12px]">{spreadsheetId.slice(0, 20)}...</span>
              </div>
              <div className="flex items-center justify-between text-[13px]">
                <span className="font-medium" style={{ color: 'var(--q-text-secondary)' }}>Aktif Sekmeler</span>
                <span className="font-bold">{selectedTabs.join(', ') || 'Seçilmedi'}</span>
              </div>
              <div className="flex items-center justify-between text-[13px]">
                <span className="font-medium" style={{ color: 'var(--q-text-secondary)' }}>WhatsApp Kanalı</span>
                <span className="font-bold">{channels.find(c => c.id === selectedChannelId)?.name || 'Seçilmedi'}</span>
              </div>
              <div className="flex items-center justify-between text-[13px]">
                <span className="font-medium" style={{ color: 'var(--q-text-secondary)' }}>Karşılama Botu</span>
                <span className="font-bold">{bots.find(b => b.id === selectedBotId)?.displayName || 'Seçilmedi'}</span>
              </div>
            </div>
          </div>
          
          {saveError && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-500 mt-0.5 flex-shrink-0" />
              <p className="text-[12px] font-medium text-rose-700">{saveError}</p>
            </div>
          )}
          
          <button
            onClick={handleSave}
            disabled={saving || !spreadsheetId || selectedTabs.length === 0}
            className="w-full py-3 rounded-xl text-white text-[14px] font-bold flex items-center justify-center gap-2 disabled:opacity-50 transition-all hover:opacity-90"
            style={{ backgroundColor: '#0F9D58' }}
          >
            {saving ? (
              <><Loader2 className="w-4 h-4 animate-spin" /> Kaydediliyor...</>
            ) : (
              <><Save className="w-4 h-4" /> Kaydet &amp; Aktifleştir</>
            )}
          </button>
        </>
      )}
    </div>
  );

  // ═══════════════════════════════════════════
  // WIZARD STEPS
  // ═══════════════════════════════════════════
  const steps: WizardStep[] = [
    { 
      id: 'connect', 
      title: 'Bağlantı', 
      component: Step1Connect, 
      isValid: !!spreadsheetId && tabs.length > 0 
    },
    { 
      id: 'tabs', 
      title: 'Sekmeler', 
      component: Step2Tabs, 
      isValid: selectedTabs.length > 0 
    },
    { 
      id: 'routing', 
      title: 'Yönlendirme', 
      component: Step3Routing, 
      isValid: true 
    },
    { 
      id: 'save', 
      title: 'Kaydet', 
      component: Step4Save, 
      isValid: saveSuccess 
    },
  ];

  return (
    <IntegrationWizard 
      isOpen={isOpen} 
      onClose={onClose} 
      providerId="google_sheets" 
      providerName="Google Sheets Entegrasyonu" 
      providerIcon={<FileSpreadsheet className="w-8 h-8 text-[#0F9D58]" />} 
      steps={steps} 
      onComplete={handleFinish} 
      localStorageKey="draft_google_sheets_wizard_v4" 
    />
  );
}
