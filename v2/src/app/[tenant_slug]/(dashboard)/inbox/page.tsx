import { ContactList } from "@/components/features/inbox/contact-list";
import { ChatArea } from "@/components/features/inbox/chat-area";
import { CrmPanel } from "@/components/features/inbox/crm-panel";

export default function InboxPage() {
  return (
    <div className="flex w-full h-full overflow-hidden bg-background relative">
      <ContactList />
      <ChatArea />
      <CrmPanel />
    </div>
  );
}
