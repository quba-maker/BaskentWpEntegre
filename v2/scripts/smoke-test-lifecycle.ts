import * as dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.join(__dirname, "../.env.local") });
const appDatabaseUrl = process.env.APP_DATABASE_URL || process.env.DATABASE_URL;

async function main() {
  if (!appDatabaseUrl) {
    console.error("No database URL found in env.");
    process.exit(1);
  }

  // Dynamically import database-dependent modules after dotenv is configured
  const { TenantDB } = await import("../src/lib/core/tenant-db");
  const { PatientOperationsLifecycleService } = await import("../src/lib/services/patient-operations-lifecycle");

  const tenantId = "caab9ea1-9591-45e4-bbc5-9c9b498982c8"; // Başkent Üniversitesi
  const opportunityId = "32ba6457-59b3-4c78-9dab-da30294955f8"; // Murtaza active opportunity
  const phoneNumber = "905554449999";
  const conversationId = "mock-conv-uuid";

  // Instantiate real TenantDB (RLS bypass set to true for script simulation)
  const db = new TenantDB(tenantId, true);

  console.log("=== 🧪 CONTROLLED LIFE-CYCLE SMOKE TEST START ===");

  // Capture original state of Murtaza's clinical task if it exists to prevent side-effects
  const clinicalTaskIdToRestore = "39618209-9952-4242-b337-b3cb35d845b3";
  const originalClinicalRows = await db.executeSafe({
    text: `SELECT task_type, title, due_at, metadata FROM follow_up_tasks WHERE id = $1`,
    values: [clinicalTaskIdToRestore]
  }) as any[];
  const originalClinicalState = originalClinicalRows[0] || null;

  // Cleanup existing tasks for this test number
  console.log("Cleaning up any existing test tasks...");
  await db.executeSafe({
    text: `DELETE FROM follow_up_tasks WHERE phone_number = $1 AND tenant_id = $2`,
    values: [phoneNumber, tenantId]
  });

  const lifecycleService = new PatientOperationsLifecycleService(db);

  // 1. First callback signal (communication_lifecycle lane)
  console.log("\n1. Triggering first callback signal (communication_lifecycle)...");
  const firstTaskId = await lifecycleService.createOrMergeTask({
    tenantId,
    opportunityId,
    conversationId,
    phoneNumber,
    taskType: "callback_scheduled",
    title: "📞 Geri Arama - Test",
    dueAt: new Date(Date.now() + 3600000).toISOString(),
    isAutomated: true,
    metadata: { signals: ["initial_callback_request"] }
  });
  console.log(`✅ Created Primary Task. ID: ${firstTaskId}`);

  // 2. Second callback signal in same lane (callback_scheduled)
  console.log("\n2. Triggering second callback signal in SAME lane (communication_lifecycle)...");
  const secondTaskId = await lifecycleService.createOrMergeTask({
    tenantId,
    opportunityId,
    conversationId,
    phoneNumber,
    taskType: "callback_scheduled",
    title: "📞 Geri Arama - Test (Duplicate)",
    dueAt: new Date(Date.now() + 1800000).toISOString(), // more urgent
    isAutomated: true,
    metadata: { signals: ["subsequent_callback_request"] }
  });
  console.log(`✅ Merge executed. ID: ${secondTaskId} (Should be same as firstTaskId: ${firstTaskId === secondTaskId})`);

  // Verify merged task properties
  const taskRows = await db.executeSafe({
    text: `SELECT task_type, title, due_at, metadata FROM follow_up_tasks WHERE id = $1`,
    values: [firstTaskId]
  }) as any[];
  console.log(`   Merged Task Metadata:`, JSON.stringify(taskRows[0].metadata));
  console.log(`   Merged Task DueAt:`, taskRows[0].due_at);

  // 3. Trigger doctor review signal in DIFFERENT lane (clinical_review_lifecycle)
  console.log("\n3. Triggering doctor review signal in DIFFERENT lane (clinical_review_lifecycle)...");
  const clinicalTaskId = await lifecycleService.createOrMergeTask({
    tenantId,
    opportunityId,
    conversationId,
    phoneNumber,
    taskType: "doctor_review_pending",
    title: "🩺 Doktor İnceleme - Test",
    dueAt: new Date(Date.now() + 7200000).toISOString(),
    isAutomated: true,
    metadata: { signals: ["doctor_review_request"] }
  });
  console.log(`✅ Created Child Task. ID: ${clinicalTaskId} (Should be different)`);

  // Verify parent-child link
  const clinicalRows = await db.executeSafe({
    text: `SELECT task_type, title, metadata FROM follow_up_tasks WHERE id = $1`,
    values: [clinicalTaskId]
  }) as any[];
  console.log(`   Child Task Metadata:`, JSON.stringify(clinicalRows[0].metadata));

  // 4. Test UI Listing filter (getAppointmentRows logic)
  console.log("\n4. Verifying UI Presentation (getAppointmentRows)...");
  
  // Query UI rows directly matching getAppointmentRows condition
  const uiRows = await db.executeSafe({
    text: `SELECT id, task_type, title, metadata->>'parent_task_id' as parent_id 
           FROM follow_up_tasks 
           WHERE tenant_id = $1 AND phone_number = $2
             AND task_type != 'appointment_reminder'
             AND metadata->>'parent_task_id' IS NULL
             AND (metadata->>'is_primary' IS NULL OR metadata->>'is_primary' != 'false')`,
    values: [tenantId, phoneNumber]
  }) as any[];

  console.log(`   UI Listing should show only Primary Task. Found rows count: ${uiRows.length}`);
  uiRows.forEach((r: any) => {
    console.log(`   * Row ID: ${r.id} | Type: ${r.task_type} | Title: "${r.title}" | Parent ID: ${r.parent_id}`);
  });

  // Query child tasks that are grouped under the primary (filter by opportunityId instead of phone_number)
  const childRows = await db.executeSafe({
    text: `SELECT id, task_type, title, metadata->>'parent_task_id' as parent_id 
           FROM follow_up_tasks 
           WHERE tenant_id = $1 AND opportunity_id = $2
             AND metadata->>'parent_task_id' = $3`,
    values: [tenantId, opportunityId, firstTaskId]
  }) as any[];
  console.log(`\n5. Verifying Drawer/Timeline Presentation...`);
  console.log(`   Drawer/Timeline should show child tasks. Found child rows count: ${childRows.length}`);
  childRows.forEach((r: any) => {
    console.log(`   * Child Task ID: ${r.id} | Type: ${r.task_type} | Title: "${r.title}" | Parent ID: ${r.parent_id}`);
  });

  // Clean up test tasks and restore original clinical task state
  console.log("\nCleaning up test tasks...");
  await db.executeSafe({
    text: `DELETE FROM follow_up_tasks WHERE phone_number = $1 AND tenant_id = $2`,
    values: [phoneNumber, tenantId]
  });

  if (originalClinicalState) {
    console.log("Restoring original Murtaza clinical task metadata to prevent pollution...");
    await db.executeSafe({
      text: `UPDATE follow_up_tasks 
             SET task_type = $1, title = $2, due_at = $3, metadata = $4::jsonb, updated_at = NOW() 
             WHERE id = $5 AND tenant_id = $6`,
      values: [
        originalClinicalState.task_type,
        originalClinicalState.title,
        originalClinicalState.due_at,
        JSON.stringify(originalClinicalState.metadata),
        clinicalTaskIdToRestore,
        tenantId
      ]
    });
  }

  console.log("=== 🧪 LIFE-CYCLE SMOKE TEST END ===");
}

main().catch(console.error);
