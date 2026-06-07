import { NextRequest, NextResponse } from 'next/server';
import { Pool } from '@neondatabase/serverless';

export async function GET(req: NextRequest) {
  const sql = new Pool({ connectionString: process.env.APP_DATABASE_URL || process.env.DATABASE_URL });
  try {
    const resLeads = await sql.query(`SELECT id, patient_name, stage, created_at FROM leads WHERE patient_name ILIKE '%Halil Hanay%' ORDER BY created_at DESC LIMIT 5`);
    const leads = resLeads.rows;
    
    let allLogs = [];
    let allMsgs = [];
    
    for (const lead of leads) {
      const logs = await sql.query(`SELECT action, metadata, created_at FROM outreach_logs WHERE lead_id = $1 ORDER BY created_at DESC`, [lead.id]);
      allLogs.push({ leadId: lead.id, logs: logs.rows });
      
      const convs = await sql.query(`SELECT id FROM conversations WHERE lead_id = $1`, [lead.id]);
      for (const conv of convs.rows) {
        const msgs = await sql.query(`SELECT id, direction, status, provider_message_id, created_at FROM messages WHERE conversation_id = $1 ORDER BY created_at DESC`, [conv.id]);
        allMsgs.push({ convId: conv.id, messages: msgs.rows });
      }
    }
    
    const recentSent = await sql.query(`SELECT lead_id, action, metadata, created_at FROM outreach_logs WHERE action = 'form_greeting_template_sent' ORDER BY created_at DESC LIMIT 5`);

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
