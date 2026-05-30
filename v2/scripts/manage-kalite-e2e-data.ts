import dotenv from "dotenv";
import fs from "fs";
import path from "path";

dotenv.config({ path: ".env.local" });

const TENANT_ID = "caab9ea1-9591-45e4-bbc5-9c9b498982c8";
const USER_ID = "23429a66-d897-4504-a7fb-c5ff898f9163"; // Baskent Admin user id
const DATA_FILE = path.join(process.cwd(), "scratch-kalite-e2e-data.json");

async function run() {
  const { withTenantDB } = await import("../src/lib/core/tenant-db");
  const db = withTenantDB(TENANT_ID, true);

  const args = process.argv.slice(2);
  const mode = args[0]; // '--prepare' or '--cleanup'

  if (mode === "--prepare") {
    console.log("🚀 Preparing E2E quality sandbox test data...");

    // Clean any prior E2E leftovers
    await db.executeSafe({
      text: `DELETE FROM follow_up_tasks WHERE tenant_id = $1 AND phone_number = $2`,
      values: [TENANT_ID, "+905555555599"]
    });
    await db.executeSafe({
      text: `DELETE FROM opportunities WHERE tenant_id = $1 AND phone_number = $2`,
      values: [TENANT_ID, "+905555555599"]
    });
    await db.executeSafe({
      text: `DELETE FROM conversations WHERE tenant_id = $1 AND patient_name = 'E2E Kalite Test Fırsatı'`,
      values: [TENANT_ID]
    });

    const createdTaskIds: string[] = [];
    const createdLogIds: number[] = [];
    let testConvId: string | null = null;
    let testOppId: string | null = null;

    // 1. Inject Conversation
    const convRes = await db.executeSafe({
      text: `
        INSERT INTO conversations (tenant_id, patient_name, department, country, status)
        VALUES ($1, $2, $3, $4, 'open')
        RETURNING id
      `,
      values: [TENANT_ID, "E2E Kalite Test Fırsatı", "Obezite", "UK"]
    }) as any[];
    testConvId = convRes[0].id;

    // 2. Inject Opportunity (Hot lead waiting, idle 3 hours)
    const oppRes = await db.executeSafe({
      text: `
        INSERT INTO opportunities (tenant_id, patient_name, phone_number, priority, source, department, country, stage, summary, ai_reason, conversation_id, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW() - INTERVAL '3 hours', NOW() - INTERVAL '3 hours')
        RETURNING id
      `,
      values: [
        TENANT_ID,
        "E2E Kalite Test Fırsatı",
        "+905555555599",
        "hot",
        "whatsapp",
        "Obezite",
        "UK",
        "new_lead",
        "E2E Klinik özet gerekçesi.",
        "E2E AI fırsat analiz nedeni.",
        testConvId
      ]
    }) as any[];
    testOppId = oppRes[0].id;

    // Set updated_at explicitly
    await db.executeSafe({
      text: `UPDATE opportunities SET updated_at = NOW() - INTERVAL '3 hours' WHERE id = $1`,
      values: [testOppId]
    });

    // 3. Inject Overdue Task (overdue by 20 mins)
    const taskOverdueRes = await db.executeSafe({
      text: `
        INSERT INTO follow_up_tasks (tenant_id, opportunity_id, phone_number, task_type, title, status, due_at)
        VALUES ($1, $2, $3, 'regular_followup', 'E2E Standart Takip', 'pending', NOW() - INTERVAL '20 minutes')
        RETURNING id
      `,
      values: [TENANT_ID, testOppId, "+905555555599"]
    }) as any[];
    createdTaskIds.push(taskOverdueRes[0].id);

    // 4. Inject Bot Handoff Task (for bot_draft_ready, generated 5 hours ago)
    const botTaskRes = await db.executeSafe({
      text: `
        INSERT INTO follow_up_tasks (tenant_id, opportunity_id, phone_number, task_type, title, status, due_at, metadata)
        VALUES ($1, $2, $3, 'bot_handoff_followup', 'Bot Takip', 'in_progress', NOW() - INTERVAL '5 hours', $4)
        RETURNING id
      `,
      values: [
        TENANT_ID,
        testOppId,
        "+905555555599",
        JSON.stringify({
          bot_delegation: {
            mode: "unreachable_followup",
            source: "patient_tracking",
            status: "draft_ready",
            generated_draft: "Merhaba, size ulaşamadık. (E2E BOT SLA)",
            generated_draft_at: new Date(Date.now() - 5 * 3600000).toISOString()
          }
        })
      ]
    }) as any[];
    createdTaskIds.push(botTaskRes[0].id);

    // 5. Inject Unconfirmed Appointment (due in 23 hours)
    const apptUnconfirmedRes = await db.executeSafe({
      text: `
        INSERT INTO follow_up_tasks (tenant_id, opportunity_id, phone_number, task_type, title, status, due_at, metadata)
        VALUES ($1, $2, $3, 'callback_scheduled', 'Teyitsiz Randevu', 'pending', NOW() + INTERVAL '23 hours', $4)
        RETURNING id
      `,
      values: [
        TENANT_ID,
        testOppId,
        "+905555555599",
        JSON.stringify({
          appointment_type: "doctor_review",
          confirmation_status: "pending"
        })
      ]
    }) as any[];
    createdTaskIds.push(apptUnconfirmedRes[0].id);

    const data = {
      convId: testConvId,
      oppId: testOppId,
      taskIds: createdTaskIds
    };

    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
    console.log("✅ E2E quality test data injected successfully:", data);

  } else if (mode === "--cleanup") {
    console.log("🧹 Cleaning up E2E quality test data...");

    if (!fs.existsSync(DATA_FILE)) {
      console.log("⚠️ No E2E quality data file found, skipping cleanup.");
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

    if (data.oppId) {
      await db.executeSafe({
        text: `DELETE FROM opportunities WHERE id = $1 AND tenant_id = $2`,
        values: [data.oppId, TENANT_ID]
      });
      console.log("  * Deleted opportunity.");
    }

    if (data.convId) {
      await db.executeSafe({
        text: `DELETE FROM conversations WHERE id = $1 AND tenant_id = $2`,
        values: [data.convId, TENANT_ID]
      });
      console.log("  * Deleted conversation.");
    }

    fs.unlinkSync(DATA_FILE);
    console.log("✅ Cleanup complete.");
  } else {
    console.error("❌ Invalid mode. Use --prepare or --cleanup");
    process.exit(1);
  }
}

run().catch(e => {
  console.error("❌ E2E Quality Data manager error:", e);
  process.exit(1);
});
