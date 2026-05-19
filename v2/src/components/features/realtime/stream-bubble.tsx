import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles, Clock, Zap, Activity } from "lucide-react";
import { StreamMetrics, StreamingState } from "@/lib/ai/streaming/types";

interface StreamBubbleProps {
  isStreaming: boolean;
  state: StreamingState;
  content: string;
  metrics?: Partial<StreamMetrics>;
  showMetrics?: boolean; // Toggled via Developer Mode
}

export function StreamBubble({ isStreaming, state, content, metrics, showMetrics = true }: StreamBubbleProps) {
  // If we are completely idle and have no content, don't render the bubble shell yet.
  if (state === 'idle') return null;

  // Render the thinking shimmer before content starts
  const isThinking = state === 'thinking';
  // Render live cursor if streaming
  const showCursor = state === 'streaming' || state === 'thinking';

  return (
    <div className="flex w-full justify-start mb-6">
      <motion.div
        layout
        initial={{ opacity: 0, y: 15, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        transition={{ duration: 0.4, ease: [0.23, 1, 0.32, 1] }}
        className="relative max-w-[95%] md:max-w-[80%] flex flex-col"
      >
        <div 
          className="relative px-4 py-3 shadow-sm rounded-2xl rounded-tl-sm"
          style={{ 
            background: "var(--q-chat-in)", 
            color: "var(--q-text-primary)",
            border: "1px solid rgba(0,0,0,0.03)"
          }}
        >
          {/* AI Header */}
          <div className="flex items-center gap-1.5 mb-2 opacity-80">
            <Sparkles className="w-3.5 h-3.5" style={{ color: "var(--q-purple)" }} />
            <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--q-purple)" }}>
              AI {isStreaming ? "ÜRETİYOR..." : ""}
            </span>
          </div>

          {/* Typography Layer */}
          <div className="text-[15px] font-medium whitespace-pre-wrap" style={{ lineHeight: "1.6", letterSpacing: "-0.01em" }}>
            {content}
            
            {/* Thinking Skeleton */}
            {isThinking && (
              <span className="inline-block w-8 h-4 ml-1 rounded-sm bg-gray-200/60 animate-pulse" />
            )}

            {/* Live Cursor */}
            <AnimatePresence>
              {showCursor && !isThinking && (
                <motion.span
                  initial={{ opacity: 0 }}
                  animate={{ opacity: [1, 0, 1] }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.8, repeat: Infinity, ease: "linear" }}
                  className="inline-block w-2 h-4 ml-0.5 align-middle bg-slate-400 rounded-sm"
                />
              )}
            </AnimatePresence>
          </div>

          {/* Interrupted/Failed state messages */}
          {(state === 'interrupted' || state === 'failed') && (
            <div className="mt-3 text-[12px] font-medium px-3 py-1.5 rounded-lg border border-red-200/50 bg-red-50/50 text-red-600 flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
              {state === 'interrupted' ? "AI yanıtı durduruldu." : "AI yanıt oluştururken hata oluştu."}
            </div>
          )}
        </div>

        {/* Developer Metrics Badge */}
        <AnimatePresence>
          {showMetrics && metrics && state === 'completed' && (
            <motion.div
              initial={{ opacity: 0, y: -5, height: 0 }}
              animate={{ opacity: 1, y: 0, height: "auto" }}
              className="mt-1 flex items-center gap-3 px-1 text-[10px] font-mono text-gray-400"
            >
              <div className="flex items-center gap-1" title="Time to First Token">
                <Clock className="w-3 h-3" />
                {metrics.firstTokenLatencyMs ? `${metrics.firstTokenLatencyMs}ms TTFT` : '--'}
              </div>
              <div className="flex items-center gap-1" title="Tokens Per Second">
                <Activity className="w-3 h-3" />
                {metrics.tokensPerSecond ? `${metrics.tokensPerSecond.toFixed(1)} t/s` : '--'}
              </div>
              <div className="flex items-center gap-1" title="Total Response Time">
                <Zap className="w-3 h-3" />
                {metrics.completionLatencyMs ? `${(metrics.completionLatencyMs / 1000).toFixed(2)}s` : '--'}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

      </motion.div>
    </div>
  );
}
