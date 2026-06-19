import { TenantBrain } from '../../brain/tenant-brain';
import { ConversationIntentRouter, ConversationIntent } from './conversation-intent-router';
import { resolveActivePromptIdentityContext, isNameBypassAllowed } from './active-prompt-context';

export interface DeterministicFallbackParams {
  inboundText: string;
  brain: TenantBrain;
  identityConfig: {
    personaName?: string;
    organizationName?: string;
    organizationShortName?: string;
  };
  unifiedContext: any;
  channelId?: string;
  systemPromptText?: string;
  promptVersion?: string | number;
  /** P0.16-H: Authoritative resolved department from orchestrator's 4-step priority chain */
  resolvedActiveDepartment?: string | null;
}

export interface DeterministicFallbackResult {
  text: string;
  sector: string;
  hasFormContext: boolean;
  hasComplaint: boolean;
  finalPath: string;
  detectedIntent?: ConversationIntent;
}

export class ContextAwareSafeFallbackResolver {
  /**
   * Resolves a safe, deterministic fallback text based on tenant config,
   * industry (sector), and inbound message intents.
   * Gated securely to avoid hardcoding client-specific names/terms globally.
   */
  public static resolve(params: DeterministicFallbackParams): DeterministicFallbackResult {
    const { inboundText, brain, identityConfig, unifiedContext } = params;
    // P0.16-H: Use orchestrator-resolved department (authoritative) over stale CRM
    const orchestratorDept = params.resolvedActiveDepartment || null;
    const lowerInbound = (inboundText || '').toLowerCase().trim();

    // 1. Sector & Context Resolution
    const configIndustry = brain.context.config?.industry;
    const metadataIndustry = (brain.prompts.metadata as any)?.industry;
    const resolvedIndustry = (configIndustry || metadataIndustry || '').toLowerCase();
    
    const isHealthcare = resolvedIndustry === 'healthcare' || resolvedIndustry === 'health';
    const hasFormContext = !!unifiedContext?.latestForm || 
      (Array.isArray(unifiedContext?.patient_known_facts) && unifiedContext.patient_known_facts.length > 0);

    const isHealthcareOrForm = isHealthcare || hasFormContext;

    // CRITICAL: Prevent opportunity.summary leakage.
    // Sourced strictly from patient_known_facts, NEVER from opportunity.summary directly.
    let complaint = '';
    let hasComplaint = false;
    if (isHealthcareOrForm) {
      const facts = unifiedContext?.patient_known_facts || [];
      const rawFactsComplaint = facts.find((f: string) => f.toLowerCase().includes('şikayet') || f.toLowerCase().includes('sikayet'));
      
      if (rawFactsComplaint) {
        const match = rawFactsComplaint.match(/(?:şikayeti|sikayeti|şikayet|sikayet):\s*(.+)/i);
        if (match && match[1]) {
          complaint = match[1].replace(/[.]+$/, '').trim();
          hasComplaint = true;
        }
      }
      
      // Truncate complaint for clean message formatting
      if (complaint.length > 50) {
        complaint = complaint.substring(0, 50) + '...';
      }
    }

    // Dynamic multi-intent international/remote patient check
    const locations = [
      { key: 'Almanya', keywords: ['almanya', 'almanyada', 'almanyadayım', 'almanyadayim', 'germany'] },
      { key: 'Kaliforniya', keywords: ['amerika', 'usa', 'us', 'california', 'kaliforniya'] },
      { key: 'Libya', keywords: ['libya'] },
      { key: 'Irak', keywords: ['irak', 'iraq'] },
      { key: 'İngiltere', keywords: ['ingiltere', 'london', 'londra', 'uk', 'england'] },
      { key: 'Hollanda', keywords: ['hollanda', 'netherlands'] },
      { key: 'Fransa', keywords: ['fransa', 'france'] },
      { key: 'Avrupa', keywords: ['avrupa', 'europe'] },
      { key: 'Yurt dışı', keywords: ['yurt dışı', 'yurt disi', 'yurt dışından', 'yurt disindan', 'yurtdısı', 'yurtdisi', 'international'] },
      { key: 'Şehir dışı', keywords: ['şehir dışı', 'sehir disi', 'sehir dışı', 'şehir disi', 'sehir dışından', 'sehirlerarasi', 'şehirlerarası'] },
      { key: 'Uzak', keywords: ['uzak', 'mesafe', 'cok uzak'] }
      // P0.18: 'konya uzak' kaldırıldı — generic 'uzak'/'mesafe' zaten yakalar
    ];

    const departmentsList = [
      { key: 'Kardiyoloji', keywords: ['kardiyoloji', 'kalp', 'damar', 'cardio', 'heart'] },
      { key: 'Ortopedi ve Travmatoloji', keywords: ['ortopedi', 'kemik', 'eklem', 'diz', 'kalça', 'kalca'] },
      { key: 'Tüp Bebek', keywords: ['tüp bebek', 'tup bebek', 'tüpbebek', 'ivf'] },
      { key: 'Plastik, Rekonstrüktif ve Estetik Cerrahi', keywords: ['estetik', 'burun estetiği', 'burun estetigi', 'rinoplasti', 'plastik cerrahi'] },
      { key: 'Diş Hekimliği', keywords: ['diş', 'dental', 'implant', 'dis', 'diş hekimliği', 'dis hekimligi'] },
      { key: 'Organ Nakli', keywords: ['organ nakli', 'organ', 'nakil', 'nakli'] },
      { key: 'Beyin ve Sinir Cerrahisi (Bel Fıtığı)', keywords: ['bel fıtığı', 'bel fitigi', 'bel fitigi', 'bel fıtıgı'] }
    ];

    const matchedLocation = locations.find(l => l.keywords.some(kw => lowerInbound.includes(kw)));
    const matchedDept = departmentsList.find(d => d.keywords.some(kw => lowerInbound.includes(kw)));
    
    const hasLogistics = ['ulasım', 'ulasim', 'ulaşım', 'surec', 'süreç', 'transfer', 'konaklama', 'otel', 'yol', 'bilet', 'gelem', 'konaklamak', 'logistics'].some(kw => lowerInbound.includes(kw));
    const hasPrice = ['fiyat', 'ucret', 'ücret', 'maliyet', 'ne kadar', 'tutar', 'para', 'fiyatlar', 'fiyati', 'ucreti', 'pricing'].some(kw => lowerInbound.includes(kw));

    if (matchedLocation && hasLogistics && hasPrice) {
      const location = matchedLocation.key;
      const dept = matchedDept?.key ||
        orchestratorDept ||
        unifiedContext?.opportunity?.department ||
        unifiedContext?.conversation?.department ||
        'Tedavi';

      // P0.16-H Telemetry: process answer department selected
      console.log(JSON.stringify({
        tag: 'PROCESS_ANSWER_DEPARTMENT_SELECTED',
        source: orchestratorDept ? 'orchestrator_resolved' : matchedDept ? 'burst_keyword' : 'stale_crm',
        resolvedActiveDepartment: dept,
        orchestratorDept,
        staleDept: unifiedContext?.opportunity?.department || null,
        finalPath: 'multi_intent_healthcare_tourism_fallback'
      }));

      const _tcr = require('./tenant-config-resolver').TenantConfigResolver;
      const _agentLbl = _tcr.getAgentName(brain);
      const text = `${location}'dan bizimle iletişime geçtiğiniz için teşekkür ederiz. ${dept} süreci, ulaşım ve fiyatlandırma ile ilgili bilgiler aşağıdadır:\n\n` +
        `• **Ulaşım ve Konaklama**: Şehir dışı ve yurt dışından gelen ziyaretçilerimiz için havalimanı transferi, konaklama ve süreç planlama koordinasyonu ekibimiz tarafından organize edilmektedir.\n` +
        `• **${dept} Süreci**: İlgili branşımız bünyesinde değerlendirme ve hizmet süreçleri uzman ekibimiz kontrolünde planlanmaktadır.\n` +
        `• **Fiyatlandırma**: Hizmet ücretleri, yapılacak değerlendirme ve oluşturulacak kişiye özel plana göre belirlenmektedir.\n` +
        `• **Sonraki Adım**: Detayları görüşmek ve planlama yapmak üzere ${_agentLbl}la kısa bir görüşme planlanabilir. Hangi gün ve saat aralığında uygun olursunuz? 🙏`;

      return {
        text,
        sector: resolvedIndustry,
        hasFormContext,
        hasComplaint,
        finalPath: 'multi_intent_healthcare_tourism_fallback',
        detectedIntent: 'price_question'
      };
    }

    // Resolve pending slot and interpreted intent
    const history = unifiedContext?.history || [];
    const { PendingQuestionResolver } = require('./pending-question-resolver');
    const { ShortAnswerInterpreter } = require('./short-answer-interpreter');
    const { ConversationStateArbitrator } = require('./conversation-state-arbitrator');
    
    // Route message to find raw intent
    const rawIntent = ConversationIntentRouter.route(inboundText);
    const rawPendingSlot = PendingQuestionResolver.resolve(history);
    const interpretedIntent = ShortAnswerInterpreter.interpret(inboundText, rawPendingSlot);

    const arbitration = ConversationStateArbitrator.arbitrate({
      lastUserMessage: inboundText,
      rawPendingSlot,
      rawInterpretedIntent: interpretedIntent || '',
      routerIntent: rawIntent,
      history
    });

    const detectedIntent = arbitration.effectiveIntent;
    const pendingSlot = arbitration.effectivePendingSlot;

    const isPromptChallenge = (detectedIntent as string) === 'prompt_challenge' || interpretedIntent === 'prompt_challenge';
    const isAbuseOrInsult = (detectedIntent as string) === 'abuse_or_insult' || interpretedIntent === 'abuse_or_insult';
    const isIdentityQuestion = (detectedIntent as string) === 'identity_question' || interpretedIntent === 'identity_question';
    
    const isAngryPatientText = [
      'şikayet', 'sikayet', 'rezalet', 'berbat', 'kötü', 'kotu', 'memnun değil', 'memnun degil',
      'memnun kalmadım', 'memnun kalmadim', 'ilgisiz', 'zaman kaybı', 'zaman kaybi', 'robot',
      'otomatik', 'dalga mı', 'dalga mi', 'düzgün', 'duzgun', 'sinir', 'bıktım', 'biktim',
      'yeter', 'insanla', 'temsilci', 'canlı destek', 'canli destek', 'muhatap', 'kızgın', 'kizgin'
    ].some(kw => lowerInbound.includes(kw));

    const isAngryOrChallenge = 
      isPromptChallenge || 
      isAbuseOrInsult || 
      isIdentityQuestion ||
      isAngryPatientText ||
      interpretedIntent === 'user_correction' ||
      (unifiedContext?.settings?.angryPatientMode === true) ||
      (lowerInbound.includes('bot') || lowerInbound.includes('yapay zeka') || lowerInbound.includes('robot'));

    const intro = isAngryOrChallenge
      ? '' // No hello/intro for angry/challenge path
      : (identityConfig.personaName 
          ? `Merhaba, ${identityConfig.personaName} ben.` 
          : `Merhaba, ben ${isHealthcare ? 'hastane ' : ''}iletişim asistanıyım.`);

    // P0.11: Pre-process mother & complaint info for challenge/angry path
    const factsText = Array.isArray(unifiedContext?.patient_known_facts) ? unifiedContext.patient_known_facts.join(' ').toLowerCase() : '';
    const historyText = (history || []).map((m: any) => m.content).join(' ').toLowerCase();
    const hasMother = lowerInbound.includes('anne') || factsText.includes('anne') || historyText.includes('anne') || lowerInbound.includes('valide') || factsText.includes('valide') || historyText.includes('valide');

    if (!complaint) {
      if (lowerInbound.includes('bel fıt') || lowerInbound.includes('bel fit') || historyText.includes('bel fıt') || historyText.includes('bel fit')) {
        complaint = 'bel fıtığı';
        hasComplaint = true;
      }
    }

    // P0.17: Short confirmation no-slot handler
    // When user says "olur/tamam/evet" (short confirmation) with:
    //   - NO active pending slot (pendingSlot is generic_none or empty)
    //   - NO active task time context (no real scheduled time to confirm)
    // → Produce safe acknowledgment WITHOUT fabricating dates/times
    // This prevents LLM from inventing "22 Haziran Pazartesi 15:00" etc.
    const SHORT_CONFIRM_TOKENS = ['olur', 'tamam', 'evet', 'tabi', 'tabii', 'harika', 'süper', 'peki', 'ok', 'okay', 'tamamdır', 'iyi'];
    const wordCount = lowerInbound.split(/\s+/).filter(Boolean).length;
    const isShortConfirmation = wordCount <= 3 && SHORT_CONFIRM_TOKENS.some(kw => lowerInbound === kw || lowerInbound.startsWith(kw + ' ') || lowerInbound.endsWith(' ' + kw));
    const hasPendingSlotActive = pendingSlot && pendingSlot !== 'generic_none' && pendingSlot !== 'none';
    const hasActiveTaskTimeContext = !!(
      unifiedContext?.active_task?.metadata?.scheduled_for_utc ||
      unifiedContext?.active_task?.metadata?.callback_time_tr
    );

    if (isShortConfirmation && !hasPendingSlotActive && !hasActiveTaskTimeContext) {
      const persona = identityConfig?.personaName
        || (require('./tenant-config-resolver').TenantConfigResolver as typeof import('./tenant-config-resolver').TenantConfigResolver).getAgentName(brain);
      console.log(JSON.stringify({
        tag: 'SHORT_CONFIRMATION_NO_SLOT_BYPASS',
        inbound: lowerInbound,
        wordCount,
        hasPendingSlotActive,
        hasActiveTaskTimeContext,
        finalPath: 'short_confirmation_no_slot_safe'
      }));
      return {
        text: `Talebinizi not aldım. ${persona} uygun bir zaman için sizinle iletişime geçecektir. 🙏`,
        sector: resolvedIndustry,
        hasFormContext,
        hasComplaint,
        finalPath: 'short_confirmation_no_slot_safe',
        detectedIntent: 'confirmation_yes_no' as any
      };
    }

    const isFactsRecallQuery = ['hastalıklar neydi', 'hastaliklar neydi', 'şikayetim neydi', 'sikayetim neydi', 'geçmiş şikayetler', 'gecmis sikayetler', 'ne yazmıştım', 'ne yazmistim', 'hangi hastalık', 'hangi hastalik', 'hastaliklarim neydi', 'hastalıklarım neydi'].some(kw => lowerInbound.includes(kw));

    if (isFactsRecallQuery) {
      const { ConversationKnownFactsResolver } = require('./conversation-known-facts-resolver');
      const factsObj = ConversationKnownFactsResolver.resolve({
        history,
        opportunity: unifiedContext?.opportunity,
        profile: unifiedContext?.profile,
        latestForm: unifiedContext?.latestForm,
        conversation: unifiedContext?.conversation,
        patient_known_facts: unifiedContext?.patient_known_facts
      });
      const factsList = ConversationKnownFactsResolver.formatFacts(factsObj);
      
      let text = '';
      if (factsList.length > 0) {
        text = `Kayıtlarımızdaki bilgileriniz şu şekildedir:\n\n` + factsList.map((f: string) => `• ${f}`).join('\n');
      } else {
        text = `Kayıtlarımızda henüz kayıtlı bir şikayet veya hastalık bilgisi bulunmamaktadır. Yardımcı olabilmem için şikayetinizi veya gitmek istediğiniz bölümü paylaşabilir misiniz?`;
      }
      return {
        text,
        sector: resolvedIndustry,
        hasFormContext,
        hasComplaint,
        finalPath: 'facts_recall_bypass',
        detectedIntent: 'complaint_detail' as any
      };
    }

    // Name Intent detection ("ismim/adım [X]", "ben [X]" or profile name match)
    const nameIntroductions = [
      /\bismim\s+([a-zA-ZçıüşöğİÇIÜŞÖĞ\s]+)/i,
      /\badım\s+([a-zA-ZçıüşöğİÇIÜŞÖĞ\s]+)/i,
      /\badim\s+([a-zA-ZçıüşöğİÇIÜŞÖĞ\s]+)/i,
      /\bben\s+([a-zA-ZçıüşöğİÇIÜŞÖĞ\s]+)/i
    ];
    let detectedName = '';
    for (const regex of nameIntroductions) {
      const match = inboundText.match(regex);
      if (match && match[1]) {
        detectedName = match[1].split(/[.,!?\s]+/)[0].trim();
        break;
      }
    }

    const profileName = unifiedContext?.profile?.first_name || unifiedContext?.conversation?.patient_name || '';
    if (!detectedName && profileName && profileName.trim().length > 1) {
      const cleanProfile = profileName.toLowerCase().trim();
      if (lowerInbound.includes(cleanProfile)) {
        detectedName = profileName.trim();
      }
    }

    if (detectedName) {
      const { isValidPatientName } = require('../../utils/patient-name-resolver');
      if (!isValidPatientName(detectedName)) {
        detectedName = '';
      } else {
        // Capitalize first letter, support Turkish lowercase 'i' to uppercase 'İ'
        const firstChar = detectedName.charAt(0);
        const upperFirst = firstChar === 'i' ? 'İ' : (firstChar === 'ı' ? 'I' : firstChar.toUpperCase());
        detectedName = upperFirst + detectedName.slice(1);
      }
    }

    const systemPromptContent = params.systemPromptText || brain.prompts?.systemPrompt || '';

    const identityCtx = resolveActivePromptIdentityContext({
      brain,
      identityConfig,
      systemPromptText: systemPromptContent
    });

    const hasPersona = !!identityCtx.personaName && identityCtx.personaName !== 'Asistan';
    const pName = identityCtx.personaName || 'Asistan';
    // P0.18: agentName önce identityCtx'den, yoksa TenantConfigResolver'dan okunuyor
    // Bu sayede farklı tenant'larda 'hasta danışmanımız' yerinde custom label kullanılabilir
    const { TenantConfigResolver } = require('./tenant-config-resolver');
    const orgName = identityCtx.organizationName || TenantConfigResolver.getOrgNameFallback(brain);
    const agentName = (identityCtx as any).agentName || TenantConfigResolver.getAgentName(brain);

    // 1. identity_question
    if (detectedIntent === 'identity_question') {
      if (hasPersona) {
        return {
          text: `Ben *${pName}*, ${orgName}’nden sizinle ilgileniyorum. Size nasıl yardımcı olabilirim? 🌿`,
          sector: resolvedIndustry,
          hasFormContext,
          hasComplaint,
          finalPath: 'identity_tenant_bypass',
          detectedIntent
        };
      } else {
        return {
          text: `Merhaba, size yardımcı olmak üzere buradayım. Hangi konuda bilgi almak istersiniz?`,
          sector: resolvedIndustry,
          hasFormContext,
          hasComplaint,
          finalPath: 'identity_generic_bypass',
          detectedIntent
        };
      }
    }

    // 2. call_scheduling_request (only if tenant has custom active prompt/config)
    if (detectedIntent === 'call_scheduling_request' && identityCtx.hasTenantPrompt) {
      const { isValidPatientName } = require('../../utils/patient-name-resolver');
      const patientNameVal = unifiedContext?.conversation?.patient_name || unifiedContext?.opportunity?.patient_name || '';
      const hasValidName = patientNameVal && isValidPatientName(patientNameVal) && !patientNameVal.includes('İsimsiz') && !patientNameVal.match(/^\+?\d+/);

      if (!hasValidName) {
        return {
          text: `Telefon görüşmesi planlaması için ${agentName} size yardımcı olabilir. Size uygun olduğunuz bir zaman aralığını belirtebilir misiniz? Ayrıca, size daha doğru yardımcı olabilmem için adınızı öğrenebilir miyim? 🙏`,
          sector: resolvedIndustry,
          hasFormContext,
          hasComplaint,
          finalPath: 'call_scheduling_tenant_unknown_name_bypass',
          detectedIntent
        };
      } else {
        return {
          text: `Telefon görüşmesi planlaması için ${agentName} size yardımcı olabilir. Size uygun olduğunuz bir zaman aralığını belirtebilir misiniz? 🙏`,
          sector: resolvedIndustry,
          hasFormContext,
          hasComplaint,
          finalPath: 'call_scheduling_tenant_known_name_bypass',
          detectedIntent
        };
      }
    }

    // 3. name_intent + aktif call flow (only if tenant has custom active prompt/config)
    const isNameAllowed = isNameBypassAllowed({
      inboundText,
      history,
      detectedIntent: (detectedIntent as string) || undefined,
      interpretedIntent: interpretedIntent || undefined
    });
    
    if (isNameAllowed && identityCtx.hasTenantPrompt) {
      const nameToUse = detectedName;
      return {
        text: `Teşekkür ederim ${nameToUse}. Bilgilerinizi not aldım. Görüşme için size hangi saat aralığında ulaşılması uygun olur? 🙏`,
        sector: resolvedIndustry,
        hasFormContext,
        hasComplaint,
        finalPath: 'name_intent_call_flow_tenant_bypass',
        detectedIntent
      };
    }

    // 4. continuation_short_reply + aktif pending slot (only if tenant has custom active prompt/config)
    if (detectedIntent === 'continuation_short_reply' && identityCtx.hasTenantPrompt) {
      if (pendingSlot === 'call_time' || pendingSlot === 'call_date' || pendingSlot === 'timezone_clarification') {
        return {
          text: "Arama planlaması için size hangi saat aralığında ulaşılması uygun olur? 🙏",
          sector: resolvedIndustry,
          hasFormContext,
          hasComplaint,
          finalPath: 'continuation_call_time_tenant_bypass',
          detectedIntent
        };
      } else if (pendingSlot === 'confirmation_yes_no') {
        return {
          text: "Belirttiğimiz görüşme planlamasını onaylıyor musunuz?",
          sector: resolvedIndustry,
          hasFormContext,
          hasComplaint,
          finalPath: 'continuation_confirmation_tenant_bypass',
          detectedIntent
        };
      }
    }

    // Doctor Lookup Resolver
    const isDoctorLookup = detectedIntent === 'doctor_lookup' || interpretedIntent === 'doctor_lookup';
    if (isDoctorLookup) {
      let text = '';
      const doctorDirectory = brain.context.config?.doctors || brain.context.config?.doctorDirectory || brain.context.config?.doctor_directory;
      let verifiedDoctorsText = '';
      if (Array.isArray(doctorDirectory) && doctorDirectory.length > 0) {
        verifiedDoctorsText = doctorDirectory.join('\n');
      } else if (typeof doctorDirectory === 'string' && doctorDirectory.trim().length > 0) {
        verifiedDoctorsText = doctorDirectory.trim();
      }

      const { ConversationKnownFactsResolver } = require('./conversation-known-facts-resolver');
      const facts = ConversationKnownFactsResolver.resolve({
        history,
        opportunity: unifiedContext?.opportunity,
        profile: unifiedContext?.profile,
        latestForm: unifiedContext?.latestForm,
        conversation: unifiedContext?.conversation,
        patient_known_facts: unifiedContext?.patient_known_facts
      });

      if (isHealthcare) {
        // P0.16-H: use orchestratorDept first, then previousDepartments from facts, then complaint
        let deptPhrase = '';
        const effectiveDept = orchestratorDept || (facts.previousDepartments?.[0] || null);
        if (effectiveDept) {
          deptPhrase = `${effectiveDept} bölümü`;
        } else if (facts.complaint) {
          deptPhrase = `${facts.complaint} şikayetinizle ilgili bölüm`;
        }

        // P0.16-H Telemetry: doctor lookup department selected
        console.log(JSON.stringify({
          tag: 'DOCTOR_LOOKUP_DEPARTMENT_SELECTED',
          path: 'fallback_bypass',
          source: orchestratorDept ? 'orchestrator_resolved' : (facts.previousDepartments?.[0] ? 'history_facts' : 'complaint'),
          resolvedActiveDepartment: effectiveDept || null,
          staleDept: unifiedContext?.opportunity?.department || null,
        }));

        // P0.16-M: DoctorNamesPolicy replaces legacy "şu an bu ekrandan" text
        if (verifiedDoctorsText) {
          const targetPhrase = deptPhrase ? `${deptPhrase} için doğrulanmış uzman ekibimizin` : 'doğrulanmış uzman ekibimizin';
          text = `Sizlere hizmet veren ${targetPhrase} listesini aşağıda paylaşıyorum:\n${verifiedDoctorsText}`;
        } else {
          // P0.16-M: Never use legacy "bu ekrandan net doğrulayamıyorum" — use DoctorNamesPolicy instead
          const deptKey = effectiveDept ? [effectiveDept] : [];
          try {
            const { DoctorNamesPolicy } = require('./doctor-names-policy');
            const policy = DoctorNamesPolicy.resolve(brain, deptKey, false);
            text = policy.text;
          } catch {
            // Safe fallback if DoctorNamesPolicy not available
            const dept = deptPhrase || 'ilgili bölümümüz';
            text = `${dept} için ${agentName} uzman listesini size iletecektir. Telefon görüşmesi için uygun gün ve saat paylaşır mısınız?`;
          }
        }
      } else {
        if (verifiedDoctorsText) {
          text = `Doğrulanmış uzman kadromuz:\n${verifiedDoctorsText}`;
        } else {
          text = `Bu ekrandan güncel uzman listesini doğrulayamıyorum. Talebinizle ilgili uzman ekibimiz değerlendirme yapabilir. İsterseniz temsilci ekibimize yönlendirilmesi için not alabilirim.`;
        }
      }

      return {
        text,
        sector: resolvedIndustry,
        hasFormContext,
        hasComplaint,
        finalPath: 'doctor_lookup_bypass',
        detectedIntent
      };
    }

    // Human Transfer Resolver
    const isHumanTransfer = detectedIntent === 'human_transfer_request' || interpretedIntent === 'human_transfer_request';
    if (isHumanTransfer) {
      const text = isHealthcare
        ? `Haklısınız, bu konuda ${agentName}nın ilgilenmesi daha doğru olur. Talebinizin iletilmesi için not alıyorum.`
        : `Haklısınız, bu konuda bir temsilcimizin ilgilenmesi daha doğru olur. Talebinizi temsilcimize iletilmesi için not alıyorum.`;
      return {
        text,
        sector: resolvedIndustry,
        hasFormContext,
        hasComplaint,
        finalPath: 'human_transfer_bypass',
        detectedIntent
      };
    }

    // Form Followup Resolver
    const isFormFollowup = detectedIntent === 'form_followup' || interpretedIntent === 'form_followup';
    if (isFormFollowup) {
      const formFacts = unifiedContext?.patient_known_facts || [];
      const hasRealFormContext = !!unifiedContext?.latestForm || (Array.isArray(formFacts) && formFacts.length > 0);
      let text = '';
      if (hasRealFormContext) {
        text = `Form başvurunuzla ilgili yardımcı olabilirim. Hangi konuda bilgi almak istersiniz?`;
      } else {
        text = `Form kaydınızı burada net göremiyorum. Size yardımcı olabilmem için başvuru yaptığınız konu veya şikayeti yazabilir misiniz?`;
      }
      return {
        text,
        sector: resolvedIndustry,
        hasFormContext: hasRealFormContext,
        hasComplaint,
        finalPath: 'form_followup_bypass',
        detectedIntent
      };
    }

    const isBotAccusation = ['bot musun', 'sen bot musun', 'are you a bot', 'botsun', 'robot musun', 'yapay zeka mısın', 'yapay zeka misin', 'insan mısın', 'insan misin'].some(kw => lowerInbound.includes(kw));
    const isAiAccusation = ['yapay zeka', 'yapayzeka', 'gpt', 'gemini', 'openai', 'claude', 'dil modeli', 'hangi model'].some(kw => lowerInbound.includes(kw));
    const isPromptChallengeOnly = detectedIntent === 'prompt_challenge' || interpretedIntent === 'prompt_challenge' || ['prompt', 'promt', 'sistem prompt', 'system prompt', 'talimatların', 'sistem talimati', 'kuralın ne', 'direktifin ne', 'uydurma'].some(kw => lowerInbound.includes(kw));
    const isAngryPromptChallenge = isPromptChallengeOnly && ['şikayet', 'sikayet', 'rezalet', 'berbat', 'kötü', 'sinir', 'bıktım', 'yeter', 'dalga'].some(kw => lowerInbound.includes(kw));

    const isLlmBypassChallenge = isPromptChallengeOnly || isBotAccusation || isAiAccusation || isAngryPromptChallenge;

    if (isLlmBypassChallenge) {
      const { PromptChallengeSafetyPolicy } = require('./prompt-challenge-safety-policy');
      const { ConversationKnownFactsResolver } = require('./conversation-known-facts-resolver');
      
      const facts = ConversationKnownFactsResolver.resolve({
        history,
        opportunity: unifiedContext?.opportunity,
        profile: unifiedContext?.profile,
        latestForm: unifiedContext?.latestForm,
        conversation: unifiedContext?.conversation,
        patient_known_facts: unifiedContext?.patient_known_facts
      });

      const text = PromptChallengeSafetyPolicy.getChallengeFallbackResponse(
        inboundText,
        facts,
        hasPersona ? pName : undefined,
        identityCtx.organizationName
      );

      return {
        text,
        sector: resolvedIndustry,
        hasFormContext,
        hasComplaint,
        finalPath: 'prompt_challenge_bypass',
        detectedIntent
      };
    }

    if (isAngryOrChallenge) {
      // Identity query, bot questions, abuse or general anger
      let text = '';

      const isAiOrBotOrPromptQuestion = 
        lowerInbound.includes('bot') || 
        lowerInbound.includes('yapay zeka') || 
        lowerInbound.includes('robot') || 
        lowerInbound.includes('prompt') || 
        lowerInbound.includes('promt') || 
        lowerInbound.includes('sistem') || 
        (detectedIntent as string) === 'prompt_challenge' || 
        interpretedIntent === 'prompt_challenge' || 
        (detectedIntent as string) === 'identity_question' || 
        interpretedIntent === 'identity_question';

      if (hasPersona && isAiOrBotOrPromptQuestion) {
        if (hasComplaint) {
          text = `Ben size süreç ve başvuru konusunda yardımcı olmak için buradayım. Ben ${pName}, ${orgName}’nden sizinle ilgileniyorum. İç sistem detaylarını paylaşamam; ama şikayetinizi, uygun bölümü ve randevu sürecini netleştirebiliriz.`;
        } else {
          text = `Ben size süreç ve başvuru konusunda yardımcı olmak için buradayım. Ben ${pName}, ${orgName}’nden sizinle ilgileniyorum. İç sistem detaylarını paylaşamam; ama şikayetinizi, uygun bölümü ve randevu sürecini netleştirebiliriz.`;
        }
      } else {
        if (hasComplaint) {
          text = `Kusura bakmayın, cevaplarım yeterince net olmadı. ${hasMother ? 'Annenizin ' : ''}${complaint} süreciyle ilgili sorularınızı daha düzgün yanıtlayayım.`;
        } else {
          text = isHealthcare
            ? 'Kusura bakmayın, cevaplarım yeterince net olmadı. Size sağlık talebinizle ilgili yardımcı olayım.'
            : 'Kusura bakmayın, cevaplarım yeterince net olmadı. Size yardımcı olmaya devam edebilirim.';
        }
      }
      return {
        text,
        sector: resolvedIndustry,
        hasFormContext,
        hasComplaint,
        finalPath: 'angry_challenge_fallback',
        detectedIntent
      };
    }

    // Priority 1: User Correction / Frustration
    if (detectedIntent === 'user_correction' || interpretedIntent === 'user_correction') {
      const isRecallFrustration = ['söyledim', 'soyledim', 'belirttim', 'belirtmiştim', 'belirtmistim', 'yazdım ya', 'yazdim ya', 'aynı şeyi söyleme', 'ayni seyi soyleme'].some(kw => lowerInbound.includes(kw));

      let replyText = '';
      if (isRecallFrustration) {
        const recallSummary = buildRecallFactsSummary(history);
        if (recallSummary) {
          replyText = `Haklısınız, ${recallSummary} yazmıştınız. Hasta danışmanımız randevu veya süreç planlaması için sizinle iletişime geçebilir.`;
        } else {
          replyText = `Haklısınız, önceki mesajlarınızı kontrol ettim. Size daha iyi yardımcı olabilmem için randevu veya hekim görüşmesi organize edebiliriz.`;
        }
      } else {
        const { ConversationKnownFactsResolver } = require('./conversation-known-facts-resolver');
        const facts = ConversationKnownFactsResolver.resolve({
          history,
          opportunity: unifiedContext?.opportunity,
          profile: unifiedContext?.profile,
          latestForm: unifiedContext?.latestForm,
          conversation: unifiedContext?.conversation
        });

        let deptPhrase = '';
        if (facts.previousDepartments && facts.previousDepartments.length > 0) {
          deptPhrase = facts.previousDepartments[0];
        } else if (facts.complaint) {
          deptPhrase = `${facts.complaint} ile ilgili bölüm`;
        }

        const isContinuityMention = ['söyledin', 'soyledin', 'dedin', 'söylemiştin', 'soylemistin', 'belirttin'].some(kw => lowerInbound.includes(kw));

        if (isContinuityMention && deptPhrase && isHealthcare) {
          replyText = `Haklısınız, kusura bakmayın. Önceki mesajlarımızda ${deptPhrase} ile ilgili görüşmüştük. Bu süreç doğrultusunda randevu planlamak veya detayları görüşmek üzere telefon araması organize edebilirim.`;
        } else {
          const userMsgs = history.filter((m: any) => m.role === 'user');
          const lastUserMsgText = userMsgs.length > 0 ? userMsgs[userMsgs.length - 1].content : '';
          if (lastUserMsgText) {
            if (isHealthcare) {
              replyText = `Haklısınız, cevabnızı aldım. ${lastUserMsgText} bilgisini not ettim; isterseniz ${agentName}la telefon görüşmesi planlanması için not alabiliriz.`;
            } else {
              replyText = `Haklısınız, cevabınızı aldım. ${lastUserMsgText} bilgisini not ettim; isterseniz bu bilgiyi temsilci ekibimize iletilmesi için not alabilirim.`;
            }
          } else {
            if (isHealthcare) {
              replyText = `Haklısınız, cevabnızı aldım ve not ettim; isterseniz ${agentName}la telefon görüşmesi planlanması için not alabiliriz.`;
            } else {
              replyText = `Haklısınız, cevabınızı aldım ve not ettim; isterseniz bu bilgiyi temsilci ekibimize iletilmesi için not alabilirim.`;
            }
          }
        }
      }

      return {
        text: replyText,
        sector: resolvedIndustry,
        hasFormContext,
        hasComplaint,
        finalPath: isRecallFrustration ? 'user_correction_recall_fallback' : 'user_correction_fallback',
        detectedIntent
      };
    }

    // P0.16-J: Next Step / Consultant Ownership — fires before transfer/generic
    const isNextStepRequest = (detectedIntent as string) === 'next_step_request' || interpretedIntent === 'next_step_request';
    if (isNextStepRequest) {
      // Scan history for multi-patient context (primary + secondary patient mentions)
      const histText = (history || []).map((m: any) => (m.content || '').toLowerCase()).join(' ');

      // Primary complaint (the user themselves)
      const selfComplaint = (() => {
        if (histText.includes('bel fıt') || histText.includes('bel fit')) return 'bel fıtığı değerlendirme süreci';
        if (histText.includes('boyun fıt') || histText.includes('boyun fit')) return 'boyun fıtığı değerlendirme süreci';
        if (histText.includes('diz') && histText.includes('ağrı')) return 'diz ağrısı değerlendirme süreci';
        if (histText.includes('ameliyat')) return 'ameliyat değerlendirme süreci';
        if (histText.includes('omurga')) return 'omurga değerlendirme süreci';
        return null;
      })();

      // Secondary patient (e.g. annem, babam, eşim, yakınım)
      const hasMother = histText.includes('annem');
      const hasFather = histText.includes('babam');
      const hasSpouse = histText.includes('eşim') || histText.includes('esim');
      const hasSecondary = hasMother || hasFather || hasSpouse;
      const secondaryLabel = hasMother ? 'anneniz' : hasFather ? 'babanız' : hasSpouse ? 'eşiniz' : null;

      // Secondary department from history
      const secondaryDept = (() => {
        if (histText.includes('kardiyoloji')) return 'kardiyoloji';
        if (histText.includes('göz') || histText.includes('goz')) return 'göz hastalıkları';
        if (histText.includes('ortopedi')) return 'ortopedi';
        return null;
      })();

      // Location context
      const isAbroad = histText.includes('almanya') || histText.includes('yurt dışı') || histText.includes('yurt disi')
        || histText.includes('avusturya') || histText.includes('hollanda') || histText.includes('ingiltere')
        || histText.includes('fransa') || histText.includes('isviçre');
      const countryName = histText.includes('almanya') ? 'Almanya'
        : histText.includes('avusturya') ? 'Avusturya'
        : histText.includes('hollanda') ? 'Hollanda'
        : histText.includes('ingiltere') ? 'İngiltere'
        : histText.includes('fransa') ? 'Fransa'
        : isAbroad ? 'Yurt dışı' : null;

      // Build topic list
      const topics: string[] = [];
      if (selfComplaint) topics.push(`Sizin için: ${selfComplaint}`);
      if (hasSecondary && secondaryDept) topics.push(`${secondaryLabel ? secondaryLabel.charAt(0).toUpperCase() + secondaryLabel.slice(1) : 'Yakınınız'} için: ${secondaryDept} ön görüşme/randevu talebi`);
      else if (hasSecondary && !secondaryDept) topics.push(`${secondaryLabel ? secondaryLabel.charAt(0).toUpperCase() + secondaryLabel.slice(1) : 'Yakınınız'} için: görüşme/randevu talebi`);

      // Compose response
      let text = '';
      if (isHealthcare) {
        if (topics.length >= 2) {
          const topicLines = topics.map((t, i) => `${i + 1}. ${t}`).join('\n');
          text = `Elbette, hemen netleştirelim.\n\nSizin için şu talepleri not ediyorum:\n${topicLines}\n\nSizi hangi gün ve saat aralığında aramamız uygun olur?`;
          if (countryName) {
            text += `\n${countryName}'da olduğunuzu not aldım; saati ${countryName} saati olarak yazabilirsiniz.`;
          }
        } else if (selfComplaint) {
          text = `Elbette, belirleyelim.\n\n${selfComplaint} için sizi hangi gün ve saat aralığında aramamız uygun olur?`;
          if (countryName) {
            text += `\n${countryName}'da olduğunuzu not aldım; saati ${countryName} saati olarak yazabilirsiniz.`;
          }
        } else {
          text = `Elbette, belirleyelim. Sizi hangi gün ve saat aralığında aramamız uygun olur?`;
          if (countryName) {
            text += `\n${countryName}'da olduğunuzu not aldım; saati ${countryName} saati olarak yazabilirsiniz.`;
          }
        }
      } else {
        text = `Elbette, belirleyelim. Sizi hangi gün ve saat aralığında aramamız uygun olur?`;
      }

      // Telemetry
      console.log(JSON.stringify({
        tag: 'CONSULTANT_NEXT_STEP_TRIGGERED',
        resolvedIndustry,
        hasMultiPatientContext: hasSecondary,
        hasSelfComplaint: !!selfComplaint,
        secondaryLabel: secondaryLabel || null,
        topicCount: topics.length,
        isAbroad,
        countryName: countryName || null
      }));
      console.log(JSON.stringify({
        tag: 'CALLBACK_SLOT_REQUESTED',
        resolvedIndustry,
        topicCount: topics.length,
        isAbroad
      }));

      return {
        text,
        sector: resolvedIndustry,
        hasFormContext,
        hasComplaint,
        finalPath: 'next_step_consultant_ownership',
        detectedIntent
      };
    }


    if (detectedIntent === 'transfer_request' || interpretedIntent === 'transfer_request') {
      return {
        text: `Talebinizi ilgili ekibe aktarıyorum, en kısa sürede sizinle iletişime geçeceklerdir.`,
        sector: resolvedIndustry,
        hasFormContext,
        hasComplaint,
        finalPath: 'intent_transfer_fallback',
        detectedIntent: 'transfer_request'
      };
    }

    // Priority 3: Pending Slot-Aware Fallback (guided recovery)
    if (pendingSlot && pendingSlot !== 'generic_none') {
      let slotText = '';
      if (pendingSlot === 'complaint_duration') {
        slotText = `Şikayetinizin ne kadardır devam ettiğini (örneğin kaç gündür veya kaç aydır olduğunu) paylaşabilir misiniz?`;
      } else if (pendingSlot === 'call_date') {
        slotText = `Telefon görüşmesi için size uygun günü paylaşabilir misiniz?`;
      } else if (pendingSlot === 'call_time') {
        slotText = `Telefon görüşmesi için size uygun saat aralığını paylaşabilir misiniz?`;
      } else if (pendingSlot === 'timezone_clarification') {
        slotText = `Belirttiğiniz saat hangi ülke veya şehir saatine göre olsun?`;
      } else if (pendingSlot === 'confirmation_yes_no') {
        slotText = `Belirttiğimiz görüşme planlamasını onaylıyor musunuz?`;
      } else if (pendingSlot === 'transfer_confirmation') {
        slotText = isHealthcare
          ? `Sizi ilgili ${agentName}ımıza aktarmamı onayliyor musunuz?`
          : `Sizi ilgili uzman temsilcimize aktarmamı onaylıyor musunuz?`;
      } else if (pendingSlot === 'price_followup') {
        slotText = isHealthcare
          ? `Dilerseniz ${agentName}la telefon görüşmesi planlanması için not alabiliriz.`
          : `Dilerseniz temsilcimizle telefon görüşmesi planlanması için not alabiliriz.`;
      } else if (pendingSlot === 'complaint_detail') {
        slotText = `Durumunuzu daha iyi anlayabilmemiz için şikayetinizi biraz daha detaylandırabilir misiniz?`;
      }

      if (slotText) {
        return {
          text: slotText,
          sector: resolvedIndustry,
          hasFormContext,
          hasComplaint,
          finalPath: `pending_slot_${pendingSlot}_fallback`,
          detectedIntent
        };
      }
    }

    // Priority 4: General Intent Fallbacks
    if (detectedIntent === 'call_scheduling_request') {
      const factsText = Array.isArray(unifiedContext?.patient_known_facts) ? unifiedContext.patient_known_facts.join(' ').toLowerCase() : '';
      const historyText = (history || []).map((m: any) => m.content).join(' ').toLowerCase();
      const hasTime = factsText.includes('saat') || historyText.includes('saat') || /\d{1,2}[:.]\d{2}/.test(lowerInbound) || /\b\d{1,2}\s*(de|da|te|ta|e|a|gibi|sularında)\b/.test(lowerInbound);
      
      let text = '';
      if (isHealthcare) {
        if (hasTime) {
          text = `Not aldım. Hasta danışmanımızla görüşme planlanması için iletebiliriz 🙏`;
        } else {
          text = `Size hangi saat aralığında ulaşılması uygun olur? 🙏`;
        }
      } else {
        if (hasTime) {
          text = `Not aldım. Temsilcimizle görüşme planlanması için iletebiliriz 🙏`;
        } else {
          text = `Size hangi saat aralığında ulaşılması uygun olur? 🙏`;
        }
      }
      return {
        text,
        sector: resolvedIndustry,
        hasFormContext,
        hasComplaint,
        finalPath: 'intent_call_scheduling_fallback',
        detectedIntent
      };
    }

    if (detectedIntent === 'time_availability') {
      const text = isHealthcare
        ? `Paylaştığınız zaman bilgisini not aldım. Hasta danışmanımız saat planlamasını teyit etmek üzere sizinle iletişime geçecektir.`
        : `Paylaştığınız zaman bilgisini not aldım. Temsilci arkadaşımız saat planlamasını teyit etmek üzere sizinle iletişime geçecektir.`;
      return {
        text,
        sector: resolvedIndustry,
        hasFormContext,
        hasComplaint,
        finalPath: 'intent_time_availability_fallback',
        detectedIntent
      };
    }

    if (detectedIntent === 'price_question') {
      const institutionLabel = TenantConfigResolver.getInstitutionLabel(brain);
      const text = isHealthcare
        ? `Hizmet ve tedavi ücretlerimiz, ${institutionLabel} yapılacak kişiye özel muayene ve değerlendirmeler sonrasında netleşmektedir. Detaylı bilgi sunabilmemiz için ${agentName}la kısa bir telefon görüşmesi planlanabilir.`
        : `Ücretlerimiz ve hizmet seçeneklerimiz kişiye özel yapılacak planlama sonrasında belirlenmektedir. Detaylı bilgi için ${agentName}la kısa bir görüşme planlanabilir.`;
      return {
        text,
        sector: resolvedIndustry,
        hasFormContext,
        hasComplaint,
        finalPath: 'intent_price_question_fallback',
        detectedIntent
      };
    }

    if (detectedIntent === 'distance_objection') {
      const text = isHealthcare
        ? `Uzaklık endişenizi çok iyi anlıyorum. Şehir dışından ve yurt dışından gelen ziyaretçilerimiz için transfer, konaklama ve süreç planlama koordinasyonunu ekibimiz organize etmektedir. Detayları telefonda görüşebiliriz.`
        : `Mesafe konusundaki endişenizi anlıyorum. Uzaktan katılım ve koordinasyon konusunda ekibimiz her türlü desteği sağlamaktadır. Detayları görüşmek için kısa bir telefon görüşmesi planlayabiliriz.`;
      return {
        text,
        sector: resolvedIndustry,
        hasFormContext,
        hasComplaint,
        finalPath: 'intent_distance_objection_fallback',
        detectedIntent
      };
    }

    // 3. Fallback Generation Routing for non-intent or default intents

    // Name Intent detection already performed at initialization

    if (detectedName) {
      if (isHealthcareOrForm && hasComplaint) {
        return {
          text: `Teşekkür ederim ${detectedName}. ${complaint} konusuyla ilgili uygun zamanı netleştirebiliriz.`,
          sector: resolvedIndustry,
          hasFormContext,
          hasComplaint,
          finalPath: 'name_healthcare_complaint_fallback',
          detectedIntent
        };
      } else {
        return {
          text: `Teşekkür ederim ${detectedName}. Bilgilerinizi not aldım.`,
          sector: resolvedIndustry,
          hasFormContext,
          hasComplaint,
          finalPath: 'name_generic_fallback',
          detectedIntent
        };
      }
    }

    const isGreeting = detectedIntent === 'greeting';

    // Intent: Greeting
    if (isGreeting) {
      if (isHealthcare && hasComplaint) {
        return {
          text: `${intro} ${complaint} konusuyla ilgili yardımcı olayım. Bu durum ne zamandır devam ediyor?`,
          sector: resolvedIndustry,
          hasFormContext,
          hasComplaint,
          finalPath: 'greeting_healthcare_complaint_fallback',
          detectedIntent
        };
      } else if (hasFormContext) {
        return {
          text: `${intro} Formunuzla ilgili yardımcı olayım; hangi konuda bilgi almak istiyorsunuz?`,
          sector: resolvedIndustry,
          hasFormContext,
          hasComplaint,
          finalPath: 'greeting_form_fallback',
          detectedIntent
        };
      } else if (isHealthcare) {
        return {
          text: `${intro} Sağlık talebinizle ilgili yardımcı olayım; hangi konuda bilgi almak istiyorsunuz?`,
          sector: resolvedIndustry,
          hasFormContext,
          hasComplaint,
          finalPath: 'greeting_healthcare_generic_fallback',
          detectedIntent
        };
      } else {
        // Parametric SaaS/tenant fallback (never use "nasıl yardımcı olabilirim")
        return {
          text: `${intro} Hangi konuda bilgi almak istediğinizi yazabilirsiniz.`,
          sector: resolvedIndustry,
          hasFormContext,
          hasComplaint,
          finalPath: 'greeting_neutral_fallback',
          detectedIntent
        };
      }
    }

    // 3.5. Tenant Default History Fallback (only if no specific intent/bypass returned early)
    if (identityCtx.hasTenantPrompt && history.length > 0) {
      return {
        text: buildHistoryAwareRecoveryFallback(history, isHealthcare, resolvedIndustry, identityCtx, agentName),
        sector: resolvedIndustry,
        hasFormContext,
        hasComplaint,
        finalPath: 'tenant_neutral_history_fallback',
        detectedIntent
      };
    }

    // 4. Default Fallback Routing (General)
    if (history.length > 0) {
      return {
        text: buildHistoryAwareRecoveryFallback(history, isHealthcare, resolvedIndustry, identityCtx, agentName),
        sector: resolvedIndustry,
        hasFormContext,
        hasComplaint,
        finalPath: 'default_history_fallback',
        detectedIntent
      };
    }

    if (isHealthcareOrForm && hasComplaint) {
      return {
        text: `${intro} ${complaint} konusuyla ilgili yardımcı olayım. Bu durum ne zamandır devam ediyor?`,
        sector: resolvedIndustry,
        hasFormContext,
        hasComplaint,
        finalPath: 'default_healthcare_complaint_fallback',
        detectedIntent
      };
    } else if (isHealthcare) {
      return {
        text: `${intro} Sağlık talebinizle ilgili yardımcı olayım; hangi konuda bilgi almak istiyorsunuz?`,
        sector: resolvedIndustry,
        hasFormContext,
        hasComplaint,
        finalPath: 'default_healthcare_generic_fallback',
        detectedIntent
      };
    } else {
      return {
        text: `${intro} Hangi konuda bilgi almak istediğinizi yazabilirsiniz.`,
        sector: resolvedIndustry,
        hasFormContext,
        hasComplaint,
        finalPath: 'default_neutral_fallback',
        detectedIntent
      };
    }
  }
}

export function buildRecallFactsSummary(history: any[]): string {
  if (!Array.isArray(history) || history.length === 0) {
    return '';
  }

  let complaint = '';
  let duration = '';
  const symptoms: string[] = [];
  let fear = '';

  for (const msg of history) {
    if (msg.role !== 'user' || !msg.content) continue;
    const text = msg.content.toLowerCase();

    // 1. Complaint detection
    if (text.includes('bel fıt') || text.includes('bel fit')) {
      complaint = 'bel fıtığı';
    } else if (text.includes('boyun fıt') || text.includes('boyun fit')) {
      complaint = 'boyun fıtığı';
    }

    // 2. Duration detection
    const durationMatch = msg.content.match(/\b(\d+|bir|iki|üç|uc|dört|dort|beş|bes|altı|alti|yedi|sekiz|dokuz|on)\s*(?:yıldır|yildir|aydır|aydir|haftadır|haftadir|gündür|gundur)\b/i);
    if (durationMatch) {
      duration = durationMatch[0].toLowerCase();
    }

    // 3. Symptoms detection
    if (text.includes('bacak')) {
      symptoms.push('ağrının bacaklarınıza vurmaya başladığını');
    }
    if (text.includes('ayakta')) {
      symptoms.push('uzun süre ayakta duramadığınızı');
    }
    if (text.includes('uyuş') || text.includes('uyus')) {
      symptoms.push('uyuşmalarınız olduğunu');
    }

    // 4. Fear detection
    if (text.includes('ameliyat') && (text.includes('kork') || text.includes('endişe') || text.includes('endise') || text.includes('çekin') || text.includes('cekin'))) {
      fear = 'ameliyat ihtimalinden çekindiğinizi';
    }
  }

  const pieces: string[] = [];
  if (complaint) {
    if (complaint === 'bel fıtığı') {
      pieces.push(`bel fıtığınızın ${duration ? `${duration} ` : ''}sürdüğünü`);
    } else if (complaint === 'boyun fıtığı') {
      pieces.push(`boyun fıtığınızın ${duration ? `${duration} ` : ''}sürdüğünü`);
    } else {
      pieces.push(`şikayetinizin ${duration ? `${duration} ` : ''}sürdüğünü`);
    }
  } else if (duration) {
    pieces.push(`şikayetinizin ${duration} sürdüğünü`);
  }

  pieces.push(...symptoms);

  if (fear) {
    pieces.push(fear);
  }

  if (pieces.length === 0) {
    return '';
  }

  if (pieces.length === 1) {
    return pieces[0];
  }
  if (pieces.length === 2) {
    return `${pieces[0]} ve ${pieces[1]}`;
  }
  const last = pieces.pop();
  return `${pieces.join(', ')} ve ${last}`;
}

export function buildHistoryAwareRecoveryFallback(
  history: any[],
  isHealthcare: boolean,
  resolvedIndustry: string,
  identityCtx: any,
  agentName: string
): string {
  const hasHistory = Array.isArray(history) && history.length > 0;
  const pName = identityCtx?.personaName;
  // P0.18: orgName resolves via identityCtx.organizationName, then identityCtx.orgNameFallback (from TenantConfigResolver),
  // then generic sector-based default. No tenant name hardcoded.
  const orgName = identityCtx?.organizationName
    || identityCtx?.orgNameFallback
    || (isHealthcare ? 'Sağlık Merkezi' : 'Hizmet Merkezi');
  const hasPersona = !!pName && pName !== 'Asistan';

  if (!hasHistory) {
    if (hasPersona) {
      return `Ben *${pName}*, ${orgName}’nden sizinle ilgileniyorum. Size nasıl yardımcı olabilirim? 🌿`;
    }
    return isHealthcare
      ? 'Merhaba, size sağlık talebinizle ilgili yardımcı olayım. Hangi konuda bilgi almak istiyorsunuz?'
      : 'Merhaba, size yardımcı olmak üzere buradayım. Hangi konuda bilgi almak istersiniz?';
  }

  // We have history! Let's extract details.
  let complaint = '';
  let duration = '';
  const symptoms: string[] = [];
  let fear = '';

  for (const msg of history) {
    if (msg.role !== 'user' || !msg.content) continue;
    const text = msg.content.toLowerCase();

    // 1. Complaint detection
    if (text.includes('bel fıt') || text.includes('bel fit')) {
      complaint = 'bel fıtığı';
    } else if (text.includes('boyun fıt') || text.includes('boyun fit')) {
      complaint = 'boyun fıtığı';
    }

    // 2. Duration detection
    const durationMatch = msg.content.match(/\b(\d+|bir|iki|üç|uc|dört|dort|beş|bes|altı|alti|yedi|sekiz|dokuz|on)\s*(?:yıldır|yildir|aydır|aydir|haftadır|haftadir|gündür|gundur)\b/i);
    if (durationMatch) {
      duration = durationMatch[0].toLowerCase();
    }

    // 3. Symptoms detection
    if (text.includes('bacak')) {
      symptoms.push('bacaklara vuran ağrı');
    }
    if (text.includes('ayakta')) {
      symptoms.push('uzun süre ayakta duramama');
    }
    if (text.includes('uyuş') || text.includes('uyus')) {
      symptoms.push('uyuşma');
    }

    // 4. Fear/Anxiety detection
    if (text.includes('ameliyat') && (text.includes('kork') || text.includes('endişe') || text.includes('endise') || text.includes('çekin') || text.includes('cekin'))) {
      fear = 'ameliyat';
    }
  }

  // If specific clinical profile is found (like bel fıtığı + bacak/ayakta/ameliyat)
  if (complaint === 'bel fıtığı' && (fear === 'ameliyat' || symptoms.length > 0)) {
    let response = "Ameliyat ihtimali sizi endişelendirmiş olabilir, bu anlaşılır. Bel fıtığında süreç genelde muayene ve mevcut MR/tetkiklerin değerlendirilmesiyle başlar. Her hasta için doğrudan ameliyat kararı verilmez; uygun yaklaşım uzman hekim değerlendirmesiyle netleşir.";
    
    if (symptoms.length > 0) {
      const formattedSymptoms = symptoms.join(' ve ');
      // Capitalize first letter of symptoms for clean starting
      const capitalizedSymptoms = formattedSymptoms.charAt(0).toUpperCase() + formattedSymptoms.slice(1);
      response += ` ${capitalizedSymptoms} şikayetiniz olduğu için sizi ilgili birime yönlendirebiliriz.`;
    } else {
      response += " Bel fıtığı şikayetiniz olduğu için sizi ilgili birime yönlendirebiliriz.";
    }
    return response;
  }

  // General healthcare fallback but with summary of complaint
  if (isHealthcare) {
    if (complaint) {
      return `Haklısınız, ${complaint} şikayetinizle ilgili paylaştığınız detayları not ettim. Bu süreçte değlendirme ve planlama için sizi ilgili birime/${agentName}a yönlendirebiliriz.`;
    }
    if (hasPersona) {
      return `Ben *${pName}*, ${orgName}’nden sizinle ilgileniyorum. Size sağlık talebinizle ilgili yardımcı olayım.`;
    }
    return 'Merhaba, size sağlık talebinizle ilgili yardımcı olayım. Hangi konuda bilgi almak istiyorsunuz?';
  }

  if (hasPersona) {
    return `Ben *${pName}*, ${orgName}’nden sizinle ilgileniyorum. Hangi konuda bilgi almak istediğinizi yazabilirsiniz.`;
  }
  return 'Merhaba, size yardımcı olmak üzere buradayım. Hangi konuda bilgi almak istersiniz?';
}

