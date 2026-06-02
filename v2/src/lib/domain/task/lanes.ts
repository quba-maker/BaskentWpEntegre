export const TASK_LANES = {
  communication_lifecycle: ['callback_scheduled', 'call_patient', 'follow_up_no_response'],
  appointment_lifecycle: ['coordinator_review', 'travel_planning', 'payment_follow_up'],
  clinical_review_lifecycle: ['doctor_review_pending', 'send_report_reminder'],
  reminder_lifecycle: ['appointment_reminder'],
} as const;

export type TaskLane = keyof typeof TASK_LANES;

export function getTaskLane(taskType: string): TaskLane {
  if (TASK_LANES.communication_lifecycle.includes(taskType as any)) return 'communication_lifecycle';
  if (TASK_LANES.clinical_review_lifecycle.includes(taskType as any)) return 'clinical_review_lifecycle';
  if (TASK_LANES.reminder_lifecycle.includes(taskType as any)) return 'reminder_lifecycle';
  return 'appointment_lifecycle'; // fallback default
}

export const LANE_PRECEDENCE: Record<TaskLane, Record<string, number>> = {
  communication_lifecycle: {
    callback_scheduled: 1,
    call_patient: 2,
    follow_up_no_response: 3,
  },
  appointment_lifecycle: {
    coordinator_review: 1,
    travel_planning: 2,
    payment_follow_up: 3,
  },
  clinical_review_lifecycle: {
    doctor_review_pending: 1,
    send_report_reminder: 2,
  },
  reminder_lifecycle: {
    appointment_reminder: 1,
  }
};
