import React from "react";

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
      <a href={href} className={`${baseClasses} ${variantClasses[variant]}`} style={style}>
        {children}
      </a>
    );
  }

  return (
    <button onClick={onClick} disabled={disabled} className={`${baseClasses} ${variantClasses[variant]}`} style={style}>
      {children}
    </button>
  );
}
