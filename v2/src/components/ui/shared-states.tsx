import { Loader2 } from "lucide-react";

// ==========================================
// QUBA AI — Shared UI Primitives
// Single source of truth for loading, empty states, and error banners
// Used across all dashboard pages for UX consistency
// ==========================================

/**
 * Full-page centered loading spinner.
 * Replaces 6+ duplicate loading patterns across dashboard pages.
 */
export function PageLoader() {
  return (
    <div className="h-full flex items-center justify-center">
      <Loader2 className="w-6 h-6 animate-spin text-[#86868B]" />
    </div>
  );
}

/**
 * Empty state placeholder with icon, title, and optional description.
 * Standardizes all "no data" views across the platform.
 */
export function EmptyState({
  icon,
  title,
  description,
}: {
  icon?: React.ReactNode;
  title: string;
  description?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      {icon && (
        <div className="w-12 h-12 rounded-2xl bg-[#F5F5F7] flex items-center justify-center text-[#86868B] mb-4">
          {icon}
        </div>
      )}
      <p className="text-[15px] font-semibold text-[#1D1D1F]">{title}</p>
      {description && (
        <p className="text-[13px] text-[#86868B] mt-1 max-w-[280px]">{description}</p>
      )}
    </div>
  );
}

/**
 * Dismissible inline error banner.
 * Replaces ad-hoc error display patterns across admin/users/integrations pages.
 */
export function ErrorBanner({
  message,
  onDismiss,
}: {
  message: string;
  onDismiss: () => void;
}) {
  return (
    <div className="flex items-center gap-2 px-4 py-3 bg-[#FF3B30]/10 border border-[#FF3B30]/20 rounded-xl text-[13px] text-[#FF3B30] font-medium">
      {message}
      <button onClick={onDismiss} className="ml-auto text-[#FF3B30]/60 hover:text-[#FF3B30] transition-colors">
        ✕
      </button>
    </div>
  );
}
