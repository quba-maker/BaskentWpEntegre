import React, { useState } from 'react';
import { X, Save, Database, Trash2, ArrowRightLeft, LayoutTemplate } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

export interface ProviderConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  providerId: string;
  providerName: string;
  onDisconnect: (providerId: string) => void;
  onSave: (providerId: string, config: any) => void;
}

export function ProviderConfigModal({ isOpen, onClose, providerId, providerName, onDisconnect, onSave }: ProviderConfigModalProps) {
  const [selectedResource, setSelectedResource] = useState('');
  
  if (!isOpen) return null;

  // Mock data based on provider
  const isGoogle = providerId === 'google_sheets';
  const resourceLabel = isGoogle ? 'Bağlanacak Tabloyu (Spreadsheet) Seçin' : 'Bağlanacak Sayfayı Seçin';
  const resources = isGoogle 
    ? [{ id: 'sheet_1', name: 'Başkent Formları 2026' }, { id: 'sheet_2', name: 'Satış Data Yedek' }]
    : [{ id: 'page_1', name: 'Başkent Üniversitesi WhatsApp' }, { id: 'page_2', name: 'Test Instagram' }];

  const handleSave = () => {
    onSave(providerId, { resourceId: selectedResource });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-[24px] w-full max-w-[540px] shadow-2xl overflow-hidden border border-[var(--q-border-default)] flex flex-col max-h-[90vh]">
        
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-[var(--q-border-default)]">
          <div>
            <h2 className="text-[18px] font-bold text-[var(--q-text-primary)]">{providerName} Yapılandırması</h2>
            <p className="text-[13px] text-[var(--q-text-secondary)] font-medium mt-1">Veri kaynağınızı seçin ve alanları eşleştirin.</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-full transition-colors text-[var(--q-text-secondary)] self-start">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content (Scrollable) */}
        <div className="p-6 overflow-y-auto flex-1 space-y-8">
          
          {/* Resource Picker */}
          <section>
            <div className="flex items-center gap-2 mb-3">
              <Database className="w-[18px] h-[18px] text-[var(--q-blue)]" />
              <h3 className="text-[14px] font-bold uppercase tracking-wider text-[var(--q-text-primary)]">1. Veri Kaynağı</h3>
            </div>
            <div className="bg-gray-50 rounded-xl p-4 border border-gray-100">
              <label className="block text-[13px] font-semibold text-[var(--q-text-secondary)] mb-2">{resourceLabel}</label>
              <select 
                value={selectedResource}
                onChange={(e) => setSelectedResource(e.target.value)}
                className="w-full px-4 py-3 rounded-lg border border-[var(--q-border-strong)] bg-white text-[14px] font-medium outline-none focus:ring-2 focus:ring-[var(--q-text-primary)] transition-shadow cursor-pointer"
              >
                <option value="" disabled>Seçim yapınız...</option>
                {resources.map(r => (
                  <option key={r.id} value={r.id}>{r.name}</option>
                ))}
              </select>
            </div>
          </section>

          {/* Mapping UI (Only if resource is selected and it's Google Sheets) */}
          <AnimatePresence>
            {selectedResource && isGoogle && (
              <motion.section initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                <div className="flex items-center gap-2 mb-3 mt-4">
                  <ArrowRightLeft className="w-[18px] h-[18px] text-[var(--q-purple)]" />
                  <h3 className="text-[14px] font-bold uppercase tracking-wider text-[var(--q-text-primary)]">2. Alan Eşleştirme (Mapping)</h3>
                </div>
                <div className="border border-[var(--q-border-default)] rounded-xl overflow-hidden">
                  <div className="grid grid-cols-5 bg-gray-50 p-3 border-b border-[var(--q-border-default)] text-[12px] font-bold text-[var(--q-text-secondary)]">
                    <div className="col-span-2">Dış Veri (Sheets)</div>
                    <div className="col-span-1 text-center"></div>
                    <div className="col-span-2">Quba CRM</div>
                  </div>
                  <div className="p-2 space-y-2 bg-white">
                    {['İsim Soyisim', 'Telefon No', 'İlgilendiği Bölüm'].map((field, idx) => (
                      <div key={idx} className="grid grid-cols-5 items-center gap-2 p-2 hover:bg-gray-50 rounded-lg transition-colors">
                        <div className="col-span-2">
                          <div className="px-3 py-2 bg-gray-100 rounded-md border border-gray-200 text-[13px] font-medium text-[var(--q-text-primary)]">
                            {field}
                          </div>
                        </div>
                        <div className="col-span-1 flex justify-center text-[var(--q-text-secondary)]">
                          <ArrowRightLeft className="w-4 h-4 opacity-50" />
                        </div>
                        <div className="col-span-2">
                          <select className="w-full px-3 py-2 rounded-md border border-[var(--q-border-strong)] bg-white text-[13px] font-medium outline-none cursor-pointer">
                            <option>Tam Adı</option>
                            <option>Telefon</option>
                            <option>Departman</option>
                            <option>Notlar</option>
                          </select>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </motion.section>
            )}
          </AnimatePresence>
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-[var(--q-border-default)] flex items-center justify-between bg-gray-50">
          <button 
            onClick={() => { onDisconnect(providerId); onClose(); }}
            className="flex items-center gap-2 px-4 py-2.5 text-[13px] font-bold text-red-600 hover:bg-red-50 rounded-xl transition-colors"
          >
            <Trash2 className="w-4 h-4" />
            Bağlantıyı Kopar
          </button>
          
          <button 
            disabled={!selectedResource}
            onClick={handleSave}
            className="flex items-center gap-2 px-6 py-2.5 text-[14px] font-bold bg-[var(--q-text-primary)] text-white rounded-xl hover:bg-black transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-md hover:-translate-y-0.5"
          >
            <Save className="w-4 h-4" />
            Kaydet
          </button>
        </div>

      </div>
    </div>
  );
}
