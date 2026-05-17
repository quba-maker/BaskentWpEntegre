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
      <h2 className="text-lg font-bold text-[#1D1D1F] mb-4 flex items-center gap-2">
        <FlaskConical className="w-5 h-5 text-[#86868B]" />
        Bot Test
      </h2>
      <div className="bg-white rounded-2xl border border-black/5 shadow-sm p-5">
        {/* Active channel indicator */}
        <div className="flex items-center gap-2 mb-4">
          <div className="w-6 h-6 rounded-lg flex items-center justify-center" style={{backgroundColor: `${activeChannel.color}15`}}>
            <activeChannel.icon className="w-3 h-3" style={{color: activeChannel.color}} />
          </div>
          <p className="text-xs text-[#86868B]">
            <span className="font-bold text-[#1D1D1F]">{activeChannel.label}</span> prompt&apos;unu test ediyorsunuz. Yukarıdaki sekmelerden kanal değiştirin.
          </p>
        </div>
        
        <div className="flex items-center gap-2 mb-4">
          <input
            type="text" value={testMsg}
            onChange={e => setTestMsg(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') runTest(); }}
            placeholder="Test mesajı yazın... (örn: Bel fıtığım var)"
            className="flex-1 px-4 py-2.5 text-sm bg-black/[0.03] border-0 rounded-xl outline-none placeholder:text-[#C7C7CC]"
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
          <div className="p-4 bg-[#F5F5F7] rounded-xl border border-black/5">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-5 h-5 rounded-full bg-gradient-to-br from-[#5856D6] to-[#007AFF] flex items-center justify-center">
                <Bot className="w-3 h-3 text-white" />
              </div>
              <p className="text-[11px] font-bold text-[#86868B]">Bot Yanıtı ({activeChannel.label})</p>
            </div>
            <p className="text-sm text-[#1D1D1F] leading-relaxed whitespace-pre-wrap">{testReply}</p>
          </div>
        )}
      </div>
    </div>
  );
}
