import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { neon } from '@neondatabase/serverless';

async function run() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('DATABASE_URL is not set in .env.local');
    process.exit(1);
  }

  const sql = neon(databaseUrl);

  try {
    console.log('\n--- Active Queries (pg_stat_activity) ---');
    const activityResult = await sql.query(`
      SELECT 
        pid,
        state,
        query,
        query_start,
        state_change,
        wait_event_type,
        wait_event
      FROM pg_stat_activity 
      WHERE state IS NOT NULL AND query NOT LIKE '%pg_stat_activity%'
      ORDER BY query_start ASC
    `);
    console.table(activityResult.rows || activityResult);

    console.log('\n--- Active Advisory Locks (pg_locks) ---');
    const locksResult = await sql.query(`
      SELECT 
        locktype,
        database,
        relation::regclass,
        page,
        tuple,
        virtualxid,
        transactionid,
        classid,
        objid,
        objsubid,
        virtualtransaction,
        pid,
        mode,
        granted,
        fastpath
      FROM pg_locks
      WHERE locktype = 'advisory'
    `);
    console.table(locksResult.rows || locksResult);
  } catch (err) {
    console.error('Error executing query:', err);
  }
}

run().catch(console.error);
