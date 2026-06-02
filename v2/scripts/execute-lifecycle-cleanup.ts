import { neon } from "@neondatabase/serverless";
import * as dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.join(__dirname, "../.env.local") });
const appDatabaseUrl = process.env.APP_DATABASE_URL || process.env.DATABASE_URL;

const TENANT_ID = "caab9ea1-9591-45e4-bbc5-9c9b498982c8";
const CHECKPOINT = "operations-task-lifecycle-unification";

// Define the exact task mappings
const CANCEL_TASKS = [
  { id: "f8319733-264e-4fbe-9be4-34198f8fd4bc", supersededBy: "9ee4ff76-2365-460f-b075-049584f0d0a9" }, // Aysu
  { id: "cc8257d9-00bd-4f50-93ee-89a340828f8b", supersededBy: "e184c07a-5b64-4a13-a15e-22ab84dc9d05" }  // Ömer Ali
];

const CHILD_TASKS = [
  { id: "9ee4ff76-2365-460f-b075-049584f0d0a9", parentId: "76f167f9-eddb-439c-b1dd-78a9d13e2859", lane: "clinical_review_lifecycle" }, // Aysu
  { id: "f347f1b0-b74e-4de3-b790-e111c3eee7ad", parentId: "76f167f9-eddb-439c-b1dd-78a9d13e2859", lane: "appointment_lifecycle" },     // Aysu
  { id: "39618209-9952-4242-b337-b3cb35d845b3", parentId: "cf7eb589-43ac-463f-b660-589ca4208885", lane: "clinical_review_lifecycle" }, // Murtaza
  { id: "44beb5c2-41cd-430d-a96c-00dd866c24bc", parentId: "c37176fc-afb9-46b8-a858-d96808f68a8a", lane: "appointment_lifecycle" },     // Ömer Ali
  { id: "e184c07a-5b64-4a13-a15e-22ab84dc9d05", parentId: "c37176fc-afb9-46b8-a858-d96808f68a8a", lane: "clinical_review_lifecycle" }  // Ömer Ali
];

const PRIMARY_TASKS = [
  { id: "76f167f9-eddb-439c-b1dd-78a9d13e2859", lane: "communication_lifecycle" }, // Aysu
  { id: "cf7eb589-43ac-463f-b660-589ca4208885", lane: "appointment_lifecycle" },     // Murtaza
  { id: "c37176fc-afb9-46b8-a858-d96808f68a8a", lane: "communication_lifecycle" }  // Ömer Ali
];

async function main() {
  if (!appDatabaseUrl) {
    console.error("No database URL found.");
    process.exit(1);
  }
  const sql = neon(appDatabaseUrl);

  console.log("=========================================");
  console.log("PHASE 5 HISTORICAL CLEANUP EXECUTION");
  console.log("=========================================\n");

  // 1. Fetch current stats before cleanup
  console.log("--- 📊 BEFORE CLEANUP STATUS & STANDALONE COUNTS ---");
  await printVerificationReport(sql);

  console.log("\nFetching current task state to prepare updates...");

  // Load all tasks metadata
  const allIds = [
    ...PRIMARY_TASKS.map(p => p.id),
    ...CHILD_TASKS.map(c => c.id),
    ...CANCEL_TASKS.map(cn => cn.id)
  ];

  const currentTasks = await sql`
    SELECT id, status, metadata 
    FROM follow_up_tasks 
    WHERE id = ANY(${allIds}) AND tenant_id = ${TENANT_ID}
  `;

  const taskMap = new Map<string, { status: string; metadata: any }>();
  currentTasks.forEach((t: any) => {
    taskMap.set(t.id, { status: t.status, metadata: t.metadata || {} });
  });

  // Verify all tasks exist in DB before running
  for (const id of allIds) {
    if (!taskMap.has(id)) {
      console.error(`Error: Task with ID ${id} not found in database!`);
      process.exit(1);
    }
  }

  const timestamp = new Date().toISOString();
  console.log("Preparing transaction batch...");

  try {
    // Execute all updates in a stateless batch transaction using the Neon tx builder
    await sql.transaction(tx => {
      const updates = [];

      // 1. Primary Tasks updates
      for (const p of PRIMARY_TASKS) {
        const state = taskMap.get(p.id)!;
        const newMeta = {
          ...state.metadata,
          is_primary: true,
          lane: p.lane
        };
        updates.push(tx`
          UPDATE follow_up_tasks 
          SET metadata = ${JSON.stringify(newMeta)}::jsonb, updated_at = NOW()
          WHERE id = ${p.id} AND tenant_id = ${TENANT_ID}
        `);
      }

      // 2. Child Tasks updates
      for (const c of CHILD_TASKS) {
        const state = taskMap.get(c.id)!;
        const newMeta = {
          ...state.metadata,
          is_primary: false,
          parent_task_id: c.parentId,
          lane: c.lane,
          cleanup_action: "attach_child_task",
          cleanup_checkpoint: CHECKPOINT,
          cleanup_at: timestamp
        };
        updates.push(tx`
          UPDATE follow_up_tasks 
          SET metadata = ${JSON.stringify(newMeta)}::jsonb, updated_at = NOW()
          WHERE id = ${c.id} AND tenant_id = ${TENANT_ID}
        `);
      }

      // 3. Cancelled Duplicate Tasks updates
      for (const cn of CANCEL_TASKS) {
        const state = taskMap.get(cn.id)!;
        const newMeta = {
          ...state.metadata,
          cleanup_action: "cancel_duplicate_lane",
          cleanup_checkpoint: CHECKPOINT,
          cleanup_at: timestamp,
          superseded_by_task: cn.supersededBy,
          previous_status: state.status
        };
        updates.push(tx`
          UPDATE follow_up_tasks 
          SET status = 'cancelled', 
              skipped_reason = 'duplicate_lane_cleanup',
              metadata = ${JSON.stringify(newMeta)}::jsonb, 
              updated_at = NOW()
          WHERE id = ${cn.id} AND tenant_id = ${TENANT_ID}
        `);
      }

      return updates;
    });

    console.log("\nTransaction successfully committed!");
  } catch (error) {
    console.error("\nTransaction failed! Changes rolled back.", error);
    process.exit(1);
  }

  // 2. Fetch current stats after cleanup
  console.log("\n--- 📊 AFTER CLEANUP STATUS & STANDALONE COUNTS ---");
  await printVerificationReport(sql);

  console.log("\n=========================================");
  console.log("CLEANUP COMPLETED SUCCESSFULLY");
  console.log("=========================================");
}

async function printVerificationReport(sql: any) {
  // Query details for Aysu, Murtaza, Ömer Ali
  const patientOpps = await sql`
    SELECT id, patient_name, phone_number
    FROM opportunities
    WHERE tenant_id = ${TENANT_ID} AND (patient_name LIKE '%Aysu%' OR patient_name LIKE '%Ömer%' OR patient_name LIKE '%Murtaza%')
  `;

  for (const opp of patientOpps) {
    console.log(`\nPatient: ${opp.patient_name} (${opp.id})`);
    
    // Standalone rows query (is_primary IS NOT false AND parent_task_id IS NULL)
    const standaloneTasks = await sql`
      SELECT id, task_type, title, status, metadata->>'parent_task_id' as parent_id, metadata->>'is_primary' as is_primary
      FROM follow_up_tasks
      WHERE opportunity_id = ${opp.id} AND tenant_id = ${TENANT_ID}
        AND status IN ('pending', 'in_progress')
        AND (metadata->>'parent_task_id' IS NULL)
        AND (metadata->>'is_primary' IS NULL OR metadata->>'is_primary' != 'false')
    `;
    console.log(`  * Standalone Active Rows count in UI List: ${standaloneTasks.length}`);
    standaloneTasks.forEach((t: any) => {
      console.log(`    - ID: ${t.id} | Type: ${t.task_type} | Title: "${t.title}" | Status: ${t.status} | Primary: ${t.is_primary}`);
    });

    // Child tasks query
    const childTasks = await sql`
      SELECT id, task_type, title, status, metadata->>'parent_task_id' as parent_id, metadata->>'is_primary' as is_primary
      FROM follow_up_tasks
      WHERE opportunity_id = ${opp.id} AND tenant_id = ${TENANT_ID}
        AND (metadata->>'parent_task_id' IS NOT NULL OR metadata->>'is_primary' = 'false')
        AND status IN ('pending', 'in_progress')
    `;
    console.log(`  * Child Rows count in Drawer/Timeline: ${childTasks.length}`);
    childTasks.forEach((t: any) => {
      console.log(`    - ID: ${t.id} | Type: ${t.task_type} | Title: "${t.title}" | Status: ${t.status} | Parent ID: ${t.parent_id}`);
    });

    // Cancelled duplicate tasks query
    const cancelledTasks = await sql`
      SELECT id, task_type, title, status, metadata->>'cancel_reason' as cancel_reason, metadata->>'superseded_by_task' as superseded_by
      FROM follow_up_tasks
      WHERE opportunity_id = ${opp.id} AND tenant_id = ${TENANT_ID}
        AND status = 'cancelled'
        AND metadata->>'cleanup_checkpoint' = ${CHECKPOINT}
    `;
    console.log(`  * Cancelled Duplicate Rows count: ${cancelledTasks.length}`);
    cancelledTasks.forEach((t: any) => {
      console.log(`    - ID: ${t.id} | Type: ${t.task_type} | Title: "${t.title}" | Status: ${t.status} | Superseded by: ${t.superseded_by}`);
    });
  }
}

main().catch(console.error);
