import { neon } from '@neondatabase/serverless';

const databaseUrl = process.env.DATABASE_URL || "postgres://dummy:dummy@dummy.com/dummy";

export const sql = neon(databaseUrl);
