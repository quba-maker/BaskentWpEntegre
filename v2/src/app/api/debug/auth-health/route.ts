import { NextResponse } from 'next/server';
import { withTenantDB } from '@/lib/core/tenant-db';

export const dynamic = 'force-dynamic';

export async function GET() {
  const dbUrl = process.env.DATABASE_URL;
  const authSecret = process.env.AUTH_SECRET;
  
  const healthStatus = {
    status: 'unhealthy',
    timestamp: new Date().toISOString(),
    dbReachable: false,
    usersCount: 0,
    tenantsCount: 0,
    jwtConfigured: !!authSecret && authSecret !== 'fallback_secret_for_build_only',
    authProviderActive: false,
    errors: [] as string[]
  };

  if (!dbUrl) {
    healthStatus.errors.push('DATABASE_URL is missing.');
    return NextResponse.json(healthStatus, { status: 500 });
  }

  try {
    const systemDb = withTenantDB('admin-system', true);
    
    // Check DB and count tenants
    const tenants = await systemDb.executeSafe("SELECT count(*) as count FROM tenants") as any[];
    healthStatus.tenantsCount = parseInt(tenants[0].count);

    // Check users
    const users = await systemDb.executeSafe("SELECT count(*) as count FROM users") as any[];
    healthStatus.usersCount = parseInt(users[0].count);

    healthStatus.dbReachable = true;
    healthStatus.authProviderActive = healthStatus.jwtConfigured && healthStatus.dbReachable;

    if (healthStatus.authProviderActive && healthStatus.tenantsCount > 0 && healthStatus.usersCount > 0) {
      healthStatus.status = 'healthy';
    }

  } catch (error: any) {
    healthStatus.errors.push(`Database connection failed: ${error.message}`);
  }

  const statusCode = healthStatus.status === 'healthy' ? 200 : 503;
  return NextResponse.json(healthStatus, { status: statusCode });
}
