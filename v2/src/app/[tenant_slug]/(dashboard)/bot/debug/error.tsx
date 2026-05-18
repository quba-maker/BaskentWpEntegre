"use client";

import { useEffect } from "react";

export default function DebugError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[Debug Panel Error]", error);
  }, [error]);

  return (
    <div className="p-8 max-w-lg mx-auto text-center mt-20">
      <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4" 
           style={{ background: 'rgba(255,59,48,0.08)' }}>
        <svg className="w-8 h-8" fill="none" stroke="var(--q-red, #ff3b30)" viewBox="0 0 24 24" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
        </svg>
      </div>
      <h2 className="text-lg font-bold mb-2" style={{ color: 'var(--q-text-primary)' }}>
        Debug Paneli Yüklenemedi
      </h2>
      <p className="text-sm mb-6" style={{ color: 'var(--q-text-secondary)' }}>
        Önce /api/migrate çalıştırarak tabloları oluşturun, sonra tekrar deneyin.
      </p>
      <div className="flex gap-3 justify-center">
        <button
          onClick={() => reset()}
          className="px-5 py-2.5 rounded-xl text-sm font-semibold text-white cursor-pointer"
          style={{ background: 'var(--q-blue, #007aff)' }}
        >
          Tekrar Dene
        </button>
        <button
          onClick={() => window.history.back()}
          className="px-5 py-2.5 rounded-xl text-sm font-semibold cursor-pointer"
          style={{ background: 'var(--q-bg-secondary)', color: 'var(--q-text-primary)', border: '1px solid var(--q-border-default)' }}
        >
          Geri Dön
        </button>
      </div>
      {error?.message && (
        <p className="text-[10px] font-mono mt-6 p-3 rounded-lg text-left" 
           style={{ background: 'var(--q-bg-secondary)', color: 'var(--q-text-secondary)' }}>
          {error.message}
        </p>
      )}
    </div>
  );
}
