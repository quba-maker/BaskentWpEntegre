import { useState, useRef, useEffect } from "react";
import { FlaskConical, Send, Loader2, Bot, Trash2, ShieldCheck, ListChecks, FileText, ChevronDown } from "lucide-react";
import { type BotChannel } from "./shared";

// ==========================================
// BOT TEST PLAYGROUND (V2 SaaS Sandbox)
// Authority: Prompt testing & simulation
// Data owner: testBotPrompt() action
// ==========================================

interface BotTestPlaygroundProps {
  activeChannel: BotChannel;
  botGroupId: string;
  onTestPrompt: (
    botGroupId: string,
    messages: { role: 'user' | 'assistant'; content: string }[],
    channelId?: string,
    options?: {
      sandboxForm?: {
        formName?: string;
        rawText?: string;
      } | null;
    }
  ) => Promise<{ success: boolean; reply: string; metadata?: any }>;
  onGetBrainDiagnostics?: (
    botGroupId: string
  ) => Promise<{ success: boolean; metadata?: any; error?: string }>;
}

export function BotTestPlayground({ activeChannel, botGroupId, onTestPrompt, onGetBrainDiagnostics }: BotTestPlaygroundProps) {
  const [testMsg, setTestMsg] = useState("");
  const [messages, setMessages] = useState<{ role: 'user' | 'assistant'; content: string }[]>([]);
  const [testing, setTesting] = useState(false);
  const [waitingForDelay, setWaitingForDelay] = useState(false);
  const [debugMeta, setDebugMeta] = useState<any>(null);
  const [brainMeta, setBrainMeta] = useState<any>(null);
  const [sandboxFormEnabled, setSandboxFormEnabled] = useState(false);
  const [sandboxFormName, setSandboxFormName] = useState("Sandbox Test Formu");
  const [sandboxFormText, setSandboxFormText] = useState("");
  const [showBrainDetails, setShowBrainDetails] = useState(false);
  const [brainDiagnosticsLoading, setBrainDiagnosticsLoading] = useState(false);
  const [brainDiagnosticsError, setBrainDiagnosticsError] = useState<string | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const delayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Auto-scroll to bottom of chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Reset chat when botGroupId changes (changing selected bot)
  useEffect(() => {
    if (delayTimerRef.current) {
      clearTimeout(delayTimerRef.current);
      delayTimerRef.current = null;
    }
    setMessages([]);
    setDebugMeta(null);
    setBrainMeta(null);
    setSandboxFormEnabled(false);
    setSandboxFormName("Sandbox Test Formu");
    setSandboxFormText("");
    setShowBrainDetails(false);
    setBrainDiagnosticsError(null);
    setWaitingForDelay(false);
    setTesting(false);
  }, [botGroupId]);

  useEffect(() => {
    let active = true;

    async function loadBrainDiagnostics() {
      if (!onGetBrainDiagnostics || !botGroupId) return;
      setBrainDiagnosticsLoading(true);
      setBrainDiagnosticsError(null);
      try {
        const result = await onGetBrainDiagnostics(botGroupId);
        if (!active) return;
        if (result.success && result.metadata) {
          setBrainMeta(result.metadata);
        } else {
          setBrainMeta(null);
          setBrainDiagnosticsError(result.error || "Brain kurulumu okunamadı.");
        }
      } catch {
        if (!active) return;
        setBrainMeta(null);
        setBrainDiagnosticsError("Brain kurulumu okunamadı.");
      } finally {
        if (active) setBrainDiagnosticsLoading(false);
      }
    }

    loadBrainDiagnostics();
    return () => {
      active = false;
    };
  }, [botGroupId, onGetBrainDiagnostics]);

  useEffect(() => {
    return () => {
      if (delayTimerRef.current) {
        clearTimeout(delayTimerRef.current);
      }
    };
  }, []);

  const getResponseDelayMs = () => {
    const rawSeconds = Number(debugMeta?.responseDelaySeconds ?? 5);
    const safeSeconds = Number.isFinite(rawSeconds) ? Math.max(2, Math.min(30, rawSeconds)) : 5;
    return safeSeconds * 1000;
  };

  const scheduleBotResponse = (nextMessages: { role: 'user' | 'assistant'; content: string }[]) => {
    if (delayTimerRef.current) {
      clearTimeout(delayTimerRef.current);
    }

    setWaitingForDelay(true);
    delayTimerRef.current = setTimeout(async () => {
      delayTimerRef.current = null;
      setWaitingForDelay(false);
      setTesting(true);

      const historyPayload = nextMessages.slice(-20);
      try {
        const result = await onTestPrompt(
          botGroupId,
          historyPayload,
          activeChannel.id,
          {
            sandboxForm: sandboxFormEnabled && sandboxFormText.trim()
              ? { formName: sandboxFormName, rawText: sandboxFormText }
              : null,
          }
        );
        if (result) {
          setMessages(prev => [...prev, { role: 'assistant' as const, content: result.reply }]);
          if (result.metadata) {
            setDebugMeta(result.metadata);
          }
        }
      } catch {
        setMessages(prev => [...prev, { role: 'assistant' as const, content: "❌ Hata: Test mesajı işlenirken bir sorun oluştu." }]);
      } finally {
        setTesting(false);
      }
    }, getResponseDelayMs());
  };

  const runTest = async () => {
    const trimmed = testMsg.trim();
    if (!trimmed || testing) return;
    
    // Add user message to history
    const updatedMessages = [...messages, { role: 'user' as const, content: trimmed }];
    setMessages(updatedMessages);
    setTestMsg("");
    scheduleBotResponse(updatedMessages);
  };

  const clearHistory = () => {
    if (delayTimerRef.current) {
      clearTimeout(delayTimerRef.current);
      delayTimerRef.current = null;
    }
    setMessages([]);
    setDebugMeta(null);
    setWaitingForDelay(false);
    setTesting(false);
  };

  const loadSampleForm = () => {
    setSandboxFormEnabled(true);
    setShowBrainDetails(false);
    setSandboxFormName("Gurbetçiler Form Randevu");
    setSandboxFormText([
      "Full name: Aysu Maysu",
      "Phone number: +905535874260",
      "Hangi ülkede yaşıyorsunuz?: Babam Türkiye'de ben Almanya'dayım",
      "Yaşınız?: 76",
      "Şikayetiniz Nedir?: Bel ve boyun fıtığı nedeniyle 3 yıldır yürüyemiyor babam. Ameliyat riskli, sinirlerinin zedelenebileceğini söylediler.",
      "Şikayetiniz Ne Zaman Başladı?: 3 yıl önce",
      "Size ne zaman randevu oluşturmamızı istersiniz?: Önce bilgi almak istiyorum, daha sonra gelebiliriz",
      "Tedavi planlamanız ve ön görüşme için sizi ne zaman arayalım?: Öğleden sonra (12:00 - 18:00)",
      "Önerilen Bölüm: Ortopedi",
    ].join("\n"));
  };

  const brainPlan = debugMeta?.brainV2ShadowPlan;
  const brainEvaluation = debugMeta?.brainV2ResponseEvaluation;
  const qubaBrainMeta = debugMeta?.qubaBrainProfile ? debugMeta : brainMeta;
  const qubaBrainProfile = qubaBrainMeta?.qubaBrainProfile;
  const qubaBrainDiagnostics = qubaBrainProfile?.diagnostics;
  const qubaRolloutMode = qubaBrainMeta?.qubaBrainRolloutMode || qubaBrainProfile?.rollout?.mode;
  const qubaCapabilities: string[] = Array.isArray(qubaBrainDiagnostics?.capabilities) ? qubaBrainDiagnostics.capabilities : [];
  const qubaWarnings: string[] = Array.isArray(qubaBrainDiagnostics?.warnings) ? qubaBrainDiagnostics.warnings : [];
  const qubaMissingSetup: string[] = Array.isArray(qubaBrainDiagnostics?.missingSetup) ? qubaBrainDiagnostics.missingSetup : [];
  const qubaPromptBudget = qubaBrainDiagnostics?.promptBudget;
  const qubaReadiness = qubaBrainProfile?.readiness;
  const qubaBlockers: string[] = Array.isArray(qubaReadiness?.blockers) ? qubaReadiness.blockers : [];
  const qubaRecommendations: string[] = Array.isArray(qubaReadiness?.recommendations) ? qubaReadiness.recommendations : [];
  const qubaSetupHealthy = qubaReadiness ? qubaReadiness.status === "ready" : qubaMissingSetup.length === 0;
  const renderCompactList = (items?: string[], emptyLabel = "Yok") => {
    const safeItems = Array.isArray(items) ? items.filter(Boolean).slice(0, 6) : [];
    if (safeItems.length === 0) {
      return <span className="text-[10px] text-gray-400">{emptyLabel}</span>;
    }
    return (
      <div className="flex flex-wrap gap-1">
        {safeItems.map((item, index) => (
          <span
            key={`${item}-${index}`}
            className="px-2 py-1 rounded-full bg-white border text-[10px] text-gray-600"
            style={{ borderColor: "var(--q-border-default)" }}
          >
            {item}
          </span>
        ))}
      </div>
    );
  };

  return (
    <div className="mt-8 mb-8 flex min-h-0 h-[650px] flex-col border rounded-2xl bg-[#f8f9fa] overflow-hidden" style={{ borderColor: "var(--q-border-default)" }}>
      {/* Header */}
      <div className="shrink-0 flex items-center justify-between px-5 py-4 border-b bg-white" style={{ borderColor: "var(--q-border-default)" }}>
        <div className="flex items-center gap-2">
          <FlaskConical className="w-5 h-5" style={{ color: "var(--q-text-secondary)" }} />
          <h2 className="text-sm font-bold" style={{ color: "var(--q-text-primary)" }}>Bot Test Alanı</h2>
        </div>
        {messages.length > 0 && (
          <button
            onClick={clearHistory}
            className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-bold rounded-lg border hover:bg-gray-50 transition-all"
            style={{ color: "var(--q-red, #ef4444)", borderColor: "var(--q-border-default)" }}
          >
            <Trash2 className="w-3.5 h-3.5" />
            Temizle
          </button>
        )}
      </div>

      <div className="shrink-0 max-h-[360px] overflow-y-auto">
      {/* Sandbox Alert Info Banner */}
      <div className="shrink-0 px-5 py-2.5 bg-blue-50/50 border-b flex items-start gap-2 text-[11px]" style={{ borderColor: "var(--q-border-default)", color: "var(--q-blue, #007aff)" }}>
        <ShieldCheck className="w-4 h-4 flex-shrink-0 mt-0.5" />
        <p className="leading-relaxed">
          <strong>Sandbox Modu:</strong> Mesajlar DB&apos;ye yazılmaz, gerçek kullanıcılara gönderilmez ve asistan araçları dry-run çalıştırılır. <span className="opacity-75">Yanıt gecikmesi canlıya yakın simüle edilir; yeni test mesajı gelirse sayaç sıfırlanır ve mesajlar birlikte değerlendirilir.</span>
        </p>
      </div>

      {/* Live-like form context */}
      <div className="shrink-0 px-5 py-3 bg-white border-b space-y-3" style={{ borderColor: "var(--q-border-default)" }}>
        <div className="flex flex-col gap-2">
          <div className="flex items-start gap-2">
            <FileText className="w-4 h-4" style={{ color: sandboxFormEnabled ? "var(--q-blue, #007aff)" : "var(--q-text-secondary)" }} />
            <div>
              <div className="text-[11px] font-bold" style={{ color: "var(--q-text-primary)" }}>Formlu Test</div>
              <div className="text-[10px] text-gray-400">Canlıdaki form lead akışını test alanında simüle eder.</div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={loadSampleForm}
              type="button"
              className="px-2.5 py-2 rounded-lg border text-[10px] font-bold hover:bg-gray-50"
              style={{ borderColor: "var(--q-border-default)", color: "var(--q-blue, #007aff)" }}
            >
              Örnek Formla Aç
            </button>
            <label
              className="flex items-center justify-center gap-2 px-2.5 py-2 rounded-lg border text-[10px] font-bold cursor-pointer"
              style={{
                borderColor: sandboxFormEnabled ? "rgba(0,122,255,0.35)" : "var(--q-border-default)",
                color: sandboxFormEnabled ? "var(--q-blue, #007aff)" : "var(--q-text-secondary)",
                backgroundColor: sandboxFormEnabled ? "rgba(0,122,255,0.06)" : "#fff",
              }}
            >
              <input
                type="checkbox"
                checked={sandboxFormEnabled}
                onChange={e => {
                  setSandboxFormEnabled(e.target.checked);
                  setShowBrainDetails(false);
                }}
                className="w-3.5 h-3.5"
              />
              {sandboxFormEnabled ? "Form Açık" : "Formsuz Test"}
            </label>
          </div>
        </div>
        {sandboxFormEnabled && (
          <div className="space-y-2">
            <input
              value={sandboxFormName}
              onChange={e => setSandboxFormName(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border text-xs"
              style={{ borderColor: "var(--q-border-default)" }}
              placeholder="Form adı"
            />
            <textarea
              value={sandboxFormText}
              onChange={e => setSandboxFormText(e.target.value)}
              rows={4}
              className="w-full px-3 py-2 rounded-xl border text-xs resize-y"
              style={{ borderColor: "var(--q-border-default)" }}
              placeholder={"Canlı form metnini buraya yapıştırın.\nÖrn: Full name: ...\nŞikayetiniz Nedir?: ...\nNerede yaşıyorsunuz?: ..."}
            />
            <div className="text-[10px] text-gray-400">
              Açıkken ilk “merhaba” cevabı form karşılaması gibi; kapalıyken doğrudan WhatsApp hastası gibi test edilir.
            </div>
          </div>
        )}
      </div>

      {/* Quba Brain Setup Health */}
      <div className="shrink-0 px-5 py-3 bg-white border-b space-y-2" style={{ borderColor: "var(--q-border-default)" }}>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-[11px] font-bold" style={{ color: "var(--q-text-primary)" }}>
            <ListChecks className="w-4 h-4" style={{ color: qubaSetupHealthy ? "var(--q-green, #22c55e)" : "var(--q-yellow, #f59e0b)" }} />
            <span>Brain Kurulum Sağlığı</span>
            {qubaReadiness && (
              <span
                className="px-1.5 py-0.5 rounded text-[9px] uppercase"
                style={{
                  backgroundColor: qubaReadiness.status === "ready" ? "rgba(34,197,94,0.10)" : "rgba(245,158,11,0.12)",
                  color: qubaReadiness.status === "ready" ? "var(--q-green, #22c55e)" : "var(--q-yellow, #f59e0b)",
                }}
              >
                {qubaReadiness.status} · {qubaReadiness.score}/100
              </span>
            )}
            {qubaRolloutMode && (
              <span
                className="px-1.5 py-0.5 rounded text-[9px] uppercase"
                style={{
                  backgroundColor: qubaRolloutMode === "active" ? "rgba(34,197,94,0.10)" : "rgba(59,130,246,0.10)",
                  color: qubaRolloutMode === "active" ? "var(--q-green, #22c55e)" : "var(--q-blue, #007aff)",
                }}
              >
                {qubaRolloutMode}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {brainDiagnosticsLoading && (
              <span className="flex items-center gap-1 text-[10px] text-gray-400">
                <Loader2 className="w-3 h-3 animate-spin" />
                Kontrol ediliyor
              </span>
            )}
            {(qubaBrainProfile || brainDiagnosticsError) && (
              <button
                type="button"
                onClick={() => setShowBrainDetails(prev => !prev)}
                className="flex items-center gap-1 rounded-full border px-2 py-1 text-[9px] font-bold text-gray-500 hover:bg-gray-50"
                style={{ borderColor: "var(--q-border-default)" }}
              >
                {showBrainDetails ? "Detayları Gizle" : "Detayları Göster"}
                <ChevronDown className={`h-3 w-3 transition-transform ${showBrainDetails ? "rotate-180" : ""}`} />
              </button>
            )}
          </div>
        </div>

        {brainDiagnosticsError && showBrainDetails ? (
          <div className="text-[11px] text-red-500 bg-red-50 border rounded-lg px-3 py-2" style={{ borderColor: "rgba(239,68,68,0.2)" }}>
            {brainDiagnosticsError}
          </div>
        ) : qubaBrainProfile && showBrainDetails ? (
          <div className="max-h-[240px] overflow-y-auto pr-1 space-y-2">
            <div className="grid grid-cols-2 gap-2 text-[10px]">
              <div className="rounded-lg border px-2.5 py-2 bg-gray-50" style={{ borderColor: "var(--q-border-default)" }}>
                <div className="font-bold text-gray-400 mb-0.5">SEKTÖR</div>
                <div className="font-semibold text-gray-700">{qubaBrainProfile.industry || "Belirsiz"}</div>
              </div>
              <div className="rounded-lg border px-2.5 py-2 bg-gray-50" style={{ borderColor: "var(--q-border-default)" }}>
                <div className="font-bold text-gray-400 mb-0.5">KURUM</div>
                <div className="font-semibold text-gray-700 truncate">{qubaBrainProfile.identity?.organizationName || "Eksik"}</div>
              </div>
              <div className="rounded-lg border px-2.5 py-2 bg-gray-50" style={{ borderColor: "var(--q-border-default)" }}>
                <div className="font-bold text-gray-400 mb-0.5">DOKTOR LİSTESİ</div>
                <div className="font-semibold text-gray-700">{qubaBrainProfile.knowledge?.doctorDirectoryAvailable ? "Var" : "Yok / algılanmadı"}</div>
              </div>
              <div className="rounded-lg border px-2.5 py-2 bg-gray-50" style={{ borderColor: "var(--q-border-default)" }}>
                <div className="font-bold text-gray-400 mb-0.5">CANLI DİREKTİF</div>
                <div className="font-semibold text-gray-700">{qubaBrainProfile.rollout?.liveDirectiveEnabled ? "Açık" : "Kapalı"}</div>
              </div>
              <div className="rounded-lg border px-2.5 py-2 bg-gray-50" style={{ borderColor: "var(--q-border-default)" }}>
                <div className="font-bold text-gray-400 mb-0.5">PROMPT SAĞLIĞI</div>
                <div className="font-semibold text-gray-700">
                  {qubaPromptBudget?.status ? `${qubaPromptBudget.status} · ${Number(qubaPromptBudget.totalStaticChars || 0).toLocaleString()} krk.` : "Ölçülmedi"}
                </div>
              </div>
            </div>
            {qubaReadiness && (
              <div>
                <div className="text-[9px] font-bold text-gray-400 mb-1">CANLIYA HAZIRLIK</div>
                <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${Math.max(0, Math.min(100, qubaReadiness.score || 0))}%`,
                      backgroundColor: qubaReadiness.status === "ready" ? "var(--q-green, #22c55e)" : "var(--q-yellow, #f59e0b)",
                    }}
                  />
                </div>
              </div>
            )}
            <div>
              <div className="text-[9px] font-bold text-gray-400 mb-1">YETENEKLER</div>
              {renderCompactList(qubaCapabilities, "Henüz algılanmadı")}
            </div>
            {(qubaBlockers.length > 0 || qubaRecommendations.length > 0) && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                <div>
                  <div className="text-[9px] font-bold text-gray-400 mb-1">CANLI BLOKER</div>
                  {renderCompactList(qubaBlockers)}
                </div>
                <div>
                  <div className="text-[9px] font-bold text-gray-400 mb-1">ÖNERİ</div>
                  {renderCompactList(qubaRecommendations)}
                </div>
              </div>
            )}
            {(qubaMissingSetup.length > 0 || qubaWarnings.length > 0) && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                <div>
                  <div className="text-[9px] font-bold text-gray-400 mb-1">EKSİK KURULUM</div>
                  {renderCompactList(qubaMissingSetup)}
                </div>
                <div>
                  <div className="text-[9px] font-bold text-gray-400 mb-1">UYARILAR</div>
                  {renderCompactList(qubaWarnings)}
                </div>
              </div>
            )}
          </div>
        ) : (
          <p className="text-[11px] text-gray-400">Brain profili henüz yüklenmedi.</p>
        )}
      </div>
      </div>

      {/* Chat Messages Log */}
      <div className="flex-1 overflow-y-auto p-5 space-y-4">
        {messages.map((m, idx) => {
          const isUser = m.role === 'user';
          return (
            <div key={idx} className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                  isUser 
                    ? 'bg-blue-600 text-white font-medium rounded-tr-sm' 
                    : 'bg-white text-gray-800 border rounded-tl-sm shadow-sm'
                }`}
                style={{
                  borderColor: isUser ? 'transparent' : 'var(--q-border-default)',
                  backgroundColor: isUser ? (activeChannel.color || 'var(--q-blue)') : '#fff'
                }}
              >
                {!isUser && (
                  <div className="flex items-center gap-1.5 mb-1 text-[10px] font-bold text-gray-400">
                    <Bot className="w-3.5 h-3.5" />
                    <span>{activeChannel.label}</span>
                  </div>
                )}
                <p className="whitespace-pre-wrap">{m.content}</p>
              </div>
            </div>
          );
        })}
        {messages.length === 0 && (
          <div className="h-full flex flex-col items-center justify-center text-center px-6">
            <Bot className="w-12 h-12 mb-3 text-gray-300" />
            <p className="text-xs font-bold text-gray-500 mb-1">Henüz konuşma başlatılmadı</p>
            <p className="text-[11px] text-gray-400 max-w-[200px]">
              Aşağıdaki kutudan ilk mesajı yazarak botun prompt/sistem davranışını test edin.
            </p>
          </div>
        )}
        {(waitingForDelay || testing) && (
          <div className="flex justify-start">
            <div className="bg-white border rounded-2xl rounded-tl-sm px-4 py-3 shadow-sm flex items-center gap-2" style={{ borderColor: 'var(--q-border-default)' }}>
              <Loader2 className="w-4 h-4 animate-spin text-gray-400" />
              <span className="text-xs text-gray-400 font-medium">{waitingForDelay ? "Canlı gecikme bekleniyor..." : "Bot yanıt üretiyor..."}</span>
            </div>
          </div>
        )}
        <div ref={chatEndRef} />
      </div>

      {/* Input Bar */}
      <div className="p-4 border-t bg-white flex items-center gap-2" style={{ borderColor: "var(--q-border-default)" }}>
        <input
          type="text"
          value={testMsg}
          onChange={e => setTestMsg(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') runTest(); }}
          placeholder="Test mesajı yazın... (örn: Merhaba, randevu istiyorum)"
          disabled={testing}
          className="flex-1 px-4 py-2.5 text-sm border rounded-xl outline-none transition-all disabled:opacity-50"
          style={{
            borderColor: "var(--q-border-default)",
            backgroundColor: "rgba(0,0,0,0.02)",
            color: "var(--q-text-primary)"
          }}
        />
        <button
          onClick={runTest}
          disabled={testing || !testMsg.trim()}
          className="p-2.5 text-white rounded-xl flex items-center justify-center disabled:opacity-50 transition-all"
          style={{ backgroundColor: activeChannel.color || 'var(--q-blue)' }}
        >
          {testing ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
        </button>
      </div>

      {/* Brain v2 Response Evaluation */}
      {brainEvaluation && (
        <div className="px-5 py-3 bg-white border-t space-y-2" style={{ borderColor: "var(--q-border-default)" }}>
          <div className="flex items-center gap-2 text-[11px] font-bold" style={{ color: "var(--q-text-primary)" }}>
            <ListChecks
              className="w-4 h-4"
              style={{
                color: brainEvaluation.status === "pass"
                  ? "var(--q-green, #22c55e)"
                  : brainEvaluation.status === "warn"
                    ? "var(--q-yellow, #f59e0b)"
                    : "var(--q-red, #ef4444)",
              }}
            />
            <span>Brain v2 Yanıt Kalitesi</span>
            <span
              className="px-1.5 py-0.5 rounded text-[9px] uppercase"
              style={{
                backgroundColor: brainEvaluation.status === "pass"
                  ? "rgba(34,197,94,0.10)"
                  : brainEvaluation.status === "warn"
                    ? "rgba(245,158,11,0.12)"
                    : "rgba(239,68,68,0.10)",
                color: brainEvaluation.status === "pass"
                  ? "var(--q-green, #22c55e)"
                  : brainEvaluation.status === "warn"
                    ? "var(--q-yellow, #f59e0b)"
                    : "var(--q-red, #ef4444)",
              }}
            >
              {brainEvaluation.status} · {brainEvaluation.score}/100
            </span>
          </div>
          <p className="text-[11px] leading-relaxed text-gray-500">{brainEvaluation.summary}</p>
          <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
            <div
              className="h-full rounded-full"
              style={{
                width: `${Math.max(0, Math.min(100, brainEvaluation.score || 0))}%`,
                backgroundColor: brainEvaluation.status === "pass"
                  ? "var(--q-green, #22c55e)"
                  : brainEvaluation.status === "warn"
                    ? "var(--q-yellow, #f59e0b)"
                    : "var(--q-red, #ef4444)",
              }}
            />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            <div>
              <div className="text-[9px] font-bold text-gray-400 mb-1">EKSİK CEVAP</div>
              {renderCompactList(brainEvaluation.missingAnswers)}
            </div>
            <div>
              <div className="text-[9px] font-bold text-gray-400 mb-1">YASAK/KRİTİK</div>
              {renderCompactList(brainEvaluation.forbiddenHits)}
            </div>
            <div>
              <div className="text-[9px] font-bold text-gray-400 mb-1">TON UYARISI</div>
              {renderCompactList(brainEvaluation.qualityWarnings)}
            </div>
          </div>
        </div>
      )}

      {/* Brain v2 Shadow Diagnostics */}
      {brainPlan && (
        <div className="px-5 py-3 bg-white border-t space-y-2" style={{ borderColor: "var(--q-border-default)" }}>
          <div className="flex items-center gap-2 text-[11px] font-bold" style={{ color: "var(--q-text-primary)" }}>
            <ListChecks className="w-4 h-4" style={{ color: "var(--q-blue, #007aff)" }} />
            <span>Brain v2 Gölge Planı</span>
            <span className="px-1.5 py-0.5 rounded bg-blue-50 text-[9px]" style={{ color: "var(--q-blue, #007aff)" }}>
              Sadece test cevabına uygulanır
            </span>
          </div>
          <p className="text-[11px] leading-relaxed text-gray-500">{brainPlan.summary}</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <div>
              <div className="text-[9px] font-bold text-gray-400 mb-1">ALGILANAN BAŞLIKLAR</div>
              {renderCompactList(brainPlan.detectedIntents)}
            </div>
            <div>
              <div className="text-[9px] font-bold text-gray-400 mb-1">CEVAPTA KAÇIRMA</div>
              {renderCompactList(brainPlan.mustAnswer)}
            </div>
            <div>
              <div className="text-[9px] font-bold text-gray-400 mb-1">RİSKLER</div>
              {renderCompactList(brainPlan.riskFlags)}
            </div>
            <div>
              <div className="text-[9px] font-bold text-gray-400 mb-1">EKSİK BİLGİ</div>
              {renderCompactList(brainPlan.missingInformation)}
            </div>
          </div>
          {brainPlan.recommendedFollowUp && (
            <div className="text-[11px] leading-relaxed text-gray-600 bg-gray-50 border rounded-lg px-3 py-2" style={{ borderColor: "var(--q-border-default)" }}>
              <span className="font-bold">Önerilen yön:</span> {brainPlan.recommendedFollowUp}
            </div>
          )}
        </div>
      )}

      {/* Debug Info Footer */}
      {debugMeta && (
        <div className="px-5 py-2.5 bg-gray-50 border-t flex flex-wrap gap-x-4 gap-y-1.5 text-[10px] text-gray-400 font-mono font-medium" style={{ borderColor: "var(--q-border-default)" }}>
          <span>MODEL: {debugMeta.model}</span>
          <span>PROMPT SÜRÜMÜ: v{debugMeta.promptVersion}</span>
          <span>SÜRE: {debugMeta.latencyMs}ms</span>
          <span>STİL: {debugMeta.responseStyle}</span>
          <span>MAX TOKEN: {debugMeta.maxResponseTokens}</span>
          <span>GECİKME: {debugMeta.responseDelaySeconds}sn</span>
        </div>
      )}
    </div>
  );
}
