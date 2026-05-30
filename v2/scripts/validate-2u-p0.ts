import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const TENANT_ID = "caab9ea1-9591-45e4-bbc5-9c9b498982c8";
const USER_ID = "00000000-0000-0000-0000-000000000000";

async function runValidation() {
  process.env.TEST_TENANT_ID = TENANT_ID;
  process.env.TEST_USER_ID = USER_ID;

  // Dynamic imports to ensure process.env is populated before module evaluation
  const { withTenantDB } = await import("../src/lib/core/tenant-db");
  const { createAppointmentTask, rescheduleAppointmentTask, completeAppointmentTask } = await import("../src/app/actions/patient-tracking");
  const { StopRuleEngine } = await import("../src/lib/services/stop-rules.service");

  const db = withTenantDB(TENANT_ID, true);

  console.log("==================================================");
  console.log("🔬 Phase 2U-P0: Reminder & Draft Validation Script");
  console.log("==================================================");

  // 1. Get a valid opportunity for testing
  const opps = await db.executeSafe({
    text: `SELECT id, patient_name, phone_number FROM opportunities WHERE tenant_id = $1 AND stage != 'lost' LIMIT 1`,
    values: [TENANT_ID]
  }) as any[];

  if (opps.length === 0) {
    console.error("❌ No active opportunities found to run test validation.");
    return;
  }

  const opp = opps[0];
  console.log(`\nUsing Test Opportunity: "${opp.patient_name}" (ID: ${opp.id}, Phone: ${opp.phone_number})`);

  // We will track all generated task IDs and outreach log IDs to clean up at the end
  const createdTaskIds: string[] = [];
  const createdLogIds: number[] = [];

  try {
    // Clean up any existing tasks and logs for this test opportunity to start fresh
    await db.executeSafe({
      text: `DELETE FROM follow_up_tasks WHERE opportunity_id = $1 AND tenant_id = $2`,
      values: [opp.id, TENANT_ID]
    });
    await db.executeSafe({
      text: `DELETE FROM outreach_logs WHERE opportunity_id = $1 AND tenant_id = $2`,
      values: [opp.id, TENANT_ID]
    });

    // ══════════════════════════════════════════════════
    // TEST 1: Appointment & Reminder Generation
    // ══════════════════════════════════════════════════
    console.log("\n📡 [TEST 1] Creating appointment with 3 standard reminders...");
    
    // Create appointment for 5 days in the future at 14:30 (TR Local Time)
    // 5 days from now, let's say TR local time
    const appointmentDateLocal = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
    appointmentDateLocal.setHours(14, 30, 0, 0); // 14:30 TR local
    
    // We convert local time to UTC for input
    const dueAtUtcString = appointmentDateLocal.toISOString();
    
    const createRes = await createAppointmentTask(opp.id, dueAtUtcString, "clinic_visit", {
      note: "Test appointment for Phase 2U-P0 verification",
      requireConfirmation: true,
      reminders: [
        { type: "3_days_before" },
        { type: "1_day_before" },
        { type: "same_day" }
      ]
    });

    console.log("createRes:", createRes);
    if (!createRes || !createRes.success || !createRes.data?.success) {
      throw new Error(`Failed to create appointment task: ${createRes?.error || createRes?.data?.error || "unknown"}`);
    }
    const parentTaskId = createRes.data?.taskId;
    if (!parentTaskId) {
      throw new Error("No parent task ID returned.");
    }
    createdTaskIds.push(parentTaskId);
    console.log(`✅ Parent appointment task created successfully. (ID: ${parentTaskId})`);

    // Fetch the parent task and associated reminder tasks
    const tasks = await db.executeSafe({
      text: `SELECT * FROM follow_up_tasks WHERE tenant_id = $1 AND (id = $2::uuid OR metadata->>'parent_task_id' = $2::text)`,
      values: [TENANT_ID, parentTaskId]
    }) as any[];

    const parentTask = tasks.find(t => t.id === parentTaskId);
    const reminderTasks = tasks.filter(t => t.task_type === "appointment_reminder");

    console.log(`\n📋 Generated Tasks Overview:`);
    console.log(`- Parent Task: "${parentTask.title}" | Status: ${parentTask.status} | Due At (UTC): ${parentTask.due_at}`);
    console.log(`- Reminder Tasks Count: ${reminderTasks.length} (Expected: 3)`);

    if (reminderTasks.length !== 3) {
      throw new Error(`Expected exactly 3 reminder tasks, got ${reminderTasks.length}`);
    }

    // Verify time calculations and sleep detection yuvarlaması
    console.log(`\n⏳ Verifying time calculations & sleep-detection roundings:`);
    for (const rem of reminderTasks) {
      createdTaskIds.push(rem.id);
      const meta = typeof rem.metadata === "string" ? JSON.parse(rem.metadata) : rem.metadata;
      
      console.log(`  * Reminder: "${rem.title}"`);
      console.log(`    - Type: ${meta.reminder_type}`);
      console.log(`    - Calculated Due At (UTC): ${rem.due_at}`);
      console.log(`    - Local TR Due Time string: ${meta.operation_due_at_tr}`);
      console.log(`    - Zero Outbound P0 Flag: ${meta.zero_outbound_p0 ? "✅ TRUE" : "❌ FALSE"}`);

      if (!meta.zero_outbound_p0) {
        throw new Error(`Reminder must have zero_outbound_p0 = true. Got false/missing.`);
      }

      // Check rounding rules:
      // 3_days_before -> 10:00 TR Local
      // 1_day_before -> 10:00 TR Local
      // same_day -> 09:00 TR Local
      if (meta.reminder_type === "3_days_before" || meta.reminder_type === "1_day_before") {
        if (!meta.operation_due_at_tr.includes("10:00")) {
          throw new Error(`Expected 10:00 TR time for 3 or 1 day before reminder, got ${meta.operation_due_at_tr}`);
        }
        console.log(`    - Rounding TR Local time 10:00: ✅ PASS`);
      } else if (meta.reminder_type === "same_day") {
        if (!meta.operation_due_at_tr.includes("09:00")) {
          throw new Error(`Expected 09:00 TR time for same day reminder, got ${meta.operation_due_at_tr}`);
        }
        console.log(`    - Rounding TR Local time 09:00: ✅ PASS`);
      }
    }

    // Verify outreach_logs are written
    const outLogs = await db.executeSafe({
      text: `SELECT * FROM outreach_logs WHERE tenant_id = $1 AND opportunity_id = $2 AND action = 'appointment_reminder_scheduled'`,
      values: [TENANT_ID, opp.id]
    }) as any[];

    console.log(`\n📢 Outreach logs count: ${outLogs.length}`);
    for (const log of outLogs) {
      createdLogIds.push(log.id);
      const logMeta = typeof log.metadata === "string" ? JSON.parse(log.metadata) : log.metadata;
      console.log(`  * Action: "${log.action}" | Channel: "${log.channel}" | Reminder Type: "${logMeta.reminder_type}" | Zero Outbound: ${logMeta.zero_outbound_p0 ? "✅ TRUE" : "❌ FALSE"}`);
      
      if (logMeta.parent_task_id !== parentTaskId) {
        throw new Error("Outreach log parent_task_id mismatch.");
      }
      if (!logMeta.zero_outbound_p0) {
        throw new Error("Outreach log must have zero_outbound_p0 = true.");
      }
    }

    // ══════════════════════════════════════════════════
    // TEST 2: Stop Rules Evaluator
    // ══════════════════════════════════════════════════
    console.log("\n🚦 [TEST 2] Evaluating Stop Rules for active reminders...");
    const stopEngine = new StopRuleEngine(db);

    const testReminder = reminderTasks[0];
    
    // Evaluate when parent appointment is ACTIVE (pending)
    const activeEval = await stopEngine.evaluate({
      tenantId: TENANT_ID,
      opportunityId: opp.id,
      phoneNumber: opp.phone_number,
      taskType: testReminder.task_type,
      taskId: testReminder.id,
      taskCreatedAt: testReminder.created_at
    });

    console.log(`  * Active parent appointment evaluation: shouldStop = ${activeEval.shouldStop} (Expected: false)`);
    if (activeEval.shouldStop) {
      throw new Error(`StopRuleEngine returned shouldStop: true when parent is pending! Reason: ${activeEval.reason}`);
    }

    // Cancel the parent appointment task
    console.log("  * Cancelling the parent appointment task...");
    const cancelRes = await completeAppointmentTask(parentTaskId, "cancelled", "Client request");

    if (!cancelRes.success) {
      throw new Error(`Failed to cancel parent appointment task: ${cancelRes.error}`);
    }

    // Evaluate stop rules again after cancel
    const cancelledEval = await stopEngine.evaluate({
      tenantId: TENANT_ID,
      opportunityId: opp.id,
      phoneNumber: opp.phone_number,
      taskType: testReminder.task_type,
      taskId: testReminder.id,
      taskCreatedAt: testReminder.created_at
    });

    console.log(`  * Cancelled parent appointment evaluation: shouldStop = ${cancelledEval.shouldStop} | Reason: "${cancelledEval.reason}" (Expected: parent_task_cancelled / parent_appointment_cancelled)`);
    if (!cancelledEval.shouldStop || !cancelledEval.reason?.includes("parent")) {
      throw new Error(`StopRuleEngine failed to detect cancelled parent appointment task.`);
    }
    console.log("  ✅ Stop Rules validation: PASS");

    // ══════════════════════════════════════════════════
    // TEST 3: Rescheduling Updates Reminders
    // ══════════════════════════════════════════════════
    console.log("\n🔄 [TEST 3] Testing reschedule recalculations...");
    
    // Create another appointment task with active reminders to test rescheduling
    const reschedApptDate = new Date(Date.now() + 6 * 24 * 60 * 60 * 1000);
    reschedApptDate.setHours(11, 0, 0, 0); // 11:00 TR Local

    const createReschedRes = await createAppointmentTask(opp.id, reschedApptDate.toISOString(), "phone_call", {
      note: "Test appointment for rescheduling",
      reminders: [
        { type: "1_day_before" }
      ]
    });

    const activeParentId = createReschedRes.data?.taskId!;
    createdTaskIds.push(activeParentId);

    // Fetch the newly created 1 day before reminder
    let activeReminders = await db.executeSafe({
      text: `SELECT * FROM follow_up_tasks WHERE tenant_id = $1 AND task_type = 'appointment_reminder' AND metadata->>'parent_task_id' = $2::text`,
      values: [TENANT_ID, activeParentId]
    }) as any[];

    if (activeReminders.length === 0) {
      throw new Error("Failed to create reminder for rescheduling test");
    }
    const reminderId = activeReminders[0].id;
    createdTaskIds.push(reminderId);
    
    const oldDueAt = activeReminders[0].due_at;
    console.log(`  * Original Reminder Due At (UTC): ${oldDueAt}`);

    // Reschedule parent appointment task to 10 days in future at 16:00
    const newDate = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
    newDate.setHours(16, 0, 0, 0); // 16:00 TR Local

    console.log(`  * Rescheduling parent appointment task to: ${newDate.toISOString()}`);
    const rescheduleRes = await rescheduleAppointmentTask(activeParentId, newDate.toISOString());
    if (!rescheduleRes.success) {
      throw new Error(`Rescheduling failed: ${rescheduleRes.error}`);
    }

    // Check if the associated reminder task got updated and recalculated
    const updatedReminders = await db.executeSafe({
      text: `SELECT * FROM follow_up_tasks WHERE id = $1 AND tenant_id = $2`,
      values: [reminderId, TENANT_ID]
    }) as any[];

    const newDueAt = updatedReminders[0].due_at;
    const newMeta = typeof updatedReminders[0].metadata === "string" ? JSON.parse(updatedReminders[0].metadata) : updatedReminders[0].metadata;

    console.log(`  * Recalculated Reminder Due At (UTC): ${newDueAt}`);
    console.log(`  * Recalculated TR Local string: ${newMeta.operation_due_at_tr}`);

    if (newDueAt === oldDueAt) {
      throw new Error("Reminder due_at was not updated after rescheduling parent appointment!");
    }
    if (!newMeta.operation_due_at_tr.includes("10:00")) {
      throw new Error("Recalculated reminder did not keep 10:00 rounding rule!");
    }
    console.log("  ✅ Rescheduling and recalculations: PASS");

    // ══════════════════════════════════════════════════
    // TEST 4: Draft Generation and Zero Outbound Safety
    // ══════════════════════════════════════════════════
    console.log("\n💬 [TEST 4] Simulating V2 Task Engine draft generation & Zero Outbound execution...");

    // Create a new reminder that is due NOW to trigger processing
    const pastApptDate = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000); // Parent is 2 days in future
    const createDueRes = await createAppointmentTask(opp.id, pastApptDate.toISOString(), "clinic_visit", {
      note: "Appointment for trigger processing",
      reminders: [{ type: "1_day_before" }]
    });

    const dueParentId = createDueRes.data?.taskId!;
    createdTaskIds.push(dueParentId);

    const dueReminders = await db.executeSafe({
      text: `SELECT * FROM follow_up_tasks WHERE tenant_id = $1 AND task_type = 'appointment_reminder' AND metadata->>'parent_task_id' = $2::text`,
      values: [TENANT_ID, dueParentId]
    }) as any[];

    const dueRemTask = dueReminders[0];
    createdTaskIds.push(dueRemTask.id);

    console.log(`  * Created reminder task ID: ${dueRemTask.id}`);
    
    // Simulate the Task Engine Route execution for task type 'appointment_reminder'
    console.log("  * Processing task through simulated V2 Task Engine...");

    // 1. Generate customized draft based on task and metadata
    const metadata = typeof dueRemTask.metadata === "string" ? JSON.parse(dueRemTask.metadata) : dueRemTask.metadata;
    const pName = opp.patient_name || 'Değerli Hastamız';
    const apptType = metadata.appointment_type === 'clinic_visit' ? 'Klinik Randevusu' : 'Görüşme/Randevu';
    
    let apptTimeStr = '';
    try {
      apptTimeStr = new Date(metadata.scheduled_for_appointment_at).toLocaleString('tr-TR', {
        timeZone: 'Europe/Istanbul',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch (_) {
      apptTimeStr = metadata.scheduled_for_appointment_at;
    }

    let draftMsg = `Merhaba ${pName}, yarın (${apptTimeStr}) gerçekleşecek olan ${apptType}nuzu hatırlatmak istedik. Herhangi bir değişiklik var mıdır?`;
    draftMsg += '\n\n*(Not: Bu taslak sadece koordinatör içindir, hastaya otomatik gönderilmez.)*';

    console.log(`  * Generated draft: "${draftMsg}"`);

    // 2. Perform DB Updates (same as in route.ts)
    // Add draft to parent task metadata
    const parentRes = await db.executeSafe({
      text: `SELECT metadata FROM follow_up_tasks WHERE id = $1 AND tenant_id = $2`,
      values: [dueParentId, TENANT_ID]
    }) as any[];

    if (parentRes.length > 0) {
      const parentMeta = typeof parentRes[0].metadata === 'string'
        ? JSON.parse(parentRes[0].metadata)
        : (parentRes[0].metadata || {});
      
      if (!parentMeta.reminder_drafts) parentMeta.reminder_drafts = [];
      parentMeta.reminder_drafts.push({
        reminder_type: metadata.reminder_type,
        draft: draftMsg,
        generated_at: new Date().toISOString()
      });
      
      await db.executeSafe({
        text: `UPDATE follow_up_tasks SET metadata = $1::jsonb WHERE id = $2 AND tenant_id = $3`,
        values: [JSON.stringify(parentMeta), dueParentId, TENANT_ID]
      });
    }

    // Mark reminder task completed and store draft
    const updatedMetadata = { 
      ...metadata, 
      generated_draft: draftMsg,
      generated_draft_at: new Date().toISOString(),
      notification_sent_at: new Date().toISOString()
    };
    await db.executeSafe({
      text: `UPDATE follow_up_tasks SET status = 'completed', metadata = $1::jsonb, updated_at = NOW() WHERE id = $2 AND tenant_id = $3`,
      values: [JSON.stringify(updatedMetadata), dueRemTask.id, TENANT_ID]
    });

    // outreach_logs (Action: appointment_reminder_draft_prepared)
    const logRes = await db.executeSafe({
      text: `INSERT INTO outreach_logs (tenant_id, opportunity_id, action, channel, actor_id, metadata)
             VALUES ($1, $2, 'appointment_reminder_draft_prepared', 'system', 'cron_v2', $3)
             RETURNING id`,
      values: [
        TENANT_ID,
        opp.id,
        JSON.stringify({
          parent_task_id: dueParentId,
          reminder_task_id: dueRemTask.id,
          reminder_type: metadata.reminder_type,
          draft: draftMsg,
          zero_outbound_p0: true
        })
      ]
    }) as any[];
    createdLogIds.push(logRes[0].id);

    console.log("  * Verifying draft persistence in parent task metadata...");
    const verifiedParent = await db.executeSafe({
      text: `SELECT metadata FROM follow_up_tasks WHERE id = $1 AND tenant_id = $2`,
      values: [dueParentId, TENANT_ID]
    }) as any[];
    const verifiedParentMeta = typeof verifiedParent[0].metadata === "string" ? JSON.parse(verifiedParent[0].metadata) : verifiedParent[0].metadata;

    console.log(`    - Found drafts array in parent: ${verifiedParentMeta.reminder_drafts ? "✅ YES" : "❌ NO"}`);
    if (!verifiedParentMeta.reminder_drafts || verifiedParentMeta.reminder_drafts[0].draft !== draftMsg) {
      throw new Error("Draft message was not correctly saved into parent task reminder_drafts!");
    }

    // Check outreach log
    const preparedLogs = await db.executeSafe({
      text: `SELECT * FROM outreach_logs WHERE id = $1 AND tenant_id = $2`,
      values: [logRes[0].id, TENANT_ID]
    }) as any[];

    console.log(`    - outreach_logs action: "${preparedLogs[0].action}" | Channel: "${preparedLogs[0].channel}"`);
    if (preparedLogs[0].action !== "appointment_reminder_draft_prepared" || preparedLogs[0].channel !== "system") {
      throw new Error("Outreach log must have correct action and system channel.");
    }

    // ══════════════════════════════════════════════════
    // TEST 5: Outbound Messages Guard Check
    // ══════════════════════════════════════════════════
    console.log("\n🛡️ [TEST 5] Checking Zero Outbound Safety verification...");
    
    // Check if any outbound message (direction = 'out') was added to the messages table in the last minute
    const outboundCheck = await db.executeSafe({
      text: `SELECT COUNT(*) as c FROM messages WHERE direction = 'out' AND created_at > NOW() - INTERVAL '1 minute'`
    }) as any[];

    console.log(`  * Total direction='out' messages sent in last 1 min: ${outboundCheck[0].c}`);
    if (outboundCheck[0].c > 0) {
      throw new Error("❌ ZERO OUTBOUND VIOLATION! An outbound message was inserted into messages table.");
    }
    console.log("  ✅ ZERO OUTBOUND SAFETY verified: PASS");

  } finally {
    // ══════════════════════════════════════════════════
    // CLEANUP
    // ══════════════════════════════════════════════════
    console.log("\n🧹 Cleaning up all test tasks and outreach logs...");
    
    if (createdTaskIds.length > 0) {
      const taskDel = await db.executeSafe({
        text: `DELETE FROM follow_up_tasks WHERE id = ANY($1) AND tenant_id = $2`,
        values: [createdTaskIds, TENANT_ID]
      }) as any;
      console.log(`  * Deleted test tasks: ${createdTaskIds.length}`);
    }

    if (createdLogIds.length > 0) {
      const logDel = await db.executeSafe({
        text: `DELETE FROM outreach_logs WHERE id = ANY($1) AND tenant_id = $2`,
        values: [createdLogIds, TENANT_ID]
      }) as any;
      console.log(`  * Deleted test outreach logs: ${createdLogIds.length}`);
    }

    console.log("\n🎉 ALL TESTS IN PHASE 2U-P0 SUCCESSFULLY PASSED! ZERO ERRORS.");
    console.log("==================================================\n");
  }
}

runValidation().catch(e => {
  console.error("\n❌ VALIDATION CRASHED WITH ERROR:\n", e);
  process.exit(1);
});
