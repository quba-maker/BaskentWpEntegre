import React, { useState, useEffect } from 'react';
import { IntegrationWizard, WizardStep } from './IntegrationWizard';
import { 
  FileSpreadsheet, Folder, ArrowRightLeft, CheckCircle2, 
  Loader2, Sparkles, Clock, AlertTriangle, AlertCircle, 
  ServerCrash, PlayCircle, Columns, Users, ShieldCheck, Activity,
  RefreshCw, GitMerge, Combine, DatabaseZap, Wand2, Type, Hash, ShieldAlert,
  RotateCcw
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { get, set, del } from 'idb-keyval';

export function GoogleSheetsWizard({ isOpen, onClose, onComplete }: { isOpen: boolean, onClose: () => void, onComplete: () => void }) {
  
  const STORAGE_KEY = 'draft_google_sheets_wizard';
  
  // State 
  const [selectedSheet, setSelectedSheet] = useState<string | null>(null);
  const [selectedTab, setSelectedTab] = useState<string | null>(null);
  const [syncMode, setSyncMode] = useState<string>('append');
  const [duplicateKey, setDuplicateKey] = useState<string>('phone');
  const [syncFrequency, setSyncFrequency] = useState<string>('realtime');
  const [isMappingConfirmed, setIsMappingConfirmed] = useState(false);
  const [isDataRestored, setIsDataRestored] = useState(false);

  // Restore Draft State from IndexedDB
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
    del(`${STORAGE_KEY}_step`); // Cleans IntegrationWizard draft
    onComplete();
  };

  // -------------------------------------------------------------
  // MOCK DATA
  // -------------------------------------------------------------
  const MOCK_SHEETS = [
    { id: '1', name: '2026 Başvurular', folder: 'Başkent Üniversitesi', updated: '2 dk önce', rows: 418, type: 'Google Form', status: 'active' },
    { id: '2', name: 'Satış Data Yedek', folder: 'Yedeklemeler', updated: 'Dün', rows: 12500, type: 'Google Sheet', status: 'idle' }
  ];
  const MOCK_TABS = [
    { id: 't1', name: 'Form Yanıtları 1', cols: 12, rows: 418, updated: '2 dk önce' }
  ];
  const MOCK_COLUMNS = ['Timestamp', 'İsim Soyisim', 'Telefon Numarası', 'Bölüm Seçimi', 'Ek Notlar'];

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
  // STEP 3: Sync Strategy (NEW)
  // -------------------------------------------------------------
  const Step3SyncStrategy = (
    <div className="space-y-8">
      {/* Sync Mode */}
      <section>
        <h4 className="text-[14px] font-bold text-[var(--q-text-primary)] mb-3 uppercase tracking-wider">Aktarım Modu (Sync Mode)</h4>
        <div className="grid grid-cols-2 gap-3">
          {[
            { id: 'append', label: 'Sadece Ekle (Append Only)', desc: 'Yeni gelenleri ekler, eskileri güncellemez.', icon: <DatabaseZap className="w-5 h-5" /> },
            { id: 'update', label: 'Mevcutları Güncelle (Update)', desc: 'Eşleşen kaydın üzerine yazar.', icon: <RefreshCw className="w-5 h-5" /> },
            { id: 'merge', label: 'Zekice Birleştir (Merge)', desc: 'Sadece boş alanları doldurur, dolu olanı ezmez.', icon: <Combine className="w-5 h-5" /> },
            { id: 'never', label: 'Asla Üzerine Yazma', desc: 'Mükerrer varsa atlar (Skip).', icon: <ShieldCheck className="w-5 h-5" /> }
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

      {/* Duplicate Strategy */}
      <section>
        <h4 className="text-[14px] font-bold text-[var(--q-text-primary)] mb-3 uppercase tracking-wider">Mükerrerlik Kontrolü (Duplicate Key)</h4>
        <div className="bg-gray-50 p-1.5 rounded-lg border border-gray-200 flex">
          {[
            { id: 'phone', label: 'Sadece Telefon' },
            { id: 'email', label: 'Sadece E-posta' },
            { id: 'phone_name', label: 'Telefon + İsim Birlikte' }
          ].map(dup => (
            <button key={dup.id} onClick={() => setDuplicateKey(dup.id)} className={`flex-1 py-2 text-[13px] font-bold rounded-md transition-all ${duplicateKey === dup.id ? 'bg-white shadow-sm text-[var(--q-text-primary)]' : 'text-gray-500 hover:text-gray-800'}`}>
              {dup.label}
            </button>
          ))}
        </div>
      </section>
      
      {/* Frequency */}
      <section>
        <h4 className="text-[14px] font-bold text-[var(--q-text-primary)] mb-3 uppercase tracking-wider">Akış Sıklığı (Sync Frequency)</h4>
        <select value={syncFrequency} onChange={e => setSyncFrequency(e.target.value)} className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl text-[14px] font-bold text-[var(--q-text-primary)] outline-none focus:ring-2 focus:ring-blue-500">
          <option value="realtime">Gerçek Zamanlı (Realtime Webhook)</option>
          <option value="5min">Her 5 Dakikada Bir (Polling)</option>
          <option value="hourly">Saatlik (Batch Job)</option>
          <option value="manual">Sadece Manuel Tetikleme (Sync Butonu)</option>
        </select>
      </section>
    </div>
  );

  // -------------------------------------------------------------
  // STEP 4: AI Mapping
  // -------------------------------------------------------------
  const Step4Mapping = (
    <div className="space-y-6">
      <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-100/50 rounded-[20px] p-5 flex gap-5 shadow-sm">
        <div className="w-12 h-12 bg-white rounded-[14px] shadow-sm flex items-center justify-center flex-shrink-0 border border-blue-100">
          <Sparkles className="w-6 h-6 text-blue-600" />
        </div>
        <div>
          <h4 className="text-[15px] font-bold text-blue-900 mb-1.5">AI Eşleştirmesi Tamamlandı</h4>
          <p className="text-[13px] text-blue-800 font-medium leading-relaxed">
            Yapay zeka {MOCK_COLUMNS.length} sütunu analiz etti. %98 ortalama güven skoru elde edildi. Lütfen eşleşmeyen (sarı) alanları kontrol edin.
          </p>
        </div>
      </div>

      <div className="border border-gray-200 rounded-[20px] overflow-hidden bg-white shadow-sm">
        <div className="grid grid-cols-[1fr_40px_1fr] bg-gray-50 p-4 border-b border-gray-200 text-[12px] font-bold text-gray-500 uppercase tracking-wider">
          <div className="pl-2">Dış Veri Kaynağı</div>
          <div></div>
          <div>CRM Hedef Alanı</div>
        </div>
        <div className="p-2 space-y-1">
          {MOCK_COLUMNS.map((col, idx) => {
            let mappedTo = '';
            let confidence = 0;
            let status: 'success' | 'warning' | 'none' = 'none';

            if (col === 'İsim Soyisim') { mappedTo = 'Tam Adı'; confidence = 98; status = 'success'; }
            if (col === 'Telefon Numarası') { mappedTo = 'Mobile Phone'; confidence = 99; status = 'success'; }
            if (col === 'Bölüm Seçimi') { mappedTo = 'Departman (Özel)'; confidence = 85; status = 'success'; }
            if (col === 'Ek Notlar') { mappedTo = ''; confidence = 0; status = 'warning'; }

            return (
              <div key={idx} className={`grid grid-cols-[1fr_40px_1fr] items-center gap-2 p-2 rounded-xl transition-colors group ${status === 'warning' ? 'bg-amber-50/50' : 'hover:bg-gray-50'}`}>
                <div className="px-4 py-3 rounded-lg border text-[13px] font-bold w-full shadow-sm flex items-center justify-between bg-white border-gray-200 text-[var(--q-text-primary)]">
                  {col}
                  {status === 'warning' && <AlertTriangle className="w-4 h-4 text-amber-500" />}
                </div>
                <div className={`flex justify-center transition-colors ${status === 'success' ? 'text-blue-400' : 'text-gray-300'}`}>
                  <ArrowRightLeft className="w-4 h-4" />
                </div>
                <div className="relative">
                  <select 
                    className={`w-full px-4 py-3 rounded-lg border text-[13px] font-bold outline-none appearance-none shadow-sm transition-colors ${
                      status === 'success' ? 'bg-blue-50/30 border-blue-200 text-blue-900' : 
                      status === 'warning' ? 'bg-white border-amber-300 text-gray-700' : 'bg-white border-gray-200 text-gray-600'
                    }`}
                    defaultValue={mappedTo}
                    onChange={(e) => { if(e.target.value) setIsMappingConfirmed(true); }}
                  >
                    <option value="">-- Seçin --</option>
                    <option value="Tam Adı">Tam Adı</option>
                    <option value="Mobile Phone">Mobile Phone</option>
                    <option value="Departman (Özel)">Departman (Özel)</option>
                    <option value="Notlar">Notlar</option>
                  </select>
                  {status === 'success' && (
                    <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1.5 pointer-events-none bg-blue-50 px-1.5 py-0.5 rounded text-[10px] font-black text-blue-600">
                      %{confidence}
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
  // STEP 5: Field Transformation (NEW)
  // -------------------------------------------------------------
  const Step5Transformation = (
    <div className="space-y-6">
      <div className="p-4 bg-purple-50 border border-purple-100 rounded-xl flex items-start gap-3">
        <Wand2 className="w-5 h-5 text-purple-600 mt-0.5" />
        <div>
          <h4 className="text-[14px] font-bold text-purple-900">Veri Temizleyici Aktif</h4>
          <p className="text-[13px] text-purple-800 mt-1">Eşleştirdiğiniz alanlar CRM'e yazılmadan önce aşağıdaki kurallara göre otomatik olarak temizlenir ve formatlanır.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Phone Norm */}
        <div className="p-5 border border-gray-200 rounded-[20px] bg-white shadow-sm flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Hash className="w-5 h-5 text-[var(--q-blue)]" />
              <h5 className="text-[14px] font-bold text-[var(--q-text-primary)]">Telefon Normalizasyonu</h5>
            </div>
            <p className="text-[13px] text-gray-500 mb-4 line-clamp-2">"05321234567" formatı otomatik olarak "+90 532 123 45 67" şeklinde CRM standardına çevrilir.</p>
          </div>
          <div className="px-3 py-2 bg-gray-50 rounded-lg text-[12px] font-mono text-gray-600 border border-gray-100">05321234567 ➔ +90 532 123 45 67</div>
        </div>
        {/* Trim & Case */}
        <div className="p-5 border border-gray-200 rounded-[20px] bg-white shadow-sm flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Type className="w-5 h-5 text-[var(--q-blue)]" />
              <h5 className="text-[14px] font-bold text-[var(--q-text-primary)]">Karakter Düzeltme</h5>
            </div>
            <p className="text-[13px] text-gray-500 mb-4 line-clamp-2">Gereksiz boşluklar kırpılır (trim) ve isimler Title-Case (Sadece baş harfleri büyük) yapılır.</p>
          </div>
          <div className="px-3 py-2 bg-gray-50 rounded-lg text-[12px] font-mono text-gray-600 border border-gray-100">  ahmet  yılmaz ➔ Ahmet Yılmaz</div>
        </div>
      </div>
    </div>
  );

  // -------------------------------------------------------------
  // STEP 6: Validation (Health Check)
  // -------------------------------------------------------------
  const [isHealthChecking, setIsHealthChecking] = useState(true);
  useEffect(() => {
    if (isOpen) {
      const timer = setTimeout(() => setIsHealthChecking(false), 2000);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  const Step6HealthCheck = (
    <div className="space-y-6">
      {isHealthChecking ? (
        <div className="py-24 flex flex-col items-center justify-center text-center">
          <div className="relative w-16 h-16 mb-6">
            <div className="absolute inset-0 border-4 border-gray-100 rounded-full"></div>
            <div className="absolute inset-0 border-4 border-[var(--q-text-primary)] rounded-full border-t-transparent animate-spin"></div>
            <ShieldCheck className="absolute inset-0 m-auto w-6 h-6 text-[var(--q-text-primary)]" />
          </div>
          <h4 className="text-[18px] font-bold text-[var(--q-text-primary)] mb-2">Veri Sağlığı & Kurallar Analiz Ediliyor</h4>
          <p className="text-[14px] text-[var(--q-text-secondary)] font-medium">Dönüşüm kuralları ve {syncMode} stratejisine göre 418 satır test ediliyor...</p>
        </div>
      ) : (
        <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="space-y-4">
          <div className="bg-white rounded-[20px] border border-gray-200 overflow-hidden shadow-sm">
            <div className="p-6 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
              <div>
                <h4 className="text-[16px] font-bold text-[var(--q-text-primary)]">Pipeline Analiz Raporu</h4>
                <p className="text-[13px] text-[var(--q-text-secondary)] font-medium mt-1">418 satır işlendi. 24 satır dönüşüm (transformation) ile kurtarıldı.</p>
              </div>
              <ShieldAlert className="w-8 h-8 text-amber-500" />
            </div>
            
            <div className="p-6 space-y-4">
              <div className="flex items-start gap-4">
                <div className="mt-0.5"><CheckCircle2 className="w-5 h-5 text-green-500" /></div>
                <div>
                  <p className="text-[14px] font-bold text-[var(--q-text-primary)]">Temiz Kayıtlar (Ready)</p>
                  <p className="text-[13px] text-[var(--q-text-secondary)] font-medium">403 satır hatasız şekilde aktarıma hazır.</p>
                </div>
              </div>
              
              <div className="flex items-start gap-4 p-3 bg-amber-50 rounded-xl border border-amber-100">
                <div className="mt-0.5"><AlertCircle className="w-5 h-5 text-amber-500" /></div>
                <div>
                  <p className="text-[14px] font-bold text-amber-900">Eksik Veri Uyarıları</p>
                  <p className="text-[13px] text-amber-700 font-medium mt-0.5">12 satırda telefon numarası yok. (Atlanacak)</p>
                </div>
              </div>

              <div className="flex items-start gap-4 p-3 bg-purple-50 rounded-xl border border-purple-100">
                <div className="mt-0.5"><Combine className="w-5 h-5 text-purple-600" /></div>
                <div>
                  <p className="text-[14px] font-bold text-purple-900">Mükerrerlik ({syncMode} Modu)</p>
                  <p className="text-[13px] text-purple-800 font-medium mt-0.5">Mevcut veritabanı analizinde 3 kayıt daha önceden var. Kurallarınıza göre üzerine yazılmayacak/güncellenecek.</p>
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </div>
  );

  // -------------------------------------------------------------
  // STEP 7: Live Preview
  // -------------------------------------------------------------
  const Step7Preview = (
    <div className="space-y-6">
      <div className="p-4 bg-gray-50 rounded-xl border border-gray-200 text-center">
        <p className="text-[13px] font-medium text-gray-600">Örnek satır dönüşüm kurallarından (<span className="font-mono">Transformation Pipeline</span>) geçirilerek CRM formatına çevrildi.</p>
      </div>

      <div className="flex flex-col md:flex-row gap-4 items-stretch">
        {/* Raw View */}
        <div className="flex-1 bg-white border border-gray-200 rounded-[20px] overflow-hidden flex flex-col">
          <div className="bg-gray-100 p-3 border-b border-gray-200"><h5 className="text-[12px] font-bold text-gray-500 uppercase">Ham Veri (Google Sheet)</h5></div>
          <div className="p-4 space-y-3 bg-gray-50/50">
            <div className="text-[12px]"><span className="font-bold">İsim:</span> <span className="font-mono text-amber-600 bg-amber-50 px-1"> aHmet  yıLMAZ </span></div>
            <div className="text-[12px]"><span className="font-bold">Telefon:</span> <span className="font-mono text-amber-600 bg-amber-50 px-1">05321234567</span></div>
          </div>
        </div>

        <div className="flex items-center justify-center text-[var(--q-blue)]">
          <ArrowRightLeft className="w-6 h-6 md:rotate-0 rotate-90" />
        </div>

        {/* CRM View */}
        <div className="flex-1 bg-white border border-[var(--q-border-strong)] rounded-[20px] overflow-hidden flex flex-col shadow-md">
          <div className="bg-blue-50 p-3 border-b border-blue-100 flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-blue-600"/><h5 className="text-[12px] font-bold text-blue-800 uppercase">Dönüştürülmüş (Quba CRM)</h5></div>
          <div className="p-6 flex flex-col items-center">
            <div className="w-12 h-12 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-bold text-lg mb-2">AY</div>
            <h3 className="text-[16px] font-bold text-[var(--q-text-primary)]">Ahmet Yılmaz</h3>
            <p className="text-[12px] font-mono text-green-600 mt-1">+90 532 123 45 67</p>
          </div>
        </div>
      </div>
    </div>
  );

  // -------------------------------------------------------------
  // STEP 8: Test Sync
  // -------------------------------------------------------------
  const [testStatus, setTestStatus] = useState<'idle' | 'running' | 'success'>('idle');
  const handleRunTest = () => {
    setTestStatus('running');
    setTimeout(() => setTestStatus('success'), 2000);
  };
  const Step8Test = (
    <div className="space-y-6">
      <div className="bg-white border border-gray-200 rounded-[24px] p-8 text-center shadow-sm">
        {testStatus === 'idle' && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
            <div className="w-20 h-20 bg-blue-50 rounded-full flex items-center justify-center mx-auto">
              <PlayCircle className="w-10 h-10 text-[var(--q-blue)]" />
            </div>
            <div>
              <h3 className="text-[20px] font-bold text-[var(--q-text-primary)] mb-2">Pipeline Testi</h3>
              <p className="text-[14px] text-[var(--q-text-secondary)] font-medium max-w-[360px] mx-auto">
                1 adet örnek kayıt, dönüşüm kurallarıyla birlikte sisteme aktarılacaktır. 
              </p>
            </div>
            <button onClick={handleRunTest} className="px-8 py-3 bg-[var(--q-text-primary)] text-white text-[14px] font-bold rounded-xl hover:bg-black shadow-lg hover:-translate-y-0.5 transition-all">Testi Başlat</button>
          </motion.div>
        )}
        {testStatus === 'running' && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4 py-6">
            <Loader2 className="w-12 h-12 animate-spin text-[var(--q-blue)] mx-auto mb-4" />
            <h3 className="text-[18px] font-bold text-[var(--q-text-primary)]">Senkronizasyon Motoru Çalışıyor...</h3>
          </motion.div>
        )}
        {testStatus === 'success' && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6 py-4">
            <CheckCircle2 className="w-16 h-16 text-green-500 mx-auto" />
            <h3 className="text-[20px] font-bold text-[var(--q-text-primary)]">Test Başarılı!</h3>
          </motion.div>
        )}
      </div>
    </div>
  );

  // -------------------------------------------------------------
  // STEP 9: Finish / Pipeline Vis / Rollback
  // -------------------------------------------------------------
  const Step9Finish = (
    <div className="space-y-8 py-8 text-center">
      <div className="flex items-center justify-center w-full max-w-[500px] mx-auto gap-2">
        {/* Pipeline Vis */}
        <div className="flex flex-col items-center gap-2"><div className="w-12 h-12 bg-green-100 rounded-xl flex items-center justify-center"><FileSpreadsheet className="w-6 h-6 text-green-600"/></div><span className="text-[10px] font-bold text-gray-500">Kaynak</span></div>
        <div className="h-[2px] flex-1 bg-gradient-to-r from-green-300 via-blue-300 to-purple-300 relative overflow-hidden"><div className="absolute inset-0 bg-white/50 w-full h-full animate-[shimmer_2s_infinite]"></div></div>
        <div className="flex flex-col items-center gap-2"><div className="w-12 h-12 bg-blue-100 rounded-xl flex items-center justify-center"><Wand2 className="w-6 h-6 text-blue-600"/></div><span className="text-[10px] font-bold text-gray-500">Dönüşüm</span></div>
        <div className="h-[2px] flex-1 bg-gradient-to-r from-blue-300 to-[var(--q-text-primary)] relative overflow-hidden"><div className="absolute inset-0 bg-white/50 w-full h-full animate-[shimmer_2s_infinite] delay-75"></div></div>
        <div className="flex flex-col items-center gap-2"><div className="w-12 h-12 bg-black rounded-xl flex items-center justify-center"><span className="text-white font-black">Q</span></div><span className="text-[10px] font-bold text-gray-500">Quba CRM</span></div>
      </div>
      
      <div>
        <h2 className="text-[28px] font-black text-[var(--q-text-primary)] tracking-tight mb-2">Veri Hattı Canlıda!</h2>
        <p className="text-[14px] text-[var(--q-text-secondary)] font-medium">Otomatik senkronizasyon ({syncFrequency}) olarak aktifleştirildi.</p>
      </div>

      <div className="flex justify-center mt-8">
        <button className="flex items-center gap-2 px-4 py-2 bg-red-50 text-red-600 hover:bg-red-100 text-[13px] font-bold rounded-xl transition-colors border border-red-100">
          <RotateCcw className="w-4 h-4" /> İçe Aktarmayı Geri Al (Rollback)
        </button>
      </div>
    </div>
  );

  const steps: WizardStep[] = [
    { id: 'discovery', title: 'Kaynak Keşfi', subtitle: 'Veri kaynağını seçin', component: Step1Discovery, isValid: selectedSheet !== null },
    { id: 'stream', title: 'Veri Akışı', subtitle: 'Hedef sekme analizi', component: Step2TabSelect, isValid: selectedTab !== null },
    { id: 'sync_strategy', title: 'Senkronizasyon Stratejisi', subtitle: 'Aktarım kuralları', component: Step3SyncStrategy, isValid: true },
    { id: 'mapping', title: 'Zeki Eşleştirme', subtitle: 'Sütun eşleştirmesi', component: Step4Mapping, isValid: true },
    { id: 'transformation', title: 'Dönüştürme Kuralları', subtitle: 'Veri temizleyici', component: Step5Transformation, isValid: true },
    { id: 'health_check', title: 'Health Check', subtitle: 'Kuralların analizi', component: Step6HealthCheck, isValid: !isHealthChecking },
    { id: 'preview', title: 'Görsel Önizleme', subtitle: 'Dönüşüm önizlemesi', component: Step7Preview, isValid: true },
    { id: 'test_sync', title: 'Canlı Test', subtitle: 'Pipeline denemesi', component: Step8Test, isValid: testStatus === 'success' },
    { id: 'finish', title: 'Aktivasyon', subtitle: 'Sistem devrede', component: Step9Finish, isValid: true }
  ];

  return (
    <IntegrationWizard isOpen={isOpen} onClose={onClose} providerId="google_sheets" providerName="Google Sheets Pipeline" providerIcon={<FileSpreadsheet className="w-8 h-8 text-[#0F9D58]" />} steps={steps} onComplete={handleFinish} localStorageKey={STORAGE_KEY} />
  );
}
