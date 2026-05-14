"use client";

import { useEffect, useState } from "react";
import { getAIModules, toggleAIModule, updateAIModuleConfig } from "@/app/actions/ai-modules";
import { MODULE_TYPES, AI_MODULES, type TenantModuleConfig } from "@/lib/ai/modules";
import {
  Cpu, Loader2, ToggleLeft, ToggleRight, Settings2, ChevronDown, ChevronUp,
  Filter, MessageCircle, BarChart3, AlertTriangle, Sparkles
} from "lucide-react";

// ==========================================
// QUBA AI — AI Module Manager Page
// Tenant bazlı AI pipeline yönetimi
// ==========================================

const TYPE_META: Record<string, { label: string; icon: any; color: string }> = {
  [MODULE_TYPES.PREPROCESSOR]: { label: "Ön İşleme", icon: Filter, color: "#007AFF" },
  [MODULE_TYPES.PROMPT_BUILDER]: { label: "Prompt Üretici", icon: MessageCircle, color: "#5856D6" },
  [MODULE_TYPES.RESPONSE_FILTER]: { label: "Yanıt Filtresi", icon: Settings2, color: "#FF9500" },
  [MODULE_TYPES.ANALYTICS]: { label: "Analitik", icon: BarChart3, color: "#34C759" },
  [MODULE_TYPES.ESCALATION]: { label: "Yönlendirme", icon: AlertTriangle, color: "#FF3B30" },
};

export default function AIModulesPage() {
  const [modules, setModules] = useState<TenantModuleConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    const res = await getAIModules();
    if (res.success && res.modules) setModules(res.modules);
    setLoading(false);
  }

  async function handleToggle(moduleId: string, currentState: boolean) {
    setToggling(moduleId);
    const res = await toggleAIModule(moduleId, !currentState);
    if (res.success) {
      setModules((prev) =>
        prev.map((m) => m.moduleId === moduleId ? { ...m, enabled: !currentState } : m)
      );
    }
    setToggling(null);
  }

  const activeCount = modules.filter((m) => m.enabled).length;
  const groupedModules = Object.entries(TYPE_META).map(([type, meta]) => ({
    type,
    ...meta,
    modules: modules.filter((m) => AI_MODULES[m.moduleId]?.type === type),
  }));

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-[#86868B]" />
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto">
      <div className="max-w-2xl mx-auto p-6 pb-20 space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-[22px] font-bold text-[#1D1D1F] flex items-center gap-2">
            <Cpu className="w-6 h-6 text-[#AF52DE]" /> AI Modülleri
          </h1>
          <p className="text-[13px] text-[#86868B] mt-1">
            {activeCount}/{modules.length} modül aktif — AI pipeline'ınızı özelleştirin
          </p>
        </div>

        {/* Pipeline Visual */}
        <div className="flex items-center gap-1 px-4 py-3 bg-gradient-to-r from-[#007AFF]/5 via-[#5856D6]/5 to-[#AF52DE]/5 rounded-xl">
          {Object.entries(TYPE_META).map(([type, meta], i) => {
            const count = modules.filter((m) => m.enabled && AI_MODULES[m.moduleId]?.type === type).length;
            return (
              <div key={type} className="flex items-center gap-1 flex-1">
                <div className="flex items-center gap-1.5 text-[11px] font-medium" style={{ color: meta.color }}>
                  <meta.icon className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">{meta.label}</span>
                  <span className="bg-white px-1.5 py-0.5 rounded text-[10px]">{count}</span>
                </div>
                {i < Object.keys(TYPE_META).length - 1 && (
                  <span className="text-[#86868B]/30 mx-1">→</span>
                )}
              </div>
            );
          })}
        </div>

        {/* Module Groups */}
        {groupedModules.map((group) => (
          <div key={group.type} className="space-y-2">
            <h2 className="text-[13px] font-semibold uppercase tracking-wide flex items-center gap-2" style={{ color: group.color }}>
              <group.icon className="w-4 h-4" /> {group.label}
            </h2>

            {group.modules.map((mod) => {
              const info = AI_MODULES[mod.moduleId];
              if (!info) return null;

              return (
                <div
                  key={mod.moduleId}
                  className={`bg-white rounded-xl border shadow-sm transition-all ${
                    mod.enabled ? "border-black/5" : "border-black/3 opacity-60"
                  }`}
                >
                  <div className="flex items-center justify-between p-4">
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <div
                        className="w-9 h-9 rounded-lg flex items-center justify-center text-white text-[13px] font-bold"
                        style={{ backgroundColor: mod.enabled ? group.color : "#86868B" }}
                      >
                        {info.name.charAt(0)}
                      </div>
                      <div className="min-w-0">
                        <h3 className="text-[14px] font-semibold text-[#1D1D1F] truncate">{info.name}</h3>
                        <p className="text-[11px] text-[#86868B] truncate">{info.description}</p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className="text-[10px] text-[#86868B] font-mono">v{info.version}</span>
                      
                      {Object.keys(info.configSchema).length > 0 && (
                        <button
                          onClick={() => setExpanded(expanded === mod.moduleId ? null : mod.moduleId)}
                          className="p-1.5 hover:bg-black/5 rounded-lg transition-colors"
                        >
                          {expanded === mod.moduleId ? 
                            <ChevronUp className="w-4 h-4 text-[#86868B]" /> : 
                            <ChevronDown className="w-4 h-4 text-[#86868B]" />}
                        </button>
                      )}
                      
                      <button
                        onClick={() => handleToggle(mod.moduleId, mod.enabled)}
                        disabled={toggling === mod.moduleId}
                        className="transition-transform active:scale-95"
                      >
                        {toggling === mod.moduleId ? (
                          <Loader2 className="w-7 h-7 animate-spin text-[#86868B]" />
                        ) : mod.enabled ? (
                          <ToggleRight className="w-7 h-7" style={{ color: group.color }} />
                        ) : (
                          <ToggleLeft className="w-7 h-7 text-[#86868B]" />
                        )}
                      </button>
                    </div>
                  </div>

                  {/* Config Panel */}
                  {expanded === mod.moduleId && Object.keys(info.configSchema).length > 0 && (
                    <div className="px-4 pb-4 pt-0 border-t border-black/5 mt-0">
                      <div className="space-y-3 pt-3">
                        {Object.entries(info.configSchema).map(([key, schema]: [string, any]) => (
                          <div key={key}>
                            <label className="text-[11px] font-medium text-[#86868B] uppercase tracking-wide">
                              {key.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase())}
                            </label>
                            {schema.type === 'select' ? (
                              <select
                                value={mod.config[key] || schema.default}
                                onChange={async (e) => {
                                  await updateAIModuleConfig(mod.moduleId, { [key]: e.target.value });
                                  load();
                                }}
                                className="w-full mt-1 px-3 py-2 text-[13px] bg-[#F5F5F7] rounded-lg outline-none"
                              >
                                {schema.options.map((o: string) => (
                                  <option key={o} value={o}>{o}</option>
                                ))}
                              </select>
                            ) : schema.type === 'boolean' ? (
                              <div className="mt-1">
                                <button
                                  onClick={async () => {
                                    await updateAIModuleConfig(mod.moduleId, { [key]: !mod.config[key] });
                                    load();
                                  }}
                                  className="text-[13px]"
                                >
                                  {mod.config[key] ? 
                                    <ToggleRight className="w-6 h-6 text-[#34C759]" /> : 
                                    <ToggleLeft className="w-6 h-6 text-[#86868B]" />}
                                </button>
                              </div>
                            ) : schema.type === 'textarea' ? (
                              <textarea
                                defaultValue={mod.config[key] || schema.default}
                                onBlur={async (e) => {
                                  await updateAIModuleConfig(mod.moduleId, { [key]: e.target.value });
                                }}
                                className="w-full mt-1 px-3 py-2 text-[13px] bg-[#F5F5F7] rounded-lg outline-none resize-none h-20"
                                placeholder={schema.default}
                              />
                            ) : (
                              <input
                                type={schema.type === 'number' ? 'number' : 'text'}
                                defaultValue={mod.config[key] || schema.default}
                                onBlur={async (e) => {
                                  const val = schema.type === 'number' ? Number(e.target.value) : e.target.value;
                                  await updateAIModuleConfig(mod.moduleId, { [key]: val });
                                }}
                                className="w-full mt-1 px-3 py-2 text-[13px] bg-[#F5F5F7] rounded-lg outline-none"
                              />
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))}

        {/* Info */}
        <div className="bg-[#AF52DE]/5 border border-[#AF52DE]/10 rounded-xl p-4">
          <div className="flex items-start gap-2">
            <Sparkles className="w-4 h-4 text-[#AF52DE] mt-0.5" />
            <div>
              <p className="text-[13px] font-medium text-[#1D1D1F]">AI Pipeline Nasıl Çalışır?</p>
              <p className="text-[12px] text-[#86868B] mt-1">
                Mesaj geldiğinde modüller sırayla çalışır: Ön İşleme → Prompt Üretici → AI Yanıt → Yanıt Filtresi → Analitik → Yönlendirme.
                Her modülü açıp kapatabilir ve yapılandırabilirsiniz.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
