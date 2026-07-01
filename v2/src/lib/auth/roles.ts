export const PLATFORM_ADMIN_ROLE = "platform_admin" as const;

export const TENANT_ROLES = ["owner", "admin", "manager", "agent", "viewer"] as const;
export const TENANT_ASSIGNABLE_ROLES = ["admin", "manager", "agent", "viewer"] as const;
export const TENANT_SETUP_ROLES = ["owner", ...TENANT_ASSIGNABLE_ROLES] as const;

export type TenantRole = (typeof TENANT_ROLES)[number];
export type TenantAssignableRole = (typeof TENANT_ASSIGNABLE_ROLES)[number];
export type UserRole = TenantRole | typeof PLATFORM_ADMIN_ROLE;

const DEFAULT_PLATFORM_TENANT_SLUGS = ["admin", "quba", "quba-ai", "platform"];

export function getPlatformTenantSlugs() {
  const raw = process.env.PLATFORM_TENANT_SLUGS || "";
  const configured = raw
    .split(",")
    .map((slug) => slug.trim().toLowerCase())
    .filter(Boolean);

  return configured.length > 0 ? configured : DEFAULT_PLATFORM_TENANT_SLUGS;
}

export function isPlatformRole(role?: string | null) {
  return role === PLATFORM_ADMIN_ROLE || role === "superadmin";
}

export function isTenantRole(role?: string | null): role is TenantRole {
  return TENANT_ROLES.includes(role as TenantRole);
}

export function isPlatformTenantSlug(slug?: string | null) {
  if (!slug) return false;
  return getPlatformTenantSlugs().includes(slug.toLowerCase());
}

export function normalizeSessionRole(role: string | null | undefined, tenantSlug?: string | null): UserRole {
  if (isPlatformRole(role)) {
    return isPlatformTenantSlug(tenantSlug) ? PLATFORM_ADMIN_ROLE : "admin";
  }

  if (isTenantRole(role)) return role;
  return "viewer";
}

export function normalizeTenantAssignableRole(role: string | null | undefined): TenantAssignableRole {
  if (TENANT_ASSIGNABLE_ROLES.includes(role as TenantAssignableRole)) {
    return role as TenantAssignableRole;
  }
  throw new Error("Bu rol firma kullanıcıları için atanamaz.");
}

export function normalizeTenantSetupRole(role: string | null | undefined): TenantRole {
  if (TENANT_SETUP_ROLES.includes(role as TenantRole)) {
    return role as TenantRole;
  }
  throw new Error("Geçersiz firma kullanıcı rolü.");
}
