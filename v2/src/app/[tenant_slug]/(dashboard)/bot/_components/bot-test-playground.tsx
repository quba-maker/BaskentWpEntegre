import { useState, useRef, useEffect } from "react";
import { FlaskConical, Send, Loader2, Bot, Trash2, ShieldCheck } from "lucide-react";
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
    channelId?: string
  ) => Promise<{ success: boolean; reply: string; metadata?: any }>;
}

export function BotTestPlayground({ activeChannel, botGroupId, onTestPrompt }: BotTestPlaygroundProps) {
  const [testMsg, setTestMsg] = useState("");
  const [messages, setMessages] = useState<{ role: 'user' | 'assistant'; content: string }[]>([]);
  const [testing, setTesting] = useState(false);
  const [debugMeta, setDebugMeta] = useState<any>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom of chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Reset chat when botGroupId changes (changing selected bot)
  useEffect(() => {
    setMessages([]);
    setDebugMeta(null);
  }, [botGroupId]);

  const runTest = async () => {
    const trimmed = testMsg.trim();
    if (!trimmed || testing) return;
    
    // Add user message to history
    const updatedMessages = [...messages, { role: 'user' as const, content: trimmed }];
    setMessages(updatedMessages);
    setTestMsg("");
    setTesting(true);
    
    // Limit test history to last 20 messages
    const historyPayload = updatedMessages.slice(-20);
    
    try {
      const result = await onTestPrompt(botGroupId, historyPayload);
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
  };

  const clearHistory = () => {
    setMessages([]);
    setDebugMeta(null);
  };

  return (
    <div className="mt-8 mb-8 flex flex-col h-[650px] border rounded-2xl bg-[#f8f9fa] overflow-hidden" style={{ borderColor: "var(--q-border-default)" }}>
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b bg-white" style={{ borderColor: "var(--q-border-default)" }}>
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

      {/* Sandbox Alert Info Banner */}
      <div className="px-5 py-2.5 bg-blue-50/50 border-b flex items-start gap-2 text-[11px]" style={{ borderColor: "var(--q-border-default)", color: "var(--q-blue, #007aff)" }}>
        <ShieldCheck className="w-4 h-4 flex-shrink-0 mt-0.5" />
        <p className="leading-relaxed">
          <strong>Sandbox Modu:</strong> Mesajlar DB&apos;ye yazılmaz, gerçek kullanıcılara gönderilmez ve asistan araçları dry-run çalıştırılır. <span className="opacity-75">Sandbox testte gerçek gecikme bekletilmez; canlı inbound akışında uygulanır.</span>
        </p>
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
        {testing && (
          <div className="flex justify-start">
            <div className="bg-white border rounded-2xl rounded-tl-sm px-4 py-3 shadow-sm flex items-center gap-2" style={{ borderColor: 'var(--q-border-default)' }}>
              <Loader2 className="w-4 h-4 animate-spin text-gray-400" />
              <span className="text-xs text-gray-400 font-medium">Bot yanıt üretiyor...</span>
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
