import dotenv from "dotenv";
import fs from "fs";
import path from "path";

dotenv.config({ path: ".env.local" });

const TENANT_ID = "caab9ea1-9591-45e4-bbc5-9c9b498982c8";
const USER_ID = "23429a66-d897-4504-a7fb-c5ff898f9163"; // Baskent Admin user id
const DATA_FILE = path.join(process.cwd(), "scratch-e2e-data.json");

async function run() {
  const { withTenantDB } = await import("../src/lib/core/tenant-db");
  const db = withTenantDB(TENANT_ID, true);

  const args = process.argv.slice(2);
  const mode = args[0]; // '--prepare' or '--cleanup'

  if (mode === "--prepare") {
    console.log("🚀 Preparing E2E test data...");

    // 1. Get opportunity for draft injection
    const opps = await db.executeSafe({
      text: `SELECT id, patient_name, phone_number FROM opportunities WHERE tenant_id = $1 AND stage != 'lost' LIMIT 1`,
      values: [TENANT_ID]
    }) as any[];

    if (opps.length === 0) {
      console.error("❌ No opportunities found to inject test drafts.");
      process.exit(1);
    }

    const opp = opps[0];
    console.log(`Using Opportunity: "${opp.patient_name}" (ID: ${opp.id}, Phone: ${opp.phone_number})`);

    // Clean any prior E2E leftovers
    await db.executeSafe({
      text: `DELETE FROM follow_up_tasks WHERE tenant_id = $1 AND phone_number = $2 AND task_type IN ('bot_handoff_followup', 'appointment_reminder')`,
      values: [TENANT_ID, opp.phone_number]
    });
    await db.executeSafe({
      text: `DELETE FROM outreach_logs WHERE tenant_id = $1 AND opportunity_id = $2`,
      values: [TENANT_ID, opp.id]
    });
    await db.executeSafe({
      text: `DELETE FROM leads WHERE tenant_id = $1 AND patient_name = 'Merve Test'`,
      values: [TENANT_ID]
    });

    const createdTaskIds: string[] = [];
    const createdLogIds: number[] = [];
    let testLeadId: string | null = null;

    // A. Inject Bot Delegation Task
    const botTaskRes = await db.executeSafe({
      text: `
        INSERT INTO follow_up_tasks (tenant_id, opportunity_id, phone_number, task_type, title, status, due_at, metadata)
        VALUES ($1, $2, $3, 'bot_handoff_followup', 'Bot Takip: Ulaşılamadı (E2E)', 'in_progress', NOW(), $4)
        RETURNING id
      `,
      values: [
        TENANT_ID,
        opp.id,
        opp.phone_number,
        JSON.stringify({
          bot_delegation: {
            mode: "unreachable_followup",
            source: "patient_tracking",
            status: "draft_ready",
            generated_draft: "Merhaba, bugün aradık ancak ulaşamadık. (E2E BOT DRAFT)",
            generated_draft_at: new Date().toISOString()
          }
        })
      ]
    }) as any[];
    createdTaskIds.push(botTaskRes[0].id);

    // B. Inject Appointment Reminder Task
    const reminderTaskRes = await db.executeSafe({
      text: `
        INSERT INTO follow_up_tasks (tenant_id, opportunity_id, phone_number, task_type, title, status, due_at, metadata)
        VALUES ($1, $2, $3, 'appointment_reminder', 'Randevu Hatırlatma (E2E)', 'completed', NOW(), $4)
        RETURNING id
      `,
      values: [
        TENANT_ID,
        opp.id,
        opp.phone_number,
        JSON.stringify({
          reminder_type: "same_day",
          generated_draft: "Merhaba, bugün randevunuzu hatırlatmak istedik. (E2E REMINDER DRAFT)",
          generated_draft_at: new Date().toISOString(),
          notification_sent_at: new Date().toISOString()
        })
      ]
    }) as any[];
    createdTaskIds.push(reminderTaskRes[0].id);

    // C. Inject Remarketing Log
    const remarketingLogRes = await db.executeSafe({
      text: `
        INSERT INTO outreach_logs (tenant_id, opportunity_id, action, channel, actor_id, metadata)
        VALUES ($1, $2, 'remarketing_draft_prepared', 'whatsapp', $3, $4)
        RETURNING id
      `,
      values: [
        TENANT_ID,
        opp.id,
        USER_ID,
        JSON.stringify({
          draftText: "Merhaba, sizinle yeniden iletişime geçmek istedik. (E2E REMARKETING DRAFT)",
          saved_at: new Date().toISOString()
        })
      ]
    }) as any[];
    createdLogIds.push(remarketingLogRes[0].id);

    // D. Inject Greeting Lead
    const leadRes = await db.executeSafe({
      text: `
        INSERT INTO leads (tenant_id, phone_number, patient_name, form_name, country, raw_data)
        VALUES ($1, '+905999999999', 'Merve Test', 'Facebook Form', 'UK', '{"language": "tr", "department": "Obezite"}')
        RETURNING id
      `,
      values: [TENANT_ID]
    }) as any[];
    testLeadId = leadRes[0].id;

    const data = {
      oppId: opp.id,
      oppName: opp.patient_name,
      oppPhone: opp.phone_number,
      taskIds: createdTaskIds,
      logIds: createdLogIds,
      leadId: testLeadId
    };

    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
    console.log("✅ E2E test data injected successfully:", data);

  } else if (mode === "--cleanup") {
    console.log("🧹 Cleaning up E2E test data...");

    if (!fs.existsSync(DATA_FILE)) {
      console.log("⚠️ No E2E data file found, skipping cleanup.");
      return;
    }

    const data = JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));

    if (data.taskIds && data.taskIds.length > 0) {
      await db.executeSafe({
        text: `DELETE FROM follow_up_tasks WHERE id = ANY($1) AND tenant_id = $2`,
        values: [data.taskIds, TENANT_ID]
      });
      console.log(`  * Deleted tasks: ${data.taskIds.length}`);
    }

    if (data.logIds && data.logIds.length > 0) {
      await db.executeSafe({
        text: `DELETE FROM outreach_logs WHERE id = ANY($1) AND tenant_id = $2`,
        values: [data.logIds, TENANT_ID]
      });
      console.log(`  * Deleted outreach logs: ${data.logIds.length}`);
    }

    if (data.leadId) {
      await db.executeSafe({
        text: `DELETE FROM leads WHERE id = $1 AND tenant_id = $2`,
        values: [data.leadId, TENANT_ID]
      });
      console.log("  * Deleted lead.");
    }

    // Clean any remaining logs for the test opportunity that might have been created during drawer tests
    if (data.oppId) {
      await db.executeSafe({
        text: `DELETE FROM outreach_logs WHERE opportunity_id = $1 AND tenant_id = $2 AND action IN ('draft_review_opened', 'draft_text_edited', 'draft_approved', 'draft_rejected', 'draft_copied')`,
        values: [data.oppId, TENANT_ID]
      });
      console.log("  * Cleaned up runtime E2E test logs.");
    }

    fs.unlinkSync(DATA_FILE);
    console.log("✅ Cleanup complete.");
    process.exit(0);
  } else {
    console.error("❌ Invalid mode. Use --prepare or --cleanup");
    process.exit(1);
  }
  process.exit(0);
}

run().catch(e => {
  console.error("❌ E2E Data manager error:", e);
  process.exit(1);
});
