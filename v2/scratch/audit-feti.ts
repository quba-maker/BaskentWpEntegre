import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const TENANT_ID = "caab9ea1-9591-45e4-bbc5-9c9b498982c8";

async function runAudit() {
  const { withTenantDB } = await import("../src/lib/core/tenant-db");
  const db = withTenantDB(TENANT_ID, true);

  console.log("=========================================");
  console.log("🔍 Running Feti Ereci Forensic DB Audit");
  console.log("=========================================");

  // 1. Check Leads table
  console.log("\n1. Leads Table Matches:");
  const leads = await db.executeSafe({
    text: `
      SELECT id, patient_name, phone_number, stage, created_at, raw_data::text as raw_data_str
      FROM leads
      WHERE tenant_id = $1
        AND (
          phone_number LIKE '%77086223402%'
          OR phone_number LIKE '%7086223402%'
          OR patient_name ILIKE '%Feti%'
          OR patient_name ILIKE '%Ereci%'
        )
    `,
    values: [TENANT_ID]
  }) as any[];
  console.dir(leads, { depth: null });

  // 2. Check Conversations table
  console.log("\n2. Conversations Table Matches:");
  const conversations = await db.executeSafe({
    text: `
      SELECT id, phone_number, status, lead_stage, last_message_at, last_message_direction, last_message_content
      FROM conversations
      WHERE tenant_id = $1
        AND (
          phone_number LIKE '%77086223402%'
          OR phone_number LIKE '%7086223402%'
          OR patient_name ILIKE '%Feti%'
          OR patient_name ILIKE '%Ereci%'
        )
    `,
    values: [TENANT_ID]
  }) as any[];
  console.dir(conversations, { depth: null });

  // 3. Check Messages table
  console.log("\n3. Messages Table Matches:");
  const messages = await db.executeSafe({
    text: `
      SELECT id, conversation_id, phone_number, direction, content, created_at, provider_timestamp, provider_message_id
      FROM messages
      WHERE tenant_id = $1
        AND (
          phone_number LIKE '%77086223402%'
          OR phone_number LIKE '%7086223402%'
          OR content ILIKE '%Hayırlı akşamlar%'
          OR content ILIKE '%Turkiyeye ne zaman gelirim%'
          OR content ILIKE '%Teşekkür ederim%'
        )
      ORDER BY COALESCE(provider_timestamp, created_at) ASC
    `,
    values: [TENANT_ID]
  }) as any[];
  console.dir(messages, { depth: null });

  // 4. Check Outreach logs table
  console.log("\n4. Outreach Logs Table Matches:");
  const outreachLogs = await db.executeSafe({
    text: `
      SELECT id, lead_id, conversation_id, action, actor_id, created_at
      FROM outreach_logs
      WHERE tenant_id = $1::text
        AND (
          lead_id IN (SELECT id FROM leads WHERE tenant_id = $1::uuid AND (phone_number LIKE '%77086223402%' OR phone_number LIKE '%7086223402%'))
          OR conversation_id IN (SELECT id::text FROM conversations WHERE tenant_id = $1::uuid AND (phone_number LIKE '%77086223402%' OR phone_number LIKE '%7086223402%'))
        )
      ORDER BY created_at ASC
    `,
    values: [TENANT_ID]
  }) as any[];
  console.dir(outreachLogs, { depth: null });

  // 5. Test no-reply eligibility
  if (leads.length > 0) {
    const { resolveFirstContactCore } = await import("../src/lib/utils/first-contact-status-resolver");
    const res = await resolveFirstContactCore(db, TENANT_ID, leads[0].id);
    console.log("\n5. First Contact Status & NoReply Followup resolution:");
    console.dir(res, { depth: null });
  }

  process.exit(0);
}

runAudit().catch(err => {
  console.error("Execution error:", err);
  process.exit(1);
});
