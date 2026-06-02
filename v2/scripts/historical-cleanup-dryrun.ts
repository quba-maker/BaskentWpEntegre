import { neon } from "@neondatabase/serverless";
import * as dotenv from "dotenv";
import { getTaskLane } from "../src/lib/domain/task/lanes";

dotenv.config({ path: "/Users/mustafa/Desktop/baskent-wp-entegre/v2/.env.local" });
const appDatabaseUrl = process.env.APP_DATABASE_URL || process.env.DATABASE_URL;

const DRYRUN_ID = `dryrun_${Date.now()}`;

async function main() {
  if (!appDatabaseUrl) {
    console.error("No database URL found in env.");
    process.exit(1);
  }
  const sql = neon(appDatabaseUrl);

  console.log("=========================================");
  console.log("REVISED HISTORICAL DUPLICATE TASK CLEANUP - DRY RUN");
  console.log(`Dry-Run ID: ${DRYRUN_ID}`);
  console.log("=========================================");

  // 1. Fetch all tenants
  const tenants = await sql`SELECT id, name FROM tenants`;
  console.log(`Found ${tenants.length} tenants.`);

  for (const tenant of tenants) {
    console.log(`\nAnalyzing Tenant: ${tenant.name} (${tenant.id})`);

    // 2. Fetch all opportunities in terminal/superseded stages with active tasks
    const orphanTasks = await sql`
      SELECT t.id, t.opportunity_id, t.task_type, t.title, t.status, t.due_at, t.created_at, o.stage as opp_stage
      FROM follow_up_tasks t
      JOIN opportunities o ON o.id = t.opportunity_id AND o.tenant_id = t.tenant_id
      WHERE t.tenant_id = ${tenant.id}
        AND t.status IN ('pending', 'in_progress')
        AND o.stage IN ('lost', 'not_qualified', 'arrived')
      ORDER BY t.created_at DESC
    `;

    console.log(`\n  --- 🚨 ORPHAN TASKS ON TERMINAL OPPORTUNITIES (${orphanTasks.length} candidates) ---`);
    orphanTasks.forEach((t: any) => {
      console.log(`  * Candidate: CANCEL task ${t.id} | Stage: ${t.opp_stage} | Title: "${t.title}"`);
      console.log(`    Metadata Change: { status: 'cancelled', skipped_reason: 'stage_terminal', metadata.cancel_reason: 'superseded_opportunity_cancellation', metadata.cleanup_dryrun_id: '${DRYRUN_ID}' }`);
      console.log(`    UI Impact: Removes row from Open/Planned lists. Doesn't link to any parent.`);
    });

    // 3. Fetch all active opportunities to check for same-lane duplicates
    const activeOpps = await sql`
      SELECT id, patient_name, stage 
      FROM opportunities 
      WHERE tenant_id = ${tenant.id} 
        AND stage NOT IN ('lost', 'not_qualified', 'arrived')
    `;

    let totalLanesDeduped = 0;
    let totalTasksCancelled = 0;
    let totalTasksChilded = 0;

    for (const opp of activeOpps) {
      // Fetch active tasks for this opportunity
      const oppTasks = await sql`
        SELECT id, task_type, title, status, due_at, created_at, metadata
        FROM follow_up_tasks
        WHERE opportunity_id = ${opp.id} AND tenant_id = ${tenant.id}
          AND status IN ('pending', 'in_progress')
        ORDER BY created_at DESC
      `;

      if (oppTasks.length <= 1) continue;

      // Group tasks by lane
      const laneGroups: Record<string, any[]> = {};
      for (const t of oppTasks) {
        const lane = getTaskLane(t.task_type);
        if (!laneGroups[lane]) laneGroups[lane] = [];
        laneGroups[lane].push(t);
      }

      const tasksToCancel = new Set<string>();
      const tasksToKeep = new Set<string>();
      const cancelMappings: Record<string, string> = {}; // duplicateId -> keepId

      // Check duplicates in each lane
      for (const lane in laneGroups) {
        const tasks = laneGroups[lane];
        if (tasks.length > 1) {
          totalLanesDeduped++;
          // Precedence logic: keep the highest precedence (first in DESC created_at or highest priority)
          const keepTask = tasks[0]; 
          tasksToKeep.add(keepTask.id);
          
          for (let i = 1; i < tasks.length; i++) {
            const dup = tasks[i];
            tasksToCancel.add(dup.id);
            cancelMappings[dup.id] = keepTask.id;
            totalTasksCancelled++;
          }
        } else if (tasks.length === 1) {
          tasksToKeep.add(tasks[0].id);
        }
      }

      // Check parent-child relationship (cross-lane primary promotion/childing)
      // Primary candidate must be one of the tasks we are KEEPING
      const primaryCandidate = oppTasks.find(t => {
        const lane = getTaskLane(t.task_type);
        return (lane === 'appointment_lifecycle' || lane === 'communication_lifecycle') && tasksToKeep.has(t.id);
      }) || oppTasks.find(t => tasksToKeep.has(t.id));

      if (primaryCandidate) {
        // Filter other tasks that we are KEEPING and are not yet linked to a parent
        const unlinkedOthers = oppTasks.filter(t => 
          t.id !== primaryCandidate.id && 
          tasksToKeep.has(t.id) && 
          !t.metadata?.parent_task_id
        );

        // 4. Output results for Aysu, Ömer Ali, Murtaza etc.
        const oppName = opp.patient_name || opp.id;
        const isTargetOpp = oppName.includes("Aysu") || oppName.includes("Ömer") || oppTasks.some(t => t.id === 'cf7eb589-43ac-463f-b660-589ca4208885');

        if (isTargetOpp || tasksToCancel.size > 0 || unlinkedOthers.length > 0) {
          console.log(`\n  --- 👤 Patient: ${oppName} ---`);
          console.log(`  [PRIMARY KEEP] Task: ${primaryCandidate.id} | Type: ${primaryCandidate.task_type} | Title: "${primaryCandidate.title}"`);
          console.log(`    Metadata Change: { metadata.is_primary: true, metadata.lane: '${getTaskLane(primaryCandidate.task_type)}', metadata.cleanup_dryrun_id: '${DRYRUN_ID}' }`);

          // Output duplicate cancellations
          tasksToCancel.forEach(cancelId => {
            const t = oppTasks.find(x => x.id === cancelId);
            const keepId = cancelMappings[cancelId];
            if (t) {
              console.log(`  [CANCEL DUPLICATE] Task: ${cancelId} | Type: ${t.task_type} | Title: "${t.title}"`);
              console.log(`    Metadata Change: { status: 'cancelled', skipped_reason: 'duplicate_lane_cleanup', metadata.cancel_reason: 'duplicate_lane_cleanup', metadata.superseded_by_task: '${keepId}', metadata.cleanup_dryrun_id: '${DRYRUN_ID}' }`);
              console.log(`    UI Impact: Removed from Open/Planned tab lists completely.`);
            }
          });

          // Output child links (only active tasks we keep!)
          unlinkedOthers.forEach(t => {
            totalTasksChilded++;
            console.log(`  [LINK AS CHILD] Task: ${t.id} | Type: ${t.task_type} | Title: "${t.title}"`);
            console.log(`    Metadata Change: { metadata.is_primary: false, metadata.parent_task_id: '${primaryCandidate.id}', metadata.cleanup_dryrun_id: '${DRYRUN_ID}' }`);
            console.log(`    UI Impact: Removed from main parent rows; moves into parent task's detail drawer and patient timeline.`);
          });
        }
      }
    }

    console.log(`\n=========================================`);
    console.log(`Summary for Tenant: ${tenant.name}`);
    console.log(`- Orphan Tasks (to Cancel): ${orphanTasks.length}`);
    console.log(`- Duplicate Lanes Deduped: ${totalLanesDeduped}`);
    console.log(`- Active Tasks Cancelled: ${totalTasksCancelled}`);
    console.log(`- Active Tasks Childed: ${totalTasksChilded}`);
    console.log(`=========================================`);
  }

  console.log("\n=========================================");
  console.log("ROLLBACK PLAN");
  console.log("=========================================");
  console.log("Since all historical cleanups write `metadata.cleanup_dryrun_id = <dryrun_id>`, we can fully roll back any cleanup actions using this single SQL script:");
  console.log(`
  BEGIN;
  
  -- 1. Restore cancelled tasks back to pending
  UPDATE follow_up_tasks 
  SET status = 'pending',
      skipped_reason = NULL,
      metadata = metadata - 'cancel_reason' - 'superseded_by_task' - 'cleanup_dryrun_id'
  WHERE metadata->>'cleanup_dryrun_id' = '${DRYRUN_ID}'
    AND status = 'cancelled';
    
  -- 2. Remove parent task relationships and restore is_primary flag
  UPDATE follow_up_tasks 
  SET metadata = metadata - 'parent_task_id' - 'is_primary' - 'cleanup_dryrun_id'
  WHERE metadata->>'cleanup_dryrun_id' = '${DRYRUN_ID}';
  
  COMMIT;
  `);
}

main().catch(console.error);
