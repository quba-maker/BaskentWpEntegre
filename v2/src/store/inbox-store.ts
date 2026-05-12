import { create } from 'zustand';

interface InboxState {
  activePhone: string | null;
  activeContact: any | null;
  mobileView: 'list' | 'chat' | 'crm';
  setActiveContact: (phone: string, contactData: any) => void;
  setMobileView: (view: 'list' | 'chat' | 'crm') => void;
}

export const useInboxStore = create<InboxState>((set) => ({
  activePhone: null,
  activeContact: null,
  mobileView: 'list',
  setActiveContact: (phone, contactData) => set({ activePhone: phone, activeContact: contactData, mobileView: 'chat' }),
  setMobileView: (view) => set({ mobileView: view }),
}));
