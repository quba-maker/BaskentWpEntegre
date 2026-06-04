import { withTenantDB } from '@/lib/core/tenant-db';
import { Pool } from 'pg';

async function run() {
  try {
    const adminDb = withTenantDB('admin-system', true);
    // Find tenant with the message
    const res = await adminDb.executeSafe({
      text: `SELECT m.id, m.tenant_id, m.opportunity_id, m.content, m.created_at, m.role
             FROM messages m
             WHERE m.content LIKE '%henüz gerçekleştiremedik.%'
             ORDER BY m.created_at DESC LIMIT 5`
    }) as any[];
    
    if (res.length === 0) {
      console.log('Message not found in messages table.');
    } else {
       console.log('Messages:', JSON.stringify(res, null, 2));
       const msg = res[0];
       // Now search ai_audit_logs for this opportunity
       const auditRes = await adminDb.executeSafe({
         text: `SELECT * FROM ai_audit_logs WHERE opportunity_id = $1 ORDER BY created_at DESC LIMIT 5`,
         values: [msg.opportunity_id]
       }) as any[];
       console.log('AI Audit Logs:', JSON.stringify(auditRes, null, 2));
       
       const queueRes = await adminDb.executeSafe({
         text: `SELECT * FROM job_queue WHERE opportunity_id = $1 ORDER BY created_at DESC LIMIT 5`,
         values: [msg.opportunity_id]
       }) as any[];
       console.log('Queue Jobs:', JSON.stringify(queueRes, null, 2));
    }
  } catch (e) {
    console.error(e);
  }
}
run();
