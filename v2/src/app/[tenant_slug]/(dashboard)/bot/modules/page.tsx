"use client";

import { useEffect, useState } from "react";
import { getAIModules, toggleAIModule, updateAIModuleConfig } from "@/app/actions/ai-modules";
import { MODULE_TYPES, AI_MODULES, type TenantModuleConfig } from "@/lib/ai/modules";
import {
  Cpu, Loader2, ToggleLeft, ToggleRight, Settings2, ChevronDown, ChevronUp,
  Filter, MessageCircle, BarChart3, AlertTriangle, Sparkles
} from "lucide-react";
import { PageLoader } from "@/components/ui/shared-states";
import { SectionCard } from "@/components/governance";

// ==========================================
// QUBA AI — AI Module Manager Page
// Authority: AI pipeline module toggling & config
// ==========================================

const TYPE_META: Record<string, { label: string; icon: any; color: string }> = {
  [MODULE_TYPES.PREPROCESSOR]: { label: "Ön İşleme", icon: Filter, color: "var(--q-blue)" },
  [MODULE_TYPES.PROMPT_BUILDER]: { label: "Prompt Üretici", icon: MessageCircle, color: "var(--q-purple)" },
  [MODULE_TYPES.RESPONSE_FILTER]: { label: "Yanıt Filtresi", icon: Settings2, color: "var(--q-orange)" },
  [MODULE_TYPES.ANALYTICS]: { label: "Analitik", icon: BarChart3, color: "var(--q-green)" },
  [MODULE_TYPES.ESCALATION]: { label: "Yönlendirme", icon: AlertTriangle, color: "var(--q-red)" },
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

  if (loading) return <PageLoader />;

  return (
    <div className="h-full overflow-auto">
      <div className="max-w-2xl mx-auto p-6 pb-20 space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-[22px] font-bold flex items-center gap-2" style={{ color: "var(--q-text-primary)" }}>
            <Cpu className="w-6 h-6" style={{ color: "var(--q-purple-alt)" }} /> AI Modülleri
          </h1>
          <p className="text-[13px] mt-1" style={{ color: "var(--q-text-secondary)" }}>
            {activeCount}/{modules.length} modül aktif — AI pipeline'ınızı özelleştirin
          </p>
        </div>

        {/* Pipeline Visual */}
        <div className="flex items-center gap-1 px-4 py-3 rounded-xl" style={{ background: "linear-gradient(to right, var(--q-blue-bg), var(--q-purple-bg), var(--q-purple-alt-bg))" }}>
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
                  <span className="mx-1" style={{ color: "var(--q-text-placeholder)" }}>→</span>
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
                <SectionCard
                  key={mod.moduleId}
                  className={!mod.enabled ? "opacity-60" : ""}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <div
                        className="w-9 h-9 rounded-lg flex items-center justify-center text-white text-[13px] font-bold"
                        style={{ backgroundColor: mod.enabled ? group.color : "var(--q-text-secondary)" }}
                      >
                        {info.name.charAt(0)}
                      </div>
                      <div className="min-w-0">
                        <h3 className="text-[14px] font-semibold truncate" style={{ color: "var(--q-text-primary)" }}>{info.name}</h3>
                        <p className="text-[11px] truncate" style={{ color: "var(--q-text-secondary)" }}>{info.description}</p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className="text-[10px] font-mono" style={{ color: "var(--q-text-secondary)" }}>v{info.version}</span>
                      
                      {Object.keys(info.configSchema).length > 0 && (
                        <button
                          onClick={() => setExpanded(expanded === mod.moduleId ? null : mod.moduleId)}
                          className="p-1.5 rounded-lg transition-colors"
                          style={{ color: "var(--q-text-secondary)" }}
                        >
                          {expanded === mod.moduleId ? 
                            <ChevronUp className="w-4 h-4" /> : 
                            <ChevronDown className="w-4 h-4" />}
                        </button>
                      )}
                      
                      <button
                        onClick={() => handleToggle(mod.moduleId, mod.enabled)}
                        disabled={toggling === mod.moduleId}
                        className="transition-transform active:scale-95"
                      >
                        {toggling === mod.moduleId ? (
                          <Loader2 className="w-7 h-7 animate-spin" style={{ color: "var(--q-text-secondary)" }} />
                        ) : mod.enabled ? (
                          <ToggleRight className="w-7 h-7" style={{ color: group.color }} />
                        ) : (
                          <ToggleLeft className="w-7 h-7" style={{ color: "var(--q-text-secondary)" }} />
                        )}
                      </button>
                    </div>
                  </div>

                  {/* Config Panel */}
                  {expanded === mod.moduleId && Object.keys(info.configSchema).length > 0 && (
                    <div className="pt-3 mt-3" style={{ borderTop: "1px solid var(--q-border-default)" }}>
                      <div className="space-y-3">
                        {Object.entries(info.configSchema).map(([key, schema]: [string, any]) => (
                          <div key={key}>
                            <label className="text-[11px] font-medium uppercase tracking-wide" style={{ color: "var(--q-text-secondary)" }}>
                              {key.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase())}
                            </label>
                            {schema.type === 'select' ? (
                              <select
                                value={mod.config[key] || schema.default}
                                onChange={async (e) => {
                                  await updateAIModuleConfig(mod.moduleId, { [key]: e.target.value });
                                  load();
                                }}
                                className="w-full mt-1 px-3 py-2 text-[13px] rounded-lg outline-none"
                                style={{ backgroundColor: "var(--q-bg-secondary)" }}
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
                                    <ToggleRight className="w-6 h-6" style={{ color: "var(--q-green)" }} /> : 
                                    <ToggleLeft className="w-6 h-6" style={{ color: "var(--q-text-secondary)" }} />}
                                </button>
                              </div>
                            ) : schema.type === 'textarea' ? (
                              <textarea
                                defaultValue={mod.config[key] || schema.default}
                                onBlur={async (e) => {
                                  await updateAIModuleConfig(mod.moduleId, { [key]: e.target.value });
                                }}
                                className="w-full mt-1 px-3 py-2 text-[13px] rounded-lg outline-none resize-none h-20"
                                style={{ backgroundColor: "var(--q-bg-secondary)" }}
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
                                className="w-full mt-1 px-3 py-2 text-[13px] rounded-lg outline-none"
                                style={{ backgroundColor: "var(--q-bg-secondary)" }}
                              />
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </SectionCard>
              );
            })}
          </div>
        ))}

        {/* Info */}
        <div className="rounded-xl p-4" style={{ backgroundColor: "var(--q-purple-alt-bg)", border: "1px solid var(--q-purple-alt)" }}>
          <div className="flex items-start gap-2">
            <Sparkles className="w-4 h-4 mt-0.5" style={{ color: "var(--q-purple-alt)" }} />
            <div>
              <p className="text-[13px] font-medium" style={{ color: "var(--q-text-primary)" }}>AI Pipeline Nasıl Çalışır?</p>
              <p className="text-[12px] mt-1" style={{ color: "var(--q-text-secondary)" }}>
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
