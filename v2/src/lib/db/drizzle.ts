import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';

// Initialize the Database client with a dummy fallback for Next.js static build phase
const databaseUrl = process.env.DATABASE_URL || "postgres://dummy:dummy@dummy.com/dummy";
const sql = neon(databaseUrl);
export const db = drizzle(sql);
