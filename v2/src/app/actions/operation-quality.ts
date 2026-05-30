"use server";

import { withActionGuard } from "@/lib/core/action-guard";
import { resolvePatientTimezone, formatDualClock } from "@/lib/utils/timezone";
import { logger } from "@/lib/core/logger";
import { getPendingDrafts } from "./draft-approval";

const log = logger.withContext({ module: 'OperationQualityActions' });

// ==========================================
// CONFIGURATION & SLA
// ==========================================

const QUALITY_SLA = {
  hotLeadMaxIdleMinutes: 120,          // 2 hours
  warmLeadMaxIdleHours: 24,            // 24 hours
  draftReviewMaxHours: 4,              // 4 hours
  appointmentConfirmationWindowHours: 24, // 24 hours
  appointmentResultGraceHours: 2,      // 2 hours grace period after start
  overdueTaskGraceMinutes: 15,          // 15 minutes tolerance
  staleOpportunityDays: 7              // 7 days without update
};

const ENABLE_QUALITY_ALERTS = false; // Telegram quality alerts default feature flag

// ==========================================
// TYPES
// ==========================================

export type RiskType =
  | 'hot_lead_waiting'
  | 'draft_pending_review'
  | 'appointment_unconfirmed'
  | 'appointment_overdue'
  | 'task_overdue'
  | 'bot_draft_ready'
  | 'reminder_draft_unreviewed'
  | 'patient_message_waiting'
  | 'patient_not_responding'
  | 'stale_opportunity'
  | 'missing_critical_data';

export interface QualityRiskItem {
  id: string; // Dynamic unique ID for front-end rendering
  type: RiskType;
  patient_name: string;
  masked_phone: string;
  phone: string;
  priority: 'low' | 'normal' | 'high' | 'critical';
  source: string;
  department: string;
  country: string;
  stage: string;
  last_action_time: string | null;
  idle_duration_label: string;
  risk_reason: string;
  suggested_action: string;
  risk_score: number;
  severity: 'düşük' | 'orta' | 'yüksek';
  links: {
    patientTracking?: string;
    appointment?: string;
    draftApproval?: string;
    inbox?: string;
  };
  missing_flags?: string[];
  opportunity_id?: string | null;
  task_id?: string | null;
  ai_summary?: string;
  ai_reason?: string;
}

export interface QualityDashboardStats {
  active_opportunities_count: number;
  hot_leads_waiting_count: number;
  overdue_tasks_count: number;
  pending_drafts_count: number;
  unreviewed_bot_drafts_count: number;
  unreviewed_reminder_drafts_count: number;
  appointments_today_count: number;
  appointments_unconfirmed_count: number;
  appointments_overdue_count: number;
  no_response_risk_count: number;
  stale_leads_count: number;
  high_risk_items_count: number;
}

// ==========================================
// HELPERS
// ==========================================

function maskPhone(phone: string): string {
  if (!phone) return '';
  const cleaned = phone.replace(/\D/g, '');
  if (cleaned.length < 6) return '***';

  let prefix = '';
  const lastFour = cleaned.slice(-4);

  if (cleaned.startsWith('90') && cleaned.length >= 10) {
    prefix = '+90';
  } else if (cleaned.startsWith('49') && cleaned.length >= 10) {
    prefix = '+49';
  } else if (cleaned.startsWith('33') && cleaned.length >= 10) {
    prefix = '+33';
  } else if (cleaned.startsWith('44') && cleaned.length >= 10) {
    prefix = '+44';
  } else if (cleaned.startsWith('1') && cleaned.length >= 10) {
    prefix = '+1';
  } else {
    prefix = `+${cleaned.substring(0, 2)}`;
  }

  const last2a = lastFour.substring(0, 2);
  const last2b = lastFour.substring(2, 4);

  return `${prefix} *** ** ${last2a} ${last2b}`;
}

function calculateRiskScore(item: Partial<QualityRiskItem>, factors: {
  isHot?: boolean;
  isOverdueTask?: boolean;
  isApptToday?: boolean;
  isDraftOverdue?: boolean;
  isIdleOverSLA?: boolean;
  isMissingData?: boolean;
  isNoResponse?: boolean;
  missingFlagsCount?: number;
}): number {
  let score = 0;

  if (factors.isHot || item.priority === 'high' || item.priority === 'critical') score += 25;
  if (factors.isOverdueTask) score += 20;
  if (factors.isApptToday) score += 25;
  if (factors.isDraftOverdue) score += 15;
  if (factors.isIdleOverSLA) score += 20;
  if (factors.isMissingData && factors.missingFlagsCount) score += factors.missingFlagsCount * 5;
  if (factors.isNoResponse) score += 10;

  return Math.min(100, score);
}

function getSeverity(score: number): 'düşük' | 'orta' | 'yüksek' {
  if (score < 40) return 'düşük';
  if (score < 70) return 'orta';
  return 'yüksek';
}

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${Math.round(minutes)} dk`;
  const hours = minutes / 60;
  if (hours < 24) return `${Math.round(hours)} saat`;
  return `${Math.round(hours / 24)} gün`;
}

// ==========================================
// ACTIONS
// ==========================================

export async function getOperationQualityItems(filters?: {
  risk_type?: string;
  priority?: string;
  department?: string;
  country?: string;
  source?: string;
  only_unassigned?: boolean;
  only_hot?: boolean;
  only_overdue?: boolean;
}) {
  return withActionGuard(
    { actionName: 'getOperationQualityItems' },
    async (ctx) => {
      const db = ctx.db;
      const tenantId = ctx.tenantId;
      const allRisks: QualityRiskItem[] = [];

      // Terminal Stages to ignore for opportunities
      const TERMINAL_STAGES = `'lost', 'not_qualified', 'arrived', 'not_interested', 'cancelled', 'completed'`;

      // ────────────────────────────────────────────────────────
      // 1. Fetch Hot Idle Leads & Stale Opportunities & Missing Data & No Response
      // ────────────────────────────────────────────────────────
      const activeOpps = await db.executeSafe({
        text: `
          SELECT o.id, o.patient_name, o.phone_number, o.priority, o.source, o.department, o.country, o.stage, o.created_at, o.updated_at, o.summary, o.ai_reason,
                 c.id as conv_id
          FROM opportunities o
          LEFT JOIN conversations c ON c.id::text = o.conversation_id::text AND c.tenant_id = o.tenant_id
          WHERE o.tenant_id = $1
            AND o.stage NOT IN (${TERMINAL_STAGES})
        `,
        values: [tenantId]
      }) as any[];

      for (const opp of activeOpps) {
        const oppId = opp.id;
        const phone = opp.phone_number || '';
        const priority = opp.priority || 'warm';

        // Get last action / message / outreach time
        const lastMsg = await db.executeSafe({
          text: `SELECT created_at, direction FROM messages WHERE phone_number = $1 AND tenant_id = $2 ORDER BY created_at DESC LIMIT 1`,
          values: [phone, tenantId]
        }) as any[];
        const lastMsgTime = lastMsg[0]?.created_at ? new Date(lastMsg[0].created_at) : null;
        const lastMsgDirection = lastMsg[0]?.direction;

        const lastOutreach = await db.executeSafe({
          text: `SELECT created_at, action FROM outreach_logs WHERE opportunity_id = $1 AND tenant_id = $2 ORDER BY created_at DESC LIMIT 1`,
          values: [oppId, tenantId]
        }) as any[];
        const lastOutreachTime = lastOutreach[0]?.created_at ? new Date(lastOutreach[0].created_at) : null;

        const lastUpdateTime = new Date(opp.updated_at);
        
        let lastActionTime: Date = lastUpdateTime;
        if (lastMsgTime && lastMsgTime > lastActionTime) lastActionTime = lastMsgTime;
        if (lastOutreachTime && lastOutreachTime > lastActionTime) lastActionTime = lastOutreachTime;

        const idleMinutes = (Date.now() - lastActionTime.getTime()) / (1000 * 60);

        // a. Missing Critical Data check
        const missingFlags: string[] = [];
        if (!opp.phone_number) missingFlags.push('phone');
        if (!opp.country) missingFlags.push('country');
        if (!opp.department) missingFlags.push('department');
        if (!opp.stage) missingFlags.push('stage');
        if (!opp.summary) missingFlags.push('summary');
        if (!opp.ai_reason) missingFlags.push('ai_reason');

        // Check timezone
        let hasTimezone = false;
        if (opp.country) {
          const tz = resolvePatientTimezone(opp.country);
          if (tz.timezone) hasTimezone = true;
        }
        if (!hasTimezone) missingFlags.push('timezone');

        // Check if has active task
        const activeTasks = await db.executeSafe({
          text: `SELECT id FROM follow_up_tasks WHERE opportunity_id = $1 AND tenant_id = $2 AND status IN ('pending', 'in_progress') LIMIT 1`,
          values: [oppId, tenantId]
        }) as any[];
        if (activeTasks.length === 0) missingFlags.push('active_task');

        if (missingFlags.length > 0) {
          const score = calculateRiskScore({ priority }, { isMissingData: true, missingFlagsCount: missingFlags.length });
          allRisks.push({
            id: `missing-${oppId}`,
            type: 'missing_critical_data',
            patient_name: opp.patient_name || 'İsimsiz Hasta',
            masked_phone: maskPhone(phone),
            phone: phone,
            priority: priority,
            source: opp.source || 'manual',
            department: opp.department || 'Genel',
            country: opp.country || 'TR',
            stage: opp.stage || 'new_lead',
            last_action_time: lastActionTime.toISOString(),
            idle_duration_label: formatDuration(idleMinutes),
            risk_reason: `Fırsat kartında eksik veriler var: ${missingFlags.join(', ')}`,
            suggested_action: 'Fırsat detay panelini açıp eksik alanları tamamlayın veya bir takip görevi planlayın.',
            risk_score: score,
            severity: getSeverity(score),
            links: {
              patientTracking: `takip?opp=${oppId}`
            },
            missing_flags: missingFlags,
            opportunity_id: oppId
          });
        }

        // b. Hot Lead Waiting check
        if (priority === 'hot') {
          const slaLimit = QUALITY_SLA.hotLeadMaxIdleMinutes;
          if (idleMinutes > slaLimit) {
            const hasPendingTasks = activeTasks.length > 0;
            // Higher risk if no active tasks
            const score = calculateRiskScore({ priority }, { isHot: true, isIdleOverSLA: true, isNoResponse: !hasPendingTasks });
            allRisks.push({
              id: `hot-lead-${oppId}`,
              type: 'hot_lead_waiting',
              patient_name: opp.patient_name || 'İsimsiz Hasta',
              masked_phone: maskPhone(phone),
              phone: phone,
              priority: 'critical',
              source: opp.source || 'manual',
              department: opp.department || 'Genel',
              country: opp.country || 'TR',
              stage: opp.stage || 'new_lead',
              last_action_time: lastActionTime.toISOString(),
              idle_duration_label: formatDuration(idleMinutes),
              risk_reason: `Sıcak fırsat ${formatDuration(idleMinutes)} süredir işlem bekliyor. (SLA Limit: 2 saat)`,
              suggested_action: hasPendingTasks 
                ? 'Geciken görevi kontrol edin veya hastayla iletişime geçip ilerletin.' 
                : 'Fırsat için hemen yeni bir takip görevi planlayın veya Onay Merkezi taslaklarını inceleyin.',
              risk_score: score,
              severity: getSeverity(score),
              links: {
                patientTracking: `takip?opp=${oppId}`,
                inbox: `inbox`
              },
              opportunity_id: oppId
            });
          }
        }

        // c. No Response / Unanswered check
        if (lastMsgTime) {
          const unansweredMinutes = (Date.now() - lastMsgTime.getTime()) / (1000 * 60);
          if (lastMsgDirection === 'in') {
            // Patient message waiting (patient sent inbound, business hasn't replied)
            const waitLimit = priority === 'hot' ? QUALITY_SLA.hotLeadMaxIdleMinutes : QUALITY_SLA.warmLeadMaxIdleHours * 60;
            if (unansweredMinutes > waitLimit) {
              const score = calculateRiskScore({ priority }, { isHot: priority === 'hot', isIdleOverSLA: true, isNoResponse: true });
              allRisks.push({
                id: `msg-waiting-${oppId}`,
                type: 'patient_message_waiting',
                patient_name: opp.patient_name || 'İsimsiz Hasta',
                masked_phone: maskPhone(phone),
                phone: phone,
                priority: priority === 'hot' ? 'critical' : 'high',
                source: opp.source || 'whatsapp',
                department: opp.department || 'Genel',
                country: opp.country || 'TR',
                stage: opp.stage || 'engaged',
                last_action_time: lastMsgTime.toISOString(),
                idle_duration_label: formatDuration(unansweredMinutes),
                risk_reason: `Hastanın gelen mesajı yanıtlanmadı! Bekleme süresi: ${formatDuration(unansweredMinutes)}.`,
                suggested_action: 'Mesaj kutusuna giderek hastanın beklemede olan son mesajını yanıtlayın.',
                risk_score: score,
                severity: getSeverity(score),
                links: {
                  inbox: `inbox`,
                  patientTracking: `takip?opp=${oppId}`
                },
                opportunity_id: oppId
              });
            }
          } else {
            // Patient not responding (we sent last message, patient hasn't answered for too long)
            const responseSla = priority === 'hot' ? 360 : 1440; // 6h for hot, 24h for warm
            if (unansweredMinutes > responseSla && activeTasks.length === 0) {
              const score = calculateRiskScore({ priority }, { isIdleOverSLA: true, isNoResponse: false });
              allRisks.push({
                id: `patient-stale-${oppId}`,
                type: 'patient_not_responding',
                patient_name: opp.patient_name || 'İsimsiz Hasta',
                masked_phone: maskPhone(phone),
                phone: phone,
                priority: priority,
                source: opp.source || 'whatsapp',
                department: opp.department || 'Genel',
                country: opp.country || 'TR',
                stage: opp.stage || 'engaged',
                last_action_time: lastMsgTime.toISOString(),
                idle_duration_label: formatDuration(unansweredMinutes),
                risk_reason: `Bizim son outreach mesajımızdan sonra hastadan yanıt alınamadı. (Süre: ${formatDuration(unansweredMinutes)})`,
                suggested_action: 'Bot Delegation planlayın veya koordinatör eşliğinde arama planı hazırlayın.',
                risk_score: score,
                severity: getSeverity(score),
                links: {
                  patientTracking: `takip?opp=${oppId}`,
                  inbox: `inbox`
                },
                opportunity_id: oppId
              });
            }
          }
        }

        // d. Stale Opportunity check
        const staleDaysLimit = QUALITY_SLA.staleOpportunityDays;
        const idleDays = idleMinutes / (60 * 24);
        if (idleDays > staleDaysLimit) {
          const score = calculateRiskScore({ priority }, { isIdleOverSLA: true });
          allRisks.push({
            id: `stale-${oppId}`,
            type: 'stale_opportunity',
            patient_name: opp.patient_name || 'İsimsiz Hasta',
            masked_phone: maskPhone(phone),
            phone: phone,
            priority: priority,
            source: opp.source || 'manual',
            department: opp.department || 'Genel',
            country: opp.country || 'TR',
            stage: opp.stage || 'engaged',
            last_action_time: lastActionTime.toISOString(),
            idle_duration_label: `${Math.round(idleDays)} gün`,
            risk_reason: `Aktif fırsat ${Math.round(idleDays)} gündür güncellenmedi veya üzerinde bir aksiyon alınmadı.`,
            suggested_action: 'Takip planını güncelleyin, stage aşamasını doğrulayın veya fırsatı kapatın (arrived/lost/cancelled).',
            risk_score: score,
            severity: getSeverity(score),
            links: {
              patientTracking: `takip?opp=${oppId}`
            },
            opportunity_id: oppId
          });
        }
      }

      // ────────────────────────────────────────────────────────
      // 2. Fetch Overdue Follow-up Tasks (Gecikmiş Görevler)
      // ────────────────────────────────────────────────────────
      const overdueTasks = await db.executeSafe({
        text: `
          SELECT t.id, t.opportunity_id, t.phone_number, t.title, t.task_type, t.due_at, t.created_at,
                 o.patient_name, o.stage, o.department, o.country, o.priority
          FROM follow_up_tasks t
          LEFT JOIN opportunities o ON o.id = t.opportunity_id AND o.tenant_id = t.tenant_id
          WHERE t.tenant_id = $1
            AND t.status IN ('pending', 'in_progress')
            AND t.due_at < NOW() - INTERVAL '15 minutes'
            AND t.task_type NOT IN ('appointment_reminder', 'bot_handoff_followup')
        `,
        values: [tenantId]
      }) as any[];

      for (const t of overdueTasks) {
        const minutesOverdue = (Date.now() - new Date(t.due_at).getTime()) / (1000 * 60);
        const score = calculateRiskScore({ priority: t.priority }, { isOverdueTask: true, isIdleOverSLA: true });
        allRisks.push({
          id: `task-overdue-${t.id}`,
          type: 'task_overdue',
          patient_name: t.patient_name || 'İsimsiz Hasta',
          masked_phone: maskPhone(t.phone_number),
          phone: t.phone_number || '',
          priority: t.priority || 'normal',
          source: 'task',
          department: t.department || 'Genel',
          country: t.country || 'TR',
          stage: t.stage || 'first_contact',
          last_action_time: t.due_at,
          idle_duration_label: formatDuration(minutesOverdue),
          risk_reason: `Planlanan "${t.title}" takip görevi zamanı ${formatDuration(minutesOverdue)} gecikmiş.`,
          suggested_action: 'Takip planını açıp görevi tamamlayın, erteleyin veya iptal edin.',
          risk_score: score,
          severity: getSeverity(score),
          links: {
            patientTracking: `takip?opp=${t.opportunity_id}`
          },
          opportunity_id: t.opportunity_id,
          task_id: t.id
        });
      }

      // ────────────────────────────────────────────────────────
      // 3. Fetch Appointment-related Risks (Teyitsiz & Sonuç Kapatılmamış)
      // ────────────────────────────────────────────────────────
      // a. Unconfirmed Appointments (next 24 hours, confirmation not confirmed)
      const unconfirmedAppts = await db.executeSafe({
        text: `
          SELECT t.id, t.opportunity_id, t.phone_number, t.due_at, t.metadata,
                 o.patient_name, o.stage, o.department, o.country, o.priority
          FROM follow_up_tasks t
          LEFT JOIN opportunities o ON o.id = t.opportunity_id AND o.tenant_id = t.tenant_id
          WHERE t.tenant_id = $1
            AND t.status IN ('pending', 'in_progress')
            AND (t.task_type IN ('callback_scheduled', 'doctor_review_pending', 'send_report_reminder') OR t.metadata->>'appointment_type' IS NOT NULL)
            AND t.due_at BETWEEN NOW() AND NOW() + INTERVAL '24 hours'
            AND (t.metadata->>'confirmation_status' IS NULL OR t.metadata->>'confirmation_status' IN ('pending', 'none', 'no_response'))
        `,
        values: [tenantId]
      }) as any[];

      for (const apt of unconfirmedAppts) {
        const meta = typeof apt.metadata === 'string' ? JSON.parse(apt.metadata) : (apt.metadata || {});
        const status = meta.confirmation_status || 'pending';
        const hoursLeft = (new Date(apt.due_at).getTime() - Date.now()) / (1000 * 60 * 60);

        const score = calculateRiskScore({ priority: apt.priority }, { isApptToday: true, isNoResponse: true });
        allRisks.push({
          id: `appt-unconfirmed-${apt.id}`,
          type: 'appointment_unconfirmed',
          patient_name: apt.patient_name || 'İsimsiz Hasta',
          masked_phone: maskPhone(apt.phone_number),
          phone: apt.phone_number || '',
          priority: 'high',
          source: meta.appointment_type || 'phone_call',
          department: apt.department || 'Genel',
          country: apt.country || 'TR',
          stage: apt.stage || 'appointment_planning',
          last_action_time: apt.due_at,
          idle_duration_label: `${Math.round(hoursLeft)} saat kaldı`,
          risk_reason: `Yaklaşan randevuya ${Math.round(hoursLeft)} saat kalmış ancak teyit alınmamış! (Statü: ${status === 'pending' ? 'Teyit Bekliyor' : 'Cevap Yok'})`,
          suggested_action: 'Mesajlardan veya telefonla teyit kanallarını kullanarak randevu onayını kesinleştirin.',
          risk_score: score,
          severity: getSeverity(score),
          links: {
            appointment: `takip?tab=randevu&taskId=${apt.id}`,
            inbox: `inbox`
          },
          opportunity_id: apt.opportunity_id,
          task_id: apt.id
        });
      }

      // b. Overdue Appointments (result grace hours exceeded)
      const overdueAppts = await db.executeSafe({
        text: `
          SELECT t.id, t.opportunity_id, t.phone_number, t.due_at, t.metadata,
                 o.patient_name, o.stage, o.department, o.country, o.priority
          FROM follow_up_tasks t
          LEFT JOIN opportunities o ON o.id = t.opportunity_id AND o.tenant_id = t.tenant_id
          WHERE t.tenant_id = $1
            AND (t.task_type IN ('callback_scheduled', 'doctor_review_pending', 'send_report_reminder') OR t.metadata->>'appointment_type' IS NOT NULL)
            AND t.due_at < NOW() - INTERVAL '2 hours'
            AND (t.status IN ('pending', 'in_progress') OR t.metadata->>'appointment_result' IS NULL)
        `,
        values: [tenantId]
      }) as any[];

      for (const apt of overdueAppts) {
        const meta = typeof apt.metadata === 'string' ? JSON.parse(apt.metadata) : (apt.metadata || {});
        const apptResult = meta.appointment_result;
        
        // If actually marked in metadata as arrived/cancelled, skip
        if (['arrived', 'no_show', 'cancelled', 'completed'].includes(apptResult)) continue;

        const hoursOverdue = (Date.now() - new Date(apt.due_at).getTime()) / (1000 * 60 * 60);
        const score = calculateRiskScore({ priority: apt.priority }, { isOverdueTask: true });
        allRisks.push({
          id: `appt-overdue-${apt.id}`,
          type: 'appointment_overdue',
          patient_name: apt.patient_name || 'İsimsiz Hasta',
          masked_phone: maskPhone(apt.phone_number),
          phone: apt.phone_number || '',
          priority: 'high',
          source: meta.appointment_type || 'phone_call',
          department: apt.department || 'Genel',
          country: apt.country || 'TR',
          stage: apt.stage || 'appointment_booked',
          last_action_time: apt.due_at,
          idle_duration_label: `${Math.round(hoursOverdue)} saat geçti`,
          risk_reason: `Randevu saati ${Math.round(hoursOverdue)} saat geçmiş fakat randevu sonucu (Geldi, Gelmedi vb.) sisteme girilmemiş.`,
          suggested_action: 'Randevu yönetimi panelinden randevu sonucunu arrived / no_show olarak işaretleyerek kapatın.',
          risk_score: score,
          severity: getSeverity(score),
          links: {
            appointment: `takip?tab=randevu&taskId=${apt.id}`
          },
          opportunity_id: apt.opportunity_id,
          task_id: apt.id
        });
      }

      // ────────────────────────────────────────────────────────
      // 4. Fetch Onay Merkezi Draft Risks (from `getPendingDrafts`)
      // ────────────────────────────────────────────────────────
      try {
        const pDraftsResponse = await getPendingDrafts();
        const pDrafts = pDraftsResponse.data || [];
        for (const dr of pDrafts) {
          const generatedAt = new Date(dr.generated_at);
          const pendingMinutes = (Date.now() - generatedAt.getTime()) / (1000 * 60);
          
          if (pendingMinutes > QUALITY_SLA.draftReviewMaxHours * 60) {
            const score = calculateRiskScore({ priority: dr.priority }, { isDraftOverdue: true, isIdleOverSLA: true });
            
            let riskType: RiskType = 'draft_pending_review';
            let reasonStr = `Yapay zeka taslağı ${formatDuration(pendingMinutes)} süredir Onay Merkezi'nde bekliyor.`;
            let sugStr = 'Onay Merkezi\'ne giderek taslağı onaylayın veya revize edip reddedin.';

            if (dr.source === 'bot_delegation') {
              riskType = 'bot_draft_ready';
              reasonStr = `Bota devir (handoff) taslağı ${formatDuration(pendingMinutes)} süredir koordinatör onayı bekliyor.`;
              sugStr = 'Onay Merkezi Bot Takip sekmesinden devir taslağını onaylayarak süreci bot devrine aktarın.';
            } else if (dr.source === 'appointment_reminder') {
              riskType = 'reminder_draft_unreviewed';
              reasonStr = `Randevu hatırlatma taslağı ${formatDuration(pendingMinutes)} süredir gözden geçirilmemiş.`;
              sugStr = 'Onay Merkezi Randevular sekmesinden hatırlatma taslağını onaylayın.';
            }

            allRisks.push({
              id: `draft-overdue-${dr.draft_id}-${dr.source}`,
              type: riskType,
              patient_name: dr.patient_name,
              masked_phone: dr.masked_phone,
              phone: dr.phone,
              priority: dr.priority,
              source: dr.source,
              department: dr.department || 'Genel',
              country: dr.country || 'TR',
              stage: dr.stage || 'engaged',
              last_action_time: dr.generated_at,
              idle_duration_label: formatDuration(pendingMinutes),
              risk_reason: reasonStr,
              suggested_action: sugStr,
              risk_score: score,
              severity: getSeverity(score),
              links: {
                draftApproval: `onay?draftId=${dr.draft_id}`
              },
              opportunity_id: dr.opportunity_id,
              task_id: (dr.source === 'bot_delegation' || dr.source === 'appointment_reminder') ? dr.draft_id : null
            });
          }
        }
      } catch (err) {
        log.error("Failed to merge getPendingDrafts risks:", err as any);
      }

      // ────────────────────────────────────────────────────────
      // 5. Apply Front-end Filters
      // ────────────────────────────────────────────────────────
      let filtered = allRisks;

      if (filters?.risk_type && filters.risk_type !== 'all') {
        filtered = filtered.filter(i => i.type === filters.risk_type);
      }
      if (filters?.priority && filters.priority !== 'all') {
        filtered = filtered.filter(i => i.priority === filters.priority);
      }
      if (filters?.department && filters.department !== 'all') {
        filtered = filtered.filter(i => i.department?.toLowerCase() === filters.department?.toLowerCase());
      }
      if (filters?.country && filters.country !== 'all') {
        filtered = filtered.filter(i => i.country?.toLowerCase() === filters.country?.toLowerCase());
      }
      if (filters?.source && filters.source !== 'all') {
        filtered = filtered.filter(i => i.source?.toLowerCase() === filters.source?.toLowerCase());
      }
      if (filters?.only_hot) {
        filtered = filtered.filter(i => i.priority === 'high' || i.priority === 'critical');
      }
      if (filters?.only_overdue) {
        filtered = filtered.filter(i => i.type === 'task_overdue' || i.type === 'appointment_overdue');
      }

      // Sort by Quality Score descending (high risk first)
      filtered.sort((a, b) => b.risk_score - a.risk_score);

      return filtered;
    }
  ).then(res => res.data || []);
}

export async function getOperationQualityDashboard(filters?: {
  department?: string;
  country?: string;
}) {
  return withActionGuard(
    { actionName: 'getOperationQualityDashboard' },
    async (ctx) => {
      const db = ctx.db;
      const tenantId = ctx.tenantId;

      // 1. Total active opportunities count
      const activeOppsRes = await db.executeSafe({
        text: `SELECT COUNT(*)::int as count FROM opportunities WHERE tenant_id = $1 AND stage NOT IN ('lost', 'not_qualified', 'arrived', 'not_interested', 'cancelled', 'completed')`,
        values: [tenantId]
      }) as any[];
      const activeOpportunitiesCount = activeOppsRes[0]?.count || 0;

      // 2. Fetch all quality items for counts compilation
      const allItems = await getOperationQualityItems(filters);

      const hotLeadsWaiting = allItems.filter(i => i.type === 'hot_lead_waiting');
      const overdueTasks = allItems.filter(i => i.type === 'task_overdue');
      const pendingDrafts = allItems.filter(i => 
        i.type === 'draft_pending_review' || 
        i.type === 'bot_draft_ready' || 
        i.type === 'reminder_draft_unreviewed'
      );
      const unreviewedBotDrafts = allItems.filter(i => i.type === 'bot_draft_ready');
      const unreviewedReminderDrafts = allItems.filter(i => i.type === 'reminder_draft_unreviewed');

      // 3. Appointments scheduled for today (Turkey time or UTC)
      const appointmentsTodayRes = await db.executeSafe({
        text: `
          SELECT COUNT(*)::int as count 
          FROM follow_up_tasks 
          WHERE tenant_id = $1 
            AND (task_type IN ('callback_scheduled', 'doctor_review_pending', 'send_report_reminder') OR metadata->>'appointment_type' IS NOT NULL)
            AND due_at::date = CURRENT_DATE
        `,
        values: [tenantId]
      }) as any[];
      const appointmentsTodayCount = appointmentsTodayRes[0]?.count || 0;

      const unconfirmedAppts = allItems.filter(i => i.type === 'appointment_unconfirmed');
      const overdueAppts = allItems.filter(i => i.type === 'appointment_overdue');
      const noResponseRisks = allItems.filter(i => i.type === 'patient_message_waiting' || i.type === 'patient_not_responding');
      const staleLeads = allItems.filter(i => i.type === 'stale_opportunity');
      const highRiskItems = allItems.filter(i => i.risk_score >= 70);

      return {
        active_opportunities_count: activeOpportunitiesCount,
        hot_leads_waiting_count: hotLeadsWaiting.length,
        overdue_tasks_count: overdueTasks.length,
        pending_drafts_count: pendingDrafts.length,
        unreviewed_bot_drafts_count: unreviewedBotDrafts.length,
        unreviewed_reminder_drafts_count: unreviewedReminderDrafts.length,
        appointments_today_count: appointmentsTodayCount,
        appointments_unconfirmed_count: unconfirmedAppts.length,
        appointments_overdue_count: overdueAppts.length,
        no_response_risk_count: noResponseRisks.length,
        stale_leads_count: staleLeads.length,
        high_risk_items_count: highRiskItems.length
      } as QualityDashboardStats;
    }
  ).then(res => res.data || {
    active_opportunities_count: 0,
    hot_leads_waiting_count: 0,
    overdue_tasks_count: 0,
    pending_drafts_count: 0,
    unreviewed_bot_drafts_count: 0,
    unreviewed_reminder_drafts_count: 0,
    appointments_today_count: 0,
    appointments_unconfirmed_count: 0,
    appointments_overdue_count: 0,
    no_response_risk_count: 0,
    stale_leads_count: 0,
    high_risk_items_count: 0
  });
}

export async function getQualityItemDetail(itemId: string, type: RiskType) {
  return withActionGuard(
    { actionName: 'getQualityItemDetail' },
    async (ctx) => {
      const db = ctx.db;
      const tenantId = ctx.tenantId;

      // Extract original opportunity ID from dynamic item ID
      // item ID format can be hot-lead-[uuid], missing-[uuid], task-overdue-[uuid], appt-unconfirmed-[uuid], draft-overdue-[uuid]
      let oppId: string | null = null;
      let taskId: string | null = null;

      if (itemId.includes('-overdue-')) {
        // e.g. task-overdue-123 or draft-overdue-123-bot_delegation
        const parts = itemId.split('-');
        if (itemId.startsWith('task-overdue-')) {
          taskId = parts[2];
        }
      } else if (itemId.includes('-unconfirmed-')) {
        const parts = itemId.split('-');
        taskId = parts[2];
      }

      // Query opportunity info using database search
      // Get all active quality items to resolve the specific one
      const allItems = await getOperationQualityItems();
      const resolvedItem = allItems.find(i => i.id === itemId);

      if (!resolvedItem) {
        throw new Error("Quality risk item not found or has already been resolved!");
      }

      oppId = resolvedItem.opportunity_id || null;
      taskId = resolvedItem.task_id || null;

      // Fetch opportunity details
      let oppDetails: any = null;
      if (oppId) {
        const oppRes = await db.executeSafe({
          text: `SELECT * FROM opportunities WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
          values: [oppId, tenantId]
        }) as any[];
        oppDetails = oppRes[0] || null;
      }

      // Fetch last message details
      let lastMessage: any = null;
      if (oppDetails?.phone_number) {
        const msgRes = await db.executeSafe({
          text: `SELECT * FROM messages WHERE phone_number = $1 AND tenant_id = $2 ORDER BY created_at DESC LIMIT 1`,
          values: [oppDetails.phone_number, tenantId]
        }) as any[];
        lastMessage = msgRes[0] || null;
      }

      // Fetch last outreach action
      let lastOutreach: any = null;
      if (oppId) {
        const logRes = await db.executeSafe({
          text: `SELECT * FROM outreach_logs WHERE opportunity_id = $1 AND tenant_id = $2 ORDER BY created_at DESC LIMIT 1`,
          values: [oppId, tenantId]
        }) as any[];
        lastOutreach = logRes[0] || null;
      }

      // Fetch active tasks
      let activeTasks: any[] = [];
      if (oppId) {
        activeTasks = await db.executeSafe({
          text: `SELECT id, title, task_type, due_at, status FROM follow_up_tasks WHERE opportunity_id = $1 AND tenant_id = $2 AND status IN ('pending', 'in_progress') ORDER BY due_at ASC LIMIT 10`,
          values: [oppId, tenantId]
        }) as any[];
      }

      // Dual clock timezone warnings
      let timezoneWarning: string | null = null;
      let dualClock: any = null;
      if (resolvedItem.country) {
        const tz = resolvePatientTimezone(resolvedItem.country);
        if (tz.timezone) {
          try {
            const patientHour = parseInt(new Date().toLocaleTimeString('en-US', {
              timeZone: tz.timezone,
              hour12: false,
              hour: '2-digit'
            }));
            if (patientHour >= 22 || patientHour < 9) {
              timezoneWarning = `🚨 UYARI: Hastanın yerel saati (${patientHour}:00) dinlenme saatleri aralığındadır. Mesaj gönderimi önerilmez.`;
            }
            if (oppDetails?.created_at) {
              dualClock = formatDualClock(new Date().toISOString(), resolvedItem.country);
            }
          } catch (_) {}
        }
      }

      return {
        item: resolvedItem,
        opportunity: oppDetails ? {
          id: oppDetails.id,
          patient_name: oppDetails.patient_name,
          phone_number: oppDetails.phone_number,
          stage: oppDetails.stage,
          priority: oppDetails.priority,
          department: oppDetails.department,
          country: oppDetails.country,
          summary: oppDetails.summary || resolvedItem.ai_summary || 'AI özeti çıkarılmamış.',
          ai_reason: oppDetails.ai_reason || resolvedItem.ai_reason || 'Fırsat nedeni çıkarılmamış.',
          created_at: oppDetails.created_at,
          updated_at: oppDetails.updated_at
        } : null,
        last_message: lastMessage ? {
          text: lastMessage.content || lastMessage.text,
          direction: lastMessage.direction,
          created_at: lastMessage.created_at
        } : null,
        last_outreach: lastOutreach ? {
          action: lastOutreach.action,
          metadata: lastOutreach.metadata,
          created_at: lastOutreach.created_at
        } : null,
        active_tasks: activeTasks.map(t => ({
          id: t.id,
          title: t.title,
          task_type: t.task_type,
          due_at: t.due_at,
          status: t.status
        })),
        timezone_warning: timezoneWarning,
        dual_clock: dualClock,
        suggested_action: resolvedItem.suggested_action,
        risk_reason: resolvedItem.risk_reason
      };
    }
  ).then(res => res.data || null);
}
