import { create } from 'zustand';

export type InboxModalType = 'call_plan' | 'appointment_plan' | 'reminder_plan' | 'form_detail' | 'draft_preview' | 'bot_handoff';

export interface ActiveModalState {
  modalType: InboxModalType;
  conversationId: string;
  patientName?: string;
  payload?: any;
}

interface InboxState {
  activePhone: string | null;
  activeContact: any | null;
  mobileView: 'list' | 'chat' | 'crm';
  setActiveContact: (phone: string, contactData: any) => void;
  updateActiveContact: (contactData: any) => void;
  setMobileView: (view: 'list' | 'chat' | 'crm') => void;
  
  // Scoped modal states
  activeModal: ActiveModalState | null;
  setActiveModal: (modal: ActiveModalState | null) => void;
  
  // Bulk selection states
  isSelectionMode: boolean;
  selectedIds: string[];
  setSelectionMode: (val: boolean) => void;
  toggleSelected: (id: string) => void;
  setSelectedIds: (ids: string[]) => void;
  clearSelection: () => void;

  // Sidebar collapse states
  isSidebarCollapsed: boolean;
  toggleSidebar: () => void;
  setSidebarCollapsed: (val: boolean) => void;

  // Manual unread lock states
  manualUnreadLocks: Record<string, number>;
  addManualUnreadLock: (conversationId: string, durationMs?: number) => void;
  clearManualUnreadLock: (conversationId: string) => void;
}

export const useInboxStore = create<InboxState>((set) => ({
  activePhone: null,
  activeContact: null,
  mobileView: 'list',
  setActiveContact: (phone, contactData) => set((state) => {
    const nextLocks = { ...state.manualUnreadLocks };
    if (state.activePhone !== phone) {
      delete nextLocks[phone];
    }
    return {
      activePhone: phone,
      activeContact: contactData,
      mobileView: 'chat',
      activeModal: null,
      manualUnreadLocks: nextLocks
    };
  }),
  updateActiveContact: (contactData) => set({ activeContact: contactData }),
  setMobileView: (view) => set({ mobileView: view }),
  
  // Scoped modal state initial value and setter
  activeModal: null,
  setActiveModal: (modal) => set({ activeModal: modal }),
  
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

  // Sidebar collapse initial values and actions
  isSidebarCollapsed: false,
  toggleSidebar: () => set((state) => {
    const nextVal = !state.isSidebarCollapsed;
    if (typeof window !== 'undefined') {
      localStorage.setItem('q_sidebar_collapsed', String(nextVal));
    }
    return { isSidebarCollapsed: nextVal };
  }),
  setSidebarCollapsed: (val) => set({ isSidebarCollapsed: val }),

  // Manual unread lock actions
  manualUnreadLocks: {},
  addManualUnreadLock: (conversationId, durationMs = 10000) => set((state) => ({
    manualUnreadLocks: {
      ...state.manualUnreadLocks,
      [conversationId]: Date.now() + durationMs
    }
  })),
  clearManualUnreadLock: (conversationId) => set((state) => {
    const next = { ...state.manualUnreadLocks };
    delete next[conversationId];
    return { manualUnreadLocks: next };
  }),
}));

// Mutation tracking for stale overwrite guard
export const lastMutationTimes: Record<string, number> = {};

export function registerUnreadMutation(conversationId: string) {
  lastMutationTimes[conversationId] = Date.now();
}

export function clearUnreadMutation(conversationId: string) {
  delete lastMutationTimes[conversationId];
}

export let lastLocalUnreadBadgeCount = 0;
export function setLastLocalUnreadBadgeCount(val: number) {
  lastLocalUnreadBadgeCount = val;
}
