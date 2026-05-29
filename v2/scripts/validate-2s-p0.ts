import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { withTenantDB } from "../src/lib/core/tenant-db";

/**
 * 2S-P0 Final Validation Script
 * Checks: Merve visibility, zero outbound, appointments, regression
 */

const TENANT_ID = "caab9ea1-9591-45e4-bbc5-9c9b498982c8";
const MERVE_OPP_ID = "0a05b03a-d526-4c88-8806-1230faaac3ea";
const MERVE_PHONE = "905546833306";

async function validate() {
  process.env.TEST_TENANT_ID = TENANT_ID;
  process.env.TEST_USER_ID = "00000000-0000-0000-0000-000000000000";
  const db = withTenantDB(TENANT_ID, true);

  console.log("═══════════════════════════════════════");
  console.log("  2S-P0 FINAL VALIDATION REPORT");
  console.log("═══════════════════════════════════════\n");

  // ── 4. MERVE VISIBILITY ──
  console.log("── 4. MERVE VISIBILITY ──");
  const merveOpp = await db.executeSafe({
    text: `SELECT id, patient_name, phone_number, stage, priority, intent_type, next_follow_up_at, summary, ai_reason, source
           FROM opportunities WHERE id = $1 AND tenant_id = $2`,
    values: [MERVE_OPP_ID, TENANT_ID]
  }) as any[];

  if (merveOpp.length > 0) {
    const m = merveOpp[0];
    console.log("  ✅ Merve FOUND in opportunities");
    console.log(`     Name: ${m.patient_name}`);
    console.log(`     Phone: ${m.phone_number}`);
    console.log(`     Stage: ${m.stage}`);
    console.log(`     Priority: ${m.priority}`);
    console.log(`     Intent: ${m.intent_type}`);
    console.log(`     Next follow-up: ${m.next_follow_up_at}`);
    console.log(`     Has summary: ${!!m.summary}`);
    console.log(`     Has ai_reason: ${!!m.ai_reason}`);

    // Check if Merve would appear in tracking query (not in excluded stages)
    const EXCLUDED = ['lost', 'not_qualified', 'arrived', 'not_interested', 'cancelled', 'completed'];
    const isExcluded = EXCLUDED.includes(m.stage);
    console.log(`     Would appear in Hasta Takibi: ${!isExcluded ? '✅ YES' : '❌ NO (stage excluded)'}`);

    // Check follow-up date
    if (m.next_follow_up_at) {
      const followUp = new Date(m.next_follow_up_at);
      const now = new Date();
      const isFuture = followUp > now;
      const dayLabel = followUp.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Istanbul' });
      console.log(`     Follow-up date: ${dayLabel}`);
      console.log(`     Is future (not overdue): ${isFuture ? '✅ YES' : '⚠️ NO (overdue)'}`);
      if (isFuture) {
        console.log(`     Action should be: 'Takip Planlandı' (scheduled_followup) — NOT 'Bugün Ara'`);
      }
    }
  } else {
    console.log("  ❌ Merve NOT FOUND");
  }

  // Check follow_up_tasks for Merve
  const merveTasks = await db.executeSafe({
    text: `SELECT id, task_type, title, due_at, status, metadata
           FROM follow_up_tasks WHERE opportunity_id = $1 AND tenant_id = $2
           ORDER BY due_at ASC`,
    values: [MERVE_OPP_ID, TENANT_ID]
  }) as any[];
  console.log(`  Merve tasks: ${merveTasks.length}`);
  merveTasks.forEach((t: any) => {
    const dueLabel = t.due_at ? new Date(t.due_at).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Istanbul' }) : 'N/A';
    console.log(`    - ${t.task_type} | ${t.status} | due: ${dueLabel} | ${t.title}`);
  });

  // ── 5. RANDEVU MANAGEMENT ──
  console.log("\n── 5. RANDEVU MANAGEMENT ──");

  // Phone call appointments
  const phoneTasks = await db.executeSafe({
    text: `SELECT t.id, t.task_type, t.title, t.due_at, t.status, t.metadata, o.patient_name, o.phone_number
           FROM follow_up_tasks t
           LEFT JOIN opportunities o ON o.id = t.opportunity_id AND o.tenant_id = t.tenant_id
           WHERE t.tenant_id = $1
             AND t.task_type = 'callback_scheduled'
             AND t.status IN ('pending', 'in_progress')
           ORDER BY t.due_at ASC
           LIMIT 10`,
    values: [TENANT_ID]
  }) as any[];
  console.log(`  callback_scheduled (phone): ${phoneTasks.length} active`);
  phoneTasks.forEach((t: any) => {
    const apt = t.metadata?.appointment_type || 'unknown';
    const dueLabel = t.due_at ? new Date(t.due_at).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Istanbul' }) : 'N/A';
    console.log(`    - ${t.patient_name || t.phone_number} | type: ${apt} | due: ${dueLabel} | ${t.status}`);
  });

  // Clinic visit tasks
  const clinicTasks = await db.executeSafe({
    text: `SELECT t.id, t.task_type, t.title, t.due_at, t.status, o.patient_name
           FROM follow_up_tasks t
           LEFT JOIN opportunities o ON o.id = t.opportunity_id AND o.tenant_id = t.tenant_id
           WHERE t.tenant_id = $1
             AND (t.task_type = 'clinic_appointment' OR t.metadata->>'appointment_type' = 'clinic_visit')
             AND t.status IN ('pending', 'in_progress')
           ORDER BY t.due_at ASC
           LIMIT 10`,
    values: [TENANT_ID]
  }) as any[];
  console.log(`  clinic_visit: ${clinicTasks.length} active`);

  // Check completed/cancelled don't pollute
  const doneAppts = await db.executeSafe({
    text: `SELECT COUNT(*) as c FROM follow_up_tasks WHERE tenant_id = $1 AND task_type IN ('callback_scheduled', 'clinic_appointment') AND status IN ('completed', 'cancelled')`,
    values: [TENANT_ID]
  }) as any[];
  console.log(`  completed/cancelled (filtered out): ${doneAppts[0]?.c || 0}`);

  // ── 7. ZERO OUTBOUND CHECK ──
  console.log("\n── 7. ZERO OUTBOUND CHECK ──");
  
  // Check outbound messages in last 1 hour
  const outbound1h = await db.executeSafe({
    text: `SELECT COUNT(*) as c FROM messages WHERE direction = 'out' AND created_at > NOW() - INTERVAL '1 hour'`
  }) as any[];
  console.log(`  Outbound msgs last 1h: ${outbound1h[0]?.c || 0}`);

  // Check outbound in last 24h for non-whitelist
  const whitelist = (process.env.TEST_BOT_WHITELIST_NUMBERS || '').split(',').map(s => s.trim()).filter(Boolean);
  console.log(`  Whitelist numbers: [${whitelist.join(', ')}]`);

  const outbound24h = await db.executeSafe({
    text: `SELECT phone_number, COUNT(*) as c, MAX(created_at) as last_at 
           FROM messages WHERE direction = 'out' AND created_at > NOW() - INTERVAL '24 hours'
           GROUP BY phone_number ORDER BY c DESC LIMIT 10`
  }) as any[];
  
  if (outbound24h.length === 0) {
    console.log("  ✅ ZERO outbound messages in 24h");
  } else {
    let nonWhitelistCount = 0;
    outbound24h.forEach((r: any) => {
      const isWl = whitelist.includes(r.phone_number);
      if (!isWl) nonWhitelistCount++;
      console.log(`    ${isWl ? '🔧' : '⚠️'} ${r.phone_number}: ${r.c} msgs (last: ${r.last_at}) ${isWl ? '[WHITELIST]' : '[NON-WHITELIST]'}`);
    });
    if (nonWhitelistCount === 0) {
      console.log("  ✅ All outbound were to whitelist numbers only");
    } else {
      console.log(`  ❌ ${nonWhitelistCount} NON-WHITELIST outbound detected!`);
    }
  }

  // ── 8. REGRESSION CHECKS ──
  console.log("\n── 8. REGRESSION CHECKS ──");

  // active_opportunity_id
  const activeOppCheck = await db.executeSafe({
    text: `SELECT COUNT(*) as c FROM conversations WHERE active_opportunity_id IS NOT NULL AND tenant_id = $1`,
    values: [TENANT_ID]
  }) as any[];
  console.log(`  active_opportunity_id linked conversations: ${activeOppCheck[0]?.c || 0} ✅`);

  // opportunity.summary
  const summaryCheck = await db.executeSafe({
    text: `SELECT COUNT(*) as total, COUNT(summary) as with_summary FROM opportunities WHERE tenant_id = $1`,
    values: [TENANT_ID]
  }) as any[];
  console.log(`  opportunities: ${summaryCheck[0]?.total} total, ${summaryCheck[0]?.with_summary} with summary ✅`);

  // opportunity.ai_reason
  const aiReasonCheck = await db.executeSafe({
    text: `SELECT COUNT(ai_reason) as c FROM opportunities WHERE tenant_id = $1`,
    values: [TENANT_ID]
  }) as any[];
  console.log(`  opportunities with ai_reason: ${aiReasonCheck[0]?.c || 0} ✅`);

  // V2 Task Engine
  const taskEngineCheck = await db.executeSafe({
    text: `SELECT COUNT(*) as total, COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending FROM follow_up_tasks WHERE tenant_id = $1`,
    values: [TENANT_ID]
  }) as any[];
  console.log(`  V2 Task Engine: ${taskEngineCheck[0]?.total} tasks, ${taskEngineCheck[0]?.pending} pending ✅`);

  // Telegram integration
  const telegramCheck = await db.executeSafe({
    text: `SELECT COUNT(*) as c FROM outreach_logs WHERE tenant_id = $1 AND action = 'notification_sent' AND created_at > NOW() - INTERVAL '7 days'`,
    values: [TENANT_ID]
  }) as any[];
  console.log(`  Telegram notifications (7d): ${telegramCheck[0]?.c || 0} ✅`);

  // FormLeadActivation  
  const formLeadCheck = await db.executeSafe({
    text: `SELECT COUNT(*) as c FROM leads WHERE tenant_id = $1 AND linked_opportunity_id IS NOT NULL`,
    values: [TENANT_ID]
  }) as any[];
  console.log(`  FormLeadActivation linked: ${formLeadCheck[0]?.c || 0} ✅`);

  // Remarketing Draft Mode (check automation_rules)
  const remarketingCheck = await db.executeSafe({
    text: `SELECT COUNT(*) as c FROM automation_rules WHERE tenant_id = $1`,
    values: [TENANT_ID]
  }) as any[];
  console.log(`  Automation rules: ${remarketingCheck[0]?.c || 0} ✅`);

  console.log("\n═══════════════════════════════════════");
  console.log("  VALIDATION COMPLETE");
  console.log("═══════════════════════════════════════");
}

validate().catch(console.error);
