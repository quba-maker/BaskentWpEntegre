import { normalizePhone } from './normalize-phone';

export type FirstContactStatus =
  | 'needs_greeting'               // Form geldi, inbound mesaj yok, karşılama yapılmadı -> Aksiyon: WhatsApp'ta Karşıla
  | 'waiting_inbox_reply'          // Hasta mesaj attı, karşılama cevabı verilmedi -> Aksiyon: Inbox'ta Karşıla
  | 'whatsapp_opened'              // Operatör WhatsApp uygulamasında mesajı açtı ama echo confirmed yok -> Aksiyon: Tekrar Aç
  | 'manual_greeting_confirmed'    // WhatsApp Business App echo matcher karşılama mesajını doğruladı -> Aksiyon: Mesaja Git
  | 'inbox_greeting_sent'          // Inbox panelden karşılama cevabı gönderildi -> Aksiyon: Mesaja Git
  | 'patient_replied'              // Biz karşılama yaptıktan sonra hasta tekrar cevap verdi -> Aksiyon: Inbox'a Git
  | 'blocked_or_invalid'           // Telefon yok, geçersiz, duplicate -> Aksiyon: Detay
  | 'out_of_scope';                // Kapsam dışı

export type ContactPhoneStatus = {
  phone: string;
  normalizedPhone: string;
  label: 'primary' | 'secondary' | 'form' | 'conversation' | 'other';
  isPrimary: boolean;
  hasInbound: boolean;
  hasWhatsappOpened: boolean;
  hasManualGreetingConfirmed: boolean;
  hasInboxGreetingSent: boolean;
  hasApiGreetingSent: boolean;
  lastActionAt?: string;
  recommendedAction: 'open_whatsapp_app' | 'open_inbox' | 'none';
};

export type FirstContactResolution = {
  patientLevelStatus: FirstContactStatus;
  recommendedPhone?: ContactPhoneStatus;
  phones: ContactPhoneStatus[];
  primaryAction: string;
};

export interface OutreachLogMinimal {
  action: string;
  created_at: string;
  target_phone?: string;
}

export interface InboundMessageMinimal {
  created_at: string;
  phone?: string; // which phone sent it
}

export const FIRST_CONTACT_HARD_DUPLICATE_ACTIONS = [
  'manual_whatsapp_greeting_echo_confirmed',
  'inbox_form_greeting_sent',
  'greeting_sent',
  'template_sent',
  'form_greeting_template_sent'
];

export const FIRST_CONTACT_GREETING_ACTIONS = FIRST_CONTACT_HARD_DUPLICATE_ACTIONS;

export const FIRST_CONTACT_SOFT_DRAFT_ACTIONS = [
  'form_greeting_draft_saved_internal',
  'smart_greeting_draft_edited',
  'smart_greeting_draft_prepared'
];

export const FIRST_CONTACT_STATUS_LABELS: Record<FirstContactStatus, string> = {
  needs_greeting: 'Karşılama Bekliyor',
  waiting_inbox_reply: 'Panelden Cevap Bekliyor',
  whatsapp_opened: 'WhatsApp\'ta Açıldı',
  manual_greeting_confirmed: 'Manuel WhatsApp Doğrulandı',
  inbox_greeting_sent: 'Cevap Gönderildi',
  patient_replied: 'Cevap Geldi',
  blocked_or_invalid: 'Sorunlu',
  out_of_scope: 'Kapsam Dışı'
};

export function resolveFirstContactStatus(
  leadPhones: { phone: string; label: ContactPhoneStatus['label']; isPrimary: boolean }[],
  outreachLogs: OutreachLogMinimal[],
  inboundMessages: InboundMessageMinimal[],
  options?: { stage?: string }
): FirstContactResolution {
  
  const phones: ContactPhoneStatus[] = leadPhones.map(lp => ({
    phone: lp.phone,
    normalizedPhone: normalizePhone(lp.phone),
    label: lp.label,
    isPrimary: lp.isPrimary,
    hasInbound: false,
    hasWhatsappOpened: false,
    hasManualGreetingConfirmed: false,
    hasInboxGreetingSent: false,
    hasApiGreetingSent: false,
    recommendedAction: 'none'
  }));

  // Populate phone status based on logs
  for (const log of outreachLogs) {
    const targetNorm = log.target_phone ? normalizePhone(log.target_phone) : null;
    let phoneObj = targetNorm ? phones.find(p => p.normalizedPhone === targetNorm) : null;
    if (!phoneObj && targetNorm) {
      // Suffix fallback for log mapping
      const suffix = targetNorm.slice(-10);
      phoneObj = phones.find(p => p.normalizedPhone.slice(-10) === suffix);
    }
    if (!phoneObj) {
      phoneObj = phones[0];
    }
    if (!phoneObj) continue;

    if (!phoneObj.lastActionAt || new Date(log.created_at) > new Date(phoneObj.lastActionAt)) {
      phoneObj.lastActionAt = log.created_at;
    }

    if (log.action === 'whatsapp_app_opened_for_greeting') {
      phoneObj.hasWhatsappOpened = true;
    } else if (log.action === 'manual_whatsapp_greeting_echo_confirmed') {
      phoneObj.hasManualGreetingConfirmed = true;
    } else if (log.action === 'inbox_form_greeting_sent') {
      phoneObj.hasInboxGreetingSent = true;
    } else if (
      log.action === 'greeting_sent' || 
      log.action === 'template_sent' || 
      log.action === 'form_greeting_template_sent'
    ) {
      phoneObj.hasApiGreetingSent = true;
    }
  }

  // Populate phone status based on inbound messages using safe priority match
  for (const msg of inboundMessages) {
    const targetNorm = msg.phone ? normalizePhone(msg.phone) : null;
    if (!targetNorm) continue;

    // Hierarchy Match:
    // Rank 1: Full normalized match
    let phoneObj = phones.find(p => p.normalizedPhone === targetNorm);
    if (!phoneObj) {
      // Rank 4: last-10 fallback
      const suffix = targetNorm.slice(-10);
      phoneObj = phones.find(p => p.normalizedPhone.slice(-10) === suffix);
    }
    if (!phoneObj) {
      phoneObj = phones[0];
    }
    if (phoneObj) {
      phoneObj.hasInbound = true;
    }
  }

  // Calculate chronological patientLevelStatus
  const greetingLogs = outreachLogs.filter(log => 
    FIRST_CONTACT_GREETING_ACTIONS.includes(log.action)
  );

  const firstGreetingLog = greetingLogs.length > 0 ? greetingLogs[greetingLogs.length - 1] : null; // assuming logs are sorted DESC
  const lastInbound = inboundMessages.length > 0 ? new Date(inboundMessages[inboundMessages.length - 1].created_at) : null;

  let patientLevelStatus: FirstContactStatus = 'needs_greeting';

  const anyInbound = phones.some(p => p.hasInbound);
  const anyConfirmed = phones.some(p => p.hasManualGreetingConfirmed);
  const anyInboxSent = phones.some(p => p.hasInboxGreetingSent);
  const anyApiSent = phones.some(p => p.hasApiGreetingSent);
  const anyOpened = phones.some(p => p.hasWhatsappOpened);

  if (anyInbound) {
    if (greetingLogs.length > 0 && firstGreetingLog) {
      // We greeted them
      if (lastInbound && new Date(firstGreetingLog.created_at) < lastInbound) {
        patientLevelStatus = 'patient_replied';
      } else if (anyInboxSent) {
        patientLevelStatus = 'inbox_greeting_sent';
      } else if (anyConfirmed) {
        patientLevelStatus = 'manual_greeting_confirmed';
      } else if (anyApiSent) {
        patientLevelStatus = 'inbox_greeting_sent';
      }
    } else {
      // Patient wrote, we haven't greeted
      patientLevelStatus = 'waiting_inbox_reply';
    }
  } else {
    // No inbound message
    if (anyConfirmed) {
      patientLevelStatus = 'manual_greeting_confirmed';
    } else if (anyInboxSent) {
      patientLevelStatus = 'inbox_greeting_sent';
    } else if (anyApiSent) {
      patientLevelStatus = 'inbox_greeting_sent';
    } else if (anyOpened) {
      patientLevelStatus = 'whatsapp_opened';
    } else {
      if (phones.length === 0 || phones.every(p => !p.phone || !p.phone.trim())) {
        patientLevelStatus = 'blocked_or_invalid';
      } else if (options?.stage && !['new', 'contacted'].includes(options.stage)) {
        patientLevelStatus = 'out_of_scope';
      } else {
        patientLevelStatus = 'needs_greeting';
      }
    }
  }

  // Recommended phone logic
  let recommendedPhone: ContactPhoneStatus | undefined = undefined;
  
  if (patientLevelStatus === 'needs_greeting' || patientLevelStatus === 'whatsapp_opened') {
    // 1. Form phone
    recommendedPhone = phones.find(p => p.label === 'form' && p.normalizedPhone);
    if (!recommendedPhone) {
      // 2. Primary phone
      recommendedPhone = phones.find(p => p.isPrimary && p.normalizedPhone);
    }
    if (!recommendedPhone) {
      // 3. Secondary
      recommendedPhone = phones.find(p => p.label === 'secondary' && p.normalizedPhone);
    }
  } else if (patientLevelStatus === 'waiting_inbox_reply') {
    // Return the one that has inbound
    recommendedPhone = phones.find(p => p.hasInbound);
  }

  // Fallback
  if (!recommendedPhone && phones.length > 0) {
    recommendedPhone = phones[0];
  }

  let primaryAction = 'Detay';
  switch (patientLevelStatus) {
    case 'needs_greeting': primaryAction = 'WhatsApp\'ta Karşıla'; break;
    case 'waiting_inbox_reply': primaryAction = 'Inbox\'ta Karşıla'; break;
    case 'whatsapp_opened': primaryAction = 'Tekrar Aç'; break;
    case 'manual_greeting_confirmed': primaryAction = 'Mesaja Git'; break;
    case 'inbox_greeting_sent': primaryAction = 'Mesaja Git'; break;
    case 'patient_replied': primaryAction = 'Inbox\'a Git'; break;
    case 'blocked_or_invalid': primaryAction = 'Detay'; break;
    case 'out_of_scope': primaryAction = 'Detay'; break;
  }

  return {
    patientLevelStatus,
    phones,
    recommendedPhone,
    primaryAction
  };
}

/**
 * Pure database-driven first contact resolver.
 * NO Action Guard / withActionGuard double-wrapping!
 */
export async function resolveFirstContactCore(
  db: any,
  tenantId: string,
  leadId: string
): Promise<FirstContactResolution> {
  // 1. Fetch Lead
  const leadRes = await db.executeSafe({
    text: `SELECT phone_number, raw_data, customer_id, stage FROM leads WHERE id = $1::uuid AND tenant_id = $2::uuid LIMIT 1`,
    values: [leadId, tenantId]
  }) as any[];
  
  if (leadRes.length === 0) {
    throw new Error("Lead not found");
  }
  const lead = leadRes[0];

  // 2. Extract phones hierarchical list
  const rawData = lead.raw_data ? (typeof lead.raw_data === 'string' ? JSON.parse(lead.raw_data) : lead.raw_data) : {};
  const allRawPhones: string[] = Array.isArray(rawData._all_phones) ? rawData._all_phones : [];
  
  const phoneList: { phone: string; label: ContactPhoneStatus['label']; isPrimary: boolean }[] = [];
  if (lead.phone_number) {
    phoneList.push({ phone: lead.phone_number, label: 'primary', isPrimary: true });
  }
  
  for (const p of allRawPhones) {
    if (!phoneList.some(xp => xp.phone === p)) {
      phoneList.push({ phone: p, label: 'form', isPrimary: false });
    }
  }

  // Rank 3: Lead / opportunity / conversation relations
  let linkedPhones: string[] = [];
  try {
    const relatedRes = await db.executeSafe({
      text: `SELECT DISTINCT c.phone_number as phone
             FROM conversations c
             WHERE c.tenant_id = $1::uuid
               AND (
                 (c.customer_id IS NOT NULL AND c.customer_id = $2::uuid)
                 OR RIGHT(c.phone_number, 10) = RIGHT($3, 10)
               )`,
      values: [tenantId, lead.customer_id || null, lead.phone_number]
    }) as any[];
    linkedPhones = relatedRes.map(r => r.phone).filter(Boolean);
  } catch (err) {
    console.error("resolveFirstContactCore: failed to fetch related phones:", err);
  }

  for (const p of linkedPhones) {
    if (!phoneList.some(xp => xp.phone === p)) {
      phoneList.push({ phone: p, label: 'conversation', isPrimary: false });
    }
  }

  // 3. Fetch Outreach Logs
  const logsRes = await db.executeSafe({
    text: `SELECT action, created_at, metadata->>'target_phone' as target_phone
           FROM outreach_logs
           WHERE tenant_id = $1::text AND lead_id = $2::uuid
           ORDER BY created_at ASC`,
    values: [tenantId, leadId]
  }) as any[];

  // 4. Fetch Inbound Messages
  const normalizedPhones = phoneList.map(pl => normalizePhone(pl.phone)).filter(Boolean);
  const suffixes = normalizedPhones.map(np => np.slice(-10)).filter(Boolean);

  let inboundMessages: InboundMessageMinimal[] = [];
  if (normalizedPhones.length > 0) {
    inboundMessages = await db.executeSafe({
      text: `SELECT m.created_at, m.phone_number as phone
             FROM messages m
             JOIN conversations c ON c.id = m.conversation_id
             WHERE m.tenant_id = $1::uuid AND m.direction = 'in'
               AND (m.media_metadata IS NULL OR COALESCE(m.media_metadata->'native'->>'message_type', '') != 'reaction')
               AND (
                 m.phone_number = ANY($2::text[])
                 OR RIGHT(m.phone_number, 10) = ANY($3::text[])
               )
             ORDER BY m.created_at ASC`,
      values: [tenantId, normalizedPhones, suffixes]
    }) as any[];
  }

  return resolveFirstContactStatus(phoneList, logsRes, inboundMessages, { stage: lead.stage });
}

