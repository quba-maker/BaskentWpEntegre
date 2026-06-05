import { create } from 'zustand';

interface InboxState {
  activePhone: string | null;
  activeContact: any | null;
  mobileView: 'list' | 'chat' | 'crm';
  setActiveContact: (phone: string, contactData: any) => void;
  updateActiveContact: (contactData: any) => void;
  setMobileView: (view: 'list' | 'chat' | 'crm') => void;
  
  // Bulk selection states
  isSelectionMode: boolean;
  selectedIds: string[];
  setSelectionMode: (val: boolean) => void;
  toggleSelected: (id: string) => void;
  setSelectedIds: (ids: string[]) => void;
  clearSelection: () => void;
}

export const useInboxStore = create<InboxState>((set) => ({
  activePhone: null,
  activeContact: null,
  mobileView: 'list',
  setActiveContact: (phone, contactData) => set({ activePhone: phone, activeContact: contactData, mobileView: 'chat' }),
  updateActiveContact: (contactData) => set({ activeContact: contactData }),
  setMobileView: (view) => set({ mobileView: view }),
  
  // Bulk selection initial values and actions
  isSelectionMode: false,
  selectedIds: [],
  setSelectionMode: (val) => set({ isSelectionMode: val, selectedIds: [] }),
  toggleSelected: (id) => set((state) => {
    const next = state.selectedIds.includes(id)
      ? state.selectedIds.filter(x => x !== id)
      : [...state.selectedIds, id];
    return { selectedIds: next };
  }),
  setSelectedIds: (ids) => set({ selectedIds: ids }),
  clearSelection: () => set({ selectedIds: [], isSelectionMode: false }),
}));
