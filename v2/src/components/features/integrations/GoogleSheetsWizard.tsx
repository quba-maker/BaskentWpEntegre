import React, { useState, useEffect } from 'react';
import { IntegrationWizard, WizardStep } from './IntegrationWizard';
import { 
  FileSpreadsheet, Folder, File, ArrowRightLeft, CheckCircle2, 
  Loader2, Sparkles, Clock, AlertTriangle, AlertCircle, 
  ServerCrash, PlayCircle, Columns, Users, ShieldCheck, Activity
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

export function GoogleSheetsWizard({ isOpen, onClose, onComplete }: { isOpen: boolean, onClose: () => void, onComplete: () => void }) {
  
  // Persistent State Engine (Draft State)
  const STORAGE_KEY = 'draft_google_sheets_wizard';
  
  const [selectedSheet, setSelectedSheet] = useState<string | null>(() => {
    if (typeof window !== 'undefined') return localStorage.getItem(`${STORAGE_KEY}_sheet`) || null;
    return null;
  });
  
  const [selectedTab, setSelectedTab] = useState<string | null>(() => {
    if (typeof window !== 'undefined') return localStorage.getItem(`${STORAGE_KEY}_tab`) || null;
    return null;
  });

  const [isMappingConfirmed, setIsMappingConfirmed] = useState(false);

  useEffect(() => {
    if (selectedSheet) localStorage.setItem(`${STORAGE_KEY}_sheet`, selectedSheet);
  }, [selectedSheet]);

  useEffect(() => {
    if (selectedTab) localStorage.setItem(`${STORAGE_KEY}_tab`, selectedTab);
  }, [selectedTab]);

  // Clean draft on complete
  const handleFinish = () => {
    localStorage.removeItem(`${STORAGE_KEY}_sheet`);
    localStorage.removeItem(`${STORAGE_KEY}_tab`);
    localStorage.removeItem(`${STORAGE_KEY}_step`);
    onComplete();
  };

  // Mock Data
  const MOCK_SHEETS = [
    { id: '1', name: '2026 Başvurular', folder: 'Başkent Üniversitesi', updated: '2 dk önce', rows: 418, type: 'Google Form', status: 'active' },
    { id: '2', name: 'Satış Data Yedek', folder: 'Yedeklemeler', updated: 'Dün', rows: 12500, type: 'Google Sheet', status: 'idle' },
    { id: '3', name: 'Yeni Lead Tablosu', folder: 'Pazarlama', updated: 'Geçen hafta', rows: 0, type: 'Google Sheet', status: 'idle' }
  ];

  const MOCK_TABS = [
    { id: 't1', name: 'Form Yanıtları 1', cols: 12, rows: 418, updated: '2 dk önce' },
    { id: 't2', name: 'Sayfa2', cols: 3, rows: 0, updated: '1 ay önce' }
  ];

  const MOCK_COLUMNS = ['Timestamp', 'İsim Soyisim', 'Telefon Numarası', 'Bölüm Seçimi', 'Ek Notlar'];

  // Step 1: Rich Resource Discovery
  const Step1Discovery = (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4">
        {MOCK_SHEETS.map(sheet => (
          <div 
            key={sheet.id}
            onClick={() => setSelectedSheet(sheet.id)}
            className={`flex items-start p-5 rounded-[20px] border-2 cursor-pointer transition-all ${
              selectedSheet === sheet.id 
                ? 'border-[var(--q-blue)] bg-blue-50/40 shadow-md ring-4 ring-blue-50' 
                : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
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
                <span className="flex items-center gap-1.5 px-2 py-0.5 bg-gray-100 rounded-md text-[11px] text-gray-600 font-bold uppercase">{sheet.type}</span>
              </div>
            </div>
            <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center transition-colors ml-4 mt-4 ${
              selectedSheet === sheet.id ? 'border-[var(--q-blue)] bg-[var(--q-blue)]' : 'border-gray-300'
            }`}>
              {selectedSheet === sheet.id && <CheckCircle2 className="w-4 h-4 text-white" />}
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  // Step 2: Data Stream Selector
  const Step2TabSelect = (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4">
        {MOCK_TABS.map(tab => (
          <div 
            key={tab.id}
            onClick={() => setSelectedTab(tab.id)}
            className={`flex items-center p-5 rounded-[20px] border-2 cursor-pointer transition-all ${
              selectedTab === tab.id 
                ? 'border-[var(--q-blue)] bg-blue-50/40 shadow-md ring-4 ring-blue-50' 
                : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
            }`}
          >
            <div className="w-12 h-12 bg-gray-100 rounded-[14px] flex items-center justify-center mr-5 border border-gray-200">
              <Columns className="w-6 h-6 text-gray-500" />
            </div>
            <div className="flex-1">
              <h4 className="text-[16px] font-bold text-[var(--q-text-primary)] mb-1.5">{tab.name}</h4>
              <div className="flex flex-wrap items-center gap-x-4 text-[13px] text-[var(--q-text-secondary)] font-medium">
                <span className="flex items-center gap-1.5"><Columns className="w-4 h-4" /> {tab.cols} Kolon</span>
                <span className="flex items-center gap-1.5"><Users className="w-4 h-4" /> {tab.rows} Kayıt</span>
                <span className="flex items-center gap-1.5"><Activity className="w-4 h-4" /> Aktivite: {tab.updated}</span>
              </div>
            </div>
            <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center transition-colors ${
              selectedTab === tab.id ? 'border-[var(--q-blue)] bg-[var(--q-blue)]' : 'border-gray-300'
            }`}>
              {selectedTab === tab.id && <CheckCircle2 className="w-4 h-4 text-white" />}
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  // Step 3: AI-Assisted Mapping
  const Step3Mapping = (
    <div className="space-y-6">
      <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-100/50 rounded-[20px] p-5 flex gap-5 shadow-sm">
        <div className="w-12 h-12 bg-white rounded-[14px] shadow-sm flex items-center justify-center flex-shrink-0 border border-blue-100">
          <Sparkles className="w-6 h-6 text-blue-600" />
        </div>
        <div>
          <h4 className="text-[15px] font-bold text-blue-900 mb-1.5">AI Eşleştirmesi Tamamlandı</h4>
          <p className="text-[13px] text-blue-800 font-medium leading-relaxed">
            Yapay zeka {MOCK_COLUMNS.length} sütunu analiz ederek Quba CRM modeline oturtmaya çalıştı. %98 ortalama güven skoru elde edildi. Lütfen eşleşmeyen (sarı) alanları kontrol edin.
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
            if (col === 'Ek Notlar') { mappedTo = ''; confidence = 0; status = 'warning'; } // Unmapped intentional warning

            return (
              <div key={idx} className={`grid grid-cols-[1fr_40px_1fr] items-center gap-2 p-2 rounded-xl transition-colors group ${status === 'warning' ? 'bg-amber-50/50' : 'hover:bg-gray-50'}`}>
                <div className="flex items-center">
                  <div className={`px-4 py-3 rounded-lg border text-[13px] font-bold w-full shadow-sm flex items-center justify-between ${
                    status === 'warning' ? 'bg-amber-100/50 border-amber-200 text-amber-900' : 'bg-gray-50 border-gray-200 text-[var(--q-text-primary)]'
                  }`}>
                    {col}
                    {status === 'warning' && <AlertTriangle className="w-4 h-4 text-amber-500" />}
                  </div>
                </div>
                <div className={`flex justify-center transition-colors ${status === 'success' ? 'text-blue-400' : 'text-gray-300'}`}>
                  <ArrowRightLeft className="w-4 h-4" />
                </div>
                <div className="relative">
                  <select 
                    className={`w-full px-4 py-3 rounded-lg border text-[13px] font-bold outline-none cursor-pointer appearance-none shadow-sm transition-colors ${
                      status === 'success' ? 'bg-blue-50/30 border-blue-200 text-blue-900 focus:ring-2 focus:ring-blue-500' : 
                      status === 'warning' ? 'bg-white border-amber-300 text-gray-700 focus:ring-2 focus:ring-amber-500' :
                      'bg-white border-gray-200 text-gray-600 focus:ring-2 focus:ring-gray-900'
                    }`}
                    defaultValue={mappedTo || ""}
                    onChange={(e) => {
                      if(e.target.value) setIsMappingConfirmed(true);
                    }}
                  >
                    <option value="">-- Alan Seçin --</option>
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

  // Step 4: Data Health Check
  const [isHealthChecking, setIsHealthChecking] = useState(true);
  useEffect(() => {
    if (isOpen) { // Simulate only when reaching step? Since it's all rendered, we can just trigger it when selectedTab changes or just mock it.
      const timer = setTimeout(() => setIsHealthChecking(false), 2000);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  const Step4HealthCheck = (
    <div className="space-y-6">
      {isHealthChecking ? (
        <div className="py-24 flex flex-col items-center justify-center text-center">
          <div className="relative w-16 h-16 mb-6">
            <div className="absolute inset-0 border-4 border-gray-100 rounded-full"></div>
            <div className="absolute inset-0 border-4 border-[var(--q-text-primary)] rounded-full border-t-transparent animate-spin"></div>
            <ShieldCheck className="absolute inset-0 m-auto w-6 h-6 text-[var(--q-text-primary)]" />
          </div>
          <h4 className="text-[18px] font-bold text-[var(--q-text-primary)] mb-2">Veri Sağlığı Kontrol Ediliyor</h4>
          <p className="text-[14px] text-[var(--q-text-secondary)] font-medium max-w-[280px]">Mevcut 418 kayıt eşleştirme kurallarınıza göre CRM testlerinden geçiriliyor...</p>
        </div>
      ) : (
        <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="space-y-4">
          <div className="bg-white rounded-[20px] border border-gray-200 overflow-hidden shadow-sm">
            <div className="p-6 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
              <div>
                <h4 className="text-[16px] font-bold text-[var(--q-text-primary)]">Kontrol Raporu</h4>
                <p className="text-[13px] text-[var(--q-text-secondary)] font-medium mt-1">418 satır analiz edildi.</p>
              </div>
              <div className="w-12 h-12 bg-amber-50 rounded-full flex items-center justify-center">
                <AlertTriangle className="w-6 h-6 text-amber-500" />
              </div>
            </div>
            
            <div className="p-6 space-y-4">
              <div className="flex items-start gap-4">
                <div className="mt-0.5"><CheckCircle2 className="w-5 h-5 text-green-500" /></div>
                <div>
                  <p className="text-[14px] font-bold text-[var(--q-text-primary)]">Kayıt Aktarımı</p>
                  <p className="text-[13px] text-[var(--q-text-secondary)] font-medium">Tüm satırlar CRM limitlerine uygun ve aktarılabilir durumda.</p>
                </div>
              </div>
              
              <div className="flex items-start gap-4 p-3 bg-amber-50 rounded-xl border border-amber-100">
                <div className="mt-0.5"><AlertCircle className="w-5 h-5 text-amber-500" /></div>
                <div>
                  <p className="text-[14px] font-bold text-amber-900">Eksik Veri Tespiti</p>
                  <p className="text-[13px] text-amber-700 font-medium mt-0.5">12 satırda zorunlu <span className="font-bold">Telefon Numarası</span> alanı boş.</p>
                </div>
              </div>

              <div className="flex items-start gap-4 p-3 bg-red-50 rounded-xl border border-red-100">
                <div className="mt-0.5"><ServerCrash className="w-5 h-5 text-red-500" /></div>
                <div>
                  <p className="text-[14px] font-bold text-red-900">Format Hataları</p>
                  <p className="text-[13px] text-red-700 font-medium mt-0.5">3 kayıtta telefon numarası formatı geçersiz (çok kısa veya harf içeriyor).</p>
                </div>
              </div>

              <div className="flex items-start gap-4">
                <div className="mt-0.5"><CheckCircle2 className="w-5 h-5 text-green-500" /></div>
                <div>
                  <p className="text-[14px] font-bold text-[var(--q-text-primary)]">Tekrar Eden Kayıtlar (Duplicates)</p>
                  <p className="text-[13px] text-[var(--q-text-secondary)] font-medium">Telefon numarasına göre yapılan kontrolde mükerrer kayıt bulunmadı.</p>
                </div>
              </div>
            </div>
          </div>
          <div className="p-4 bg-gray-50 rounded-xl border border-gray-200 flex items-center gap-3">
            <ShieldCheck className="w-5 h-5 text-gray-500" />
            <p className="text-[13px] text-gray-600 font-medium">Hatalı formata sahip kayıtlar aktarım sırasında otomatik olarak <strong>"Hatalı Kayıtlar"</strong> havuzuna yönlendirilecektir.</p>
          </div>
        </motion.div>
      )}
    </div>
  );

  // Step 5: Live Preview (Raw -> CRM)
  const Step5LivePreview = (
    <div className="space-y-6">
      <div className="p-4 bg-gray-50 rounded-xl border border-gray-200 text-center">
        <p className="text-[13px] font-medium text-gray-600">Örnek satır (Row 2) okunarak CRM formatına dönüştürüldü.</p>
      </div>

      <div className="flex flex-col md:flex-row gap-4 items-stretch">
        
        {/* Raw Row View */}
        <div className="flex-1 bg-white border border-gray-200 rounded-[20px] overflow-hidden shadow-sm flex flex-col">
          <div className="bg-green-50/50 p-4 border-b border-gray-100 flex items-center gap-2">
            <FileSpreadsheet className="w-4 h-4 text-[#0F9D58]" />
            <h5 className="text-[13px] font-bold text-green-800 uppercase tracking-wider">Raw Google Sheet Row</h5>
          </div>
          <div className="p-5 space-y-4 flex-1 bg-gray-50/30">
            <div className="space-y-1">
              <span className="text-[11px] font-bold text-gray-400 uppercase">Timestamp</span>
              <div className="text-[13px] font-medium text-gray-800 bg-white px-3 py-2 border border-gray-200 rounded-md">20.05.2026 14:32:01</div>
            </div>
            <div className="space-y-1">
              <span className="text-[11px] font-bold text-gray-400 uppercase">İsim Soyisim</span>
              <div className="text-[13px] font-medium text-gray-800 bg-white px-3 py-2 border border-gray-200 rounded-md">Mustafa Yılmaz</div>
            </div>
            <div className="space-y-1">
              <span className="text-[11px] font-bold text-gray-400 uppercase">Telefon Numarası</span>
              <div className="text-[13px] font-medium text-gray-800 bg-white px-3 py-2 border border-gray-200 rounded-md">0532 123 4567</div>
            </div>
            <div className="space-y-1">
              <span className="text-[11px] font-bold text-gray-400 uppercase">Bölüm Seçimi</span>
              <div className="text-[13px] font-medium text-gray-800 bg-white px-3 py-2 border border-gray-200 rounded-md">Kardiyoloji</div>
            </div>
          </div>
        </div>

        {/* Transformation Arrow */}
        <div className="flex items-center justify-center text-gray-300 md:rotate-0 rotate-90">
          <ArrowRightLeft className="w-6 h-6" />
        </div>

        {/* CRM Card View */}
        <div className="flex-1 bg-white border border-[var(--q-border-strong)] rounded-[20px] overflow-hidden shadow-md flex flex-col relative">
          <div className="absolute top-0 left-0 w-full h-1 bg-[var(--q-text-primary)]"></div>
          <div className="bg-gray-50/80 p-4 border-b border-gray-100 flex items-center gap-2">
            <div className="w-5 h-5 bg-black rounded flex items-center justify-center">
              <span className="text-[10px] font-bold text-white">Q</span>
            </div>
            <h5 className="text-[13px] font-bold text-[var(--q-text-primary)] uppercase tracking-wider">CRM Contact Card</h5>
          </div>
          <div className="p-6 flex flex-col items-center flex-1">
            <div className="w-16 h-16 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-bold text-xl mb-3 shadow-inner">
              MY
            </div>
            <h3 className="text-[18px] font-bold text-[var(--q-text-primary)]">Mustafa Yılmaz</h3>
            <p className="text-[13px] text-[var(--q-text-secondary)] font-medium mb-6">+90 532 123 45 67</p>
            
            <div className="w-full space-y-3">
              <div className="flex items-center justify-between p-3 bg-gray-50 rounded-xl border border-gray-100">
                <span className="text-[12px] font-bold text-gray-500">Departman</span>
                <span className="text-[13px] font-bold text-[var(--q-text-primary)] bg-white px-2 py-1 rounded shadow-sm">Kardiyoloji</span>
              </div>
              <div className="flex items-center justify-between p-3 bg-gray-50 rounded-xl border border-gray-100">
                <span className="text-[12px] font-bold text-gray-500">Kayıt Tarihi</span>
                <span className="text-[13px] font-bold text-[var(--q-text-primary)]">Bugün</span>
              </div>
            </div>
          </div>
        </div>

      </div>
    </div>
  );

  // Step 6: Test Sync
  const [testStatus, setTestStatus] = useState<'idle' | 'running' | 'success'>('idle');
  
  const handleRunTest = () => {
    setTestStatus('running');
    setTimeout(() => setTestStatus('success'), 2000);
  };

  const Step6TestSync = (
    <div className="space-y-6">
      <div className="bg-white border border-gray-200 rounded-[24px] p-8 text-center shadow-sm">
        
        {testStatus === 'idle' && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
            <div className="w-20 h-20 bg-blue-50 rounded-full flex items-center justify-center mx-auto">
              <PlayCircle className="w-10 h-10 text-[var(--q-blue)]" />
            </div>
            <div>
              <h3 className="text-[20px] font-bold text-[var(--q-text-primary)] mb-2">Canlı Test Senkronizasyonu</h3>
              <p className="text-[14px] text-[var(--q-text-secondary)] font-medium max-w-[360px] mx-auto">
                Sistemi aktif etmeden önce 1 adet örnek kaydı CRM'e göndererek veri hattının düzgün çalıştığından emin olun.
              </p>
            </div>
            <button 
              onClick={handleRunTest}
              className="inline-flex items-center gap-2 px-8 py-3.5 bg-[var(--q-text-primary)] text-white text-[15px] font-bold rounded-[14px] hover:bg-black transition-all shadow-lg hover:-translate-y-0.5"
            >
              Testi Başlat
            </button>
          </motion.div>
        )}

        {testStatus === 'running' && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4 py-6">
            <Loader2 className="w-12 h-12 animate-spin text-[var(--q-blue)] mx-auto mb-4" />
            <h3 className="text-[18px] font-bold text-[var(--q-text-primary)]">Pipeline Çalıştırılıyor...</h3>
            <div className="flex items-center justify-center gap-2 text-[13px] font-medium text-gray-500">
              <span className="animate-pulse">Google Sheets API</span> 
              <ArrowRightLeft className="w-3 h-3" /> 
              <span className="animate-pulse delay-100">Quba Data Mapper</span>
              <ArrowRightLeft className="w-3 h-3" /> 
              <span className="animate-pulse delay-200">CRM Engine</span>
            </div>
          </motion.div>
        )}

        {testStatus === 'success' && (
          <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="space-y-6 py-4">
            <div className="w-20 h-20 bg-green-50 border-[3px] border-green-200 rounded-full flex items-center justify-center mx-auto">
              <CheckCircle2 className="w-10 h-10 text-green-500" />
            </div>
            <div>
              <h3 className="text-[20px] font-bold text-[var(--q-text-primary)] mb-2">Test Başarılı!</h3>
              <p className="text-[14px] text-[var(--q-text-secondary)] font-medium">
                Örnek kayıt sorunsuz bir şekilde CRM'e ulaştı. Veri hattınız yayına alınmaya hazır.
              </p>
            </div>
          </motion.div>
        )}

      </div>
    </div>
  );

  // Step 7: Finish / Sync Activation
  const Step7Finish = (
    <div className="space-y-8 py-8 text-center">
      <div className="relative w-32 h-32 mx-auto">
        <div className="absolute inset-0 bg-green-100 rounded-full animate-ping opacity-30"></div>
        <div className="absolute inset-4 bg-green-200 rounded-full animate-pulse opacity-50"></div>
        <div className="absolute inset-8 bg-green-500 rounded-full shadow-xl shadow-green-500/40 flex items-center justify-center">
          <Activity className="w-8 h-8 text-white" />
        </div>
      </div>
      
      <div>
        <h2 className="text-[28px] font-black text-[var(--q-text-primary)] tracking-tight mb-3">Sistem Canlıda!</h2>
        <p className="text-[15px] text-[var(--q-text-secondary)] font-medium max-w-[400px] mx-auto leading-relaxed">
          Harika! Veri hattı kuruldu ve dinlenmeye başlandı. 
        </p>
      </div>

      <div className="max-w-[400px] mx-auto bg-gray-50 rounded-[20px] p-6 text-left border border-gray-200 shadow-sm space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></div>
          <span className="text-[14px] font-bold text-[var(--q-text-primary)]">Otomatik Senkronizasyon Aktif</span>
        </div>
        <div className="flex items-center gap-3">
          <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse delay-100"></div>
          <span className="text-[14px] font-bold text-[var(--q-text-primary)]">Polling Süresi: 60 saniye</span>
        </div>
        <div className="flex items-center gap-3">
          <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse delay-200"></div>
          <span className="text-[14px] font-bold text-[var(--q-text-primary)]">Yeni kayıtlar anında içeri akacak</span>
        </div>
      </div>
    </div>
  );

  const steps: WizardStep[] = [
    {
      id: 'discovery',
      title: 'Kaynak Keşfi',
      subtitle: 'Bağlı hesabınızdaki form veya veri dosyaları',
      component: Step1Discovery,
      isValid: selectedSheet !== null
    },
    {
      id: 'stream',
      title: 'Veri Akışı (Stream)',
      subtitle: 'Dinlenecek hedef sayfayı seçin',
      component: Step2TabSelect,
      isValid: selectedTab !== null
    },
    {
      id: 'mapping',
      title: 'Zeki Eşleştirme',
      subtitle: 'Yapay zeka analizli alan haritalaması',
      component: Step3Mapping,
      isValid: true // Allow default smart mapping
    },
    {
      id: 'health_check',
      title: 'Health Check',
      subtitle: 'Veri sağlığı ve CRM uyumluluk analizi',
      component: Step4HealthCheck,
      isValid: !isHealthChecking
    },
    {
      id: 'preview',
      title: 'Görsel Önizleme',
      subtitle: 'Ham verinin CRM kartına dönüşümü',
      component: Step5LivePreview,
      isValid: true
    },
    {
      id: 'test_sync',
      title: 'Canlı Test',
      subtitle: 'Veri hattı simülasyonu',
      component: Step6TestSync,
      isValid: testStatus === 'success'
    },
    {
      id: 'finish',
      title: 'Aktivasyon',
      subtitle: 'Veri senkronizasyonu başlatılıyor',
      component: Step7Finish,
      isValid: true
    }
  ];

  return (
    <IntegrationWizard
      isOpen={isOpen}
      onClose={onClose}
      providerId="google_sheets"
      providerName="Google Sheets"
      providerIcon={<FileSpreadsheet className="w-8 h-8 text-[#0F9D58]" />}
      steps={steps}
      onComplete={handleFinish}
      localStorageKey={STORAGE_KEY}
    />
  );
}
