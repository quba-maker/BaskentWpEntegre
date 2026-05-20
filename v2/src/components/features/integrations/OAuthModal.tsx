import React, { useState, useEffect } from 'react';
import { Loader2, CheckCircle2, Shield, X, ArrowRight } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { setupIntegrationChannel } from '@/app/actions/integrations';

export interface OAuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  providerId: string;
  providerName: string;
  providerIcon: React.ReactNode;
  onSuccess: (providerId: string) => void;
}

export function OAuthModal({ isOpen, onClose, providerId, providerName, providerIcon, onSuccess }: OAuthModalProps) {
  const [step, setStep] = useState<'intro' | 'connecting' | 'success'>('intro');
  const [identifier, setIdentifier] = useState('');
  const [token, setToken] = useState('');

  useEffect(() => {
    if (isOpen) {
      setStep('intro');
      setIdentifier('');
      setToken('');
    }
  }, [isOpen]);

  const startAuth = async () => {
    if (!identifier || !token) {
      alert('Lütfen tüm alanları doldurun');
      return;
    }
    
    setStep('connecting');
    const dbProvider = providerId === 'meta_whatsapp' ? 'whatsapp' : providerId === 'meta_instagram' ? 'instagram' : 'messenger';
    const channelName = providerId === 'meta_whatsapp' ? 'WhatsApp Business API' : 'Meta Instagram/Messenger';

    try {
      const res = await setupIntegrationChannel(dbProvider, identifier, channelName, token);
      if (res.success) {
        setStep('success');
        setTimeout(() => {
          onSuccess(providerId);
          onClose();
        }, 1500);
      } else {
        alert('Bağlantı hatası: ' + res.error);
        setStep('intro');
      }
    } catch (e: any) {
      alert('Bağlantı hatası: ' + e.message);
      setStep('intro');
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white dark:bg-[#111] rounded-[24px] w-full max-w-[420px] shadow-2xl overflow-hidden border border-black/5 dark:border-white/10">
        
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-black/5 dark:border-white/10">
          <div className="flex items-center gap-3">
            <Shield className="w-[18px] h-[18px] text-gray-500" />
            <h3 className="text-[14px] font-bold text-black dark:text-white">Güvenli Bağlantı</h3>
          </div>
          {step !== 'connecting' && (
            <button onClick={onClose} className="p-2 hover:bg-gray-100 dark:hover:bg-white/5 rounded-full transition-colors text-gray-500">
              <X className="w-[18px] h-[18px]" />
            </button>
          )}
        </div>

        {/* Content */}
        <div className="p-8">
          <AnimatePresence mode="wait">
            
            {step === 'intro' && (
              <motion.div key="intro" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="text-center">
                <div className="flex justify-center items-center gap-5 mb-8">
                  <div className="w-16 h-16 rounded-[18px] bg-black dark:bg-white flex items-center justify-center shadow-lg border border-gray-800 dark:border-gray-200">
                    <span className="text-white dark:text-black font-black text-xl tracking-tighter">QUBA</span>
                  </div>
                  <ArrowRight className="w-5 h-5 text-gray-300 dark:text-gray-600" />
                  <div className="w-16 h-16 rounded-[18px] bg-gray-50 dark:bg-white/5 flex items-center justify-center shadow-inner border border-gray-200 dark:border-white/10">
                    {providerIcon}
                  </div>
                </div>
                <h2 className="text-[20px] font-bold mb-3 text-black dark:text-white tracking-tight">{providerName} Bağlantısı</h2>
                <p className="text-[14px] text-gray-500 mb-6 font-medium leading-relaxed">
                  SaaS sisteminin {providerName} verilerinize erişim sağlaması için kimlik bilgilerinizi girin. Bu bilgiler şifrelenerek saklanacaktır.
                </p>

                <div className="space-y-4 mb-8 text-left">
                  <div>
                    <label className="block text-[12px] font-bold text-gray-700 dark:text-gray-300 mb-1">
                      {providerId === 'meta_whatsapp' ? 'Phone ID' : 'Page/Instagram ID'}
                    </label>
                    <input 
                      type="text" 
                      value={identifier}
                      onChange={(e) => setIdentifier(e.target.value)}
                      placeholder="Örn: 10512345678"
                      className="w-full px-4 py-3 bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl text-[14px] outline-none focus:ring-2 focus:ring-blue-500 transition-shadow dark:text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-[12px] font-bold text-gray-700 dark:text-gray-300 mb-1">
                      Kalıcı Erişim Jetonu (Access Token)
                    </label>
                    <input 
                      type="password" 
                      value={token}
                      onChange={(e) => setToken(e.target.value)}
                      placeholder="EAAGX..."
                      className="w-full px-4 py-3 bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl text-[14px] outline-none focus:ring-2 focus:ring-blue-500 transition-shadow dark:text-white"
                    />
                  </div>
                </div>

                <button 
                  onClick={startAuth}
                  className="w-full py-3.5 bg-black dark:bg-white text-white dark:text-black text-[15px] font-bold rounded-xl shadow-lg hover:bg-gray-800 dark:hover:bg-gray-200 transition-all hover:-translate-y-0.5"
                >
                  Bağlantıyı Kur
                </button>
              </motion.div>
            )}

            {step === 'connecting' && (
              <motion.div key="connecting" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="py-8 text-center">
                <Loader2 className="w-10 h-10 animate-spin text-gray-500 mx-auto mb-6" />
                <h3 className="text-[18px] font-bold text-black dark:text-white mb-2">Bağlantı Kuruluyor</h3>
                <p className="text-[14px] text-gray-500 font-medium">Şifreleme yapılıyor ve kanal oluşturuluyor...</p>
              </motion.div>
            )}

            {step === 'success' && (
              <motion.div key="success" initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} className="py-8 text-center">
                <div className="w-20 h-20 bg-green-50 dark:bg-green-500/10 border-[3px] border-green-200 dark:border-green-500/20 rounded-[22px] flex items-center justify-center mx-auto mb-6">
                  <CheckCircle2 className="w-10 h-10 text-green-500" />
                </div>
                <h3 className="text-[20px] font-bold text-black dark:text-white mb-2 tracking-tight">Bağlantı Başarılı</h3>
                <p className="text-[14px] text-gray-500 font-medium">Entegrasyon aktif ve kanal açıldı.</p>
              </motion.div>
            )}

          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
