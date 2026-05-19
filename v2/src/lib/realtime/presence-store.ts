import { create } from "zustand";

export type AgentType = "human" | "ai";

interface TypingState {
  isTyping: boolean;
  agentType: AgentType;
  lastUpdatedAt: number;
}

interface PresenceStore {
  // Channel -> ClientId -> TypingState
  typingStates: Record<string, Record<string, TypingState>>;
  
  setTyping: (channel: string, clientId: string, isTyping: boolean, agentType?: AgentType) => void;
  cleanupStale: (ttlMs: number) => void;
  getTypingClients: (channel: string) => { clientId: string; agentType: AgentType }[];
}

export const usePresenceStore = create<PresenceStore>((set, get) => ({
  typingStates: {},

  setTyping: (channel, clientId, isTyping, agentType = "human") => {
    set((state) => {
      const channelState = state.typingStates[channel] || {};
      
      if (!isTyping) {
        // Remove from typing state if not typing
        const newState = { ...channelState };
        delete newState[clientId];
        
        return {
          typingStates: {
            ...state.typingStates,
            [channel]: newState,
          }
        };
      }

      return {
        typingStates: {
          ...state.typingStates,
          [channel]: {
            ...channelState,
            [clientId]: {
              isTyping: true,
              agentType,
              lastUpdatedAt: Date.now(),
            }
          }
        }
      };
    });
  },

  cleanupStale: (ttlMs: number) => {
    const now = Date.now();
    set((state) => {
      let hasChanges = false;
      const nextStates = { ...state.typingStates };

      for (const channel in nextStates) {
        const channelState = nextStates[channel];
        const newChannelState = { ...channelState };
        let channelChanged = false;

        for (const clientId in newChannelState) {
          if (now - newChannelState[clientId].lastUpdatedAt > ttlMs) {
            delete newChannelState[clientId]; // Stale state evicted (Ghost typing prevented)
            channelChanged = true;
            hasChanges = true;
          }
        }

        if (channelChanged) {
          nextStates[channel] = newChannelState;
        }
      }

      return hasChanges ? { typingStates: nextStates } : state;
    });
  },

  getTypingClients: (channel: string) => {
    const channelState = get().typingStates[channel] || {};
    return Object.entries(channelState).map(([clientId, state]) => ({
      clientId,
      agentType: state.agentType,
    }));
  }
}));

// Background Daemon: Stale Presence Eviction (Ghost Typing Prevention)
// Automatically cleans up ghost typing indicators if socket drops or client disconnects ungracefully.
if (typeof window !== "undefined") {
  setInterval(() => {
    usePresenceStore.getState().cleanupStale(3000); // 3 seconds TTL
  }, 1000); // Check every 1 second
}
