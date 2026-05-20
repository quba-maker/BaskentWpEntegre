import React from 'react';
import { Settings, AlertCircle, CheckCircle2 } from 'lucide-react';

export interface IntegrationCardProps {
  id: string;
  name: string;
  description: string;
  icon: React.ReactNode;
  status: 'connected' | 'disconnected' | 'error';
  onConnect: (id: string) => void;
  onConfigure: (id: string) => void;
}

export function IntegrationCard({
  id,
  name,
  description,
  icon,
  status,
  onConnect,
  onConfigure
}: IntegrationCardProps) {
  const isConnected = status === 'connected';
  const isError = status === 'error';

  return (
    <div className={`group relative overflow-hidden rounded-2xl border transition-all duration-300 hover:shadow-md ${isConnected ? 'bg-white border-green-200/50 hover:border-green-300' : isError ? 'bg-white border-red-200/50 hover:border-red-300' : 'bg-white border-[var(--q-border-default)] hover:border-[var(--q-border-strong)]'}`}>
      <div className="p-6 flex flex-col h-full">
        <div className="flex items-start justify-between mb-5">
          <div className={`w-12 h-12 rounded-[14px] flex items-center justify-center border shadow-sm transition-transform duration-300 group-hover:scale-105 ${isConnected ? 'bg-green-50/50 border-green-100' : isError ? 'bg-red-50/50 border-red-100' : 'bg-gray-50 border-gray-100'}`}>
            {icon}
          </div>
          
          {/* Status Badge */}
          {isConnected && (
            <span className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider bg-green-50 text-green-700 rounded-full border border-green-200/60">
              <CheckCircle2 className="w-3.5 h-3.5" />
              Bağlı
            </span>
          )}
          {isError && (
            <span className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider bg-red-50 text-red-700 rounded-full border border-red-200/60">
              <AlertCircle className="w-3.5 h-3.5" />
              Hata
            </span>
          )}
        </div>
        
        <h3 className="text-[17px] font-bold text-[var(--q-text-primary)] mb-1.5">{name}</h3>
        <p className="text-[13px] font-medium text-[var(--q-text-secondary)] mb-6 line-clamp-2 leading-relaxed">
          {description}
        </p>

        <div className="flex items-center gap-3 mt-auto">
          {isConnected ? (
            <button 
              onClick={() => onConfigure(id)}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-[13px] font-bold bg-white text-[var(--q-text-primary)] border border-[var(--q-border-strong)] rounded-xl hover:bg-gray-50 transition-colors shadow-sm"
            >
              <Settings className="w-4 h-4" />
              Yapılandır
            </button>
          ) : (
            <button 
              onClick={() => onConnect(id)}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-[13px] font-bold bg-[var(--q-text-primary)] text-white rounded-xl hover:opacity-90 transition-opacity shadow-sm"
            >
              Bağlan
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
