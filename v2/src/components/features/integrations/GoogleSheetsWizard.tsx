import React, { useState, useEffect } from 'react';
import { IntegrationWizard, WizardStep } from './IntegrationWizard';
import { 
  FileSpreadsheet, Folder, ArrowRightLeft, CheckCircle2, 
  Loader2, Sparkles, Clock, AlertTriangle, AlertCircle, 
  ServerCrash, PlayCircle, Columns, Users, ShieldCheck, Activity,
  RefreshCw, Combine, DatabaseZap, Wand2, Type, Hash, ShieldAlert,
  RotateCcw, BrainCircuit, UserCog, Lightbulb, MessageSquareText
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { get, set, del } from 'idb-keyval';

export function GoogleSheetsWizard({ isOpen, onClose, onComplete }: { isOpen: boolean, onClose: () => void, onComplete: () => void }) {
  
  const STORAGE_KEY = 'draft_google_sheets_wizard_v3';
  
  // State 
  const [selectedSheet, setSelectedSheet] = useState<string | null>(null);
  const [selectedTab, setSelectedTab] = useState<string | null>(null);
  const [syncMode, setSyncMode] = useState<string>('append');
  const [duplicateKey, setDuplicateKey] = useState<string>('semantic');
  const [syncFrequency, setSyncFrequency] = useState<string>('realtime');
  const [isMappingConfirmed, setIsMappingConfirmed] = useState(false);
  const [isDataRestored, setIsDataRestored] = useState(false);

  // Restore Draft State
  useEffect(() => {
    if (isOpen) {
      Promise.all([
        get(`${STORAGE_KEY}_sheet`),
        get(`${STORAGE_KEY}_tab`),
        get(`${STORAGE_KEY}_syncMode`),
        get(`${STORAGE_KEY}_duplicateKey`),
        get(`${STORAGE_KEY}_syncFreq`),
        get(`${STORAGE_KEY}_mapping`)
      ]).then(([sheet, tab, mode, dupKey, freq, mapping]) => {
        if (sheet) setSelectedSheet(sheet);
        if (tab) setSelectedTab(tab);
        if (mode) setSyncMode(mode);
        if (dupKey) setDuplicateKey(dupKey);
        if (freq) setSyncFrequency(freq);
        if (mapping) setIsMappingConfirmed(true);
        setIsDataRestored(true);
      });
    } else {
      setIsDataRestored(false);
    }
  }, [isOpen]);

  // Persist State
  useEffect(() => {
    if (isDataRestored) {
      if (selectedSheet) set(`${STORAGE_KEY}_sheet`, selectedSheet);
      if (selectedTab) set(`${STORAGE_KEY}_tab`, selectedTab);
      set(`${STORAGE_KEY}_syncMode`, syncMode);
      set(`${STORAGE_KEY}_duplicateKey`, duplicateKey);
      set(`${STORAGE_KEY}_syncFreq`, syncFrequency);
      if (isMappingConfirmed) set(`${STORAGE_KEY}_mapping`, isMappingConfirmed);
    }
  }, [selectedSheet, selectedTab, syncMode, duplicateKey, syncFrequency, isMappingConfirmed, isDataRestored]);

  // Clean draft on complete
  const handleFinish = () => {
    del(`${STORAGE_KEY}_sheet`);
    del(`${STORAGE_KEY}_tab`);
    del(`${STORAGE_KEY}_syncMode`);
    del(`${STORAGE_KEY}_duplicateKey`);
    del(`${STORAGE_KEY}_syncFreq`);
    del(`${STORAGE_KEY}_mapping`);
    del(`${STORAGE_KEY}_step`); 
    onComplete();
  };

  // -------------------------------------------------------------
  // MOCK DATA
  // -------------------------------------------------------------
  const MOCK_SHEETS = [
    { id: '1', name: '2026 Başvurular', folder: 'Başkent Üniversitesi', updated: '2 dk önce', rows: 418, type: 'Google Form', status: 'active' }
  ];
  const MOCK_TABS = [
    { id: 't1', name: 'Form Yanıtları 1', cols: 12, rows: 418, updated: '2 dk önce' }
  ];
  const MOCK_COLUMNS = ['Timestamp', 'İletişim Numaranız', 'Bize mesajınız', 'Bölüm Tercihi'];

  // -------------------------------------------------------------
  // STEP 1: Discovery
  // -------------------------------------------------------------
  const Step1Discovery = (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4">
        {MOCK_SHEETS.map(sheet => (
          <div 
            key={sheet.id}
            onClick={() => setSelectedSheet(sheet.id)}
            className={`flex items-start p-5 rounded-[20px] border-2 cursor-pointer transition-all ${
              selectedSheet === sheet.id ? 'border-[var(--q-blue)] bg-blue-50/40 shadow-md ring-4 ring-blue-50' : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
            }`}
          >
            <div className={`w-14 h-14 rounded-[16px] flex items-center justify-center mr-5 flex-shrink-0 ${sheet.type === 'Google Form' ? 'bg-purple-100 text-purple-600' : 'bg-green-100 text-[#0F9D58]'}`}>
              <FileSpreadsheet className="w-7 h-7" />
            </div>
            <div className="flex-1">
              <div className="flex items-center justify-between mb-1.5">
                <h4 className="text-[16px] font-bold text-[var(--q-text-primary)]">{sheet.name}</h4>
                {sheet.status === 'active' && <span className="flex items-center gap-1.5 px-2.5 py-1 bg-green-100 text-green-700 text-[11px] font-bold rounded-full uppercase tracking-wide"><Activity className="w-3.5 h-3.5" /> Aktif Akış</span>}
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px] text-[var(--q-text-secondary)] font-medium">
                <span className="flex items-center gap-1.5"><Folder className="w-4 h-4 text-gray-400" /> {sheet.folder}</span>
                <span className="flex items-center gap-1.5"><Users className="w-4 h-4 text-gray-400" /> {sheet.rows} Kayıt</span>
                <span className="flex items-center gap-1.5"><Clock className="w-4 h-4 text-gray-400" /> Son Veri: {sheet.updated}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  // -------------------------------------------------------------
  // STEP 2: Data Stream Selector
  // -------------------------------------------------------------
  const Step2TabSelect = (
    <div className="space-y-4">
      {MOCK_TABS.map(tab => (
        <div 
          key={tab.id}
          onClick={() => setSelectedTab(tab.id)}
          className={`flex items-center p-5 rounded-[20px] border-2 cursor-pointer transition-all ${
            selectedTab === tab.id ? 'border-[var(--q-blue)] bg-blue-50/40 shadow-md ring-4 ring-blue-50' : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
          }`}
        >
          <div className="w-12 h-12 bg-gray-100 rounded-[14px] flex items-center justify-center mr-5 border border-gray-200">
            <Columns className="w-6 h-6 text-gray-500" />
          </div>
          <div className="flex-1">
            <h4 className="text-[16px] font-bold text-[var(--q-text-primary)] mb-1.5">{tab.name}</h4>
            <div className="flex items-center gap-4 text-[13px] text-[var(--q-text-secondary)] font-medium">
              <span className="flex items-center gap-1.5"><Columns className="w-4 h-4" /> {tab.cols} Kolon</span>
              <span className="flex items-center gap-1.5"><Users className="w-4 h-4" /> {tab.rows} Kayıt</span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );

  // -------------------------------------------------------------
  // STEP 3: Semantic Analysis (NEW)
  // -------------------------------------------------------------
  const [isAnalyzing, setIsAnalyzing] = useState(true);
  useEffect(() => {
    if (isOpen) {
      const timer = setTimeout(() => setIsAnalyzing(false), 3000);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  const Step3Semantic = (
    <div className="space-y-6">
      {isAnalyzing ? (
        <div className="py-20 flex flex-col items-center justify-center text-center">
          <div className="relative w-24 h-24 mb-6">
            <motion.div animate={{ scale: [1, 1.2, 1], opacity: [0.3, 0.6, 0.3] }} transition={{ repeat: Infinity, duration: 2 }} className="absolute inset-0 bg-blue-200 rounded-full blur-xl"></motion.div>
            <div className="absolute inset-2 bg-white rounded-full flex items-center justify-center shadow-lg border border-blue-100">
              <BrainCircuit className="w-10 h-10 text-[var(--q-blue)] animate-pulse" />
            </div>
          </div>
          <h4 className="text-[18px] font-bold text-[var(--q-text-primary)] mb-2">Semantik Analiz Yapılıyor...</h4>
          <p className="text-[14px] text-[var(--q-text-secondary)] font-medium max-w-[320px]">
            Sütun isimleri ve örnek verileriniz Yapay Zeka tarafından okunarak anlamsal (semantic) eşleşme skorları hesaplanıyor.
          </p>
        </div>
      ) : (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-6 py-10 text-center">
           <div className="w-20 h-20 bg-green-50 border-[3px] border-green-200 rounded-full flex items-center justify-center mx-auto mb-6">
              <CheckCircle2 className="w-10 h-10 text-green-500" />
            </div>
            <h3 className="text-[20px] font-bold text-[var(--q-text-primary)]">Analiz Tamamlandı</h3>
            <p className="text-[14px] text-[var(--q-text-secondary)] font-medium max-w-[360px] mx-auto">
              Yapay zeka {MOCK_COLUMNS.length} adet sütunu analiz etti ve %94 genel güven skoru ile haritalama (mapping) haritasını çıkardı.
            </p>
        </motion.div>
      )}
    </div>
  );

  // -------------------------------------------------------------
  // STEP 4: Sync Strategy
  // -------------------------------------------------------------
  const Step4SyncStrategy = (
    <div className="space-y-8">
      <section>
        <h4 className="text-[14px] font-bold text-[var(--q-text-primary)] mb-3 uppercase tracking-wider">Aktarım Modu (Sync Mode)</h4>
        <div className="grid grid-cols-2 gap-3">
          {[
            { id: 'append', label: 'Sadece Ekle', desc: 'Mevcutları güncellemez.', icon: <DatabaseZap className="w-5 h-5" /> },
            { id: 'update', label: 'Güncelle', desc: 'Eşleşen kaydı ezer.', icon: <RefreshCw className="w-5 h-5" /> },
            { id: 'merge', label: 'Zeki Birleştir', desc: 'Dolu alanları ezmez.', icon: <Combine className="w-5 h-5" /> },
            { id: 'never', label: 'Asla Üzerine Yazma', desc: 'Mükerreri atlar.', icon: <ShieldCheck className="w-5 h-5" /> }
          ].map(mode => (
            <div key={mode.id} onClick={() => setSyncMode(mode.id)} className={`p-4 rounded-xl border-2 cursor-pointer transition-colors ${syncMode === mode.id ? 'border-[var(--q-blue)] bg-blue-50/30' : 'border-gray-200 hover:bg-gray-50'}`}>
              <div className="flex items-center gap-2 mb-1.5">
                <div className={`w-6 h-6 flex items-center justify-center ${syncMode === mode.id ? 'text-[var(--q-blue)]' : 'text-gray-400'}`}>
                  {mode.icon}
                </div>
                <h5 className="font-bold text-[14px] text-[var(--q-text-primary)]">{mode.label}</h5>
              </div>
              <p className="text-[12px] text-[var(--q-text-secondary)] font-medium pl-8">{mode.desc}</p>
            </div>
          ))}
        </div>
      </section>

      <section>
        <div className="flex items-center justify-between mb-3">
          <h4 className="text-[14px] font-bold text-[var(--q-text-primary)] uppercase tracking-wider">Mükerrerlik Stratejisi (Duplicate Strategy)</h4>
          <span className="flex items-center gap-1 text-[11px] font-bold text-purple-600 bg-purple-50 px-2 py-0.5 rounded-full"><Sparkles className="w-3 h-3"/> AI Enhanced</span>
        </div>
        <div className="bg-gray-50 p-1.5 rounded-lg border border-gray-200 flex flex-wrap gap-1">
          {[
            { id: 'phone', label: 'Sadece Telefon (Exact)' },
            { id: 'email', label: 'Sadece E-posta (Exact)' },
            { id: 'semantic', label: 'Semantik Bulanık Eşleşme (Fuzzy Name + Phone)' }
          ].map(dup => (
            <button key={dup.id} onClick={() => setDuplicateKey(dup.id)} className={`flex-1 py-2 px-3 text-[13px] font-bold rounded-md transition-all ${duplicateKey === dup.id ? (dup.id==='semantic' ? 'bg-gradient-to-r from-purple-600 to-blue-600 text-white shadow-md' : 'bg-white shadow-sm text-[var(--q-text-primary)] border border-gray-200') : 'text-gray-500 hover:text-gray-800 border border-transparent'}`}>
              {dup.label}
            </button>
          ))}
        </div>
        {duplicateKey === 'semantic' && <p className="text-[12px] text-gray-500 mt-2 font-medium">"Ahmet Yılmaz" ile "ahmet yilmaz" aynı müşteri olarak değerlendirilecektir.</p>}
      </section>
      
      <section>
        <h4 className="text-[14px] font-bold text-[var(--q-text-primary)] mb-3 uppercase tracking-wider">Akış Sıklığı (Sync Frequency)</h4>
        <select value={syncFrequency} onChange={e => setSyncFrequency(e.target.value)} className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl text-[14px] font-bold text-[var(--q-text-primary)] outline-none focus:ring-2 focus:ring-blue-500">
          <option value="realtime">Gerçek Zamanlı (Realtime Webhook)</option>
          <option value="5min">Her 5 Dakikada Bir (Polling)</option>
        </select>
      </section>
    </div>
  );

  // -------------------------------------------------------------
  // STEP 5: AI Mapping & Confidence
  // -------------------------------------------------------------
  const Step5Mapping = (
    <div className="space-y-6">
      <div className="bg-gradient-to-r from-gray-50 to-white border border-gray-200 rounded-[20px] p-5 flex gap-5 shadow-sm">
        <div className="w-12 h-12 bg-gray-100 rounded-[14px] shadow-inner flex items-center justify-center flex-shrink-0">
          <UserCog className="w-6 h-6 text-gray-600" />
        </div>
        <div>
          <h4 className="text-[15px] font-bold text-gray-900 mb-1.5">Human-in-the-loop Aktif</h4>
          <p className="text-[13px] text-gray-600 font-medium leading-relaxed">
            %85 Güven Skorunun altındaki eşleştirmeler sarı renk ile işaretlenmiştir. Bu alanlar onayınız olmadan CRM'e yazılmaz.
          </p>
        </div>
      </div>

      <div className="border border-gray-200 rounded-[20px] overflow-hidden bg-white shadow-sm">
        <div className="grid grid-cols-[1fr_40px_1fr] bg-gray-50 p-4 border-b border-gray-200 text-[12px] font-bold text-gray-500 uppercase tracking-wider">
          <div className="pl-2">Dış Veri (Semantic Source)</div>
          <div></div>
          <div>CRM Hedef Alanı</div>
        </div>
        <div className="p-2 space-y-1">
          {MOCK_COLUMNS.map((col, idx) => {
            let mappedTo = '';
            let confidence = 0;
            let status: 'success' | 'warning' | 'none' = 'none';

            if (col === 'İletişim Numaranız') { mappedTo = 'Mobile Phone'; confidence = 99; status = 'success'; }
            if (col === 'Bölüm Tercihi') { mappedTo = 'Departman (Özel)'; confidence = 91; status = 'success'; }
            if (col === 'Bize mesajınız') { mappedTo = 'Intent Analysis'; confidence = 65; status = 'warning'; } // Requires review

            return (
              <div key={idx} className={`grid grid-cols-[1fr_40px_1fr] items-center gap-2 p-2 rounded-xl transition-colors group ${status === 'warning' ? 'bg-amber-50/50' : 'hover:bg-gray-50'}`}>
                <div className={`px-4 py-3 rounded-lg border text-[13px] font-bold w-full shadow-sm flex items-center justify-between ${status==='warning'?'bg-amber-50 border-amber-200 text-amber-900':'bg-white border-gray-200 text-[var(--q-text-primary)]'}`}>
                  {col}
                </div>
                <div className={`flex justify-center transition-colors ${status === 'success' ? 'text-blue-400' : 'text-amber-400'}`}>
                  <ArrowRightLeft className="w-4 h-4" />
                </div>
                <div className="relative">
                  <select 
                    className={`w-full px-4 py-3 rounded-lg border text-[13px] font-bold outline-none appearance-none shadow-sm transition-colors ${
                      status === 'success' ? 'bg-blue-50/30 border-blue-200 text-blue-900' : 
                      status === 'warning' ? 'bg-amber-100/50 border-amber-300 text-amber-900' : 'bg-white border-gray-200 text-gray-600'
                    }`}
                    defaultValue={mappedTo}
                    onChange={(e) => { if(e.target.value) setIsMappingConfirmed(true); }}
                  >
                    <option value="">-- Seçin --</option>
                    <option value="Tam Adı">Tam Adı</option>
                    <option value="Mobile Phone">Mobile Phone</option>
                    <option value="Departman (Özel)">Departman (Özel)</option>
                    <option value="Intent Analysis">Intent Analysis (Notlar)</option>
                  </select>
                  {status !== 'none' && (
                    <div className={`absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1 pointer-events-none px-1.5 py-0.5 rounded text-[10px] font-black ${status==='success'?'bg-blue-50 text-blue-600':'bg-amber-100 text-amber-700'}`}>
                      {status === 'warning' && <AlertTriangle className="w-3 h-3" />} %{confidence}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );

  // -------------------------------------------------------------
  // STEP 6: Transformation
  // -------------------------------------------------------------
  const Step6Transformation = (
    <div className="space-y-6">
      <div className="p-4 bg-gradient-to-r from-purple-50 to-pink-50 border border-purple-100 rounded-xl flex items-start gap-3">
        <Sparkles className="w-5 h-5 text-purple-600 mt-0.5" />
        <div>
          <h4 className="text-[14px] font-bold text-purple-900">AI Inferred Transformation</h4>
          <p className="text-[13px] text-purple-800 mt-1">Eşleştirilen alanlar CRM'e yazılmadan önce eksik veriler (Country, City vb.) mevcut verilere bakılarak yapay zeka tarafından tamamlanmaya çalışılır.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="p-5 border border-gray-200 rounded-[20px] bg-white shadow-sm flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Hash className="w-5 h-5 text-[var(--q-blue)]" />
              <h5 className="text-[14px] font-bold text-[var(--q-text-primary)]">Telefon Normalizasyonu</h5>
            </div>
          </div>
          <div className="px-3 py-2 bg-gray-50 rounded-lg text-[12px] font-mono text-gray-600 border border-gray-100 mt-4">05321234567 ➔ +90 532 123 45 67</div>
        </div>
        <div className="p-5 border border-purple-200 rounded-[20px] bg-purple-50/30 shadow-sm flex flex-col justify-between relative overflow-hidden">
          <div className="absolute top-0 right-0 px-2 py-1 bg-purple-100 text-purple-700 text-[10px] font-bold rounded-bl-lg">AI Özelliği</div>
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Lightbulb className="w-5 h-5 text-purple-600" />
              <h5 className="text-[14px] font-bold text-[var(--q-text-primary)]">Missing Value Inference</h5>
            </div>
            <p className="text-[12px] text-gray-500 mb-2">Telefon alan kodu üzerinden eksik Ülke (Country) bilgisi tamamlanır.</p>
          </div>
          <div className="px-3 py-2 bg-white rounded-lg text-[12px] font-mono text-purple-800 border border-purple-100 flex items-center justify-between">
            <span>+90...</span> <ArrowRightLeft className="w-3 h-3 text-purple-300"/> <span>Country: TR</span>
          </div>
        </div>
      </div>
    </div>
  );

  // -------------------------------------------------------------
  // STEP 7: Validation (Health Check)
  // -------------------------------------------------------------
  const [isHealthChecking, setIsHealthChecking] = useState(true);
  useEffect(() => { if (isOpen) { const timer = setTimeout(() => setIsHealthChecking(false), 2000); return () => clearTimeout(timer); } }, [isOpen]);

  const Step7HealthCheck = (
    <div className="space-y-6">
      {isHealthChecking ? (
        <div className="py-24 flex flex-col items-center justify-center text-center">
          <div className="relative w-16 h-16 mb-6">
            <div className="absolute inset-0 border-4 border-gray-100 rounded-full"></div>
            <div className="absolute inset-0 border-4 border-[var(--q-text-primary)] rounded-full border-t-transparent animate-spin"></div>
          </div>
          <h4 className="text-[18px] font-bold text-[var(--q-text-primary)] mb-2">Veri Sağlığı & Semantik Analiz Yapılıyor</h4>
        </div>
      ) : (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
          <div className="bg-white rounded-[20px] border border-gray-200 overflow-hidden shadow-sm">
            <div className="p-6 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
              <div>
                <h4 className="text-[16px] font-bold text-[var(--q-text-primary)]">Pipeline Analiz Raporu</h4>
                <p className="text-[13px] text-[var(--q-text-secondary)] font-medium mt-1">418 satır işlendi. Semantic Duplicate taraması tamamlandı.</p>
              </div>
              <ShieldAlert className="w-8 h-8 text-amber-500" />
            </div>
            <div className="p-6 space-y-4">
              <div className="flex items-start gap-4">
                <div className="mt-0.5"><CheckCircle2 className="w-5 h-5 text-green-500" /></div>
                <div>
                  <p className="text-[14px] font-bold text-[var(--q-text-primary)]">Temiz Kayıtlar</p>
                  <p className="text-[13px] text-[var(--q-text-secondary)] font-medium">403 satır aktarıma hazır.</p>
                </div>
              </div>
              <div className="flex items-start gap-4 p-3 bg-amber-50 rounded-xl border border-amber-100">
                <div className="mt-0.5"><UserCog className="w-5 h-5 text-amber-500" /></div>
                <div>
                  <p className="text-[14px] font-bold text-amber-900">Operatör Onayı Bekleyenler</p>
                  <p className="text-[13px] text-amber-700 font-medium mt-0.5">7 satırın Niyet Analizi (Intent) güven skoru %85 altında kaldı. Bu kayıtlar Human-in-the-loop havuzuna düşecek.</p>
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </div>
  );

  // -------------------------------------------------------------
  // STEP 8: Live Preview (Intent & Entity Extraction)
  // -------------------------------------------------------------
  const Step8Preview = (
    <div className="space-y-6">
      <div className="p-4 bg-gray-50 rounded-xl border border-gray-200 text-center">
        <p className="text-[13px] font-medium text-gray-600">Örnek satırdaki uzun mesaj parçalandı, niyet okundu ve varlıklar çıkarıldı.</p>
      </div>

      <div className="flex flex-col gap-4">
        {/* Raw View */}
        <div className="bg-white border border-gray-200 rounded-[20px] overflow-hidden flex flex-col shadow-sm">
          <div className="bg-gray-100 p-3 border-b border-gray-200 flex items-center gap-2"><MessageSquareText className="w-4 h-4 text-gray-600"/><h5 className="text-[12px] font-bold text-gray-600 uppercase">Ham Mesaj (Google Sheet)</h5></div>
          <div className="p-4 bg-gray-50/50">
            <p className="text-[14px] italic text-gray-700">"Merhaba, 0532 123 4567 numaramdan dönüş yapın lütfen. Annem için ortopedi randevusu almak istiyoruz, acil."</p>
          </div>
        </div>

        <div className="flex justify-center text-[var(--q-blue)] py-2">
          <BrainCircuit className="w-6 h-6 animate-pulse" />
        </div>

        {/* AI Extracted View */}
        <div className="bg-white border border-purple-200 rounded-[20px] overflow-hidden flex flex-col shadow-md">
          <div className="bg-purple-50 p-3 border-b border-purple-100 flex items-center justify-between">
            <div className="flex items-center gap-2"><Sparkles className="w-4 h-4 text-purple-600"/><h5 className="text-[12px] font-bold text-purple-800 uppercase">AI Entity Extraction & Intent</h5></div>
            <span className="bg-white px-2 py-1 rounded text-[10px] font-bold text-purple-600 border border-purple-200">Confidence: 96%</span>
          </div>
          <div className="p-5 grid grid-cols-2 md:grid-cols-4 gap-4 bg-white">
            <div>
              <span className="block text-[11px] font-bold text-gray-400 uppercase mb-1">Intent (Niyet)</span>
              <span className="inline-block px-3 py-1.5 bg-blue-50 text-blue-700 text-[13px] font-bold rounded-lg border border-blue-100">Randevu Talebi</span>
            </div>
            <div>
              <span className="block text-[11px] font-bold text-gray-400 uppercase mb-1">Departman</span>
              <span className="inline-block px-3 py-1.5 bg-green-50 text-green-700 text-[13px] font-bold rounded-lg border border-green-100">Ortopedi</span>
            </div>
            <div>
              <span className="block text-[11px] font-bold text-gray-400 uppercase mb-1">Aciliyet</span>
              <span className="inline-block px-3 py-1.5 bg-red-50 text-red-700 text-[13px] font-bold rounded-lg border border-red-100">Yüksek (Acil)</span>
            </div>
            <div>
              <span className="block text-[11px] font-bold text-gray-400 uppercase mb-1">Yakınlık Derecesi</span>
              <span className="inline-block px-3 py-1.5 bg-orange-50 text-orange-700 text-[13px] font-bold rounded-lg border border-orange-100">Anne (Yakını)</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  // -------------------------------------------------------------
  // STEP 9: Test Sync
  // -------------------------------------------------------------
  const [testStatus, setTestStatus] = useState<'idle' | 'running' | 'success'>('idle');
  const handleRunTest = () => { setTestStatus('running'); setTimeout(() => setTestStatus('success'), 2000); };
  const Step9Test = (
    <div className="space-y-6">
      <div className="bg-white border border-gray-200 rounded-[24px] p-8 text-center shadow-sm">
        {testStatus === 'idle' && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
            <button onClick={handleRunTest} className="px-8 py-3 bg-[var(--q-text-primary)] text-white text-[14px] font-bold rounded-xl hover:bg-black transition-all">Orkestrasyonu Test Et</button>
          </motion.div>
        )}
        {testStatus === 'running' && ( <Loader2 className="w-12 h-12 animate-spin text-[var(--q-blue)] mx-auto" /> )}
        {testStatus === 'success' && ( <CheckCircle2 className="w-16 h-16 text-green-500 mx-auto" /> )}
      </div>
    </div>
  );

  // -------------------------------------------------------------
  // STEP 10: Finish
  // -------------------------------------------------------------
  const Step10Finish = (
    <div className="space-y-8 py-8 text-center">
      <div className="flex items-center justify-center w-full max-w-[600px] mx-auto gap-2">
        <div className="flex flex-col items-center gap-2"><div className="w-12 h-12 bg-gray-100 rounded-xl flex items-center justify-center"><FileSpreadsheet className="w-5 h-5 text-gray-600"/></div></div>
        <div className="h-[2px] w-8 bg-gradient-to-r from-gray-300 to-purple-300"></div>
        <div className="flex flex-col items-center gap-2"><div className="w-12 h-12 bg-purple-100 rounded-xl flex items-center justify-center shadow-[0_0_15px_rgba(168,85,247,0.4)]"><BrainCircuit className="w-5 h-5 text-purple-600"/></div></div>
        <div className="h-[2px] w-8 bg-gradient-to-r from-purple-300 to-blue-300"></div>
        <div className="flex flex-col items-center gap-2"><div className="w-12 h-12 bg-blue-100 rounded-xl flex items-center justify-center"><Wand2 className="w-5 h-5 text-blue-600"/></div></div>
        <div className="h-[2px] w-8 bg-gradient-to-r from-blue-300 to-[var(--q-text-primary)]"></div>
        <div className="flex flex-col items-center gap-2"><div className="w-12 h-12 bg-black rounded-xl flex items-center justify-center"><span className="text-white font-black">Q</span></div></div>
      </div>
      
      <div>
        <h2 className="text-[28px] font-black text-[var(--q-text-primary)] tracking-tight mb-2">AI Ingestion Aktif!</h2>
      </div>

      <div className="flex justify-center mt-8 gap-4">
        <button className="flex items-center gap-2 px-4 py-2 bg-red-50 text-red-600 hover:bg-red-100 text-[13px] font-bold rounded-xl transition-colors">
          <RotateCcw className="w-4 h-4" /> Rollback
        </button>
      </div>
    </div>
  );

  const steps: WizardStep[] = [
    { id: 'discovery', title: 'Kaynak', component: Step1Discovery, isValid: selectedSheet !== null },
    { id: 'stream', title: 'Akış', component: Step2TabSelect, isValid: selectedTab !== null },
    { id: 'semantic', title: 'Semantik Analiz', component: Step3Semantic, isValid: !isAnalyzing },
    { id: 'sync', title: 'Strateji', component: Step4SyncStrategy, isValid: true },
    { id: 'mapping', title: 'Eşleştirme', component: Step5Mapping, isValid: true },
    { id: 'transform', title: 'Dönüşüm', component: Step6Transformation, isValid: true },
    { id: 'validation', title: 'Validation', component: Step7HealthCheck, isValid: !isHealthChecking },
    { id: 'preview', title: 'Entity Preview', component: Step8Preview, isValid: true },
    { id: 'test', title: 'Canlı Test', component: Step9Test, isValid: testStatus === 'success' },
    { id: 'finish', title: 'Aktivasyon', component: Step10Finish, isValid: true }
  ];

  return (
    <IntegrationWizard isOpen={isOpen} onClose={onClose} providerId="google_sheets" providerName="AI-Native Ingestion" providerIcon={<BrainCircuit className="w-8 h-8 text-purple-600" />} steps={steps} onComplete={handleFinish} localStorageKey={STORAGE_KEY} />
  );
}
