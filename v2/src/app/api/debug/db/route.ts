import { NextRequest, NextResponse } from 'next/server';
import { Pool } from '@neondatabase/serverless';

export async function GET(req: NextRequest) {
  const sql = new Pool({ connectionString: process.env.APP_DATABASE_URL || process.env.DATABASE_URL });
  try {
    const { searchParams } = new URL(req.url);
    const limit = parseInt(searchParams.get('limit') || '10');

    let allMsgs: any[] = [];
    try {
      const msgsRes = await sql.query(`SELECT * FROM messages ORDER BY created_at DESC LIMIT $1`, [limit]);
      allMsgs = msgsRes.rows;
    } catch(err) {
      console.log('could not read messages table', err);
    }

    let allLogs: any[] = [];
    try {
      const logsRes = await sql.query(`SELECT * FROM outreach_logs ORDER BY created_at DESC LIMIT $1`, [limit]);
      allLogs = logsRes.rows;
    } catch (err) {
      console.log('could not read logs table', err);
    }

    const resLeads = await sql.query(`SELECT id, patient_name, stage, created_at FROM leads WHERE patient_name ILIKE '%Halil Hanay%' ORDER BY created_at DESC LIMIT 5`);
    const leads = resLeads.rows;
    const recentSent = await sql.query(`SELECT * FROM outreach_logs WHERE action = 'form_greeting_template_sent' ORDER BY created_at DESC LIMIT 5`);

    return NextResponse.json({
      leads,
      logs: allLogs,
      msgs: allMsgs,
      recentSent: recentSent.rows
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  } finally {
    await sql.end();
  }
}
