const fs = require('fs');
const { Pool } = require('@neondatabase/serverless');

const envFile = fs.readFileSync('.env.vercel.prod', 'utf8') + '\n' + fs.readFileSync('.env.production.local', 'utf8');
let dbUrl = '';
for (const line of envFile.split('\n')) {
  if (line.startsWith('DATABASE_URL=')) {
    dbUrl = line.split('=')[1].replace(/["']/g, '');
  }
}

async function run() {
  const pool = new Pool({ connectionString: dbUrl });
  try {
    const res = await pool.query(`
      SELECT m.id, m.tenant_id, m.opportunity_id, m.content, m.created_at, m.role
      FROM messages m
      WHERE m.content LIKE '%henüz gerçekleştiremedik.%'
      ORDER BY m.created_at DESC LIMIT 5
    `);
    
    if (res.rows.length === 0) {
      console.log('Message not found in messages table.');
    } else {
       console.log('Messages:', JSON.stringify(res.rows, null, 2));
       const msg = res.rows[0];
       
       const auditRes = await pool.query(`
         SELECT * FROM ai_audit_logs WHERE opportunity_id = $1 ORDER BY created_at DESC LIMIT 5
       `, [msg.opportunity_id]);
       console.log('AI Audit Logs:', JSON.stringify(auditRes.rows, null, 2));
       
       const queueRes = await pool.query(`
         SELECT * FROM job_queue WHERE opportunity_id = $1 ORDER BY created_at DESC LIMIT 5
       `, [msg.opportunity_id]);
       console.log('Queue Jobs:', JSON.stringify(queueRes.rows, null, 2));
    }
  } catch (e) {
    console.error(e);
  } finally {
    await pool.end();
  }
}
run();
