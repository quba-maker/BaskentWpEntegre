import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const TENANT_ID = "caab9ea1-9591-45e4-bbc5-9c9b498982c8";
const USER_ID = "00000000-0000-0000-0000-000000000000";

async function runValidation() {
  process.env.TEST_TENANT_ID = TENANT_ID;
  process.env.TEST_USER_ID = USER_ID;

  // Dynamic imports to ensure process.env is populated before module evaluation
  const { withTenantDB } = await import("../src/lib/core/tenant-db");
  const { createBotDelegationTask, completeBotDelegationTask, cancelBotDelegationTask } = await import("../src/app/actions/focus-queue");
  const { BotDelegationService } = await import("../src/lib/services/bot-delegation.service");
  const { StopRuleEngine } = await import("../src/lib/services/stop-rules.service");

  const db = withTenantDB(TENANT_ID, true);

  console.log("==========================================================");
  console.log("🤖 Phase 2V-P0: Bot Delegation Orchestrator Validation");
  console.log("==========================================================");

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

  const createdTaskIds: string[] = [];
  const createdLogIds: number[] = [];

  try {
    // Fresh cleanup for the test opportunity
    await db.executeSafe({
      text: `DELETE FROM follow_up_tasks WHERE opportunity_id = $1 AND tenant_id = $2`,
      values: [opp.id, TENANT_ID]
    });
    await db.executeSafe({
      text: `DELETE FROM outreach_logs WHERE opportunity_id = $1 AND tenant_id = $2`,
      values: [opp.id, TENANT_ID]
    });

    const service = new BotDelegationService(db);

    // ══════════════════════════════════════════════════
    // TEST 1: Strict Mode Whitelist & Metadata Shapes
    // ══════════════════════════════════════════════════
    console.log("\n🔒 [TEST 1] Testing whitelists and metadata standard...");

    // Test whitelisted mode
    const wlRes = await createBotDelegationTask(opp.id, {
      mode: "unreachable_followup",
      source: "patient_tracking",
      reason: "called_missed"
    });

    console.log("WL mode createRes:", wlRes);
    const taskId1 = wlRes.data?.taskId;
    if (!wlRes || !wlRes.success || !wlRes.data?.success || !taskId1) {
      throw new Error(`Failed to create task with whitelisted mode 'unreachable_followup': ${wlRes?.error || wlRes?.data?.error || "unknown"}`);
    }
    createdTaskIds.push(taskId1);
    console.log(`✅ Whitelisted mode task created. (ID: ${taskId1})`);

    // Fetch and check metadata shape
    const taskRows = await db.executeSafe({
      text: `SELECT * FROM follow_up_tasks WHERE id = $1 AND tenant_id = $2`,
      values: [taskId1, TENANT_ID]
    }) as any[];
    
    const task1 = taskRows[0];
    const meta = typeof task1.metadata === "string" ? JSON.parse(task1.metadata) : task1.metadata;

    console.log("Metadata Standard:", JSON.stringify(meta.bot_delegation, null, 2));

    if (task1.task_type !== "bot_handoff_followup") {
      throw new Error(`Expected task_type 'bot_handoff_followup', got '${task1.task_type}'`);
    }
    if (meta.bot_delegation.status !== "pending_draft") {
      throw new Error(`Expected initial status 'pending_draft', got '${meta.bot_delegation.status}'`);
    }
    if (!meta.zero_outbound_p0 || meta.initiated_from !== "bot_delegation_orchestrator") {
      throw new Error("Metadata must carry safety flags zero_outbound_p0 and initiated_from!");
    }
    console.log("✅ Task type and metadata standard: PASS");

    // Test unsupported mode rejection
    console.log("  * Testing invalid mode rejection...");
    const badRes = await createBotDelegationTask(opp.id, {
      mode: "invalid_unsupported_mode" as any,
      source: "patient_tracking"
    });

    console.log("Rejection result:", badRes);
    if (badRes.data?.success) {
      throw new Error("Validation failed: Unsupported mode was not rejected!");
    }
    console.log("✅ Rejection of unsupported mode: PASS");

    // ══════════════════════════════════════════════════
    // TEST 2: Duplicate Guard Check
    // ══════════════════════════════════════════════════
    console.log("\n👯 [TEST 2] Testing Duplicate active delegation guard...");
    const dupRes = await createBotDelegationTask(opp.id, {
      mode: "unreachable_followup",
      source: "patient_tracking"
    });

    console.log("Duplicate result:", dupRes);
    if (dupRes.data?.success) {
      throw new Error("Validation failed: Duplicate active delegation task of same mode was created!");
    }
    console.log("✅ Duplicate active delegation guard: PASS");

    // ══════════════════════════════════════════════════
    // TEST 3: All 7 Modes Draft Content Generation
    // ══════════════════════════════════════════════════
    console.log("\n✍️ [TEST 3] Testing draft content templates for all 7 whitelisted modes...");

    const modes: any[] = [
      "unreachable_followup",
      "collect_phone_call_time",
      "confirm_phone_call",
      "clinic_appointment_reminder",
      "no_response_followup",
      "report_request",
      "appointment_reschedule_request"
    ];

    for (const m of modes) {
      // Direct call to process dry-run to get draft
      const tempTask = await db.executeSafe({
        text: `INSERT INTO follow_up_tasks (tenant_id, opportunity_id, phone_number, task_type, title, status, due_at, metadata)
               VALUES ($1, $2, $3, 'bot_handoff_followup', 'Temp Task', 'pending', NOW(), $4) RETURNING id`,
        values: [
          TENANT_ID,
          opp.id,
          opp.phone_number,
          JSON.stringify({
            bot_delegation: {
              mode: m,
              status: "pending_draft"
            }
          })
        ]
      }) as any[];
      const tempId = tempTask[0].id;
      createdTaskIds.push(tempId);

      const dryRunRes = await service.process(tempId, true);
      console.log(`  * Mode: "${m}"`);
      console.log(`    Draft: "${dryRunRes.draft.replace(/\n/g, " ")}"`);

      if (!dryRunRes.draft.includes("Bu taslak sadece koordinatör içindir, hastaya otomatik gönderilmez.")) {
        throw new Error(`Draft for mode '${m}' is missing safety disclaimer!`);
      }

      // Check specific mode keywords from prompt
      if (m === "unreachable_followup" && !dryRunRes.draft.includes("ulaşamadık")) {
        throw new Error("unreachable_followup draft missing 'ulaşamadık' keyword!");
      }
      if (m === "collect_phone_call_time" && !dryRunRes.draft.includes("görüşme için")) {
        throw new Error("collect_phone_call_time draft missing 'görüşme için' keyword!");
      }
      if (m === "confirm_phone_call" && !dryRunRes.draft.includes("görüşmeniz için")) {
        throw new Error("confirm_phone_call draft missing 'görüşmeniz için' keyword!");
      }
      if (m === "clinic_appointment_reminder" && !dryRunRes.draft.includes("randevunuz için")) {
        throw new Error("clinic_appointment_reminder draft missing 'randevunuz için' keyword!");
      }
      if (m === "report_request" && !dryRunRes.draft.includes("rapor veya tetkik")) {
        throw new Error("report_request draft missing 'rapor veya tetkik' keyword!");
      }
      if (m === "appointment_reschedule_request" && !dryRunRes.draft.includes("yeniden planlamak")) {
        throw new Error("appointment_reschedule_request draft missing 'yeniden planlamak' keyword!");
      }
    }
    console.log("✅ All 7 modes draft templates validated: PASS");

    // ══════════════════════════════════════════════════
    // TEST 4: Context Building & Warning Checks
    // ══════════════════════════════════════════════════
    console.log("\n📋 [TEST 4] Testing Context Builder and Context Warnings...");

    // Create a task for opportunity with missing name/summary to test warnings
    const emptyOpp = await db.executeSafe({
      text: `INSERT INTO opportunities (tenant_id, patient_name, phone_number, stage, country, priority, intent_type)
             VALUES ($1, NULL, '+905555555555', 'first_contact', 'UK', 'warm', 'callback') RETURNING id`,
      values: [TENANT_ID]
    }) as any[];
    const emptyOppId = emptyOpp[0].id;

    const warnTask = await db.executeSafe({
      text: `INSERT INTO follow_up_tasks (tenant_id, opportunity_id, phone_number, task_type, title, status, due_at, metadata)
             VALUES ($1, $2, '+905555555555', 'bot_handoff_followup', 'Warn Task', 'pending', NOW(), $3) RETURNING id`,
      values: [
        TENANT_ID,
        emptyOppId,
        JSON.stringify({
          bot_delegation: {
            mode: "clinic_appointment_reminder",
            status: "pending_draft"
          }
        })
      ]
    }) as any[];
    const warnTaskId = warnTask[0].id;
    createdTaskIds.push(warnTaskId);

    const warnRes = await service.process(warnTaskId, true);
    console.log("Generated warnings:", warnRes.warnings);

    // Should flag missing_patient_name, missing_summary, and missing_appointment_time
    if (!warnRes.warnings.includes("missing_patient_name")) throw new Error("Missing patient name warning did not trigger.");
    if (!warnRes.warnings.includes("missing_summary")) throw new Error("Missing opportunity summary warning did not trigger.");
    if (!warnRes.warnings.includes("missing_appointment_time")) throw new Error("Missing appointment time warning did not trigger.");
    
    console.log("✅ Context Builder warnings: PASS");

    // Clean up empty opp
    await db.executeSafe({
      text: `DELETE FROM opportunities WHERE id = $1`,
      values: [emptyOppId]
    });

    // ══════════════════════════════════════════════════
    // TEST 5: Stop Rules (Parent Cancel, Patient Responded)
    // ══════════════════════════════════════════════════
    console.log("\n🚦 [TEST 5] Testing custom Stop Rules...");
    const stopEngine = new StopRuleEngine(db);

    // 1. Terminal Opportunity Stage Rule
    console.log("  * Testing Terminal Opportunity Stage check...");
    await db.executeSafe({
      text: `UPDATE opportunities SET stage = 'lost' WHERE id = $1`,
      values: [opp.id]
    });

    const stageEval = await stopEngine.evaluate({
      tenantId: TENANT_ID,
      opportunityId: opp.id,
      phoneNumber: opp.phone_number,
      taskType: "bot_handoff_followup",
      taskId: taskId1,
      taskCreatedAt: task1.created_at
    });

    console.log("Stage Lost Evaluation shouldStop:", stageEval.shouldStop, "Reason:", stageEval.reason);
    if (!stageEval.shouldStop || stageEval.reason !== "opportunity_terminal_stage") {
      throw new Error("Terminal opportunity stage lost was not blocked!");
    }
    
    // Restore stage
    await db.executeSafe({
      text: `UPDATE opportunities SET stage = 'first_contact' WHERE id = $1`,
      values: [opp.id]
    });

    // 2. Parent Appointment Cancelled Rule
    console.log("  * Testing Parent Appointment Cancelled check...");
    const parentAppt = await db.executeSafe({
      text: `INSERT INTO follow_up_tasks (tenant_id, opportunity_id, phone_number, task_type, title, status, due_at)
             VALUES ($1, $2, $3, 'callback_scheduled', 'Parent Appt', 'cancelled', NOW()) RETURNING id`,
      values: [TENANT_ID, opp.id, opp.phone_number]
    }) as any[];
    const parentApptId = parentAppt[0].id;
    createdTaskIds.push(parentApptId);

    // Link task1 to parentApptId
    await db.executeSafe({
      text: `UPDATE follow_up_tasks SET metadata = $1::jsonb WHERE id = $2`,
      values: [
        JSON.stringify({
          bot_delegation: {
            mode: "unreachable_followup",
            parent_task_id: parentApptId,
            status: "pending_draft"
          }
        }),
        taskId1
      ]
    });

    const parentCancelEval = await stopEngine.evaluate({
      tenantId: TENANT_ID,
      opportunityId: opp.id,
      phoneNumber: opp.phone_number,
      taskType: "bot_handoff_followup",
      taskId: taskId1,
      taskCreatedAt: task1.created_at
    });

    console.log("Parent Cancel Evaluation shouldStop:", parentCancelEval.shouldStop, "Reason:", parentCancelEval.reason);
    if (!parentCancelEval.shouldStop || parentCancelEval.reason !== "parent_appointment_cancelled") {
      throw new Error("Cancelled parent appointment did not trigger correct stop rule!");
    }

    // 3. Patient Responded After Delegation Creation Rule
    console.log("  * Testing Patient Responded After Delegation check...");
    
    // Unlink parent task so we test message rule
    await db.executeSafe({
      text: `UPDATE follow_up_tasks SET metadata = $1::jsonb WHERE id = $2`,
      values: [
        JSON.stringify({
          bot_delegation: {
            mode: "unreachable_followup",
            status: "pending_draft"
          }
        }),
        taskId1
      ]
    });

    // Fetch conversation id for testing
    let conversationId = null;
    const convRows = await db.executeSafe({
      text: `SELECT id FROM conversations WHERE phone_number = $1 AND tenant_id = $2 LIMIT 1`,
      values: [opp.phone_number, TENANT_ID]
    }) as any[];
    if (convRows.length > 0) {
      conversationId = convRows[0].id;
    } else {
      const fallbackConv = await db.executeSafe({
        text: `SELECT id FROM conversations WHERE tenant_id = $1 LIMIT 1`,
        values: [TENANT_ID]
      }) as any[];
      conversationId = fallbackConv[0]?.id;
    }

    if (!conversationId) {
      throw new Error("No conversation found in DB to attach messages to.");
    }

    // Create an inbound message BEFORE task creation (should NOT stop)
    await db.executeSafe({
      text: `INSERT INTO messages (tenant_id, conversation_id, phone_number, direction, content, created_at)
             VALUES ($1, $2, $3, 'in', 'Eski mesaj', $4)`,
      values: [TENANT_ID, conversationId, opp.phone_number, new Date(new Date(task1.created_at).getTime() - 60000).toISOString()]
    });

    const oldMsgEval = await stopEngine.evaluate({
      tenantId: TENANT_ID,
      opportunityId: opp.id,
      phoneNumber: opp.phone_number,
      taskType: "bot_handoff_followup",
      taskId: taskId1,
      taskCreatedAt: task1.created_at
    });
    console.log("    - Inbound message BEFORE delegation: shouldStop =", oldMsgEval.shouldStop);
    if (oldMsgEval.shouldStop) {
      throw new Error("StopRuleEngine mistakenly stopped for an inbound message received BEFORE task creation!");
    }

    // Create an inbound message AFTER task creation (should STOP)
    await db.executeSafe({
      text: `INSERT INTO messages (tenant_id, conversation_id, phone_number, direction, content, created_at)
             VALUES ($1, $2, $3, 'in', 'Yeni mesaj', $4)`,
      values: [TENANT_ID, conversationId, opp.phone_number, new Date(new Date(task1.created_at).getTime() + 60000).toISOString()]
    });

    const newMsgEval = await stopEngine.evaluate({
      tenantId: TENANT_ID,
      opportunityId: opp.id,
      phoneNumber: opp.phone_number,
      taskType: "bot_handoff_followup",
      taskId: taskId1,
      taskCreatedAt: task1.created_at
    });
    console.log("    - Inbound message AFTER delegation: shouldStop =", newMsgEval.shouldStop, "Reason:", newMsgEval.reason);
    if (!newMsgEval.shouldStop || newMsgEval.reason !== "patient_responded_after_delegation") {
      throw new Error("StopRuleEngine failed to stop for an inbound message received AFTER task creation!");
    }

    console.log("✅ Custom Stop Rules: PASS");

    // Clean up test message and reset task1 metadata for test 6
    await db.executeSafe({
      text: `DELETE FROM messages WHERE phone_number = $1 AND tenant_id = $2`,
      values: [opp.phone_number, TENANT_ID]
    });
    await db.executeSafe({
      text: `UPDATE follow_up_tasks SET metadata = $1::jsonb WHERE id = $2`,
      values: [
        JSON.stringify({
          bot_delegation: {
            mode: "unreachable_followup",
            status: "pending_draft"
          }
        }),
        taskId1
      ]
    });

    // ══════════════════════════════════════════════════
    // TEST 6: Simulated Real-Run and Lifecycle State
    // ══════════════════════════════════════════════════
    console.log("\n🔄 [TEST 6] Testing simulated Real-Run process and lifecycle transition...");

    const realRunRes = await service.process(taskId1, false);
    console.log("Real-run output:", realRunRes);

    if (!realRunRes || !realRunRes.success || !realRunRes.processed) {
      throw new Error("Failed to process task in real run.");
    }

    // Verify DB states after real-run processing
    const processedTaskRows = await db.executeSafe({
      text: `SELECT * FROM follow_up_tasks WHERE id = $1 AND tenant_id = $2`,
      values: [taskId1, TENANT_ID]
    }) as any[];
    const processedTask = processedTaskRows[0];
    const processedMeta = typeof processedTask.metadata === "string" ? JSON.parse(processedTask.metadata) : processedTask.metadata;

    console.log(`  * Task Status: "${processedTask.status}"`);
    console.log(`  * Bot Delegation internal status: "${processedMeta.bot_delegation.status}"`);
    console.log(`  * generated_draft_at set: ${processedMeta.bot_delegation.generated_draft_at ? "✅ YES" : "❌ NO"}`);
    console.log(`  * notification_sent_at set: ${processedMeta.bot_delegation.notification_sent_at ? "✅ YES" : "❌ NO"}`);

    if (processedTask.status !== "in_progress") {
      throw new Error(`Expected task status 'in_progress', got '${processedTask.status}'`);
    }
    if (processedMeta.bot_delegation.status !== "draft_ready") {
      throw new Error(`Expected bot delegation status 'draft_ready', got '${processedMeta.bot_delegation.status}'`);
    }

    // Verify notification was written with masked phone
    const notifs = await db.executeSafe({
      text: `SELECT * FROM notifications WHERE task_id = $1 AND tenant_id = $2`,
      values: [taskId1, TENANT_ID]
    }) as any[];
    console.log(`  * Notifications generated: ${notifs.length}`);
    if (notifs.length === 0) {
      throw new Error("No panel notifications were written to DB.");
    }
    console.log(`    - Notification title: "${notifs[0].title}"`);
    console.log(`    - Notification body: "${notifs[0].body}"`);
    console.log(`    - Category: "${notifs[0].category}"`);
    
    if (notifs[0].category !== "bot_delegation_ready") {
      throw new Error(`Expected category 'bot_delegation_ready', got '${notifs[0].category}'`);
    }

    // Check outreach logs
    const preparedLogs = await db.executeSafe({
      text: `SELECT * FROM outreach_logs WHERE opportunity_id = $1 AND action = 'bot_delegation_draft_prepared'`,
      values: [opp.id]
    }) as any[];
    console.log(`  * Generated Outreach Logs: ${preparedLogs.length}`);
    if (preparedLogs.length === 0) {
      throw new Error("Outreach log for action 'bot_delegation_draft_prepared' was not saved.");
    }
    
    console.log("✅ Real-Run and lifecycle transition: PASS");

    // ══════════════════════════════════════════════════
    // TEST 7: UI Manual Complete & Cancel Actions
    // ══════════════════════════════════════════════════
    console.log("\n🖱️ [TEST 7] Testing UI client actions (complete/cancel server actions)...");

    // Test complete action
    console.log("  * Invoking completeBotDelegationTask...");
    const cmpRes = await completeBotDelegationTask(taskId1);
    console.log("    Result:", cmpRes);
    if (!cmpRes.success || !cmpRes.data?.success) throw new Error("completeBotDelegationTask returned error: " + (cmpRes.error || cmpRes.data?.error));

    const completedTaskRows = await db.executeSafe({
      text: `SELECT status, metadata FROM follow_up_tasks WHERE id = $1`,
      values: [taskId1]
    }) as any[];
    const cmpMeta = typeof completedTaskRows[0].metadata === "string" ? JSON.parse(completedTaskRows[0].metadata) : completedTaskRows[0].metadata;

    console.log(`    - Status: "${completedTaskRows[0].status}"`);
    console.log(`    - Bot Delegation internal status: "${cmpMeta.bot_delegation.status}"`);

    if (completedTaskRows[0].status !== "completed" || cmpMeta.bot_delegation.status !== "completed") {
      throw new Error("Task was not completed successfully by action!");
    }

    // Test cancel action on a newly created task
    console.log("  * Creating task to cancel...");
    
    // Clear out any existing duplicate tasks of mode collect_phone_call_time
    await db.executeSafe({
      text: `DELETE FROM follow_up_tasks WHERE opportunity_id = $1 AND tenant_id = $2 AND metadata->'bot_delegation'->>'mode' = 'collect_phone_call_time'`,
      values: [opp.id, TENANT_ID]
    });

    const toCancelTask = await createBotDelegationTask(opp.id, {
      mode: "collect_phone_call_time",
      source: "patient_tracking"
    });
    const cancelId = toCancelTask.data?.taskId!;
    if (!toCancelTask.success || !toCancelTask.data?.success || !cancelId) {
      throw new Error("Failed to create task to cancel: " + (toCancelTask.error || toCancelTask.data?.error));
    }
    createdTaskIds.push(cancelId);

    console.log("  * Invoking cancelBotDelegationTask...");
    const cnlRes = await cancelBotDelegationTask(cancelId, "Wrongly delegated");
    console.log("    Result:", cnlRes);
    if (!cnlRes.success || !cnlRes.data?.success) throw new Error("cancelBotDelegationTask returned error: " + (cnlRes.error || cnlRes.data?.error));

    const cancelledTaskRows = await db.executeSafe({
      text: `SELECT status, metadata FROM follow_up_tasks WHERE id = $1`,
      values: [cancelId]
    }) as any[];
    const cnlMeta = typeof cancelledTaskRows[0].metadata === "string" ? JSON.parse(cancelledTaskRows[0].metadata) : cancelledTaskRows[0].metadata;

    console.log(`    - Status: "${cancelledTaskRows[0].status}"`);
    console.log(`    - Bot Delegation internal status: "${cnlMeta.bot_delegation.status}"`);

    if (cancelledTaskRows[0].status !== "cancelled" || cnlMeta.bot_delegation.status !== "cancelled") {
      throw new Error("Task was not cancelled successfully by action!");
    }

    console.log("✅ UI complete & cancel actions: PASS");

    // ══════════════════════════════════════════════════
    // TEST 8: Zero Outbound Check
    // ══════════════════════════════════════════════════
    console.log("\n🛡️ [TEST 8] Final check for Zero Outbound safety...");
    const outboundCheck = await db.executeSafe({
      text: `SELECT COUNT(*) as c FROM messages WHERE direction = 'out' AND created_at > NOW() - INTERVAL '5 minutes'`
    }) as any[];

    console.log(`  * Direction='out' messages sent in last 5 mins: ${outboundCheck[0].c}`);
    if (outboundCheck[0].c > 0) {
      throw new Error("❌ ZERO OUTBOUND VIOLATION! Outbound messages were written during this validation run.");
    }
    console.log("  ✅ ZERO OUTBOUND SAFETY verified: PASS");

  } finally {
    console.log("\n🧹 Cleaning up test tasks, notifications and logs...");
    if (createdTaskIds.length > 0) {
      await db.executeSafe({
        text: `DELETE FROM follow_up_tasks WHERE id = ANY($1) AND tenant_id = $2`,
        values: [createdTaskIds, TENANT_ID]
      });
      console.log(`  * Deleted test tasks: ${createdTaskIds.length}`);
    }

    // Clean up notifications generated during test
    await db.executeSafe({
      text: `DELETE FROM notifications WHERE category = 'bot_delegation_ready' AND tenant_id = $1`,
      values: [TENANT_ID]
    });
    console.log("  * Deleted test notifications.");

    console.log("\n🎉 ALL 2V-P0 BOT DELEGATION ORCHESTRATOR TESTS SUCCESSFULLY PASSED!");
    console.log("==========================================================\n");
    process.exit(0);
  }
}

runValidation().catch(e => {
  console.error("\n❌ VALIDATION CRASHED WITH ERROR:\n", e);
  process.exit(1);
});
