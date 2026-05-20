import React, { useState, useEffect } from 'react';
import { X, ArrowRight, ArrowLeft, Check, Sparkles } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

export interface WizardStep {
  id: string;
  title: string;
  subtitle?: string;
  component: React.ReactNode;
  isValid: boolean;
}

export interface IntegrationWizardProps {
  isOpen: boolean;
  onClose: () => void;
  providerId: string;
  providerName: string;
  providerIcon: React.ReactNode;
  steps: WizardStep[];
  onComplete: () => void;
  localStorageKey?: string;
}

export function IntegrationWizard({
  isOpen,
  onClose,
  providerId,
  providerName,
  providerIcon,
  steps,
  onComplete,
  localStorageKey
}: IntegrationWizardProps) {
  const [currentStepIndex, setCurrentStepIndex] = useState(() => {
    if (typeof window !== 'undefined' && localStorageKey) {
      const saved = localStorage.getItem(`${localStorageKey}_step`);
      if (saved) {
        const parsed = parseInt(saved, 10);
        return isNaN(parsed) ? 0 : parsed;
      }
    }
    return 0;
  });

  useEffect(() => {
    if (localStorageKey) {
      localStorage.setItem(`${localStorageKey}_step`, currentStepIndex.toString());
    }
  }, [currentStepIndex, localStorageKey]);

  // Reset if modal is closed and re-opened without a draft (in this case, we always want draft, so we only reset if told to)
  // Actually, we keep draft state.

  if (!isOpen) return null;

  const currentStep = steps[currentStepIndex];
  const isFirstStep = currentStepIndex === 0;
  const isLastStep = currentStepIndex === steps.length - 1;

  const handleNext = () => {
    if (isLastStep) {
      onComplete();
      onClose();
    } else {
      setCurrentStepIndex(i => Math.min(i + 1, steps.length - 1));
    }
  };

  const handlePrev = () => {
    setCurrentStepIndex(i => Math.max(i - 1, 0));
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-md p-4">
      <div className="bg-white rounded-[28px] w-full max-w-[800px] shadow-2xl overflow-hidden border border-gray-200 flex flex-col h-[85vh] max-h-[800px]">
        
        {/* Header with Provider Branding & Close */}
        <div className="flex items-center justify-between p-6 border-b border-gray-100 bg-white">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-gray-50 flex items-center justify-center border border-gray-100 shadow-sm">
              {providerIcon}
            </div>
            <div>
              <h2 className="text-[20px] font-bold text-[var(--q-text-primary)] tracking-tight">{providerName} Bağlantısı</h2>
              <p className="text-[14px] text-[var(--q-text-secondary)] font-medium mt-0.5">SaaS Veri Akışı Yapılandırması</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2.5 hover:bg-gray-100 rounded-full transition-colors text-gray-500 hover:text-gray-900">
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Layout: Sidebar + Content */}
        <div className="flex flex-1 overflow-hidden">
          
          {/* Sidebar: Progress Indicator (Stepper) */}
          <div className="w-[240px] bg-gray-50/50 border-r border-gray-100 p-8 hidden md:block">
            <div className="space-y-8">
              {steps.map((step, index) => {
                const isActive = index === currentStepIndex;
                const isCompleted = index < currentStepIndex;
                
                return (
                  <div key={step.id} className="relative">
                    {/* Connecting Line */}
                    {index !== steps.length - 1 && (
                      <div className={`absolute left-[15px] top-[34px] bottom-[-24px] w-[2px] transition-colors duration-500 ${isCompleted ? 'bg-[var(--q-text-primary)]' : 'bg-gray-200'}`} />
                    )}
                    
                    <div className="flex items-start gap-4">
                      <div className={`relative z-10 w-8 h-8 rounded-full flex items-center justify-center text-[13px] font-bold transition-all duration-300 shadow-sm ${
                        isActive ? 'bg-[var(--q-text-primary)] text-white ring-4 ring-gray-200' 
                        : isCompleted ? 'bg-[var(--q-text-primary)] text-white'
                        : 'bg-white border-2 border-gray-200 text-gray-400'
                      }`}>
                        {isCompleted ? <Check className="w-4 h-4" /> : index + 1}
                      </div>
                      <div className="pt-1.5">
                        <h4 className={`text-[14px] font-bold transition-colors ${isActive ? 'text-[var(--q-text-primary)]' : isCompleted ? 'text-gray-600' : 'text-gray-400'}`}>
                          {step.title}
                        </h4>
                        {step.subtitle && isActive && (
                          <p className="text-[12px] font-medium text-gray-500 mt-1 leading-relaxed">
                            {step.subtitle}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Main Content Area */}
          <div className="flex-1 flex flex-col bg-white overflow-hidden">
            <div className="flex-1 overflow-y-auto p-8 custom-scrollbar">
              <AnimatePresence mode="wait">
                <motion.div
                  key={currentStep.id}
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                  className="h-full"
                >
                  <div className="mb-8">
                    <h3 className="text-[24px] font-bold text-[var(--q-text-primary)] mb-2 tracking-tight">{currentStep.title}</h3>
                    {currentStep.subtitle && <p className="text-[15px] text-[var(--q-text-secondary)] font-medium leading-relaxed">{currentStep.subtitle}</p>}
                  </div>
                  
                  {/* Render the specific step component */}
                  {currentStep.component}
                  
                </motion.div>
              </AnimatePresence>
            </div>

            {/* Footer / Navigation */}
            <div className="p-6 border-t border-gray-100 bg-white flex items-center justify-between">
              <div>
                {!isFirstStep && (
                  <button 
                    onClick={handlePrev}
                    className="flex items-center gap-2 px-5 py-2.5 text-[14px] font-bold text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-xl transition-all"
                  >
                    <ArrowLeft className="w-4 h-4" />
                    Geri
                  </button>
                )}
              </div>
              
              <button 
                disabled={!currentStep.isValid}
                onClick={handleNext}
                className={`flex items-center gap-2 px-8 py-3 text-[15px] font-bold text-white rounded-[14px] transition-all shadow-md hover:-translate-y-0.5 ${
                  currentStep.isValid 
                    ? 'bg-[var(--q-text-primary)] hover:shadow-xl hover:bg-black' 
                    : 'bg-gray-300 cursor-not-allowed shadow-none hover:translate-y-0'
                }`}
              >
                {isLastStep ? 'Kaydet ve Başlat' : 'Devam Et'}
                {isLastStep ? <Sparkles className="w-5 h-5 ml-1" /> : <ArrowRight className="w-5 h-5 ml-1" />}
              </button>
            </div>
          </div>
          
        </div>
      </div>
    </div>
  );
}
