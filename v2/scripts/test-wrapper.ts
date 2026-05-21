import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { sql } from 'drizzle-orm';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const dbUrl = new URL(process.env.DATABASE_URL!);
dbUrl.username = 'app_client';
dbUrl.password = 'AppClientSuperSecurePassword123!@#_2026';
const db = drizzle(neon(dbUrl.toString()));

export async function runWithTenant<T>(
  tenantId: string,
  queries: (db: any) => Promise<any>[]
) {
  const queryPromises = queries(db);
  // We can't actually inject SET LOCAL into the promises if they are already built.
}
