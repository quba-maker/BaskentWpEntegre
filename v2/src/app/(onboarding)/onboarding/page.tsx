"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { CheckCircle2, ChevronRight, MessageSquare, Bot, CreditCard, Stethoscope, Briefcase, GraduationCap, Building2 } from "lucide-react";

const STEPS = [
  { id: 'business', title: 'İşletme Profili', desc: 'Sektör ve marka tanımı' },
  { id: 'channels', title: 'Kanal Bağlantıları', desc: 'WhatsApp & Instagram' },
  { id: 'ai', title: 'AI Karakteri', desc: 'Ton ve kurallar' },
  { id: 'billing', title: 'Aktivasyon', desc: 'Paket seçimi' }
];

const INDUSTRIES = [
  { id: 'healthcare', title: 'Sağlık / Klinik', icon: Stethoscope, pack: 'HealthPack v1.2' },
  { id: 'realestate', title: 'Gayrimenkul', icon: Building2, pack: 'EstatePack v2.0' },
  { id: 'education', title: 'Eğitim', icon: GraduationCap, pack: 'EduPack v1.0' },
  { id: 'agency', title: 'Ajans / Hizmet', icon: Briefcase, pack: 'ServicePack v1.5' },
];

export default function OnboardingWizard() {
  const [currentStep, setCurrentStep] = useState(0);
  const [selectedIndustry, setSelectedIndustry] = useState('');

  return (
    <div className="min-h-screen bg-neutral-50 flex items-center justify-center p-6">
      <div className="w-full max-w-5xl grid grid-cols-1 md:grid-cols-[300px_1fr] gap-8 bg-white rounded-3xl shadow-xl overflow-hidden border border-neutral-200/50 min-h-[700px]">
        
        {/* Left Sidebar - Progress */}
        <div className="bg-neutral-900 text-white p-8 flex flex-col relative overflow-hidden">
          {/* Subtle background glow */}
          <div className="absolute top-0 right-0 w-64 h-64 bg-blue-500/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2" />
          
          <div className="flex items-center gap-3 mb-16 relative z-10">
            <div className="w-8 h-8 rounded-lg bg-blue-500 flex items-center justify-center font-bold">Q</div>
            <span className="font-semibold text-lg tracking-tight">Quba AI OS</span>
          </div>

          <nav className="flex-1 relative z-10">
            <ul className="space-y-8">
              {STEPS.map((step, idx) => {
                const isActive = idx === currentStep;
                const isPast = idx < currentStep;
                return (
                  <li key={step.id} className="relative">
                    {/* Connection line */}
                    {idx !== STEPS.length - 1 && (
                      <div className={`absolute top-8 left-4 w-[1px] h-12 -ml-px transition-colors duration-500 \${isPast ? 'bg-blue-500' : 'bg-neutral-800'}`} />
                    )}
                    
                    <div className={`flex items-start gap-4 transition-colors duration-300 \${isActive ? 'opacity-100' : isPast ? 'opacity-70' : 'opacity-40'}`}>
                      <div className={`mt-0.5 w-8 h-8 rounded-full flex items-center justify-center border-2 transition-colors duration-300 \${
                        isActive ? 'border-blue-500 text-blue-400 bg-blue-500/10' : 
                        isPast ? 'border-blue-500 bg-blue-500 text-neutral-900' : 
                        'border-neutral-700 text-neutral-600'
                      }`}>
                        {isPast ? <CheckCircle2 className="w-4 h-4" /> : <span className="text-sm font-medium">{idx + 1}</span>}
                      </div>
                      <div>
                        <p className={`font-medium \${isActive ? 'text-white' : 'text-neutral-300'}`}>{step.title}</p>
                        <p className="text-sm text-neutral-500 mt-0.5">{step.desc}</p>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </nav>
        </div>

        {/* Right Content Area */}
        <div className="p-10 md:p-14 flex flex-col relative">
          <AnimatePresence mode="wait">
            {currentStep === 0 && (
              <motion.div
                key="step1"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="flex-1"
              >
                <div className="mb-10">
                  <h1 className="text-3xl font-semibold tracking-tight text-neutral-900">İşletmenizi Tanıyın</h1>
                  <p className="text-neutral-500 mt-2 text-lg">AI asistanınızın sektöre özel eğitilmiş altyapısını kuracağız.</p>
                </div>

                <div className="grid grid-cols-2 gap-4 mb-8">
                  {INDUSTRIES.map((ind) => {
                    const Icon = ind.icon;
                    const isSelected = selectedIndustry === ind.id;
                    return (
                      <button
                        key={ind.id}
                        onClick={() => setSelectedIndustry(ind.id)}
                        className={`p-6 rounded-2xl text-left border-2 transition-all duration-200 \${
                          isSelected 
                            ? 'border-neutral-900 bg-neutral-50 ring-4 ring-neutral-900/5' 
                            : 'border-neutral-200 hover:border-neutral-300 hover:bg-neutral-50'
                        }`}
                      >
                        <Icon className={`w-8 h-8 mb-4 \${isSelected ? 'text-neutral-900' : 'text-neutral-400'}`} />
                        <h3 className="font-semibold text-neutral-900">{ind.title}</h3>
                        <p className="text-xs font-mono mt-2 text-blue-600 bg-blue-50 inline-block px-2 py-1 rounded-md">{ind.pack}</p>
                      </button>
                    );
                  })}
                </div>
              </motion.div>
            )}

            {currentStep === 1 && (
              <motion.div
                key="step2"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="flex-1"
              >
                <div className="mb-10">
                  <h1 className="text-3xl font-semibold tracking-tight text-neutral-900">Kanalları Bağlayın</h1>
                  <p className="text-neutral-500 mt-2 text-lg">Müşterilerinizle konuştuğunuz platformları entegre edin.</p>
                </div>
                {/* Meta Connect Card placeholder */}
                <div className="p-8 border border-neutral-200 rounded-2xl bg-neutral-50 flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 bg-[#25D366] rounded-full flex items-center justify-center">
                      <MessageSquare className="w-6 h-6 text-white" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-neutral-900">WhatsApp Business API</h3>
                      <p className="text-sm text-neutral-500">Resmi numaranızı AI ile konuşturun.</p>
                    </div>
                  </div>
                  <button className="px-6 py-2.5 bg-neutral-900 text-white rounded-lg font-medium hover:bg-neutral-800 transition-colors">
                    Bağla
                  </button>
                </div>
              </motion.div>
            )}

            {/* Other steps placeholders... */}
          </AnimatePresence>

          {/* Footer Actions */}
          <div className="mt-auto pt-8 border-t border-neutral-100 flex items-center justify-between">
            <button 
              onClick={() => setCurrentStep(s => Math.max(0, s - 1))}
              className={`px-6 py-2.5 text-neutral-500 font-medium hover:text-neutral-900 transition-colors \${currentStep === 0 ? 'opacity-0 pointer-events-none' : ''}`}
            >
              Geri
            </button>
            <button 
              onClick={() => setCurrentStep(s => Math.min(STEPS.length - 1, s + 1))}
              disabled={currentStep === 0 && !selectedIndustry}
              className="px-8 py-3 bg-blue-600 text-white rounded-xl font-medium hover:bg-blue-700 transition-all flex items-center gap-2 shadow-lg shadow-blue-500/25 disabled:opacity-50 disabled:shadow-none"
            >
              Devam Et <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
