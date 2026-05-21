import { neon } from "@neondatabase/serverless";
import { unstable_cache } from "next/cache";

export interface TenantBootstrapData {
  profile: {
    id: string;
    name: string;
    slug: string;
    industry: string;
    logo_url: string | null;
    primary_color: string | null;
  };
  theme: {
    sidebar_theme: 'light' | 'dark' | 'system';
    dashboard_density: 'compact' | 'comfortable' | 'spacious';
    ui_mode: 'light' | 'dark' | 'system';
  };
  limits: {
    plan: string;
    monthly_message_limit: number;
    max_bot_messages: number;
  };
  flags: Record<string, boolean>;
  workspace_version: number;
}

async function fetchTenantDataFromDB(tenantId: string): Promise<TenantBootstrapData | null> {
  const startTime = performance.now();
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) return null;
  
  const sqlClient = neon(connectionString);

  try {
    // 1. Fetch Tenant Profile, Theme & Limits
    const tenants = await sqlClient`
      SELECT id, name, slug, industry, logo_url, primary_color, 
             sidebar_theme, dashboard_density, ui_mode, workspace_version,
             plan, monthly_message_limit, token_budget
      FROM tenants 
      WHERE id = ${tenantId} AND status = 'active'
    `;

    if (tenants.length === 0) return null;
    const t = tenants[0];

    // 2. Fetch Feature Flags (with safe fallback if table missing)
    const flags: Record<string, boolean> = {};
    try {
      const modules = await sqlClient`
        SELECT module_name, is_active 
        FROM ai_module_settings 
        WHERE tenant_id = ${tenantId}
      `;
      modules.forEach((m: any) => {
        flags[m.module_name] = m.is_active;
      });
    } catch (err) {
      // Table doesn't exist yet, ignore
    }

    const duration = performance.now() - startTime;
    console.log(`[BOOTSTRAP] Successfully hydrated workspace for ${t.slug} in ${duration.toFixed(2)}ms`);

    return {
      profile: {
        id: t.id,
        name: t.name,
        slug: t.slug,
        industry: t.industry,
        logo_url: t.logo_url,
        primary_color: t.primary_color || "#007AFF"
      },
      theme: {
        sidebar_theme: t.sidebar_theme || 'light',
        dashboard_density: t.dashboard_density || 'comfortable',
        ui_mode: t.ui_mode || 'system',
      },
      limits: {
        plan: t.plan || 'starter',
        monthly_message_limit: t.monthly_message_limit || 500,
        max_bot_messages: 8 // default since it was removed
      },
      flags,
      workspace_version: t.workspace_version || 1
    };
  } catch (err) {
    console.error("[BOOTSTRAP] Failed to load workspace data:", err);
    return null;
  }
}

// TTL Cache wrapper with Next.js unstable_cache
// Revalidates every 30 seconds or via tag invalidation
export const getTenantBootstrapData = unstable_cache(
  fetchTenantDataFromDB,
  ['tenant-bootstrap'],
  {
    revalidate: 30,
    tags: ['tenant-bootstrap']
  }
);
