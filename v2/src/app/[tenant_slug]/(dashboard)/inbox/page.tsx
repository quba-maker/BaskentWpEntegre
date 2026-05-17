import { ContactRail } from "@/components/features/inbox/contact-list";
import { ConversationViewport } from "@/components/features/inbox/chat-area";
import { ContextPanel } from "@/components/features/inbox/crm-panel";

// ==========================================
// INBOX PAGE — InboxShell
// Architecture: Orchestration layer
//   ContactRail → Navigation system (left)
//   ConversationViewport → Communication surface (center)
//   ContextPanel → Contextual CRM engine (right)
//
// Each panel has:
//   ✅ Independent loading (skeleton-first)
//   ✅ Scroll isolation
//   ✅ Token-native styling (0 HEX)
//   ✅ Motion-governed interaction (q-glass, q-press, q-bubble-in)
//   ✅ Responsive mobile view management via Zustand
// ==========================================

export default function InboxPage() {
  return (
    <div className="flex w-full h-full overflow-hidden relative" style={{ background: "var(--q-bg-secondary)" }}>
      <ContactRail />
      <ConversationViewport />
      <ContextPanel />
    </div>
  );
}
