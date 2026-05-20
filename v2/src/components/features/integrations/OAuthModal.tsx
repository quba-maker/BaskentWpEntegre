import React, { useState, useEffect } from 'react';
import { Loader2, CheckCircle2, Shield, X, ArrowRight } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

export interface OAuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  providerId: string;
  providerName: string;
  providerIcon: React.ReactNode;
  onSuccess: (providerId: string) => void;
}

export function OAuthModal({ isOpen, onClose, providerId, providerName, providerIcon, onSuccess }: OAuthModalProps) {
  const [step, setStep] = useState<'intro' | 'connecting' | 'authorizing' | 'success'>('intro');

  useEffect(() => {
    if (isOpen) setStep('intro');
  }, [isOpen]);

  const startAuth = () => {
    setStep('connecting');
    // Simulate OAuth redirect delay
    setTimeout(() => {
      setStep('authorizing');
      // Simulate waiting for user to click "Allow" in the popup
      setTimeout(() => {
        setStep('success');
        // Auto-close and fire success after a short delay
        setTimeout(() => {
          onSuccess(providerId);
          onClose();
        }, 1500);
      }, 2500);
    }, 1200);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-[24px] w-full max-w-[420px] shadow-2xl overflow-hidden border border-[var(--q-border-default)]">
        
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-[var(--q-border-default)]">
          <div className="flex items-center gap-3">
            <Shield className="w-[18px] h-[18px] text-[var(--q-text-secondary)]" />
            <h3 className="text-[14px] font-bold text-[var(--q-text-primary)]">Güvenli Bağlantı</h3>
          </div>
          {step !== 'connecting' && step !== 'authorizing' && (
            <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-full transition-colors text-[var(--q-text-secondary)]">
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
                  <div className="w-16 h-16 rounded-[18px] bg-black flex items-center justify-center shadow-lg border border-gray-800">
                    <span className="text-white font-black text-xl tracking-tighter">QUBA</span>
                  </div>
                  <ArrowRight className="w-5 h-5 text-gray-300" />
                  <div className="w-16 h-16 rounded-[18px] bg-gray-50 flex items-center justify-center shadow-inner border border-gray-200">
                    {providerIcon}
                  </div>
                </div>
                <h2 className="text-[20px] font-bold mb-3 text-[var(--q-text-primary)] tracking-tight">{providerName} Bağlantısı</h2>
                <p className="text-[14px] text-[var(--q-text-secondary)] mb-8 font-medium leading-relaxed">
                  SaaS sisteminin {providerName} verilerinize güvenli erişim sağlaması için izin verin.
                </p>
                <button 
                  onClick={startAuth}
                  className="w-full py-3.5 bg-[var(--q-text-primary)] text-white text-[15px] font-bold rounded-xl shadow-lg hover:bg-black transition-all hover:-translate-y-0.5"
                >
                  Devam Et
                </button>
              </motion.div>
            )}

            {step === 'connecting' && (
              <motion.div key="connecting" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="py-8 text-center">
                <Loader2 className="w-10 h-10 animate-spin text-[var(--q-text-secondary)] mx-auto mb-6" />
                <h3 className="text-[18px] font-bold text-[var(--q-text-primary)] mb-2">Bağlantı Kuruluyor</h3>
                <p className="text-[14px] text-[var(--q-text-secondary)] font-medium">Güvenli oturum açma sayfası hazırlanıyor...</p>
              </motion.div>
            )}

            {step === 'authorizing' && (
              <motion.div key="authorizing" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="py-8 text-center">
                <div className="relative w-20 h-20 mx-auto mb-6">
                  <div className="absolute inset-0 border-[3px] border-blue-100 rounded-[22px] animate-ping opacity-75"></div>
                  <div className="relative w-full h-full bg-blue-50 border-[3px] border-blue-200 rounded-[22px] flex items-center justify-center">
                    {providerIcon}
                  </div>
                </div>
                <h3 className="text-[18px] font-bold text-[var(--q-text-primary)] mb-2">Yetki Bekleniyor</h3>
                <p className="text-[14px] text-[var(--q-text-secondary)] font-medium px-4">Lütfen açılan {providerName} penceresinde onay verin.</p>
              </motion.div>
            )}

            {step === 'success' && (
              <motion.div key="success" initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} className="py-8 text-center">
                <div className="w-20 h-20 bg-green-50 border-[3px] border-green-200 rounded-[22px] flex items-center justify-center mx-auto mb-6">
                  <CheckCircle2 className="w-10 h-10 text-green-500" />
                </div>
                <h3 className="text-[20px] font-bold text-[var(--q-text-primary)] mb-2 tracking-tight">Bağlantı Başarılı</h3>
                <p className="text-[14px] text-[var(--q-text-secondary)] font-medium">Entegrasyon aktif. Yapılandırmaya yönlendiriliyorsunuz.</p>
              </motion.div>
            )}

          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
