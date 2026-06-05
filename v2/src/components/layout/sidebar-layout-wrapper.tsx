"use client";

import { useInboxStore } from "@/store/inbox-store";
import { useEffect, useState } from "react";

export function SidebarLayoutWrapper({ children }: { children: React.ReactNode }) {
  const isSidebarCollapsed = useInboxStore((state) => state.isSidebarCollapsed);
  const toggleSidebar = useInboxStore((state) => state.toggleSidebar);
  const setSidebarCollapsed = useInboxStore((state) => state.setSidebarCollapsed);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    // Load preference from localStorage
    if (typeof window !== 'undefined') {
      const persisted = localStorage.getItem('q_sidebar_collapsed');
      if (persisted === 'true') {
        setSidebarCollapsed(true);
      }
    }
  }, [setSidebarCollapsed]);

  // Keyboard shortcut listener: Cmd+\ or Ctrl+\
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Check for Cmd + \ (macOS) or Ctrl + \ (Windows/Linux)
      // Note: key is "\" and metaKey is Cmd (macOS), ctrlKey is Ctrl
      if ((e.metaKey || e.ctrlKey) && e.key === "\\") {
        e.preventDefault();
        toggleSidebar();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [toggleSidebar]);

  // Default to expanded (false) during SSR and pre-mount to avoid hydration mismatch
  const collapsed = mounted ? isSidebarCollapsed : false;

  return (
    <div 
      className={`hidden md:flex h-full transition-all duration-300 ease-in-out shrink-0 select-none ${
        collapsed ? "w-0 overflow-hidden border-r-0 opacity-0" : "w-64 opacity-100"
      }`}
    >
      {children}
    </div>
  );
}
