import React from "react";
import { Check, Save, Loader2 } from "lucide-react";

// ==========================================
// QUBA AI — GOVERNANCE COMPONENTS
// Standard building blocks for all pages
// 
// RULE: New pages MUST use these components.
// No ad-hoc layout patterns allowed.
// ==========================================

/**
 * PageShell — Root wrapper for every dashboard page.
 * Provides consistent padding, background effects, and scroll behavior.
 */
export function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="p-4 md:p-8 h-full flex flex-col relative overflow-y-auto">
      {/* Ambient background blur — Apple-grade depth */}
      <div className="absolute top-0 right-0 w-[500px] h-[500px] rounded-full blur-[100px] pointer-events-none -z-10" style={{ backgroundColor: "var(--q-purple)", opacity: 0.04 }} />
      <div className="absolute bottom-0 left-0 w-[400px] h-[400px] rounded-full blur-[100px] pointer-events-none -z-10" style={{ backgroundColor: "var(--q-blue)", opacity: 0.04 }} />
      {children}
    </div>
  );
}

/**
 * PageHeader — Standard page title + optional action area.
 * Every page must have exactly one.
 */
export function PageHeader({
  icon: Icon,
  iconGradient,
  title,
  subtitle,
  children, // action buttons go here
}: {
  icon: React.ElementType;
  iconGradient?: { from: string; to: string };
  title: string;
  subtitle?: string;
  children?: React.ReactNode;
}) {
  const defaultGradient = { from: "var(--q-purple)", to: "var(--q-blue)" };
  const gradient = iconGradient || defaultGradient;

  return (
    <div className="mb-8">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3 mb-2">
          <div
            className="w-10 h-10 rounded-2xl flex items-center justify-center shadow-lg"
            style={{ background: `linear-gradient(135deg, ${gradient.from}, ${gradient.to})` }}
          >
            <Icon className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl md:text-3xl font-bold tracking-tight" style={{ color: "var(--q-text-primary)" }}>
              {title}
            </h1>
            {subtitle && (
              <p className="text-sm font-medium" style={{ color: "var(--q-text-secondary)" }}>
                {subtitle}
              </p>
            )}
          </div>
        </div>
        {children && <div className="flex items-center gap-2">{children}</div>}
      </div>
    </div>
  );
}

/**
 * SectionCard — Standard card container for grouped content.
 * All panels must render inside this.
 */
export function SectionCard({
  children,
  className = "",
  noPadding = false,
}: {
  children: React.ReactNode;
  className?: string;
  noPadding?: boolean;
}) {
  return (
    <div
      className={`bg-white rounded-2xl border shadow-sm overflow-hidden ${noPadding ? "" : "p-5"} ${className}`}
      style={{ borderColor: "var(--q-border-default)" }}
    >
      {children}
    </div>
  );
}

/**
 * SectionHeader — Standard header above each content section.
 */
export function SectionHeader({
  icon: Icon,
  title,
  children, // action buttons
}: {
  icon: React.ElementType;
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between mb-4">
      <h2 className="text-lg font-bold flex items-center gap-2" style={{ color: "var(--q-text-primary)" }}>
        <Icon className="w-5 h-5" style={{ color: "var(--q-text-secondary)" }} />
        {title}
      </h2>
      {children}
    </div>
  );
}

/**
 * ActionButton — Standard CTA button with consistent styling.
 */
export function ActionButton({
  children,
  onClick,
  href,
  color = "var(--q-blue)",
  variant = "primary",
  size = "default",
  disabled = false,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  href?: string;
  color?: string;
  variant?: "primary" | "secondary" | "ghost";
  size?: "small" | "default";
  disabled?: boolean;
}) {
  const baseClasses = `inline-flex items-center gap-2 font-semibold transition-all disabled:opacity-50 ${
    size === "small" ? "px-3 py-1.5 text-xs rounded-lg" : "px-4 py-2.5 text-[13px] rounded-xl"
  }`;

  const variantClasses = {
    primary: "text-white hover:opacity-90 shadow-sm",
    secondary: "border hover:opacity-80",
    ghost: "hover:bg-black/[0.04]",
  };

  const style: React.CSSProperties = {
    ...(variant === "primary" ? { backgroundColor: color } : {}),
    ...(variant === "secondary" ? { color, borderColor: `${color}33`, backgroundColor: `${color}10` } : {}),
    ...(variant === "ghost" ? { color } : {}),
  };

  if (href) {
    return (
      <a href={href} className={`${baseClasses} ${variantClasses[variant]} q-press`} style={style}>
        {children}
      </a>
    );
  }

  return (
    <button onClick={onClick} disabled={disabled} className={`${baseClasses} ${variantClasses[variant]} q-press`} style={style}>
      {children}
    </button>
  );
}

// ==========================================
// INTERACTION PRIMITIVES
// Platform-wide interaction building blocks
// Every interactive element MUST use these.
// ==========================================

/**
 * CardInteractive — Clickable card with hover lift physics.
 * Use for tenant cards, integration cards, any selectable surface.
 */
export function CardInteractive({
  children,
  onClick,
  className = "",
  selected = false,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  className?: string;
  selected?: boolean;
}) {
  return (
    <div
      onClick={onClick}
      className={`bg-white rounded-2xl border shadow-sm overflow-hidden p-5 q-card-interactive ${
        onClick ? "cursor-pointer" : ""
      } ${selected ? "ring-2" : ""} ${className}`}
      style={{
        borderColor: selected ? "var(--q-blue)" : "var(--q-border-default)",
        ...(selected ? { ringColor: "var(--q-blue)" } : {}),
      }}
    >
      {children}
    </div>
  );
}

/**
 * IconButton — Standardized icon action button.
 * Use for toolbar actions, row actions, settings toggles.
 * 
 * Physics: hover bg + active press scale
 */
export function IconButton({
  icon: Icon,
  onClick,
  color = "var(--q-text-secondary)",
  hoverColor,
  title,
  size = "default",
  disabled = false,
}: {
  icon: React.ElementType;
  onClick?: () => void;
  color?: string;
  hoverColor?: string;
  title?: string;
  size?: "small" | "default";
  disabled?: boolean;
}) {
  const sizeClasses = size === "small" ? "p-1 rounded-md" : "p-2 rounded-lg";
  const iconSize = size === "small" ? "w-3.5 h-3.5" : "w-4 h-4";

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`${sizeClasses} q-list-item q-press disabled:opacity-40`}
      style={{ color }}
    >
      <Icon className={iconSize} />
    </button>
  );
}

/**
 * Skeleton — Loading state placeholder.
 * 
 * RULE: Use Skeleton instead of Spinner for content loading.
 * Spinners only for action feedback (save, submit).
 */
export function Skeleton({
  width,
  height = "16px",
  rounded = false,
  className = "",
}: {
  width?: string;
  height?: string;
  rounded?: boolean;
  className?: string;
}) {
  return (
    <div
      className={`q-skeleton ${className}`}
      style={{
        width: width || "100%",
        height,
        borderRadius: rounded ? "var(--q-radius-pill)" : "var(--q-radius-default)",
      }}
    />
  );
}

/**
 * SkeletonCard — Full card skeleton for page loading states.
 * Use instead of PageLoader when you know the layout structure.
 */
export function SkeletonCard({ lines = 3 }: { lines?: number }) {
  return (
    <div
      className="bg-white rounded-2xl border shadow-sm p-5 space-y-3"
      style={{ borderColor: "var(--q-border-default)" }}
    >
      <Skeleton width="40%" height="20px" />
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} width={`${80 - i * 15}%`} height="14px" />
      ))}
    </div>
  );
}

/**
 * StatusBadge — Consistent status/label display.
 * Use for active/inactive, plan tiers, role labels.
 */
export function StatusBadge({
  label,
  color = "var(--q-blue)",
  variant = "subtle",
}: {
  label: string;
  color?: string;
  variant?: "subtle" | "solid";
}) {
  return (
    <span
      className="text-[11px] font-semibold px-2 py-0.5 rounded-full"
      style={
        variant === "solid"
          ? { backgroundColor: color, color: "white" }
          : { backgroundColor: `color-mix(in srgb, ${color} 10%, transparent)`, color }
      }
    >
      {label}
    </span>
  );
}

/**
 * ToggleSwitch — Platform-standard toggle.
 * SSOT: All on/off toggles must use this.
 */
export function ToggleSwitch({
  active,
  onToggle,
  disabled = false,
}: {
  active: boolean;
  onToggle: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onToggle}
      disabled={disabled}
      className="relative w-[51px] h-[31px] rounded-full shrink-0 disabled:opacity-40"
      style={{
        backgroundColor: active ? "var(--q-green)" : "var(--q-bg-tertiary)",
        transition: "background-color var(--q-transition-fast)",
      }}
    >
      <div
        className="absolute top-[2px] w-[27px] h-[27px] bg-white rounded-full shadow-md"
        style={{
          transform: active ? "translateX(22px)" : "translateX(2px)",
          transition: "transform var(--q-transition-fast)",
        }}
      />
    </button>
  );
}

/**
 * SaveButton — Platform-standard save/persist button.
 * SSOT: All data persistence actions MUST use this.
 * 
 * Lifecycle: idle → saving → success (1.5s) → idle
 * Physics: press scale + color transition
 */
export function SaveButton({
  saving,
  saved,
  onClick,
  label = "Kaydet",
  savedLabel = "Kaydedildi!",
  color = "var(--q-blue)",
  size = "default",
}: {
  saving: boolean;
  saved: boolean;
  onClick: () => void;
  label?: string;
  savedLabel?: string;
  color?: string;
  size?: "small" | "default";
}) {
  const sizeClasses = size === "small"
    ? "px-3 py-1 text-[11px] rounded-lg"
    : "px-4 py-1.5 text-xs rounded-lg";

  return (
    <button
      onClick={onClick}
      disabled={saving}
      className={`${sizeClasses} font-bold flex items-center gap-1.5 text-white q-press disabled:opacity-60`}
      style={{
        backgroundColor: saved ? "var(--q-green)" : color,
        transition: "background-color var(--q-transition-fast)",
      }}
    >
      {saving ? (
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
      ) : saved ? (
        <Check className="w-3.5 h-3.5" />
      ) : (
        <Save className="w-3.5 h-3.5" />
      )}
      {saved ? savedLabel : label}
    </button>
  );
}
