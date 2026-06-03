import { NextResponse } from 'next/server';
import { Pool } from '@neondatabase/serverless';

export async function GET() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  
  try {
    const counts = await pool.query(`SELECT count(*) FROM opportunities`);
    const tzCounts = await pool.query(`SELECT count(*) FROM opportunities WHERE metadata->>'patient_timezone' IS NOT NULL`);
    const sample = await pool.query(`SELECT id, country, metadata->>'patient_timezone' as tz FROM opportunities LIMIT 5`);

    return NextResponse.json({
      total_opportunities: counts.rows[0].count,
      with_timezone: tzCounts.rows[0].count,
      sample: sample.rows
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  } finally {
    await pool.end();
  }
}
