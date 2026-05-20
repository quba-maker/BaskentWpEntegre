import React, { useState, useEffect } from 'react';
import { IntegrationWizard, WizardStep } from './IntegrationWizard';
import { FileSpreadsheet, Folder, File, ArrowRightLeft, Table2, CheckCircle2, Loader2, Sparkles } from 'lucide-react';
import { motion } from 'framer-motion';

export function GoogleSheetsWizard({ isOpen, onClose, onComplete }: { isOpen: boolean, onClose: () => void, onComplete: () => void }) {
  // State for steps
  const [selectedSheet, setSelectedSheet] = useState<string | null>(null);
  const [selectedTab, setSelectedTab] = useState<string | null>(null);
  const [isMappingConfirmed, setIsMappingConfirmed] = useState(false);
  const [isSimulatingLivePreview, setIsSimulatingLivePreview] = useState(true);

  // Mock Data
  const MOCK_SHEETS = [
    { id: '1', name: 'Başkent Formları 2026', folder: 'Başkent Üniversitesi', updated: '2 saat önce' },
    { id: '2', name: 'Satış Data Yedek', folder: 'Yedeklemeler', updated: 'Dün' },
    { id: '3', name: 'Yeni Lead Tablosu', folder: 'Pazarlama', updated: 'Geçen hafta' }
  ];

  const MOCK_TABS = [
    { id: 't1', name: 'Form Yanıtları 1', rows: 1250 },
    { id: 't2', name: 'Sayfa2', rows: 0 },
    { id: 't3', name: 'Lead Data', rows: 45 }
  ];

  const MOCK_COLUMNS = ['Timestamp', 'Full Name', 'Phone Number', 'Department', 'Notes'];

  // Reset state when opened
  useEffect(() => {
    if (isOpen) {
      setSelectedSheet(null);
      setSelectedTab(null);
      setIsMappingConfirmed(false);
      setIsSimulatingLivePreview(true);
    }
  }, [isOpen]);

  // Step 1: Discovery (Spreadsheet Select)
  const Step1Discovery = (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3">
        {MOCK_SHEETS.map(sheet => (
          <div 
            key={sheet.id}
            onClick={() => setSelectedSheet(sheet.id)}
            className={`flex items-center p-4 rounded-2xl border-2 cursor-pointer transition-all ${
              selectedSheet === sheet.id 
                ? 'border-[var(--q-blue)] bg-blue-50/50 shadow-md' 
                : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
            }`}
          >
            <div className="w-12 h-12 bg-green-100 rounded-xl flex items-center justify-center mr-4">
              <FileSpreadsheet className="w-6 h-6 text-[#0F9D58]" />
            </div>
            <div className="flex-1">
              <h4 className="text-[15px] font-bold text-[var(--q-text-primary)]">{sheet.name}</h4>
              <div className="flex items-center gap-3 text-[13px] text-[var(--q-text-secondary)] font-medium mt-1">
                <span className="flex items-center gap-1"><Folder className="w-3.5 h-3.5" /> {sheet.folder}</span>
                <span>•</span>
                <span>Düzenlenme: {sheet.updated}</span>
              </div>
            </div>
            <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center transition-colors ${
              selectedSheet === sheet.id ? 'border-[var(--q-blue)] bg-[var(--q-blue)]' : 'border-gray-300'
            }`}>
              {selectedSheet === sheet.id && <CheckCircle2 className="w-4 h-4 text-white" />}
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  // Step 2: Tab Select
  const Step2TabSelect = (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3">
        {MOCK_TABS.map(tab => (
          <div 
            key={tab.id}
            onClick={() => setSelectedTab(tab.id)}
            className={`flex items-center p-4 rounded-2xl border-2 cursor-pointer transition-all ${
              selectedTab === tab.id 
                ? 'border-[var(--q-blue)] bg-blue-50/50 shadow-md' 
                : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
            }`}
          >
            <div className="w-10 h-10 bg-gray-100 rounded-xl flex items-center justify-center mr-4">
              <File className="w-5 h-5 text-gray-600" />
            </div>
            <div className="flex-1">
              <h4 className="text-[15px] font-bold text-[var(--q-text-primary)]">{tab.name}</h4>
              <p className="text-[13px] text-[var(--q-text-secondary)] font-medium mt-0.5">{tab.rows} Satır Veri</p>
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

  // Step 3: Auto-Mapping
  const Step3Mapping = (
    <div className="space-y-6">
      <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4 flex gap-4">
        <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center flex-shrink-0">
          <Sparkles className="w-5 h-5 text-blue-600" />
        </div>
        <div>
          <h4 className="text-[14px] font-bold text-blue-900 mb-1">Akıllı Eşleştirme Tamamlandı</h4>
          <p className="text-[13px] text-blue-800 font-medium leading-relaxed">
            Sistemimiz {MOCK_COLUMNS.length} sütun başlığını analiz etti ve en uygun CRM alanlarıyla eşleştirdi. Lütfen eşleşmeleri kontrol edin.
          </p>
        </div>
      </div>

      <div className="border border-gray-200 rounded-2xl overflow-hidden bg-white shadow-sm">
        <div className="grid grid-cols-[1fr_40px_1fr] bg-gray-50 p-4 border-b border-gray-200 text-[12px] font-bold text-gray-500 uppercase tracking-wider">
          <div>Dış Veri (Sheets Sütunu)</div>
          <div></div>
          <div>Quba CRM Alanı</div>
        </div>
        <div className="p-2 space-y-1">
          {MOCK_COLUMNS.map((col, idx) => {
            let mappedTo = '';
            let isAutoMapped = false;
            if (col === 'Full Name') { mappedTo = 'Tam Adı'; isAutoMapped = true; }
            if (col === 'Phone Number') { mappedTo = 'Telefon'; isAutoMapped = true; }
            if (col === 'Department') { mappedTo = 'Departman (Özel Alan)'; isAutoMapped = true; }
            if (col === 'Notes') { mappedTo = 'Notlar'; isAutoMapped = true; }

            return (
              <div key={idx} className="grid grid-cols-[1fr_40px_1fr] items-center gap-2 p-2 hover:bg-gray-50 rounded-xl transition-colors group">
                <div className="flex items-center">
                  <div className="px-4 py-2.5 bg-gray-100 rounded-lg border border-gray-200 text-[13px] font-bold text-[var(--q-text-primary)] w-full shadow-sm">
                    {col}
                  </div>
                </div>
                <div className="flex justify-center text-gray-300 group-hover:text-[var(--q-blue)] transition-colors">
                  <ArrowRightLeft className="w-4 h-4" />
                </div>
                <div className="relative">
                  <select 
                    className={`w-full px-4 py-2.5 rounded-lg border text-[13px] font-bold outline-none cursor-pointer appearance-none ${
                      isAutoMapped 
                        ? 'bg-blue-50/30 border-blue-200 text-blue-900' 
                        : 'bg-white border-gray-200 text-gray-600'
                    }`}
                    defaultValue={mappedTo || ""}
                    onChange={() => setIsMappingConfirmed(true)} // Mock validation trigger
                  >
                    <option value="">-- Alan Seçin --</option>
                    <option value="Tam Adı">Tam Adı</option>
                    <option value="Telefon">Telefon</option>
                    <option value="Departman (Özel Alan)">Departman (Özel Alan)</option>
                    <option value="Notlar">Notlar</option>
                  </select>
                  {isAutoMapped && (
                    <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
                      <Sparkles className="w-3.5 h-3.5 text-blue-400" />
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

function LivePreviewStep({ selectedSheet, selectedTab }: { selectedSheet: string | null, selectedTab: string | null }) {
  const [isSimulating, setIsSimulating] = useState(true);

  useEffect(() => {
    setIsSimulating(true);
    const timer = setTimeout(() => setIsSimulating(false), 1500);
    return () => clearTimeout(timer);
  }, [selectedSheet, selectedTab]);

  return (
    <div className="space-y-6">
      {isSimulating ? (
        <div className="py-20 flex flex-col items-center justify-center text-center">
          <Loader2 className="w-10 h-10 animate-spin text-[var(--q-blue)] mb-4" />
          <h4 className="text-[16px] font-bold text-[var(--q-text-primary)] mb-1">Canlı Veriler Çekiliyor...</h4>
          <p className="text-[14px] text-[var(--q-text-secondary)]">Seçtiğiniz sayfadan son 3 satır eşleştiriliyor.</p>
        </div>
      ) : (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
          <p className="text-[14px] font-medium text-[var(--q-text-secondary)]">Eşleştirme ayarlarınızla sisteme akacak örnek veriler:</p>
          
          <div className="border border-gray-200 rounded-2xl overflow-hidden bg-white shadow-sm">
            <div className="overflow-x-auto custom-scrollbar">
              <table className="w-full text-left text-[13px]">
                <thead className="bg-gray-50 text-gray-500 font-bold uppercase tracking-wider text-[11px] border-b border-gray-200">
                  <tr>
                    <th className="px-6 py-4">Kişi</th>
                    <th className="px-6 py-4">İletişim</th>
                    <th className="px-6 py-4">Departman (Özel)</th>
                    <th className="px-6 py-4">Not</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 font-medium text-[var(--q-text-primary)]">
                  <tr className="hover:bg-gray-50/50 transition-colors">
                    <td className="px-6 py-4 flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 font-bold text-xs">AH</div>
                      Ahmet Yılmaz
                    </td>
                    <td className="px-6 py-4">0532 123 45 67</td>
                    <td className="px-6 py-4"><span className="px-2.5 py-1 bg-gray-100 rounded-md">Kardiyoloji</span></td>
                    <td className="px-6 py-4 text-gray-500 line-clamp-1">Randevu almak istiyor...</td>
                  </tr>
                  <tr className="hover:bg-gray-50/50 transition-colors">
                    <td className="px-6 py-4 flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-purple-100 flex items-center justify-center text-purple-700 font-bold text-xs">AÇ</div>
                      Ayşe Çelik
                    </td>
                    <td className="px-6 py-4">0555 987 65 43</td>
                    <td className="px-6 py-4"><span className="px-2.5 py-1 bg-gray-100 rounded-md">Dahiliye</span></td>
                    <td className="px-6 py-4 text-gray-500 line-clamp-1">Kan sonuçları hakkında...</td>
                  </tr>
                  <tr className="hover:bg-gray-50/50 transition-colors">
                    <td className="px-6 py-4 flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-700 font-bold text-xs">MÖ</div>
                      Mehmet Öz
                    </td>
                    <td className="px-6 py-4">0505 111 22 33</td>
                    <td className="px-6 py-4"><span className="px-2.5 py-1 bg-gray-100 rounded-md">Ortopedi</span></td>
                    <td className="px-6 py-4 text-gray-500 line-clamp-1">Bel ağrısı şikayeti...</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </motion.div>
      )}
    </div>
  );
}

  const steps: WizardStep[] = [
    {
      id: 'discovery',
      title: 'Form Kaynağı Seçin',
      subtitle: 'Bağlı Google Drive hesabınızdaki tablolar',
      component: Step1Discovery,
      isValid: selectedSheet !== null
    },
    {
      id: 'tab',
      title: 'Çalışma Sayfası',
      subtitle: 'Verilerin bulunduğu alt sayfayı (sekme) seçin',
      component: Step2TabSelect,
      isValid: selectedTab !== null
    },
    {
      id: 'mapping',
      title: 'Veri Eşleştirme',
      subtitle: 'Tablonuzdaki sütunları CRM alanlarıyla eşleştirin',
      component: Step3Mapping,
      isValid: true // Allow default smart mapping
    },
    {
      id: 'preview',
      title: 'Canlı Önizleme',
      subtitle: 'Verilerinizin sisteme nasıl akacağını kontrol edin',
      component: <LivePreviewStep selectedSheet={selectedSheet} selectedTab={selectedTab} />,
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
      onComplete={onComplete}
    />
  );
}
