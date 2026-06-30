import { useState, useRef, useEffect } from "react";
import { FlaskConical, Send, Loader2, Bot, Trash2, ShieldCheck, ListChecks, FileText, ChevronDown } from "lucide-react";
import { type BotChannel } from "./shared";

// ==========================================
// BOT TEST PLAYGROUND (V3 Single Prompt Sandbox)
// Authority: Prompt testing & simulation
// Data owner: testBotPrompt() action
// ==========================================

interface BotTestPlaygroundProps {
  activeChannel: BotChannel;
  botGroupId: string;
  currentAiSettings?: {
    model?: string | null;
    responseStyle?: string | null;
    responseDelaySeconds?: number | null;
    maxResponseTokens?: number | null;
  };
  onTestPrompt: (
    botGroupId: string,
    messages: { role: 'user' | 'assistant'; content: string }[],
    channelId?: string,
    options?: {
      sandboxForm?: {
        formName?: string;
        rawText?: string;
      } | null;
      sandboxBrainMode?: 'legacy' | 'v2';
      sandboxModelOverride?: string | null;
    }
  ) => Promise<{ success: boolean; reply: string; metadata?: any }>;
  onGetBrainDiagnostics?: (
    botGroupId: string
  ) => Promise<{ success: boolean; metadata?: any; error?: string }>;
}

const MODEL_LABELS: Record<string, string> = {
  "gemini-3.5-flash": "Gemini 3.5 Flash",
  "gemini-2.5-flash": "Gemini 2.5 Flash",
  "gemini-2.5-flash-lite": "Gemini 2.5 Flash Lite",
  "gemini-2.5-pro": "Gemini 2.5 Pro",
};

const STYLE_LABELS: Record<string, string> = {
  short: "Kısa",
  balanced: "Dengeli",
  detailed: "Detaylı",
};

export function BotTestPlayground({ activeChannel, botGroupId, currentAiSettings, onTestPrompt, onGetBrainDiagnostics }: BotTestPlaygroundProps) {
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
  const inputRef = useRef<HTMLInputElement>(null);
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
    const rawSeconds = Number(debugMeta?.responseDelaySeconds ?? currentAiSettings?.responseDelaySeconds ?? 5);
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
            sandboxBrainMode: 'legacy',
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
    setTimeout(() => inputRef.current?.focus(), 0);
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
    setTimeout(() => inputRef.current?.focus(), 0);
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
      "Önerilen Bölüm: Beyin ve Sinir Cerrahisi",
    ].join("\n"));
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const brainPlan = debugMeta?.brainV2ShadowPlan;
  const v2GateResult = debugMeta?.qubaV2GateResult;
  const brainEvaluation = debugMeta?.brainV2ResponseEvaluation;
  const qubaBrainMeta = debugMeta?.qubaBrainProfile ? debugMeta : brainMeta;
  const qubaBrainProfile = qubaBrainMeta?.qubaBrainProfile;
  const qubaBrainDiagnostics = qubaBrainProfile?.diagnostics;
  const liveAutomation = qubaBrainMeta?.liveAutomation;
  const formAutomation = liveAutomation?.formAutopilot;
  const inboundAutomation = liveAutomation?.inboundAutopilot;
  const recentAutomation = liveAutomation?.recent24h;
  const qubaRolloutMode = qubaBrainMeta?.qubaBrainRolloutMode || qubaBrainProfile?.rollout?.mode;
  const qubaCapabilities: string[] = Array.isArray(qubaBrainDiagnostics?.capabilities) ? qubaBrainDiagnostics.capabilities : [];
  const qubaWarnings: string[] = Array.isArray(qubaBrainDiagnostics?.warnings) ? qubaBrainDiagnostics.warnings : [];
  const qubaMissingSetup: string[] = Array.isArray(qubaBrainDiagnostics?.missingSetup) ? qubaBrainDiagnostics.missingSetup : [];
  const qubaPromptBudget = qubaBrainDiagnostics?.promptBudget;
  const qubaReadiness = qubaBrainProfile?.readiness;
  const qubaBlockers: string[] = Array.isArray(qubaReadiness?.blockers) ? qubaReadiness.blockers : [];
  const qubaRecommendations: string[] = Array.isArray(qubaReadiness?.recommendations) ? qubaReadiness.recommendations : [];
  const qubaSetupHealthy = qubaReadiness ? qubaReadiness.status === "ready" : qubaMissingSetup.length === 0;
  const qubaSandboxEnabled = Boolean(qubaBrainProfile?.rollout?.sandboxDirectiveEnabled);
  const rolloutLabelMap: Record<string, string> = {
    disabled: "Kapalı",
    sandbox: "Sandbox",
    shadow: "Gölge",
    active: "Canlı",
  };
  const rolloutLabel = rolloutLabelMap[String(qubaRolloutMode || "")] || "Yükleniyor";
  const selectedSystemLabel = "V3 Tek Prompt";
  const selectedModel = currentAiSettings?.model || debugMeta?.model || "gemini-3.5-flash";
  const selectedStyle = currentAiSettings?.responseStyle || debugMeta?.responseStyle || "balanced";
  const selectedDelay = currentAiSettings?.responseDelaySeconds ?? debugMeta?.responseDelaySeconds ?? 5;
  const selectedMaxTokens = currentAiSettings?.maxResponseTokens ?? debugMeta?.maxResponseTokens ?? 1000;
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
    <div className="mb-8 flex min-h-[560px] h-[calc(100vh-96px)] max-h-[760px] xl:h-[calc(100vh-48px)] xl:max-h-none flex-col border rounded-2xl bg-[#f8f9fa] overflow-hidden" style={{ borderColor: "var(--q-border-default)" }}>
      {/* Header */}
      <div className="shrink-0 flex items-center justify-between px-5 py-4 border-b bg-white" style={{ borderColor: "var(--q-border-default)" }}>
        <div className="flex items-center gap-2">
          <FlaskConical className="w-5 h-5" style={{ color: "var(--q-text-secondary)" }} />
          <div>
            <h2 className="text-sm font-bold" style={{ color: "var(--q-text-primary)" }}>Bot Test Alanı</h2>
            <p className="text-[10px] text-gray-400">Gerçek hastaya mesaj gitmeden canlıya yakın deneme</p>
          </div>
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

      <div className="shrink-0 max-h-[310px] overflow-y-auto border-b bg-white" style={{ borderColor: "var(--q-border-default)" }}>
        <div className="px-4 py-3 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wide text-gray-400">Test edilecek sistem</div>
              <div className="mt-0.5 text-xs font-bold" style={{ color: "var(--q-text-primary)" }}>
                {selectedSystemLabel} · {sandboxFormEnabled ? "Formlu test" : "Formsuz test"}
              </div>
              <p className="mt-1 text-[10px] leading-relaxed text-gray-400">
                Güvenli test: Gerçek hastaya mesaj gönderilmez. V3 Ana Prompt, Bilgi Bankası ve sol taraftaki AI Ayarları ile denenir; yeni test mesajı gelirse sayaç sıfırlanır ve mesajlar birlikte değerlendirilir.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowBrainDetails(prev => !prev)}
              className="flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1.5 text-[10px] font-bold text-gray-500 hover:bg-gray-50"
              style={{ borderColor: "var(--q-border-default)" }}
            >
              {showBrainDetails ? "Detayı gizle" : "Teknik detay"}
              <ChevronDown className={`h-3 w-3 transition-transform ${showBrainDetails ? "rotate-180" : ""}`} />
            </button>
          </div>

          <div className="rounded-xl border bg-green-50/60 px-3 py-2" style={{ borderColor: "rgba(34,197,94,0.22)" }}>
            <div className="text-[11px] font-bold" style={{ color: "var(--q-text-primary)" }}>V3 Tek Prompt aktif</div>
            <div className="text-[9px] leading-relaxed text-gray-500">
              Bu panelde tek ana prompt ve sol AI Ayarları denenir; canlıya mesaj gitmez.
            </div>
          </div>

          <div className="rounded-xl border bg-white p-3" style={{ borderColor: "var(--q-border-default)" }}>
            <div className="mb-2 text-[10px] font-bold uppercase tracking-wide text-gray-400">Kullanılan AI ayarı</div>
            <div className="grid grid-cols-2 gap-2 text-[10px]">
              <div className="rounded-lg bg-gray-50 px-2.5 py-2">
                <div className="font-bold text-gray-400">MODEL</div>
                <div className="font-semibold text-gray-700">{MODEL_LABELS[selectedModel] || selectedModel}</div>
              </div>
              <div className="rounded-lg bg-gray-50 px-2.5 py-2">
                <div className="font-bold text-gray-400">STİL</div>
                <div className="font-semibold text-gray-700">{STYLE_LABELS[selectedStyle] || selectedStyle}</div>
              </div>
              <div className="rounded-lg bg-gray-50 px-2.5 py-2">
                <div className="font-bold text-gray-400">GECİKME</div>
                <div className="font-semibold text-gray-700">{selectedDelay} sn</div>
              </div>
              <div className="rounded-lg bg-gray-50 px-2.5 py-2">
                <div className="font-bold text-gray-400">YANIT LİMİTİ</div>
                <div className="font-semibold text-gray-700">{selectedMaxTokens} token</div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => {
                setSandboxFormEnabled(false);
                setShowBrainDetails(false);
                setSandboxFormText("");
              }}
              className="rounded-xl border px-3 py-2 text-left transition-all hover:bg-gray-50"
              style={{
                borderColor: !sandboxFormEnabled ? "rgba(0,122,255,0.35)" : "var(--q-border-default)",
                backgroundColor: !sandboxFormEnabled ? "rgba(0,122,255,0.06)" : "#fff",
              }}
            >
              <div className="text-[11px] font-bold" style={{ color: "var(--q-text-primary)" }}>Formsuz Test</div>
              <div className="text-[9px] leading-relaxed text-gray-400">Direkt WhatsApp hastası</div>
            </button>
            <button
              type="button"
              onClick={loadSampleForm}
              className="rounded-xl border px-3 py-2 text-left transition-all hover:bg-gray-50"
              style={{
                borderColor: sandboxFormEnabled ? "rgba(0,122,255,0.35)" : "var(--q-border-default)",
                backgroundColor: sandboxFormEnabled ? "rgba(0,122,255,0.06)" : "#fff",
              }}
            >
              <div className="flex items-center gap-1.5 text-[11px] font-bold" style={{ color: "var(--q-text-primary)" }}>
                <FileText className="h-3.5 w-3.5" />
                Örnek Formla Aç
              </div>
              <div className="text-[9px] leading-relaxed text-gray-400">Canlı form lead akışı</div>
            </button>
          </div>

          {sandboxFormEnabled && (
            <div className="space-y-2 rounded-xl border bg-gray-50 p-2" style={{ borderColor: "var(--q-border-default)" }}>
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
            </div>
          )}
        </div>

        {showBrainDetails && (
          <div className="border-t bg-gray-50 px-4 py-3 space-y-3" style={{ borderColor: "var(--q-border-default)" }}>
            <div>
              <div className="mb-2 flex items-center gap-2">
                <ShieldCheck className="w-4 h-4" style={{ color: inboundAutomation?.liveSending ? "var(--q-green, #22c55e)" : "var(--q-yellow, #f59e0b)" }} />
                <div>
                  <div className="text-[11px] font-bold" style={{ color: "var(--q-text-primary)" }}>Canlı Cevap Durumu</div>
                  <div className="text-[10px] text-gray-400">Test modu ayrı, gerçek hasta gönderimi ayrı izlenir.</div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-xl border px-3 py-2 bg-white" style={{ borderColor: "var(--q-border-default)" }}>
                  <div className="text-[9px] font-bold text-gray-400 mb-0.5">FORM İLK KARŞILAMA</div>
                  <div
                    className="text-[11px] font-bold"
                    style={{ color: formAutomation?.liveSending ? "var(--q-green, #22c55e)" : "var(--q-yellow, #f59e0b)" }}
                  >
                    {formAutomation
                      ? (formAutomation.liveSending ? "Canlı gönderir" : formAutomation.enabled ? "Dry-run / göndermez" : "Kapalı")
                      : "Yükleniyor"}
                  </div>
                </div>
                <div className="rounded-xl border px-3 py-2 bg-white" style={{ borderColor: "var(--q-border-default)" }}>
                  <div className="text-[9px] font-bold text-gray-400 mb-0.5">HASTA MESAJINA CEVAP</div>
                  <div
                    className="text-[11px] font-bold"
                    style={{ color: inboundAutomation?.liveSending ? "var(--q-green, #22c55e)" : "var(--q-yellow, #f59e0b)" }}
                  >
                    {inboundAutomation
                      ? (inboundAutomation.liveSending ? "Canlı cevaplar" : inboundAutomation.enabled ? "Dry-run / göndermez" : "Kapalı")
                      : "Yükleniyor"}
                  </div>
                </div>
              </div>
              {recentAutomation && (
                <div className="mt-2 grid grid-cols-3 gap-2 text-[10px]">
                  <div className="rounded-lg border bg-white px-2.5 py-2" style={{ borderColor: "var(--q-border-default)" }}>
                    <div className="font-bold text-gray-400">BOTTA</div>
                    <div className="font-semibold text-gray-700">{recentAutomation.botConversations || 0}</div>
                  </div>
                  <div className="rounded-lg border bg-white px-2.5 py-2" style={{ borderColor: "var(--q-border-default)" }}>
                    <div className="font-bold text-gray-400">MANUELDE</div>
                    <div className="font-semibold text-gray-700">{recentAutomation.humanConversations || 0}</div>
                  </div>
                  <div className="rounded-lg border bg-white px-2.5 py-2" style={{ borderColor: "var(--q-border-default)" }}>
                    <div className="font-bold text-gray-400">DEVİR SEBEBİ</div>
                    <div className="font-semibold text-gray-700">
                      {(recentAutomation.appEchoTakeovers || 0) > 0
                        ? `${recentAutomation.appEchoTakeovers} manuel echo`
                        : (recentAutomation.circuitBreakerStops || 0) > 0
                          ? `${recentAutomation.circuitBreakerStops} kalite durdu`
                          : "Yok"}
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div>
              <div className="mb-2 flex items-center gap-2 text-[11px] font-bold" style={{ color: "var(--q-text-primary)" }}>
                <ListChecks className="w-4 h-4" style={{ color: qubaSetupHealthy ? "var(--q-green, #22c55e)" : "var(--q-yellow, #f59e0b)" }} />
                <span>V3 Kurulum Kontrolü</span>
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
                    {rolloutLabel}
                  </span>
                )}
                {brainDiagnosticsLoading && (
                  <span className="flex items-center gap-1 text-[10px] text-gray-400">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    Kontrol ediliyor
                  </span>
                )}
              </div>

              {brainDiagnosticsError ? (
                <div className="text-[11px] text-red-500 bg-red-50 border rounded-lg px-3 py-2" style={{ borderColor: "rgba(239,68,68,0.2)" }}>
                  {brainDiagnosticsError}
                </div>
              ) : qubaBrainProfile ? (
                <div className="max-h-[150px] overflow-y-auto pr-1 space-y-2">
                  <div className="grid grid-cols-2 gap-2 text-[10px]">
                    <div className="rounded-lg border px-2.5 py-2 bg-white" style={{ borderColor: "var(--q-border-default)" }}>
                      <div className="font-bold text-gray-400 mb-0.5">SEKTÖR</div>
                      <div className="font-semibold text-gray-700">{qubaBrainProfile.industry || "Belirsiz"}</div>
                    </div>
                    <div className="rounded-lg border px-2.5 py-2 bg-white" style={{ borderColor: "var(--q-border-default)" }}>
                      <div className="font-bold text-gray-400 mb-0.5">KURUM</div>
                      <div className="font-semibold text-gray-700 truncate">{qubaBrainProfile.identity?.organizationName || "Eksik"}</div>
                    </div>
                    <div className="rounded-lg border px-2.5 py-2 bg-white" style={{ borderColor: "var(--q-border-default)" }}>
                      <div className="font-bold text-gray-400 mb-0.5">DOKTOR LİSTESİ</div>
                      <div className="font-semibold text-gray-700">{qubaBrainProfile.knowledge?.doctorDirectoryAvailable ? "Var" : "Yok / algılanmadı"}</div>
                    </div>
                    <div className="rounded-lg border px-2.5 py-2 bg-white" style={{ borderColor: "var(--q-border-default)" }}>
                      <div className="font-bold text-gray-400 mb-0.5">CANLI DİREKTİF</div>
                      <div className="font-semibold text-gray-700">{qubaBrainProfile.rollout?.liveDirectiveEnabled ? "Açık" : "Kapalı"}</div>
                    </div>
                  </div>
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
                  {qubaPromptBudget?.status && (
                    <div>
                      <div className="text-[9px] font-bold text-gray-400 mb-1">PROMPT SAĞLIĞI</div>
                      <p className="text-[10px] text-gray-400">
                        {qubaPromptBudget.status} · {Number(qubaPromptBudget.totalStaticChars || 0).toLocaleString()} krk.
                      </p>
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-[11px] text-gray-400">V3 kontrol bilgisi henüz yüklenmedi.</p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Chat Messages Log */}
      <div className="min-h-0 flex-1 overflow-y-auto p-4 space-y-4">
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

      {/* V3 Response Evaluation */}
      {brainEvaluation && (showBrainDetails || brainEvaluation.status !== "pass") && (
        <div className="shrink-0 max-h-[170px] overflow-y-auto px-5 py-3 bg-white border-t space-y-2" style={{ borderColor: "var(--q-border-default)" }}>
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
            <span>V3 Yanıt Kalitesi</span>
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

      {/* V3 Lightweight Diagnostics */}
      {(v2GateResult || brainPlan) && showBrainDetails && (
        <div className="shrink-0 max-h-[170px] overflow-y-auto px-5 py-3 bg-white border-t space-y-2" style={{ borderColor: "var(--q-border-default)" }}>
          <div className="flex items-center gap-2 text-[11px] font-bold" style={{ color: "var(--q-text-primary)" }}>
            <ListChecks className="w-4 h-4" style={{ color: "var(--q-blue, #007aff)" }} />
            <span>{v2GateResult ? "V3 Hafif Kontrol" : "V3 Yanıt Planı"}</span>
            <span className="px-1.5 py-0.5 rounded bg-blue-50 text-[9px]" style={{ color: "var(--q-blue, #007aff)" }}>
              {v2GateResult ? "Cevabı kilitlemez" : "Sadece test cevabına uygulanır"}
            </span>
          </div>
          <p className="text-[11px] leading-relaxed text-gray-500">{v2GateResult?.summary || brainPlan?.summary}</p>
          {v2GateResult && (
            <div className="rounded-lg border bg-gray-50 px-3 py-2 text-[11px] leading-relaxed text-gray-600" style={{ borderColor: "var(--q-border-default)" }}>
              <span className="font-bold">Kontrol rolü:</span> Cevap yazmaz; sadece risk, doğrulanmış veri ve dry-run aksiyon sonucu üretir.
            </div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <div>
              <div className="text-[9px] font-bold text-gray-400 mb-1">ALGILANAN BAŞLIKLAR</div>
              {renderCompactList(v2GateResult?.detectedIntents || brainPlan?.detectedIntents)}
            </div>
            <div>
              <div className="text-[9px] font-bold text-gray-400 mb-1">CEVAPTA KAÇIRMA</div>
              {renderCompactList(v2GateResult?.mustAnswer || brainPlan?.mustAnswer)}
            </div>
            <div>
              <div className="text-[9px] font-bold text-gray-400 mb-1">RİSKLER</div>
              {renderCompactList(v2GateResult?.riskFlags || brainPlan?.riskFlags)}
            </div>
            <div>
              <div className="text-[9px] font-bold text-gray-400 mb-1">EKSİK BİLGİ</div>
              {renderCompactList(v2GateResult?.missingInformation || brainPlan?.missingInformation)}
            </div>
          </div>
          {v2GateResult?.dryRunActions?.length > 0 && (
            <div>
              <div className="text-[9px] font-bold text-gray-400 mb-1">DRY-RUN AKSİYON</div>
              {renderCompactList(v2GateResult.dryRunActions.map((action: any) => `${action.action}: ${action.status}${action.requiredMissing?.length ? ` (${action.requiredMissing.join(", ")})` : ""}`))}
            </div>
          )}
          {(v2GateResult?.recommendedFollowUp || brainPlan?.recommendedFollowUp) && (
            <div className="text-[11px] leading-relaxed text-gray-600 bg-gray-50 border rounded-lg px-3 py-2" style={{ borderColor: "var(--q-border-default)" }}>
              <span className="font-bold">Önerilen yön:</span> {v2GateResult?.recommendedFollowUp || brainPlan?.recommendedFollowUp}
            </div>
          )}
        </div>
      )}

      {/* Debug Info Footer */}
      {debugMeta && (
        <div className="shrink-0 px-5 py-2.5 bg-gray-50 border-t flex flex-wrap gap-x-4 gap-y-1.5 text-[10px] text-gray-400 font-mono font-medium" style={{ borderColor: "var(--q-border-default)" }}>
          <span>MODEL: {debugMeta.model}</span>
          <span>PROMPT SÜRÜMÜ: v{debugMeta.promptVersion}</span>
          <span>SÜRE: {debugMeta.latencyMs}ms</span>
          <span>STİL: {debugMeta.responseStyle}</span>
          <span>MAX TOKEN: {debugMeta.maxResponseTokens}</span>
          <span>GECİKME: {debugMeta.responseDelaySeconds}sn</span>
          <span>KAYNAK: V3 Tek Prompt</span>
          <span>KONTROL: Hafif güvenlik</span>
          {debugMeta.sandboxSystemPromptChars && <span>TEST PROMPT: {debugMeta.sandboxSystemPromptChars} krk.</span>}
        </div>
      )}

      {/* Input Bar */}
      <form
        className="shrink-0 relative z-20 p-3 border-t bg-white flex items-center gap-2 shadow-[0_-4px_14px_rgba(15,23,42,0.04)]"
        style={{ borderColor: "var(--q-border-default)" }}
        onSubmit={(event) => {
          event.preventDefault();
          runTest();
        }}
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) inputRef.current?.focus();
        }}
      >
        <input
          ref={inputRef}
          aria-label="Sandbox test mesajı"
          name="sandboxTestMessage"
          type="text"
          value={testMsg}
          onChange={e => setTestMsg(e.target.value)}
          placeholder="Test mesajı yazın... (örn: Merhaba, randevu istiyorum)"
          disabled={testing}
          className="min-w-0 flex-1 px-4 py-2.5 text-sm border rounded-xl outline-none transition-all disabled:opacity-50 focus:ring-2 focus:ring-blue-100"
          style={{
            borderColor: "var(--q-border-default)",
            backgroundColor: "rgba(0,0,0,0.02)",
            color: "var(--q-text-primary)",
          }}
        />
        <button
          type="submit"
          aria-label="Sandbox test mesajını gönder"
          disabled={testing || !testMsg.trim()}
          className="shrink-0 p-2.5 text-white rounded-xl flex items-center justify-center disabled:opacity-50 transition-all"
          style={{ backgroundColor: activeChannel.color || 'var(--q-blue)' }}
        >
          {testing ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
        </button>
      </form>
    </div>
  );
}
