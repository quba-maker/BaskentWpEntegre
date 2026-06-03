import { neon } from '@neondatabase/serverless';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { formatTimeTR } from '../src/lib/utils/timezone';

// Load environment variables
dotenv.config({ path: path.join(__dirname, '../.env.local') });
const dbUrl = process.env.APP_DATABASE_URL || process.env.DATABASE_URL;

if (!dbUrl) {
  console.error('DATABASE_URL is not set.');
  process.exit(1);
}

const sql = neon(dbUrl);

// Standalone Helper functions
function getTzCityLabel(tzString?: string | null): string {
  if (!tzString) return '';
  const parts = tzString.split('/');
  return parts[parts.length - 1].replace(/_/g, ' ');
}

type UiBucket =
  | 'bot_suggestion_pending'
  | 'open'
  | 'scheduled'
  | 'confirmed'
  | 'overdue'
  | 'completed'
  | 'unreachable'
  | 'cancelled';

interface OperationsTaskProjected {
  taskId: string | null;
  opportunityId: string | null;
  phoneNumber: string;
  taskType: string;
  taskTitle: string;
  taskDescription: string | null;
  dueAtUtc: string | null;
  dueAtTurkey: string | null;
  dueAtPatientLocal: string | null;
  patientTimezone: string | null;
  isPrimary: boolean;
  status: string;
  uiBucket: UiBucket;
  confirmationStatus: 'pending' | 'confirmed' | 'declined' | 'no_response' | 'none';
  appointmentType: 'phone_call' | 'clinic_visit' | 'consultation' | 'doctor_review' | 'report_followup';
  timeDisplay: string;
  timezoneNeedsClarification: boolean;
}

function buildOperationsTaskProjection(
  task: any,
  opp?: any
): OperationsTaskProjected {
  const metadata = task?.metadata || {};
  const status = task?.status || 'pending';
  const dueAt = task?.due_at;

  const isClinic = metadata.appointment_type === 'clinic_visit';
  const confirmationStatus = metadata.confirmation_status || 'none';

  // 1. uiBucket Calculation
  let uiBucket: UiBucket = 'open';

  if (status === 'cancelled' || metadata.appointment_result === 'cancelled') {
    uiBucket = 'cancelled';
  } else if (status === 'completed') {
    if (metadata.appointment_result === 'no_show') {
      uiBucket = 'unreachable';
    } else {
      uiBucket = 'completed';
    }
  } else if (status === 'no_show' || metadata.appointment_result === 'no_show') {
    uiBucket = 'unreachable';
  } else if (isClinic && confirmationStatus === 'no_response') {
    uiBucket = 'unreachable';
  } else if (status === 'pending' || status === 'in_progress') {
    const isTaskOverdue = dueAt && new Date(dueAt).getTime() < Date.now();
    if (isTaskOverdue) {
      uiBucket = 'overdue';
    } else if (metadata.bot_suggestion?.status === 'pending') {
      uiBucket = 'bot_suggestion_pending';
    } else if (confirmationStatus === 'confirmed') {
      uiBucket = 'confirmed';
    } else if (task?.task_type === 'callback_scheduled' || isClinic) {
      uiBucket = 'scheduled';
    } else {
      uiBucket = 'open';
    }
  }

  // 2. Appointment Type
  let appointmentType: OperationsTaskProjected['appointmentType'] = 'phone_call';
  if (isClinic) {
    appointmentType = 'clinic_visit';
  } else if (metadata.appointment_type === 'consultation') {
    appointmentType = 'consultation';
  } else if (task?.task_type === 'doctor_review_pending') {
    appointmentType = 'doctor_review';
  } else if (task?.task_type === 'send_report_reminder') {
    appointmentType = 'report_followup';
  } else if (metadata.appointment_type === 'phone_call') {
    appointmentType = 'phone_call';
  }

  // 3. Time Display
  let scheduledUtc = metadata.scheduled_for_utc || dueAt || null;
  let trTime = metadata.callback_time_tr;
  let patientTime = metadata.patient_local_time;
  let patientTz = metadata.patient_timezone;
  let needsClarification = !!metadata.needs_timezone_clarification;

  if (!trTime && dueAt) {
    trTime = formatTimeTR(dueAt, 'Europe/Istanbul');
    needsClarification = true;
  }

  let timeDisplay = 'Saat belirtilmemiş';
  if (trTime) {
    if (needsClarification || !patientTime) {
      timeDisplay = `Türkiye saati: ${trTime} / Hasta saati net değil`;
    } else {
      const city = getTzCityLabel(patientTz);
      timeDisplay = `${trTime} TR / ${patientTime} ${city || 'Hasta'}`;
    }
  }

  // 4. Primary Task check
  const isPrimary = metadata.is_primary === true || (!metadata.parent_task_id && metadata.is_primary !== false);

  return {
    taskId: task?.id || null,
    opportunityId: task?.opportunity_id || null,
    phoneNumber: task?.phone_number || '',
    taskType: task?.task_type || '',
    taskTitle: task?.title || '',
    taskDescription: task?.description || null,
    dueAtUtc: scheduledUtc,
    dueAtTurkey: trTime || null,
    dueAtPatientLocal: patientTime || null,
    patientTimezone: patientTz || null,
    isPrimary,
    status,
    uiBucket,
    confirmationStatus,
    appointmentType,
    timeDisplay,
    timezoneNeedsClarification: needsClarification
  };
}

// Helper to safe-parse JSON
function safeJsonParse(val: any, fallback: any = {}) {
  if (!val) return fallback;
  if (typeof val === 'object') return val;
  try {
    return JSON.parse(val);
  } catch {
    return fallback;
  }
}

async function verifyPatients() {
  const targets = ['Murtaza', 'Aysu', 'Ömer Ali'];
  
  console.log('=== REAL PATIENTS VERIFICATION START ===\n');

  for (const name of targets) {
    console.log(`\n======================================================`);
    console.log(`PATIENT SEARCH KEYWORD: "${name}"`);
    console.log(`======================================================`);

    // 1. Get Opportunities
    const opportunities = await sql`
      SELECT o.id, o.patient_name, o.phone_number, o.stage, o.priority, o.intent_type, o.created_at,
             c.id as conv_id, c.active_opportunity_id as conv_active_opp_id
      FROM opportunities o
      LEFT JOIN conversations c ON c.phone_number = o.phone_number
      WHERE o.patient_name ILIKE ${'%' + name + '%'}
      ORDER BY o.created_at DESC
    `;

    console.log(`\nOpportunities found in DB: ${opportunities.length}`);
    opportunities.forEach(o => {
      console.log(`  - OppID: ${o.id} | Name: ${o.patient_name} | Phone: ${o.phone_number} | Stage: ${o.stage} | ActiveOppID: ${o.conv_active_opp_id}`);
    });

    if (opportunities.length === 0) continue;

    // Get phone number from first opp
    const phone = opportunities[0].phone_number;

    // 2. Fetch Tasks (including parents and children)
    const tasks = await sql`
      SELECT t.id, t.opportunity_id, t.phone_number, t.task_type, t.title, t.description, t.status, t.due_at, t.metadata
      FROM follow_up_tasks t
      WHERE t.phone_number = ${phone}
      ORDER BY t.created_at DESC
    `;

    console.log(`\nTasks found in DB for Phone (${phone}): ${tasks.length}`);
    
    // Simulate UI drawer primary vs child tasks nesting logic
    const allTasks = tasks.map(t => ({
      id: t.id,
      opportunityId: t.opportunity_id,
      taskType: t.task_type,
      title: t.title,
      description: t.description,
      status: t.status,
      dueAt: t.due_at,
      metadata: typeof t.metadata === 'string' ? safeJsonParse(t.metadata) : (t.metadata || {})
    }));

    const primaryTasks = allTasks.filter(t => 
      t.taskType !== 'appointment_reminder' && 
      !t.metadata?.parent_task_id && 
      t.metadata?.is_primary !== false
    );

    const childTasks = allTasks.filter(t => 
      t.metadata?.parent_task_id || 
      t.taskType === 'appointment_reminder' ||
      t.metadata?.is_primary === false
    );

    console.log(`  - Primary Tasks (Header Cards in Drawer): ${primaryTasks.length}`);
    primaryTasks.forEach(p => {
      console.log(`    * [PRIMARY] ID: ${p.id} | Title: "${p.title}" | Status: ${p.status} | Due: ${p.dueAt}`);
      
      const children = allTasks.filter(c => c.metadata?.parent_task_id === p.id);
      console.log(`      ↳ Alt İşlemler / İşlem Adımları (${children.length} nested child tasks):`);
      children.forEach(c => {
        console.log(`        - [CHILD] ID: ${c.id} | Title: "${c.title}" | Type: ${c.taskType} | Status: ${c.status} | Due: ${c.dueAt}`);
      });
    });

    console.log(`  - Orphaned / Child tasks without parent matching:`);
    const orphanTasks = childTasks.filter(c => !c.metadata?.parent_task_id);
    orphanTasks.forEach(o => {
      console.log(`    * [ORPHAN/REMINDER] ID: ${o.id} | Title: "${o.title}" | Type: ${o.taskType} | Status: ${o.status}`);
    });

    // 3. Simulate getPatientTrackingRows collapsing logic
    const groupedMap = new Map<string, any[]>();
    opportunities.forEach(row => {
      const key = row.phone_number;
      if (!groupedMap.has(key)) groupedMap.set(key, []);
      groupedMap.get(key)!.push(row);
    });

    console.log(`\nHasta Takibi (Tracking Rows) Collapse Summary:`);
    for (const [key, groupRows] of groupedMap.entries()) {
      let representative = groupRows.find(
        r => r.id && r.id === r.conv_active_opp_id
      );
      const isCollapsed = groupRows.length > 1;
      
      if (!representative) representative = groupRows[0];
      
      console.log(`  - Patient Representative for Phone ${key}: OppID ${representative.id} (${representative.patient_name})`);
      console.log(`  - Group Rows Count: ${groupRows.length} | Collapsed: ${isCollapsed ? 'YES (Deduplicated)' : 'NO'}`);
      console.log(`  - UI Patient Tracking row count returned to client: 1`);
    }

    // 4. Simulate getAppointmentRows/Stats Projection uiBucket
    console.log(`\nAppointment Tab UI Buckets Projection:`);
    allTasks.forEach(task => {
      const taskObj = {
        id: task.id,
        status: task.status,
        due_at: task.dueAt,
        task_type: task.taskType,
        title: task.title,
        description: task.description,
        metadata: task.metadata
      };

      try {
        const proj = buildOperationsTaskProjection(taskObj, {});
        console.log(`  - Task: "${task.title}" -> uiBucket: "${proj.uiBucket}" | confirmationStatus: "${proj.confirmationStatus}" | isPrimary: ${task.metadata?.is_primary}`);
      } catch (e: any) {
        console.log(`  - Failed to project task: ${e.message}`);
      }
    });
  }

  // 5. Timezone logic sample display
  console.log(`\n======================================================`);
  console.log(`TIMEZONE DISPLAY VERIFICATION SAMPLE`);
  console.log(`======================================================`);
  const dateSample = new Date('2026-06-03T07:00:00.000Z'); // 10:00 TRT
  console.log(`UTC ISO String (scheduled_for_utc): ${dateSample.toISOString()}`);
  
  const callback_time_tr = dateSample.toLocaleTimeString('tr-TR', {
    timeZone: 'Europe/Istanbul',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
  console.log(`TR local time (callback_time_tr): ${callback_time_tr}`);
  
  const patient_local_time = dateSample.toLocaleTimeString('tr-TR', {
    timeZone: 'Europe/Berlin', // Germany
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
  console.log(`Patient Germany time (patient_local_time): ${patient_local_time}`);

  console.log('\n=== REAL PATIENTS VERIFICATION END ===');
}

verifyPatients().catch(console.error);
