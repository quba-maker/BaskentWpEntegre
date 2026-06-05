import { sql } from '../src/lib/db';
import { normalizePhoneForIdentity, parseAllPhones } from '../src/lib/utils/phone-identity';
import * as fs from 'fs';
import * as path from 'path';

const TENANT_ID = 'caab9ea1-9591-45e4-bbc5-9c9b498982c8'; // Başkent Üniversitesi Tenant ID

// Cache for dry-run
const classificationCache = new Map<string, any>();

// Refined Deterministic Classifier
function classifyMessage(text: string): {
  expectsReply: boolean;
  confidence: 'high' | 'medium' | 'low';
  reason: string;
  category: 'appointment_time' | 'document_request' | 'country_confirmation' | 'call_time' | 'medical_question' | 'final_closing' | 'unknown';
  isClosingMessage: boolean;
} {
  const clean = (text || '').toLowerCase().trim();
  if (!clean) {
    return {
      expectsReply: false,
      confidence: 'high',
      reason: 'Empty message',
      category: 'unknown',
      isClosingMessage: false
    };
  }

  // 1. Blacklist / Closing keywords
  const closingKeywords = [
    "teşekkür ederiz", "teşekkürler", "iyi günler", "randevunuz onaylandı", 
    "görüşmeniz tamamlandı", "yine bekleriz", "talebiniz alınmıştır",
    "iyi akşamlar", "geçmiş olsun", "iyi bayramlar", "mutlu günler",
    "başarılar dileriz", "yardımcı olabildiysek ne mutlu", "hoşçakalın", "kendinize iyi bakın",
    "thank you", "thanks", "have a nice day", "good day", "stay safe"
  ];
  for (const kw of closingKeywords) {
    if (clean.includes(kw)) {
      return {
        expectsReply: false,
        confidence: 'high',
        reason: `Matched closing keyword: "${kw}"`,
        category: 'final_closing',
        isClosingMessage: true
      };
    }
  }

  // 2. Whitelist keywords & categories
  const callTimeKeywords = ["uygun saat", "ne zaman arayalım", "ne zaman görüşelim", "arama saati", "ne zaman müsait", "görüşme saati"];
  const docKeywords = ["paylaşır mısınız", "var mı", "dosya", "belge", "röntgeniniz", "sonuçları", "raporunuz var mı", "filminiz var mı"];
  const countryKeywords = ["nereden", "nerede yaşıyorsunuz", "hangi ülkede", "nerede ikamet", "yaşadığınız yer"];
  const apptKeywords = ["teyit", "gelmeyi düşünüyor musunuz", "randevu saati", "randevu tarihi", "geliyor musunuz", "gelecek misiniz", "katılım durumunuz"];
  
  // Specific contextual medical questions (NO generic 'ağrı', 'tedavi', etc. alone)
  const medicalQuestionKeywords = [
    "şikayetiniz nedir", "rahatsızlığınız nedir", "ağrınız ne", "ağrınız var mı", 
    "tedavi planı", "ameliyat planı", "hastalık geçmişiniz"
  ];

  if (callTimeKeywords.some(kw => clean.includes(kw))) {
    return {
      expectsReply: true,
      confidence: 'high',
      reason: 'Matched call_time context keyword',
      category: 'call_time',
      isClosingMessage: false
    };
  }

  if (docKeywords.some(kw => clean.includes(kw))) {
    return {
      expectsReply: true,
      confidence: 'high',
      reason: 'Matched document_request context keyword',
      category: 'document_request',
      isClosingMessage: false
    };
  }

  if (countryKeywords.some(kw => clean.includes(kw))) {
    return {
      expectsReply: true,
      confidence: 'high',
      reason: 'Matched country_confirmation context keyword',
      category: 'country_confirmation',
      isClosingMessage: false
    };
  }

  if (apptKeywords.some(kw => clean.includes(kw))) {
    return {
      expectsReply: true,
      confidence: 'high',
      reason: 'Matched appointment_time context keyword',
      category: 'appointment_time',
      isClosingMessage: false
    };
  }

  if (medicalQuestionKeywords.some(kw => clean.includes(kw))) {
    return {
      expectsReply: true,
      confidence: 'high',
      reason: 'Matched medical_question context keyword',
      category: 'medical_question',
      isClosingMessage: false
    };
  }

  // 3. Question mark check (acts as fallback if not matching blacklist)
  if (clean.includes('?')) {
    return {
      expectsReply: true,
      confidence: 'medium',
      reason: 'Contains question mark "?" but no specific category keywords matched',
      category: 'unknown',
      isClosingMessage: false
    };
  }

  // Default to false/low confidence
  return {
    expectsReply: false,
    confidence: 'low',
    reason: 'No keywords or question mark matched',
    category: 'unknown',
    isClosingMessage: false
  };
}

// Checks if content contains opt-out/stop signals
function hasOptOutKeywords(text: string): boolean {
  const clean = (text || '').toLowerCase().trim();
  const optOuts = [
    "dur", "stop", "istemiyorum", "rahatsız etmeyin", "mesaj atmayın", 
    "bırakın", "silin", "arama", "yazma", "unsubscribe", "don't write"
  ];
  return optOuts.some(kw => clean.includes(kw));
}

async function run() {
  console.log("🚀 STARTING DRY-RUN + CLASSIFIER AUDIT (DETERMINISTIC ONLY)...");
  console.log("Tenant:", TENANT_ID);

  const now = new Date();

  // Load all raw tables
  const conversations = await sql`
    SELECT * FROM conversations WHERE tenant_id = ${TENANT_ID}
  `;
  const messages = await sql`
    SELECT * FROM messages 
    WHERE tenant_id = ${TENANT_ID} 
      AND direction != 'system'
      AND (media_metadata IS NULL OR COALESCE(media_metadata->'native'->>'message_type', '') != 'reaction')
    ORDER BY created_at ASC
  `;
  const leads = await sql`
    SELECT * FROM leads WHERE tenant_id = ${TENANT_ID}
  `;
  const opportunities = await sql`
    SELECT * FROM opportunities WHERE tenant_id = ${TENANT_ID}
  `;
  const outreachLogs = await sql`
    SELECT * FROM outreach_logs WHERE tenant_id = ${TENANT_ID}
  `;

  console.log(`Fetched: ${conversations.length} convs, ${messages.length} msgs, ${leads.length} leads, ${opportunities.length} opps, ${outreachLogs.length} logs.`);

  // Group messages by conversation_id
  const messagesByConvId: Record<string, any[]> = {};
  for (const m of messages) {
    if (!m.conversation_id) continue;
    if (!messagesByConvId[m.conversation_id]) {
      messagesByConvId[m.conversation_id] = [];
    }
    messagesByConvId[m.conversation_id].push(m);
  }

  // Pre-calculate E.164 normalization for all conversations
  const normalizedConvMap = new Map<string, any>();
  for (const c of conversations) {
    const norm = normalizePhoneForIdentity(c.phone_number);
    if (norm.e164) {
      normalizedConvMap.set(norm.e164, c);
    }
  }

  // Find all opt-out phone suffixes / IDs
  const optOutPhones = new Set<string>();
  const activeOptOutOpps = opportunities.filter(o => {
    const isOptOut = o.metadata && (o.metadata.opt_out_requested === true || o.metadata.opt_out_requested === 'true');
    return isOptOut;
  });
  for (const o of activeOptOutOpps) {
    const norm = normalizePhoneForIdentity(o.phone_number);
    if (norm.e164) optOutPhones.add(norm.e164);
  }

  // Check last messages for opt-out keywords on each conversation
  for (const c of conversations) {
    const cMsgs = messagesByConvId[c.id] || [];
    const lastInbound = cMsgs.filter(m => m.direction === 'in').pop();
    if (lastInbound && hasOptOutKeywords(lastInbound.content)) {
      const norm = normalizePhoneForIdentity(c.phone_number);
      if (norm.e164) optOutPhones.add(norm.e164);
    }
  }

  // ═══════════════════════════════════════════════════════════
  // CATEGORY 1: NO-REPLY ANALYSIS
  // ═══════════════════════════════════════════════════════════
  const noReplyList: any[] = [];
  let totalConversationsAnalyzed = 0;
  let lastOutboundExists = 0;
  let expectsReplyHigh = 0;
  let expectsReplyMedium = 0;
  let excludedFinalClosing = 0;
  let excludedPatientRepliedAfter = 0;
  let excludedStopOptOut = 0;
  let excludedTerminal = 0;

  const noReplyDistribution = {
    total_3h: 0,
    total_6h: 0,
    total_9h: 0,
    total_24h: 0,
    total_48h: 0,
  };

  for (const c of conversations) {
    totalConversationsAnalyzed++;
    const convMsgs = messagesByConvId[c.id] || [];
    if (convMsgs.length === 0) continue;

    // Find last outbound normal message
    const lastOutbound = convMsgs.filter(m => m.direction === 'out').pop();
    if (!lastOutbound) continue;
    lastOutboundExists++;

    // Check if patient replied after last outbound
    const lastOutboundTime = new Date(lastOutbound.created_at).getTime();
    let patientRepliedAfter = false;
    let lastInboundTime = 0;

    for (const m of convMsgs) {
      if (m.direction === 'in') {
        const inTime = new Date(m.created_at).getTime();
        lastInboundTime = Math.max(lastInboundTime, inTime);
        if (inTime > lastOutboundTime) {
          patientRepliedAfter = true;
        }
      }
    }

    const classification = classifyMessage(lastOutbound.content);
    if (classification.expectsReply) {
      if (classification.confidence === 'high') expectsReplyHigh++;
      else if (classification.confidence === 'medium') expectsReplyMedium++;
    }

    const noReplyHours = (now.getTime() - lastOutboundTime) / (1000 * 60 * 60);
    const windowOpen = lastInboundTime > 0 && (now.getTime() - lastInboundTime) <= 24 * 60 * 60 * 1000;

    // Retrieve active opportunity for RLS & Stage
    const opp = opportunities.find(o => o.id === c.active_opportunity_id);
    const lead = leads.find(l => l.customer_id === c.customer_id || (l.linked_opportunity_id && opp && l.linked_opportunity_id === opp.id));

    // Resolve exact cross-phone opt-outs
    const normPhone = normalizePhoneForIdentity(c.phone_number);
    const isPrimaryOptedOut = (opp?.metadata?.opt_out_requested === true) || (normPhone.e164 && optOutPhones.has(normPhone.e164));
    
    // Stage check: lost, not_qualified, arrived are terminal
    const isStageTerminal = opp && ['lost', 'not_qualified', 'arrived'].includes(opp.stage);
    const isBooked = opp && opp.stage === 'booked';
    const isAutomationDisabled = opp && (opp.automation_status === 'stopped' || opp.automation_status === 'paused');

    let riskReason = "No risk";
    let recommendedAction = "no action needed";

    if (isPrimaryOptedOut) {
      riskReason = "Patient requested opt-out (StopRule)";
      excludedStopOptOut++;
    } else if (isStageTerminal) {
      riskReason = `Terminal stage: ${opp?.stage} (StopRule)`;
      excludedTerminal++;
    } else if (isBooked && classification.isClosingMessage) {
      // Excluded only if closing message (Booked is not hard terminal)
      riskReason = "Excluded: Booked stage with closing message";
      excludedTerminal++;
    } else if (isAutomationDisabled) {
      riskReason = `Automation disabled: ${opp?.automation_status} (StopRule)`;
    } else if (classification.isClosingMessage) {
      riskReason = "Excluded: closing/final message";
      excludedFinalClosing++;
    } else if (patientRepliedAfter) {
      riskReason = "Patient replied after last outbound";
      excludedPatientRepliedAfter++;
    }

    const isEligible = !patientRepliedAfter && classification.expectsReply && riskReason === "No risk";

    if (isEligible) {
      recommendedAction = windowOpen ? "Prepare freeform reply draft" : "Prepare template reminder draft";
      
      if (noReplyHours >= 3) noReplyDistribution.total_3h++;
      if (noReplyHours >= 6) noReplyDistribution.total_6h++;
      if (noReplyHours >= 9) noReplyDistribution.total_9h++;
      if (noReplyHours >= 24) noReplyDistribution.total_24h++;
      if (noReplyHours >= 48) noReplyDistribution.total_48h++;
    }

    noReplyList.push({
      conversation_id: c.id,
      patient_name: c.patient_name || opp?.patient_name || lead?.patient_name || "Bilinmeyen Hasta",
      phone: c.phone_number,
      last_outbound_text: lastOutbound.content,
      expects_reply: classification.expectsReply,
      no_reply_hours: Math.round(noReplyHours * 10) / 10,
      window_open: windowOpen,
      requires_template: !windowOpen,
      recommended_action: recommendedAction,
      risk_reason: riskReason,
      is_eligible: isEligible,
      last_message_status: lastOutbound.status || 'unknown'
    });
  }

  // ═══════════════════════════════════════════════════════════
  // CATEGORY 2: SECONDARY FALLBACK ANALYSIS
  // ═══════════════════════════════════════════════════════════
  const secondaryFallbackList: any[] = [];
  let multiPhoneLeads = 0;
  let primaryNoReplyCandidates = 0;
  let primaryFailedCandidates = 0;
  let secondaryHasExistingConv = 0;
  let secondaryRequiresTemplate = 0;
  let secondaryWindowOpen = 0;
  let secondaryFallbackEligible = 0;
  let excludedOptOutSF = 0;

  for (const c of conversations) {
    const opp = opportunities.find(o => o.id === c.active_opportunity_id);
    const lead = leads.find(l => l.customer_id === c.customer_id || (l.linked_opportunity_id && opp && l.linked_opportunity_id === opp.id));
    if (!lead || !lead.raw_data) continue;

    let parsedRaw: any = null;
    try {
      parsedRaw = typeof lead.raw_data === 'string' ? JSON.parse(lead.raw_data) : lead.raw_data;
    } catch (_) {
      continue;
    }

    if (!parsedRaw || !parsedRaw._all_phones) continue;

    const allPhones = parseAllPhones(parsedRaw._all_phones);
    const primaryPhoneNorm = normalizePhoneForIdentity(c.phone_number);
    const secondaryPhones = allPhones.filter(p => {
      const pNorm = normalizePhoneForIdentity(p);
      return pNorm.e164 && primaryPhoneNorm.e164 && pNorm.e164 !== primaryPhoneNorm.e164;
    });

    if (secondaryPhones.length === 0) continue;
    multiPhoneLeads++;

    // Check if primary phone is in active no-reply or has failed delivery
    const primaryNoReplyItem = noReplyList.find(item => item.conversation_id === c.id);
    if (!primaryNoReplyItem) continue;

    const primaryFailed = primaryNoReplyItem.last_message_status === 'failed';
    const primaryNoReply = primaryNoReplyItem.is_eligible;

    if (!primaryFailed && !primaryNoReply) continue;
    
    if (primaryFailed) primaryFailedCandidates++;
    if (primaryNoReply) primaryNoReplyCandidates++;

    for (const secPhone of secondaryPhones) {
      const secPhoneNorm = normalizePhoneForIdentity(secPhone);
      if (!secPhoneNorm.e164) continue;

      // Find secondary conversation
      const secConv = normalizedConvMap.get(secPhoneNorm.e164);
      const hasConv = !!secConv;
      if (hasConv) secondaryHasExistingConv++;

      let secWindowOpen = false;
      if (secConv) {
        const secMsgs = messagesByConvId[secConv.id] || [];
        const lastSecInbound = secMsgs.filter(m => m.direction === 'in').pop();
        if (lastSecInbound) {
          secWindowOpen = (now.getTime() - new Date(lastSecInbound.created_at).getTime()) <= 24 * 60 * 60 * 1000;
        }
      }

      if (secWindowOpen) secondaryWindowOpen++;
      else secondaryRequiresTemplate++;

      // Cross-phone opt-out rule: if either phone is opted out, exclude!
      const isAnyPhoneOptedOut = (primaryPhoneNorm.e164 && optOutPhones.has(primaryPhoneNorm.e164)) || optOutPhones.has(secPhoneNorm.e164);
      const isStageTerminal = opp && ['lost', 'not_qualified', 'arrived'].includes(opp.stage);

      let riskReason = "No risk";
      let recommendedAction = "No action suggested";

      if (isAnyPhoneOptedOut) {
        riskReason = "Patient requested opt-out (StopRule)";
        excludedOptOutSF++;
      } else if (isStageTerminal) {
        riskReason = `Terminal stage: ${opp.stage} (StopRule)`;
      } else if (!primaryNoReply && !primaryFailed) {
        riskReason = "Primary phone not candidate";
      }

      const isEligible = riskReason === "No risk";

      if (isEligible) {
        secondaryFallbackEligible++;
        if (hasConv) {
          recommendedAction = `Link existing secondary conversation (${secConv.id})`;
        } else {
          recommendedAction = "Prepare secondary contact template draft candidate";
        }
      }

      secondaryFallbackList.push({
        lead_id: lead.id,
        conversation_id: c.id,
        patient_name: c.patient_name || opp?.patient_name || lead.patient_name || "Bilinmeyen Hasta",
        phone: secPhone,
        last_outbound_text: primaryNoReplyItem.last_outbound_text,
        expects_reply: primaryNoReplyItem.expects_reply,
        no_reply_hours: primaryNoReplyItem.no_reply_hours,
        window_open: secWindowOpen,
        requires_template: !secWindowOpen,
        recommended_action: recommendedAction,
        risk_reason: riskReason,
        is_eligible: isEligible
      });
    }
  }

  // ═══════════════════════════════════════════════════════════
  // CATEGORY 3: FORM GREETING ANALYSIS
  // ═══════════════════════════════════════════════════════════
  const formGreetingList: any[] = [];
  let recentLeads72h = 0;
  let hasNoConversation = 0;
  let hasConversationNoInbound = 0;
  let hasPatientMessagedBeforeCount = 0;
  let greetingAlreadySentCount = 0;
  let fgWindowOpen = 0;
  let fgRequiresTemplate = 0;
  let fgEligibleDraftOnly = 0;

  // Active leads created in the last 72 hours
  const activeLeads = leads.filter(l => {
    const elapsed = (now.getTime() - new Date(l.created_at).getTime()) / (1000 * 60 * 60);
    return elapsed <= 72;
  });

  for (const l of activeLeads) {
    recentLeads72h++;
    const primaryPhoneNorm = normalizePhoneForIdentity(l.phone_number);
    
    // Find conversation on primary phone
    const primaryConv = primaryPhoneNorm.e164 ? normalizedConvMap.get(primaryPhoneNorm.e164) : null;
    
    // Parse secondary phones
    let parsedRaw: any = null;
    try {
      parsedRaw = typeof l.raw_data === 'string' ? JSON.parse(l.raw_data) : l.raw_data;
    } catch (_) {}
    const allPhones = parsedRaw && parsedRaw._all_phones ? parseAllPhones(parsedRaw._all_phones) : [];
    const secondaryPhones = allPhones.filter(p => {
      const pNorm = normalizePhoneForIdentity(p);
      return pNorm.e164 && primaryPhoneNorm.e164 && pNorm.e164 !== primaryPhoneNorm.e164;
    });

    // Check if patient wrote inbound message ever on primary or any secondary
    let inboundCount = 0;
    let outboundCount = 0;
    let lastInboundTime = 0;

    const phonesToCheck = [primaryPhoneNorm.e164, ...secondaryPhones.map(p => normalizePhoneForIdentity(p).e164)].filter(Boolean) as string[];

    for (const phone of phonesToCheck) {
      const conv = normalizedConvMap.get(phone);
      if (conv) {
        const convMsgs = messagesByConvId[conv.id] || [];
        for (const m of convMsgs) {
          if (m.direction === 'in') {
            inboundCount++;
            lastInboundTime = Math.max(lastInboundTime, new Date(m.created_at).getTime());
          } else if (m.direction === 'out') {
            outboundCount++;
          }
        }
      }
    }

    const hasConversation = !!primaryConv || secondaryPhones.some(p => {
      const pNorm = normalizePhoneForIdentity(p);
      return pNorm.e164 && normalizedConvMap.has(pNorm.e164);
    });

    if (!hasConversation) hasNoConversation++;
    else if (inboundCount === 0) hasConversationNoInbound++;

    const hasPatientMessagedBefore = inboundCount > 0;
    if (hasPatientMessagedBefore) hasPatientMessagedBeforeCount++;

    const windowOpen = lastInboundTime > 0 && (now.getTime() - lastInboundTime) <= 24 * 60 * 60 * 1000;
    if (windowOpen) fgWindowOpen++;
    else fgRequiresTemplate++;

    // Check if greeting log or outbound message exists
    const hasLog = outreachLogs.some(log => log.lead_id === l.id && ['greeting_sent', 'greeting_template_sent'].includes(log.action));
    const greetingSentBefore = hasLog || outboundCount > 0;
    if (greetingSentBefore) greetingAlreadySentCount++;

    const opp = opportunities.find(o => o.id === l.linked_opportunity_id);
    const isPatientOptedOut = (primaryPhoneNorm.e164 && optOutPhones.has(primaryPhoneNorm.e164)) || secondaryPhones.some(p => {
      const pNorm = normalizePhoneForIdentity(p);
      return pNorm.e164 && optOutPhones.has(pNorm.e164);
    });
    const isStageTerminal = opp && ['lost', 'not_qualified', 'arrived'].includes(opp.stage);

    let riskReason = "No risk";
    let recommendedAction = "No action";

    if (isPatientOptedOut) {
      riskReason = "Patient requested opt-out (StopRule)";
    } else if (isStageTerminal) {
      riskReason = `Terminal stage: ${opp.stage} (StopRule)`;
    } else if (hasPatientMessagedBefore) {
      riskReason = "Patient has already sent inbound message on WhatsApp";
    } else if (greetingSentBefore) {
      riskReason = "Greeting has already been sent to this patient";
    }

    const isEligible = riskReason === "No risk";

    if (isEligible) {
      fgEligibleDraftOnly++;
      recommendedAction = windowOpen ? "Prepare freeform greeting task" : "Prepare template-required greeting task";
    }

    formGreetingList.push({
      lead_id: l.id,
      patient_name: l.patient_name || opp?.patient_name || "Bilinmeyen Hasta",
      phone: l.phone_number,
      last_outbound_text: "N/A",
      expects_reply: false,
      no_reply_hours: 0,
      window_open: windowOpen,
      requires_template: !windowOpen,
      recommended_action: recommendedAction,
      risk_reason: riskReason,
      is_eligible: isEligible
    });
  }

  // Compile final results
  const report = {
    noReply: {
      totalConversationsAnalyzed,
      lastOutboundExists,
      expectsReplyHigh,
      expectsReplyMedium,
      excludedFinalClosing,
      excludedPatientRepliedAfter,
      excludedStopOptOut,
      excludedTerminal,
      eligible3h: noReplyDistribution.total_3h,
      eligible6h: noReplyDistribution.total_6h,
      eligible9h: noReplyDistribution.total_9h,
      eligible24h: noReplyDistribution.total_24h,
      eligible48h: noReplyDistribution.total_48h,
      samples: noReplyList.filter(item => item.is_eligible).slice(0, 10)
    },
    secondaryFallback: {
      multiPhoneLeads,
      primaryNoReplyCandidates,
      primaryFailedCandidates,
      secondaryHasExistingConversation: secondaryHasExistingConv,
      secondaryRequiresTemplate,
      secondaryWindowOpen,
      secondaryFallbackEligible,
      excludedOptOut: excludedOptOutSF,
      excludedCollision: 0,
      samples: secondaryFallbackList.filter(item => item.is_eligible).slice(0, 10)
    },
    formGreeting: {
      recentLeads72h,
      hasNoConversation,
      hasConversationNoInbound,
      hasPatientMessagedBefore: hasPatientMessagedBeforeCount,
      greetingAlreadySent: greetingAlreadySentCount,
      windowOpen: fgWindowOpen,
      requiresTemplate: fgRequiresTemplate,
      templateConfigMissing: fgRequiresTemplate, // No approved template configured
      eligibleDraftOnly: fgEligibleDraftOnly,
      invalidPhone: 0,
      secondaryRecommended: 0,
      samples: formGreetingList.filter(item => item.is_eligible).slice(0, 10)
    }
  };

  // Write ignored scratch file in the project
  const scratchFilePath = path.join(__dirname, 'dry_run_report_raw.json');
  fs.writeFileSync(scratchFilePath, JSON.stringify(report, null, 2));

  console.log("=== FINAL DRY RUN AUDIT REPORT (JSON) ===");
  console.log(JSON.stringify({
    totals: {
      conversations: conversations.length,
      noReplyEligible: noReplyList.filter(item => item.is_eligible).length,
      secondaryFallbackEligible,
      formGreetingEligible: fgEligibleDraftOnly
    },
    noReplyDistribution,
    outreachLogsColumns: outreachLogs.length > 0 ? Object.keys(outreachLogs[0]) : []
  }, null, 2));

  console.log("✅ DRY-RUN COMPLETED SUCCESSFULLY! Output saved to:", scratchFilePath);
  process.exit(0);
}

run().catch(err => {
  console.error("Fatal error running dry-run script:", err);
  process.exit(1);
});
