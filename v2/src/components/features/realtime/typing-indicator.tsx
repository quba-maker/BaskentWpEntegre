import { motion, AnimatePresence } from "framer-motion";
import { AgentType } from "@/lib/realtime/presence-store";

interface TypingIndicatorProps {
  typingClients: { clientId: string; agentType: AgentType }[];
}

export function TypingIndicator({ typingClients }: TypingIndicatorProps) {
  const isTyping = typingClients.length > 0;
  
  // Pick the first client, prioritizing AI if multiple are typing
  const activeClient = typingClients.find(c => c.agentType === "ai") || typingClients[0];

  return (
    <div className="h-8 flex items-end px-4 overflow-hidden"> 
      {/* Reserved height strategy: Zero layout shift when element enters/leaves */}
      <AnimatePresence>
        {isTyping && activeClient && (
          <motion.div
            initial={{ opacity: 0, y: 10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 5, scale: 0.95 }}
            transition={{ duration: 0.3, ease: [0.23, 1, 0.32, 1] }} // Apple-like ease-out
            className="origin-bottom-left"
          >
            {activeClient.agentType === "human" ? (
              <HumanTyping />
            ) : (
              <AITyping />
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function HumanTyping() {
  return (
    <div className="flex items-center gap-1 px-3 py-2 bg-gray-100 rounded-2xl rounded-bl-sm w-fit shadow-sm border border-gray-200/50">
      <motion.div
        className="w-1.5 h-1.5 bg-gray-400 rounded-full"
        animate={{ y: [0, -3, 0], opacity: [0.4, 1, 0.4] }}
        transition={{ duration: 0.8, repeat: Infinity, ease: "easeInOut", delay: 0 }}
      />
      <motion.div
        className="w-1.5 h-1.5 bg-gray-400 rounded-full"
        animate={{ y: [0, -3, 0], opacity: [0.4, 1, 0.4] }}
        transition={{ duration: 0.8, repeat: Infinity, ease: "easeInOut", delay: 0.15 }}
      />
      <motion.div
        className="w-1.5 h-1.5 bg-gray-400 rounded-full"
        animate={{ y: [0, -3, 0], opacity: [0.4, 1, 0.4] }}
        transition={{ duration: 0.8, repeat: Infinity, ease: "easeInOut", delay: 0.3 }}
      />
    </div>
  );
}

function AITyping() {
  return (
    <div className="flex items-center gap-2 text-xs font-medium text-[--q-brand] bg-[--q-brand]/5 px-3 py-2 rounded-2xl rounded-bl-sm w-fit border border-[--q-brand]/20 shadow-sm">
      <motion.div
        animate={{ 
          rotate: [0, 15, -15, 0],
          scale: [1, 1.1, 1]
        }}
        transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
        className="text-[10px]"
      >
        ✨
      </motion.div>
      <span className="bg-clip-text text-transparent bg-gradient-to-r from-[--q-brand] to-indigo-500 animate-pulse opacity-90">
        AI üretiyor...
      </span>
    </div>
  );
}
