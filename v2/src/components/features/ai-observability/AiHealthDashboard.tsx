"use client";

import { useState, useEffect } from "react";
import { getAiHealthCards } from "@/app/actions/ai-os";
import { Activity, Brain, Timer, Wrench, Database, Loader2 } from "lucide-react";

// =============================================
// AI Health Dashboard Cards — Phase 6 Monitoring
// Apple Health / Stripe Dashboard style
// =============================================

function MetricCard({ label, value, suffix, icon: Icon, color, secondaryText }: {
  label: string; value: string | number; suffix?: string;
  icon: typeof Activity; color: string; secondaryText?: string;
}) {
  const numVal = typeof value === 'number' ? value : parseFloat(value);
  const isAlert = label.includes('Hata') && numVal > 0;

  return (
    <div 
      className="rounded-2xl p-5 relative overflow-hidden group transition-all duration-300 hover:shadow-md"
      style={{ 
        background: isAlert ? 'rgba(255,59,48,0.03)' : 'rgba(255,255,255,0.6)',
        border: `1px solid ${isAlert ? 'rgba(255,59,48,0.15)' : 'var(--q-border-default)'}`,
        boxShadow: 'var(--q-shadow-sm)'
      }}
    >
      <div className="absolute top-0 left-0 w-full h-0.5 opacity-30" style={{ background: `linear-gradient(to right, transparent, ${color}, transparent)` }} />
      
      <div className="flex items-center gap-2 mb-3">
        <div 
          className="w-8 h-8 rounded-lg flex items-center justify-center"
          style={{ background: `${color}15` }}
        >
          <Icon className="w-4 h-4" style={{ color }} />
        </div>
        <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--q-text-secondary)' }}>
          {label}
        </span>
      </div>
      
      <div className="flex items-baseline gap-1">
        <span className="text-3xl font-black tracking-tight" style={{ color: 'var(--q-text-primary)' }}>
          {value}
        </span>
        {suffix && (
          <span className="text-sm font-bold" style={{ color: 'var(--q-text-secondary)' }}>
            {suffix}
          </span>
        )}
      </div>
      
      {secondaryText && (
        <p className="text-[10px] font-medium mt-2" style={{ color: 'var(--q-text-secondary)' }}>
          {secondaryText}
        </p>
      )}
    </div>
  );
}

export function AiHealthDashboard() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getAiHealthCards().then(d => {
      setData(d);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="mb-8">
        <div className="flex items-center gap-2 mb-4">
          <Activity className="w-4 h-4" style={{ color: 'var(--q-blue)' }} />
          <span className="text-[11px] font-bold uppercase tracking-widest" style={{ color: 'var(--q-text-secondary)' }}>AI Engine Sağlığı</span>
          <span className="text-[8px] px-1.5 py-0.5 rounded ml-1" style={{ color: 'var(--q-blue)', background: 'var(--q-blue-bg)' }}>CANLI</span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {[1,2,3,4,5].map(i => (
            <div key={i} className="rounded-2xl p-5 q-skeleton h-28" />
          ))}
        </div>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="mb-8">
      <div className="flex items-center gap-2 mb-4">
        <Activity className="w-4 h-4" style={{ color: 'var(--q-blue)' }} />
        <span className="text-[11px] font-bold uppercase tracking-widest" style={{ color: 'var(--q-text-secondary)' }}>AI Engine Sağlığı</span>
        <span className="text-[8px] px-1.5 py-0.5 rounded ml-1" style={{ color: 'var(--q-green)', background: 'rgba(52,199,89,0.1)' }}>
          {data.aiSuccessRate >= 95 ? 'SAĞLIKLI' : data.aiSuccessRate >= 80 ? 'UYARI' : 'KRİTİK'}
        </span>
        <span className="text-[9px] ml-auto" style={{ color: 'var(--q-text-secondary)' }}>Son 24 saat</span>
      </div>
      
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <MetricCard 
          label="AI Başarı" 
          value={data.aiSuccessRate} suffix="%" 
          icon={Activity} 
          color="var(--q-green)"
          secondaryText="Başarılı yanıt oranı"
        />
        <MetricCard 
          label="Kimlik Eşleşme" 
          value={data.identityMatchRate} suffix="%" 
          icon={Brain} 
          color="var(--q-blue)"
          secondaryText="Profil eşleşme oranı"
        />
        <MetricCard 
          label="Ort. Yanıt" 
          value={data.avgResponseMs > 0 ? `${(data.avgResponseMs / 1000).toFixed(1)}` : '—'} suffix="sn" 
          icon={Timer} 
          color="var(--q-orange)"
          secondaryText="Ortalama AI yanıt süresi"
        />
        <MetricCard 
          label="Tool Başarı" 
          value={data.toolSuccessRate} suffix="%" 
          icon={Wrench} 
          color="#5AC8FA"
          secondaryText="Tool doğrulama oranı"
        />
        <MetricCard 
          label="Hafıza Kapsam" 
          value={data.memoryCoverage} suffix="%" 
          icon={Database} 
          color="#AF52DE"
          secondaryText="Konuşma hafıza oranı"
        />
      </div>
    </div>
  );
}
