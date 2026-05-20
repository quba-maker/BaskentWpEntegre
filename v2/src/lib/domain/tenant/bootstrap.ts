import { db } from "@/lib/db/drizzle";
import { sql } from "drizzle-orm";
import { neon } from "@neondatabase/serverless";

export interface TenantBootstrapData {
  profile: {
    id: string;
    name: string;
    slug: string;
    industry: string;
    logo_url: string | null;
    primary_color: string | null;
  };
  limits: {
    plan: string;
    monthly_message_limit: number;
    max_bot_messages: number;
  };
  modules: string[];
}

export async function getTenantBootstrapData(tenantId: string): Promise<TenantBootstrapData | null> {
  // Use raw SQL via neon for fastest direct lookup (bypassing complex ORM joins if needed, or use drizzle sql helper)
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) return null;
  
  const sqlClient = neon(connectionString);

  try {
    // 1. Fetch Tenant Profile & Limits
    const tenants = await sqlClient`
      SELECT id, name, slug, industry, logo_url, primary_color, plan, monthly_message_limit, max_bot_messages 
      FROM tenants 
      WHERE id = ${tenantId} AND status = 'active'
    `;

    if (tenants.length === 0) return null;
    const t = tenants[0];

    // 2. Fetch Active Modules
    const modules = await sqlClient`
      SELECT module_name 
      FROM ai_module_settings 
      WHERE tenant_id = ${tenantId} AND is_active = true
    `;
    const activeModules = modules.map((m: any) => m.module_name);

    return {
      profile: {
        id: t.id,
        name: t.name,
        slug: t.slug,
        industry: t.industry,
        logo_url: t.logo_url,
        primary_color: t.primary_color || "#007AFF"
      },
      limits: {
        plan: t.plan || 'starter',
        monthly_message_limit: t.monthly_message_limit || 500,
        max_bot_messages: t.max_bot_messages || 8
      },
      modules: activeModules
    };
  } catch (err) {
    console.error("[TENANT BOOTSTRAP] Failed to load workspace data:", err);
    return null;
  }
}
