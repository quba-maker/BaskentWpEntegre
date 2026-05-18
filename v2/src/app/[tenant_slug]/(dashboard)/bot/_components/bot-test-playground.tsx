import { useState } from "react";
import { FlaskConical, Send, Loader2, Bot } from "lucide-react";
import { type BotChannel } from "./shared";

// ==========================================
// BOT TEST PLAYGROUND
// Authority: Prompt testing & simulation
// Data owner: testBotPrompt() action
// ==========================================

interface BotTestPlaygroundProps {
  activeChannel: BotChannel;
  currentPrompt: string;
  activeTab: string;
  onTestPrompt: (prompt: string, message: string, channel: string) => Promise<{ reply: string }>;
}

export function BotTestPlayground({ activeChannel, currentPrompt, activeTab, onTestPrompt }: BotTestPlaygroundProps) {
  const [testMsg, setTestMsg] = useState("");
  const [testReply, setTestReply] = useState("");
  const [testing, setTesting] = useState(false);

  const runTest = async () => {
    if (!testMsg.trim() || testing) return;
    setTesting(true);
    setTestReply('');
    const result = await onTestPrompt(currentPrompt, testMsg, activeTab);
    setTestReply(result.reply);
    setTesting(false);
  };

  return (
    <div className="mt-8 mb-8">
      <h2 className="text-lg font-bold mb-4 flex items-center gap-2" style={{ color: "var(--q-text-primary)" }}>
        <FlaskConical className="w-5 h-5" style={{ color: "var(--q-text-secondary)" }} />
        Bot Test
      </h2>
      <div className="bg-white rounded-2xl border shadow-sm p-5" style={{ borderColor: "var(--q-border-default)" }}>
        {/* Active channel indicator */}
        <div className="flex items-center gap-2 mb-4">
          <div className="w-6 h-6 rounded-lg flex items-center justify-center" style={{backgroundColor: `${activeChannel.color}15`}}>
            <activeChannel.icon className="w-3 h-3" style={{color: activeChannel.color}} />
          </div>
          <p className="text-xs" style={{ color: "var(--q-text-secondary)" }}>
            <span className="font-bold" style={{ color: "var(--q-text-primary)" }}>{activeChannel.label}</span> prompt&apos;unu test ediyorsunuz. Yukarıdaki sekmelerden kanal değiştirin.
          </p>
        </div>
        
        <div className="flex items-center gap-2 mb-4">
          <input
            type="text" value={testMsg}
            onChange={e => setTestMsg(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') runTest(); }}
            placeholder="Test mesajı yazın... (örn: Bel fıtığım var)"
            className="flex-1 px-4 py-2.5 text-sm border-0 rounded-xl outline-none"
            style={{ backgroundColor: "rgba(0,0,0,0.03)", color: "var(--q-text-primary)" }}
          />
          <button
            onClick={runTest}
            disabled={testing || !testMsg.trim()}
            className="px-4 py-2.5 text-white rounded-xl text-sm font-bold flex items-center gap-1.5 disabled:opacity-50"
            style={{backgroundColor: activeChannel.color}}
          >
            {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            Test Et
          </button>
        </div>
        {testReply && (
          <div className="p-4 rounded-xl border" style={{ backgroundColor: "var(--q-bg-secondary)", borderColor: "var(--q-border-default)" }}>
            <div className="flex items-center gap-2 mb-2">
              <div className="w-5 h-5 rounded-full flex items-center justify-center" style={{ background: "linear-gradient(135deg, var(--q-purple), var(--q-blue))" }}>
                <Bot className="w-3 h-3 text-white" />
              </div>
              <p className="text-[11px] font-bold" style={{ color: "var(--q-text-secondary)" }}>Bot Yanıtı ({activeChannel.label})</p>
            </div>
            <p className="text-sm leading-relaxed whitespace-pre-wrap" style={{ color: "var(--q-text-primary)" }}>{testReply}</p>
          </div>
        )}
      </div>
    </div>
  );
}
