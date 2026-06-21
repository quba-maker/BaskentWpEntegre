import crypto from 'crypto';
import { TenantBrain } from '../../brain/tenant-brain';
import { ChatMessage, AIOrchestrator } from './orchestrator';
import { PromptBuilder } from './prompt-builder';
import { ContextAwareSafeFallbackResolver } from './context-aware-safe-fallback';
import { MultilingualQualityGate } from './multilingual-quality-gate';
import { TurkishMorphologyGuard } from './turkish-morphology-guard';
import { FinalOutboundGuard } from './final-outbound-guard';
import { ResponseFormattingPolicy } from './response-formatting-policy';
import { ConversationTurnAggregator } from './conversation-turn-aggregator';
import { ConversationTopicSwitchResolver } from './conversation-topic-switch-resolver';
import { DoctorDirectoryResolver } from './doctor-directory-resolver';
import { DepartmentAliasResolver } from './department-alias-resolver';
import { RecentDepartmentContextResolver } from './recent-department-context-resolver';
import { IdentityEngine } from './engines/identity';
import { withTenantDB } from '@/lib/core/tenant-db';
// P0.16-K: Consultant brain imports
import { ConsultantConversationStateResolver } from './consultant-conversation-state-resolver';
import { MultiIntentConsultantComposer } from './multi-intent-consultant-composer';
import { DoctorNamesPolicy } from './doctor-names-policy';
import { ConversationIntentRouter } from './conversation-intent-router';
// P0.16-L: Live/test parity pipeline imports
import { ConversationFrameResolver } from './conversation-frame-resolver';
import { WhatsAppFormattingFinalizer } from './whatsapp-formatting-finalizer';
import { TurkishFinalQualityNormalizer } from './turkish-final-quality-normalizer';
// P0.16-M: Final pipeline enforcer — mandatory chain for all response paths
import { FinalPipelineEnforcer } from './final-pipeline-enforcer';
// P0.19: Tenant-agnostic config resolver
import { TenantConfigResolver } from './tenant-config-resolver';
import { DateAnswerResolver } from './date-answer-resolver';
import { ConversationKnownFactsResolver } from './conversation-known-facts-resolver';


export interface OrchestratorParams {
  tenantId: string;
  phoneNumber: string;
  inboundText: string;
  mediaType?: string | null;
  mediaMetadata?: any;
  brain: TenantBrain;
  channel: 'whatsapp' | 'instagram' | 'messenger' | string;
  channelId?: string;
  conversationId?: string;
  customerId?: string;
  sandbox?: boolean;
  history?: ChatMessage[]; // Optional: passed in sandbox/test mode
  workerPath?: string; // Telemetry parameter (testBot | worker_immediate | worker_delayed)
  unifiedContext?: any;
}

export interface OrchestratorResult {
  text: string;
  modelUsed: string;
  promptVersion?: string | number;
  latencyMs: number;
  bypassed: boolean;
  isRetry: boolean;
  qualityGateFailed: boolean;
  qualityGateReason?: string;
  inputTokens?: number;
  outputTokens?: number;
  deduplicated?: boolean; // Concurrency flag
  responseDedupeKey?: string; // Telemetry
  burstAnchorId?: string; // Telemetry
  dryRun: boolean;
  replyLanguage?: string;
}

export function getOldDedupeKey(tenantId: string, channelId: string, conversationId: string, burstAnchorId: string): string {
  return `dedupe:response:${tenantId}:${channelId || 'unknown'}:${conversationId}:${burstAnchorId}`;
}

export function getNewDedupeKey(tenantId: string, channelId: string, conversationId: string, burstAnchorId: string): string {
  return `tenant:${tenantId}:dedupe:response:${channelId || 'unknown'}:${conversationId}:${burstAnchorId}`;
}

export class AIResponseOrchestrator {
  public static sandboxLockStore = new Map<string, { token: string; expiresAt: number }>();
  public static sandboxProcessedStore = new Set<string>();

  public static addSandboxProcessed(key: string) {
    AIResponseOrchestrator.sandboxProcessedStore.add(key);
  }

  public static clearSandboxStores() {
    AIResponseOrchestrator.sandboxLockStore.clear();
    AIResponseOrchestrator.sandboxProcessedStore.clear();
  }

  public static async run(params: OrchestratorParams): Promise<OrchestratorResult> {
    const {
      tenantId,
      phoneNumber,
      inboundText,
      mediaType = null,
      mediaMetadata = null,
      brain,
      channelId,
      conversationId,
      customerId,
      sandbox = false,
      history: passedHistory,
      workerPath = 'unknown',
      unifiedContext: passedUnifiedContext
    } = params;

    const startTime = Date.now();
    const settingsDb = withTenantDB(tenantId);

    const parseToUtcWithTz = (dStr: string, tStr: string, tz: string): string => {
      const [yyyy, mm, dd] = dStr.split('-').map(Number);
      const [hh, min] = tStr.split(':').map(Number);
      const localUtc = Date.UTC(yyyy, mm - 1, dd, hh, min);
      let offsetMin = 180; // default Turkey +3
      try {
        const tzFormatter = new Intl.DateTimeFormat('en-US', {
          timeZone: tz,
          year: 'numeric', month: 'numeric', day: 'numeric',
          hour: 'numeric', minute: 'numeric', second: 'numeric',
          hour12: false
        });
        const utcFormatter = new Intl.DateTimeFormat('en-US', {
          timeZone: 'UTC',
          year: 'numeric', month: 'numeric', day: 'numeric',
          hour: 'numeric', minute: 'numeric', second: 'numeric',
          hour12: false
        });
        const dummyDate = new Date(localUtc);
        const tzParts = tzFormatter.formatToParts(dummyDate);
        const utcParts = utcFormatter.formatToParts(dummyDate);
        const getVal = (parts: Intl.DateTimeFormatPart[], type: string) => parseInt(parts.find(p => p.type === type)?.value || '0', 10);
        const tzYear = getVal(tzParts, 'year');
        const tzMonth = getVal(tzParts, 'month') - 1;
        const tzDay = getVal(tzParts, 'day');
        const tzHour = getVal(tzParts, 'hour');
        const tzMinute = getVal(tzParts, 'minute');
        const utcYear = getVal(utcParts, 'year');
        const utcMonth = getVal(utcParts, 'month') - 1;
        const utcDay = getVal(utcParts, 'day');
        const utcHour = getVal(utcParts, 'hour');
        const utcMinute = getVal(utcParts, 'minute');
        const tzDate = Date.UTC(tzYear, tzMonth, tzDay, tzHour, tzMinute);
        const utcDate = Date.UTC(utcYear, utcMonth, utcDay, utcHour, utcMinute);
        offsetMin = (tzDate - utcDate) / 60000;
      } catch (err) {
        offsetMin = 180;
      }
      return new Date(localUtc - offsetMin * 60000).toISOString();
    };

    const countryTranslations: Record<string, Record<string, string>> = {
      tr: { Germany: 'Almanya', Deutschland: 'Almanya', Netherlands: 'Hollanda', Holland: 'Hollanda', 'United Kingdom': 'İngiltere', France: 'Fransa', Belgium: 'Belçika', Switzerland: 'İsviçre', Denmark: 'Danimarka', Sweden: 'İsveç' },
      en: { Almanya: 'Germany', Deutschland: 'Germany', Hollanda: 'Netherlands', Holland: 'Netherlands', 'United Kingdom': 'UK', Fransa: 'France', Belçika: 'Belgium', İsviçre: 'Switzerland', Danimarka: 'Denmark', İsveç: 'Sweden' },
      de: { Germany: 'Deutschland', Almanya: 'Deutschland', Hollanda: 'Niederlande', Netherlands: 'Niederlande', 'United Kingdom': 'UK', Fransa: 'Frankreich', Belçika: 'Belgien', İsviçre: 'Schweiz', Danimarka: 'Dänemark', İsveç: 'Schweden' },
      nl: { Germany: 'Duitsland', Almanya: 'Duitsland', Hollanda: 'Nederland', Netherlands: 'Nederland', 'United Kingdom': 'VK', Fransa: 'Frankrijk', Belçika: 'België', İsviçre: 'Zwitserland', Danimarka: 'Denemarken', İsveç: 'Zweden' },
      ar: { Germany: 'ألمانيا', Almanya: 'ألمانيا', Hollanda: 'هولندا', Netherlands: 'هولندا', 'United Kingdom': 'بريطانيا', Fransa: 'فرنسا', Belçika: 'بلجيكا', İsviçre: 'سويسرا', Danimarka: 'الدانمارك', İsveç: 'السويد' }
    };
    
    const getPatientTimeStr = (utcDate: Date, patientTz: string): string => {
      return utcDate.toLocaleTimeString('tr-TR', {
        timeZone: patientTz,
        hour: '2-digit', minute: '2-digit', hour12: false
      });
    };

    const formatLocalDate = (dateObj: Date, lang: string): string => {
      const locales: Record<string, string> = {
        tr: 'tr-TR',
        en: 'en-US',
        de: 'de-DE',
        nl: 'nl-NL',
        ar: 'ar-EG'
      };
      const locale = locales[lang] || 'en-US';
      try {
        return new Intl.DateTimeFormat(locale, {
          day: 'numeric',
          month: 'long',
          weekday: 'long'
        }).format(dateObj);
      } catch {
        const dd = dateObj.getUTCDate();
        const mm = dateObj.getUTCMonth();
        const dayIndex = dateObj.getUTCDay();
        const dayName = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'][dayIndex];
        const monthNames = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
        return `${dd} ${monthNames[mm]} ${dayName}`;
      }
    };

    const processCallbackSuggestion = async (input: {
      parsedSugg: any;
      convMeta: any;
      unifiedContext: any;
      country: string | null;
      replyLanguage: string;
      tenantDefaultLang: string;
      timezone: string;
      sandbox: boolean;
      tenantId: string;
      channelId: string;
      phoneNumber: string;
      history: any[];
      db: any;
      isTurkeyBasisInherited: boolean;
      isPatientBasisInherited?: boolean;
    }): Promise<{ responseText: string; isSuccess: boolean }> => {
      const {
        parsedSugg,
        convMeta,
        unifiedContext,
        country,
        replyLanguage,
        tenantDefaultLang,
        timezone,
        sandbox,
        tenantId,
        channelId,
        phoneNumber,
        history,
        db,
        isTurkeyBasisInherited,
        isPatientBasisInherited = false
      } = input;

      const { resolvePatientTimezone } = require('../../utils/timezone');
      const tzRes = resolvePatientTimezone(country);

      const supportedLangs = ['tr', 'en', 'de', 'ar', 'nl'];
      const lang = supportedLangs.includes(replyLanguage) ? replyLanguage : (supportedLangs.includes(tenantDefaultLang) ? tenantDefaultLang : 'en');

      if (parsedSugg && parsedSugg.suggested_time && !parsedSugg.suggested_date) {
        const lastOffer = convMeta?.last_callback_offer;
        if (lastOffer && lastOffer.proposed_due_at) {
          const dt = new Date(lastOffer.proposed_due_at);
          if (!isNaN(dt.getTime())) {
            const formatter = new Intl.DateTimeFormat('en-US', {
              timeZone: 'Europe/Istanbul',
              year: 'numeric', month: '2-digit', day: '2-digit',
              hour12: false
            });
            const parts = formatter.formatToParts(dt);
            const getVal = (type: string) => parts.find(p => p.type === type)?.value || '';
            parsedSugg.suggested_date = `${getVal('year')}-${getVal('month')}-${getVal('day')}`;
          }
        }
      }

      if (parsedSugg && parsedSugg.suggested_time && !parsedSugg.suggested_date) {
        let timezoneBasisToUse = parsedSugg.suggested_timezone_basis;
        if (isTurkeyBasisInherited) {
          timezoneBasisToUse = 'turkey_time';
        } else if (isPatientBasisInherited) {
          timezoneBasisToUse = 'patient_local_time';
        }
        const isTrTz = timezoneBasisToUse === 'turkey_time' || tzRes.timezone === 'Europe/Istanbul';

        const tzLabels: Record<string, Record<string, string>> = {
          tr: { tr: 'Türkiye saatiyle', local: 'yerel saatinizle' },
          en: { tr: 'Turkey time', local: 'your local time' },
          de: { tr: 'Türkei-Zeit', local: 'Ihre Ortszeit' },
          nl: { tr: 'Turkse tijd', local: 'uw lokale tijd' },
          ar: { tr: 'بتوقيت تركيا', local: 'بتوقيتك المحلي' }
        };
        const langLabels = tzLabels[lang] || tzLabels.en;
        const tzLabel = isTrTz ? langLabels.tr : langLabels.local;

        const rangeStr = parsedSugg.suggested_time_end
          ? `${parsedSugg.suggested_time}–${parsedSugg.suggested_time_end}`
          : parsedSugg.suggested_time;

        let responseText = '';
        if (lang === 'tr') {
          responseText = `${tzLabel} ${rangeStr} aralığını not alabilirim. Hangi gün için uygun olur?`;
        } else if (lang === 'de') {
          responseText = `Ich kann den Zeitraum ${rangeStr} (${tzLabel}) notieren. Welcher Tag wäre für Sie geeignet?`;
        } else if (lang === 'nl') {
          responseText = `Ik kan het tijdsbereik ${rangeStr} (${tzLabel}) notieren. Welke dag zou schikken?`;
        } else if (lang === 'ar') {
          responseText = `يمكنني تسجيل الفترة الزمنية ${rangeStr} (${tzLabel}). أي يوم سيكون مناسباً لك؟`;
        } else {
          responseText = `I can note the time range ${rangeStr} (${tzLabel}). Which day would be suitable?`;
        }
        return { responseText, isSuccess: false };
      }

      if (parsedSugg && parsedSugg.suggested_date && parsedSugg.suggested_time) {
        let timezoneBasisToUse = parsedSugg.suggested_timezone_basis;
        if (isTurkeyBasisInherited) {
          timezoneBasisToUse = 'turkey_time';
        } else if (isPatientBasisInherited) {
          timezoneBasisToUse = 'patient_local_time';
        }

        const isPatientTzDifferent = tzRes.timezone && tzRes.timezone !== 'Europe/Istanbul';

        if (timezoneBasisToUse === 'unknown' && isPatientTzDifferent) {
          const formattedDate = formatLocalDate(new Date(parsedSugg.suggested_date), lang);
          const isRange = !!parsedSugg.suggested_time_end;
          const rangeStr = isRange
            ? `${parsedSugg.suggested_time}–${parsedSugg.suggested_time_end}`
            : parsedSugg.suggested_time;

          const patientCountryName = country ? (countryTranslations[lang]?.[country] || (lang === 'tr' ? country : null) || countryTranslations.en[country] || country) : '';

          let responseText = '';
          if (lang === 'tr') {
            responseText = `${formattedDate} ${rangeStr} ${isRange ? 'aralığını' : 'saatini'} not alabilirim. Bu saat Türkiye saatiyle mi, ${patientCountryName} saatinizle mi? 🙏`;
          } else if (lang === 'de') {
            responseText = `Ich kann ${isRange ? 'den Zeitraum' : 'die Uhrzeit'} ${rangeStr} für ${formattedDate} notieren. Ist dies in Türkei-Zeit oder in Ihrer ${patientCountryName}-Zeit? 🙏`;
          } else if (lang === 'nl') {
            responseText = `Ik kan ${isRange ? 'het tijdsbereik' : 'de tijd'} ${rangeStr} voor ${formattedDate} noteren. Is dit in Turkse tijd of in uw ${patientCountryName}-tijd? 🙏`;
          } else if (lang === 'ar') {
            responseText = `يمكنني تسجيل ${isRange ? 'الفترة الزمنية' : 'الساعة'} ${rangeStr} في يوم ${formattedDate}. هل هذا بتوقيت تركيا أم بتوقيتك المحلي في ${patientCountryName}؟ 🙏`;
          } else {
            responseText = `I can note the ${isRange ? 'time range' : 'time'} ${rangeStr} for ${formattedDate}. Is this in Turkey time or your ${patientCountryName} time? 🙏`;
          }
          return { responseText, isSuccess: false };
        }

        const timeZone = (timezoneBasisToUse === 'turkey_time' || tzRes.timezone === 'Europe/Istanbul')
          ? 'Europe/Istanbul'
          : tzRes.timezone;

        const correctedUtc = parseToUtcWithTz(parsedSugg.suggested_date, parsedSugg.suggested_time, timeZone);
        parsedSugg.proposed_date = correctedUtc;

        let currentD = new Date(correctedUtc);
        let trTime = currentD.getTime() + 3 * 60 * 60 * 1000;
        let trDate = new Date(trTime);

        const wh = (brain.context.settings?.workingHours || brain.context.config?.workingHours || { enabled: true, start: "09:00", end: "21:00" }) as any;
        const isDayOpen = (dateObj: Date) => {
          const day = dateObj.getUTCDay();
          if (wh && Array.isArray(wh.days)) {
            return wh.days.includes(day);
          }
          return day !== 0;
        };

        let loopCount = 0;
        while (!isDayOpen(trDate) && loopCount < 7) {
          trDate.setUTCDate(trDate.getUTCDate() + 1);
          loopCount++;
        }

        let startMin = 9 * 60;
        let endMin = 21 * 60;
        if (wh?.start) {
          const [h, m] = wh.start.split(':').map(Number);
          startMin = h * 60 + (m || 0);
        }
        if (wh?.end) {
          const [h, m] = wh.end.split(':').map(Number);
          endMin = h * 60 + (m || 0);
        }

        const trHour = trDate.getUTCHours();
        const trMinute = trDate.getUTCMinutes();
        const trTotalMinutes = trHour * 60 + trMinute;

        if (trTotalMinutes < startMin) {
          trDate.setUTCHours(Math.floor(startMin / 60), startMin % 60, 0, 0);
        } else if (trTotalMinutes > endMin) {
          trDate.setUTCDate(trDate.getUTCDate() + 1);
          let loopCount2 = 0;
          while (!isDayOpen(trDate) && loopCount2 < 7) {
            trDate.setUTCDate(trDate.getUTCDate() + 1);
            loopCount2++;
          }
          trDate.setUTCHours(Math.floor(startMin / 60), startMin % 60, 0, 0);
        }

        const proposedUtc = new Date(trDate.getTime() - 3 * 60 * 60 * 1000).toISOString();
        parsedSugg.proposed_date = proposedUtc;

        const formattedDate = formatLocalDate(trDate, lang);

        const { resolvePatientTimeDisplay } = require('../../utils/timezone');
        const timeDisplay = resolvePatientTimeDisplay({
          country,
          timezone: convMeta?.patient_timezone || null,
          referenceDate: proposedUtc
        });

        const isDifferentTimezone = timeDisplay.patientTimezone && timeDisplay.patientTimezone !== 'Europe/Istanbul';
        const patientCountryName = country ? (countryTranslations[lang]?.[country] || (lang === 'tr' ? country : null) || countryTranslations.en[country] || country) : '';

        let responseText = '';
        const startT = parsedSugg.suggested_time;
        const endT = parsedSugg.suggested_time_end;

        if (endT) {
          if (isDifferentTimezone) {
            const patientTz = timeDisplay.patientTimezone;
            const patientDStart = new Date(proposedUtc);
            const patientDEnd = new Date(parseToUtcWithTz(parsedSugg.suggested_date, endT, timeZone));

            const shiftMs = new Date(proposedUtc).getTime() - new Date(correctedUtc).getTime();
            const shiftedPatientDStart = new Date(patientDStart.getTime() + shiftMs);
            const shiftedPatientDEnd = new Date(patientDEnd.getTime() + shiftMs);

            const patientStartStr = getPatientTimeStr(shiftedPatientDStart, patientTz);
            const patientEndStr = getPatientTimeStr(shiftedPatientDEnd, patientTz);

            if (lang === 'tr') {
              responseText = `Teyidinizi aldım. Görüşme talebinizi ${formattedDate} Türkiye saatiyle ${startT}–${endT} aralığı için not alıyorum. Bu saat ${patientCountryName}'da ${patientStartStr}–${patientEndStr} aralığına denk gelir. Hasta danışmanımıza iletilmesi için not alıyorum 🙏`;
            } else if (lang === 'de') {
              responseText = `Ich habe Ihre Gesprächsanfrage für ${formattedDate} zwischen ${startT}–${endT} (Türkei-Zeit) notiert. Dies entspricht ${patientStartStr}–${patientEndStr} in ${patientCountryName}. Ich werde dies an unseren Patientenberater weiterleiten 🙏`;
            } else if (lang === 'nl') {
              responseText = `Ik heb uw oproepverzoek voor ${formattedDate} tussen ${startT}–${endT} (Turkse tijd) genoteerd. Dit komt overeen met ${patientStartStr}–${patientEndStr} in ${patientCountryName}. Ik geef dit door aan onze patiëntadviseur 🙏`;
            } else if (lang === 'ar') {
              responseText = `لقد سجلت طلب الاتصال بك يوم ${formattedDate} بين الساعة ${startT}–${endT} بتوقيت تركيا. هذا التوقيت يعادل ${patientStartStr}–${patientEndStr} في ${patientCountryName}. سأقوم بنقل الطلب لمستشار المرضى لدينا 🙏`;
            } else {
              responseText = `I have noted your call request for ${formattedDate} between ${startT}–${endT} Turkey time. This corresponds to ${patientStartStr}–${patientEndStr} in ${patientCountryName}. I will share this with our patient advisor 🙏`;
            }
          } else {
            if (lang === 'tr') {
              responseText = `Teyidinizi aldım. Görüşme talebinizi ${formattedDate} Türkiye saatiyle ${startT}–${endT} aralığı için hasta danışmanımıza iletilmesi için not alıyorum 🙏`;
            } else if (lang === 'de') {
              responseText = `Ich habe Ihre Gesprächsanfrage für ${formattedDate} zwischen ${startT}–${endT} (Türkei-Zeit) für unseren Patientenberater notiert 🙏`;
            } else if (lang === 'nl') {
              responseText = `Ik heb uw oproepverzoek voor ${formattedDate} tussen ${startT}–${endT} (Turkse tijd) genoteerd voor onze patiëntadviseur 🙏`;
            } else if (lang === 'ar') {
              responseText = `لقد سجلت طلب الاتصال بك يوم ${formattedDate} بين الساعة ${startT}–${endT} بتوقيت تركيا لمستشار المرضى لدينا 🙏`;
            } else {
              responseText = `I have noted your call request for ${formattedDate} between ${startT}–${endT} (Turkey time) for our patient advisor 🙏`;
            }
          }
        } else {
          const trHour2 = trDate.getUTCHours();
          const trMin2 = trDate.getUTCMinutes();
          const formattedHHMM = `${String(trHour2).padStart(2, '0')}:${String(trMin2).padStart(2, '0')}`;
          
          const hourInt = trHour2;
          const suffixes: Record<number, string> = {
            0: 'de', 1: 'de', 2: 'de', 3: 'te', 4: 'te', 5: 'te', 6: 'da', 7: 'de', 8: 'de', 9: 'da',
            10: 'da', 11: 'de', 12: 'de', 13: 'te', 14: 'te', 15: 'te', 16: 'da', 17: 'de', 18: 'de',
            19: 'da', 20: 'de', 21: 'de', 22: 'de', 23: 'te'
          };
          const suffix = suffixes[hourInt] || 'da';
          const formattedTime = `${formattedHHMM}’${suffix}`;

          if (isDifferentTimezone) {
            const patientTz = timeDisplay.patientTimezone;
            const patientD = new Date(proposedUtc);
            
            const patientTimeStr = patientD.toLocaleTimeString('tr-TR', {
              timeZone: patientTz,
              hour: '2-digit', minute: '2-digit', hour12: false
            });
            const patientHourInt = parseInt(patientTimeStr.split(':')[0], 10);
            const patientSuffix = suffixes[patientHourInt] || 'da';
            const formattedPatientTime = `${patientTimeStr}’${patientSuffix}`;

            const patientDatePartsFormatter = new Intl.DateTimeFormat(lang === 'tr' ? 'tr-TR' : 'en-US', {
              timeZone: patientTz,
              day: 'numeric', month: 'long', weekday: 'long'
            });
            const patientDateStr = patientDatePartsFormatter.format(patientD);
            
            if (lang === 'tr') {
              responseText = `Teyidinizi aldım. Görüşme talebinizi yerel saatinizle ${patientDateStr} ${formattedPatientTime} (Türkiye saatiyle ${formattedDate} ${formattedTime}) olarak hasta danışmanımıza iletilmesi için not alıyorum 🙏`;
            } else if (lang === 'de') {
              responseText = `Ich habe Ihre Gesprächsanfrage für ${formattedDate} um ${formattedHHMM} (Türkei-Zeit) notiert. Dies entspricht ${patientTimeStr} in Ihrer Ortszeit. Ich werde dies an unseren Patientenberater weiterleiten 🙏`;
            } else if (lang === 'nl') {
              responseText = `Ik heb uw oproepverzoek voor ${formattedDate} om ${formattedHHMM} (Turkse tijd) genoteerd. Dit komt overeen met ${patientTimeStr} in uw lokale tijd. Ik geef dit door aan onze patiëntadviseur 🙏`;
            } else if (lang === 'ar') {
              responseText = `لقد سجلت طلب الاتصال بك يوم ${formattedDate} في تمام الساعة ${formattedHHMM} بتوقيت تركيا. هذا التوقيت يعادل ${patientTimeStr} بتوقيتك المحلي. سأقوم بنقل الطلب لمستشار المرضى لدينا 🙏`;
            } else {
              responseText = `I have noted your call request for ${formattedDate} at ${formattedHHMM} Turkey time. This corresponds to ${patientTimeStr} in your local time. I will share this with our patient advisor 🙏`;
            }
          } else {
            if (lang === 'tr') {
              responseText = `Teyidinizi aldım. Görüşme talebinizi ${formattedDate} Türkiye saatiyle ${formattedTime} olarak hasta danışmanımıza iletilmesi için not alıyorum 🙏`;
            } else if (lang === 'de') {
              responseText = `Ich habe Ihre Gesprächsanfrage für ${formattedDate} um ${formattedHHMM} (Türkei-Zeit) für unseren Patientenberater notiert 🙏`;
            } else if (lang === 'nl') {
              responseText = `Ik heb uw oproepverzoek voor ${formattedDate} om ${formattedHHMM} (Turkse tijd) genoteerd voor onze patiëntadviseur 🙏`;
            } else if (lang === 'ar') {
              responseText = `لقد سجلت طلب الاتصال بك يوم ${formattedDate} في تمام الساعة ${formattedHHMM} بتوقيت تركيا لمستشار المرضى لدينا 🙏`;
            } else {
              responseText = `I have noted your call request for ${formattedDate} at ${formattedHHMM} (Turkey time) for our patient advisor 🙏`;
            }
          }
        }

        if (!sandbox) {
          try {
            const existing = await db.executeSafe({
              text: `SELECT id FROM follow_up_tasks 
                     WHERE tenant_id = $1 
                       AND conversation_id = $2 
                       AND task_type = $3 
                       AND due_at = $4 
                       AND status IN ('pending', 'in_progress')`,
              values: [tenantId, conversationId, 'callback_scheduled', proposedUtc]
            }) as any[];
            
            if (existing.length === 0) {
              const { TaskService } = require('../task.service');
              const taskService = new TaskService(db);
              const opportunityId = unifiedContext?.opportunity?.id || null;
              
              const crypto = require('crypto');
              const idempotencyKey = crypto.createHash('sha256')
                .update(`${tenantId}:${channelId || 'whatsapp'}:${conversationId}:callback_scheduled:${proposedUtc}`)
                .digest('hex');
              
              await taskService.create({
                tenantId,
                opportunityId: opportunityId || undefined,
                conversationId: conversationId || undefined,
                phoneNumber,
                taskType: 'callback_scheduled',
                title: '📞 Geri Arama',
                description: 'Telefon görüşmesi planlandı.',
                dueAt: proposedUtc,
                isAutomated: true,
                createdBy: 'system',
                metadata: {
                  idempotency_key: idempotencyKey,
                  callback_time_tr: parsedSugg.suggested_time,
                  callback_time_tr_end: parsedSugg.suggested_time_end || undefined,
                  source: 'callback_confirmation_bypass'
                }
              });
            }
          } catch (taskErr) {
            console.error('[AIResponseOrchestrator] Failed to create callback follow-up task:', taskErr);
          }
        }

        return { responseText, isSuccess: true };
      }

      return { responseText: '', isSuccess: false };
    };

    let dryRun = true;
    let cachedInboundSettings: any = null;

    if (!sandbox) {
      try {
        const { getInboundAutopilotSettings } = await import("../forms/form-autopilot-eligibility-resolver");
        cachedInboundSettings = await getInboundAutopilotSettings(tenantId, settingsDb);
        if (cachedInboundSettings && typeof cachedInboundSettings.dryRun === 'boolean') {
          dryRun = cachedInboundSettings.dryRun;
        }
      } catch (err) {
        console.error("AIResponseOrchestrator: Failed to fetch inbound settings, defaulting dryRun to true:", err);
        dryRun = true;
      }
    }

    let replyLanguage: string | undefined = undefined;
    let tenantDefaultLang: string | undefined = undefined;

    const buildResult = (data: Omit<OrchestratorResult, 'dryRun'>): OrchestratorResult => {
      return {
        replyLanguage,
        ...data,
        dryRun
      };
    };

    // P0.20-K: Anomalous Text Check (Skip punctuation-only or empty texts completely)
    const cleanInboundText = (inboundText || '').trim();
    const isAnomalousText = cleanInboundText === '' || /^[.!?,\-\s]+$/.test(cleanInboundText);
    if (isAnomalousText) {
      console.log(JSON.stringify({
        tag: "AI_RESPONSE_ORCHESTRATOR_ANOMALOUS_TEXT_BYPASS",
        tenantId,
        conversationId,
        inboundText,
        reason: "only_punctuation_or_empty"
      }));
      return buildResult({
        text: '',
        modelUsed: 'bypass_anomalous',
        latencyMs: Date.now() - startTime,
        bypassed: true,
        isRetry: false,
        qualityGateFailed: false
      });
    }

    // P3.01: Customer-level permanent override check (channel-scoped) in orchestrator
    const db = withTenantDB(tenantId);
    let customerProfileMetadata: any = {};
    if (customerId) {
      try {
        const cprof = await db.executeSafe({
          text: `SELECT metadata FROM customer_profiles WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
          values: [customerId, tenantId]
        }) as any[];
        customerProfileMetadata = cprof[0]?.metadata || {};
      } catch (err) {
        console.error("AIResponseOrchestrator: Failed to fetch customer profile metadata by customerId:", err);
      }
    } else if (phoneNumber) {
      try {
        const cprof = await db.executeSafe({
          text: `SELECT metadata FROM customer_profiles WHERE primary_phone = $1 AND tenant_id = $2 LIMIT 1`,
          values: [phoneNumber, tenantId]
        }) as any[];
        customerProfileMetadata = cprof[0]?.metadata || {};
      } catch (err) {
        console.error("AIResponseOrchestrator: Failed to fetch customer profile metadata by phone:", err);
      }
    }

    const overrides = customerProfileMetadata.inbound_autopilot_overrides || {};
    const channelOverride = overrides[channelId || ''];
    if (channelOverride?.disabled === true || channelOverride?.disabled === 'true') {
      console.log(JSON.stringify({
        tag: "AI_RESPONSE_ORCHESTRATOR_MANUALLY_DISABLED_BYPASS",
        tenantId,
        conversationId,
        customerId,
        channelId,
        reason: "contact_inbound_autopilot_manually_disabled"
      }));
      return buildResult({
        text: '',
        modelUsed: 'contact_inbound_autopilot_manually_disabled',
        latencyMs: Date.now() - startTime,
        bypassed: true,
        isRetry: false,
        qualityGateFailed: false
      });
    }

    let burstAnchorId = '';
    let responseDedupeKey = '';
    let convMeta: any = {};
    let resolvedChannelId = channelId || '';
    let isDbLockAcquired = false;
    let isRedisLockAcquired = false;
    let timezone: string | null = null;
    const lockToken = crypto.randomUUID();

    // ────────────────────────────────────────────────────────
    // 1. CONCURRENCY LOCKING & IDEMPOTENCY BOUNDARY
    // ────────────────────────────────────────────────────────
    if (conversationId) {
      console.log(JSON.stringify({
        tag: "AI_RESPONSE_ORCHESTRATOR_STARTED",
        tenantId,
        conversationId,
        workerPath
      }));

      const db = withTenantDB(tenantId);
      let lastOutboundTime = new Date(0).toISOString();
      resolvedChannelId = channelId || '';
      convMeta = {};

      if (!sandbox) {
        // A. Query the last outbound message created_at
        const lastOutboundQuery = await db.executeSafe({
          text: `SELECT created_at FROM messages 
                 WHERE tenant_id = $1 AND conversation_id = $2 AND direction = 'out' 
                 ORDER BY created_at DESC LIMIT 1`,
          values: [tenantId, conversationId]
        }) as any[];
        lastOutboundTime = lastOutboundQuery.length > 0 
          ? new Date(lastOutboundQuery[0].created_at).toISOString() 
          : new Date(0).toISOString();

        // B. Query the first inbound message after that time (burst anchor)
        const firstInboundQuery = await db.executeSafe({
          text: `SELECT provider_message_id, id, created_at FROM messages 
                 WHERE tenant_id = $1 AND conversation_id = $2 AND direction = 'in' AND created_at > $3
                 ORDER BY created_at ASC LIMIT 1`,
          values: [tenantId, conversationId, lastOutboundTime]
        }) as any[];

        if (firstInboundQuery.length > 0) {
          burstAnchorId = firstInboundQuery[0].provider_message_id || firstInboundQuery[0].id;
          const firstInboundTime = new Date(firstInboundQuery[0].created_at).getTime();

          // Extra check: if an outbound has been sent after the current burst started, skip!
          if (lastOutboundQuery.length > 0) {
            const lastOutboundTimeMs = new Date(lastOutboundQuery[0].created_at).getTime();
            if (lastOutboundTimeMs > firstInboundTime) {
              console.log(JSON.stringify({
                tag: "AI_RESPONSE_ORCHESTRATOR_DEDUPED",
                tenantId,
                conversationId,
                reason: "already_replied_newer_outbound",
                workerPath,
                burstAnchorId
              }));
              return buildResult({
                text: '',
                modelUsed: 'deduplicated',
                latencyMs: 0,
                bypassed: true,
                isRetry: false,
                qualityGateFailed: false,
                deduplicated: true
              });
            }
          }
        } else {
          burstAnchorId = inboundText || 'no-inbound-anchor';
        }
      } else {
        // Sandbox mode - try mock DB but fall back gracefully
        try {
          const lastOutboundQuery = await db.executeSafe({
            text: `SELECT created_at FROM messages 
                   WHERE tenant_id = $1 AND conversation_id = $2 AND direction = 'out' 
                   ORDER BY created_at DESC LIMIT 1`,
            values: [tenantId, conversationId]
          }) as any[];
          lastOutboundTime = lastOutboundQuery.length > 0 
            ? new Date(lastOutboundQuery[0].created_at).toISOString() 
            : new Date(0).toISOString();

          const firstInboundQuery = await db.executeSafe({
            text: `SELECT provider_message_id, id, created_at FROM messages 
                   WHERE tenant_id = $1 AND conversation_id = $2 AND direction = 'in' AND created_at > $3
                   ORDER BY created_at ASC LIMIT 1`,
            values: [tenantId, conversationId, lastOutboundTime]
          }) as any[];

          if (firstInboundQuery.length > 0) {
            burstAnchorId = firstInboundQuery[0].provider_message_id || firstInboundQuery[0].id;
          } else {
            burstAnchorId = inboundText || 'no-inbound-anchor';
          }
        } catch (_) {
          burstAnchorId = inboundText || 'no-inbound-anchor';
        }
      }

      // Query DB for channelId and metadata
      if (!sandbox) {
        const convCheck = await db.executeSafe({
          text: `SELECT metadata, channel_id FROM conversations WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
          values: [conversationId, tenantId]
        }) as any[];
        const convRecord = convCheck[0];
        convMeta = convRecord?.metadata || {};
        resolvedChannelId = convRecord?.channel_id || channelId || '';
      } else {
        try {
          const convCheck = await db.executeSafe({
            text: `SELECT metadata, channel_id FROM conversations WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
            values: [conversationId, tenantId]
          }) as any[];
          const convRecord = convCheck[0];
          convMeta = convRecord?.metadata || {};
          resolvedChannelId = convRecord?.channel_id || channelId || '';
        } catch (_) {
          resolvedChannelId = channelId || '';
        }

        try {
          const tenantTzRow = await db.executeSafe({
            text: `SELECT timezone FROM tenants WHERE id = $1 LIMIT 1`,
            values: [tenantId]
          }) as any[];
          timezone = tenantTzRow[0]?.timezone || null;
        } catch (_) {
          timezone = null;
        }
      }

      // Inbound Autopilot Settings & Eligibility checks (only when sandbox is false)
      if (!sandbox) {
        const inboundSettings = cachedInboundSettings || { enabled: false, dryRun: true, rolloutPercentage: 0, departmentMode: 'selected', allowedDepartments: [] };

        if (!inboundSettings.enabled) {
          console.log(JSON.stringify({
            tag: "AI_RESPONSE_ORCHESTRATOR_BYPASSED",
            tenantId,
            conversationId,
            reason: "inbound_autopilot_disabled"
          }));
          return buildResult({
            text: '',
            modelUsed: 'inbound_autopilot_disabled',
            latencyMs: Date.now() - startTime,
            bypassed: true,
            isRetry: false,
            qualityGateFailed: false
          });
        }

        // Timezone Check (if timezone settings/details fail or are missing, we fall back to not_eligible / dry-run)
        try {
          const tenantTzRow = await db.executeSafe({
            text: `SELECT timezone FROM tenants WHERE id = $1 LIMIT 1`,
            values: [tenantId]
          }) as any[];
          timezone = tenantTzRow[0]?.timezone || null;
        } catch (e) {
          timezone = null;
        }

        if (!timezone) {
          console.log(JSON.stringify({
            tag: "AI_RESPONSE_ORCHESTRATOR_BYPASSED",
            tenantId,
            conversationId,
            reason: "timezone_missing_not_eligible"
          }));
          return buildResult({
            text: '',
            modelUsed: 'timezone_missing_not_eligible',
            latencyMs: Date.now() - startTime,
            bypassed: true,
            isRetry: false,
            qualityGateFailed: false
          });
        }

        // Human Takeover Check
        const { HumanTakeoverGuard } = await import("../automation/human-takeover-guard");
        const takeoverCheck = await HumanTakeoverGuard.isHumanTakeoverActive(tenantId, conversationId, db);
        if (takeoverCheck.active) {
          console.log(JSON.stringify({
            tag: "AI_RESPONSE_ORCHESTRATOR_BYPASSED",
            tenantId,
            conversationId,
            reason: `human_takeover_active_${takeoverCheck.reason}`
          }));
          return buildResult({
            text: '',
            modelUsed: `human_takeover_active_${takeoverCheck.reason}`,
            latencyMs: Date.now() - startTime,
            bypassed: true,
            isRetry: false,
            qualityGateFailed: false
          });
        }

        // SHA-256 Rollout Percentage Check
        if (inboundSettings.rolloutPercentage < 100) {
          const { getRolloutBucket } = await import("@/lib/utils/hash");
          const bucketKey = `${tenantId}:${resolvedChannelId || 'whatsapp'}:inbound_autopilot_settings:${conversationId}`;
          const bucket = getRolloutBucket(bucketKey);
          if (bucket >= inboundSettings.rolloutPercentage) {
            console.log(JSON.stringify({
              tag: "AI_RESPONSE_ORCHESTRATOR_BYPASSED",
              tenantId,
              conversationId,
              reason: "rollout_percentage_excluded",
              bucket,
              rolloutPercentage: inboundSettings.rolloutPercentage
            }));
            return buildResult({
              text: '',
              modelUsed: 'rollout_percentage_excluded',
              latencyMs: Date.now() - startTime,
              bypassed: true,
              isRetry: false,
              qualityGateFailed: false
            });
          }
        }
      }

      responseDedupeKey = getNewDedupeKey(tenantId, resolvedChannelId || params.channel || 'unknown', conversationId, burstAnchorId);

      // C. Idempotency Check: Check if response has already been processed for this burst
      if (sandbox) {
        if (AIResponseOrchestrator.sandboxProcessedStore.has(responseDedupeKey)) {
          console.log(JSON.stringify({
            tag: "AI_RESPONSE_ORCHESTRATOR_DEDUPED",
            tenantId,
            conversationId,
            reason: "sandbox_inmemory_idempotency_marker",
            workerPath,
            responseDedupeKey
          }));
          return buildResult({
            text: '',
            modelUsed: 'deduplicated',
            latencyMs: 0,
            bypassed: true,
            isRetry: false,
            qualityGateFailed: false,
            deduplicated: true,
            responseDedupeKey,
            burstAnchorId
          });
        }
      } else {
        // C1. Check Redis processed marker
        try {
          const { redis } = await import('@/lib/redis');
          if (redis) {
            const oldDedupeKey = getOldDedupeKey(tenantId, resolvedChannelId || params.channel || 'unknown', conversationId, burstAnchorId);
            let isProcessed = await redis.get(`${responseDedupeKey}:processed`);
            if (!isProcessed) {
              isProcessed = await redis.get(`${oldDedupeKey}:processed`);
            }
            if (isProcessed) {
              console.log(JSON.stringify({
                tag: "AI_RESPONSE_ORCHESTRATOR_DEDUPED",
                tenantId,
                conversationId,
                reason: "redis_idempotency_marker",
                workerPath,
                responseDedupeKey
              }));
              return buildResult({
                text: '',
                modelUsed: 'deduplicated',
                latencyMs: 0,
                bypassed: true,
                isRetry: false,
                qualityGateFailed: false,
                deduplicated: true,
                responseDedupeKey,
                burstAnchorId
              });
            }
          }
        } catch (redisErr) {
          console.warn('[AIResponseOrchestrator] Redis idempotency check failed:', redisErr);
        }

        // C2. Check DB metadata processed marker
        if (convMeta.last_processed_dedupe_key === responseDedupeKey) {
          console.log(JSON.stringify({
            tag: "AI_RESPONSE_ORCHESTRATOR_DEDUPED",
            tenantId,
            conversationId,
            reason: "db_idempotency_marker",
            workerPath,
            responseDedupeKey
          }));
          return buildResult({
            text: '',
            modelUsed: 'deduplicated',
            latencyMs: 0,
            bypassed: true,
            isRetry: false,
            qualityGateFailed: false,
            deduplicated: true,
            responseDedupeKey,
            burstAnchorId
          });
        }
      }

      // D. Acquire Processing Lock
      let lockAcquired = false;

      if (sandbox) {
        const activeLock = AIResponseOrchestrator.sandboxLockStore.get(responseDedupeKey);
        if (activeLock && activeLock.expiresAt > Date.now()) {
          console.log(JSON.stringify({
            tag: "AI_RESPONSE_ORCHESTRATOR_DEDUPED",
            tenantId,
            conversationId,
            reason: "sandbox_inmemory_processing_lock_active",
            workerPath,
            responseDedupeKey
          }));
          return buildResult({
            text: '',
            modelUsed: 'deduplicated',
            latencyMs: 0,
            bypassed: true,
            isRetry: false,
            qualityGateFailed: false,
            deduplicated: true,
            responseDedupeKey,
            burstAnchorId
          });
        } else {
          AIResponseOrchestrator.sandboxLockStore.set(responseDedupeKey, {
            token: lockToken,
            expiresAt: Date.now() + 120 * 1000
          });
          lockAcquired = true;
        }
      } else {
        // D1. Try Redis Lock
        try {
          const { redis } = await import('@/lib/redis');
          if (redis) {
            const oldChannelId = resolvedChannelId || params.channel || 'unknown';
            const oldLockKey = `dedupe:response:${tenantId}:${oldChannelId}:${conversationId}:${burstAnchorId}:processing`;
            const newLockKey = `${responseDedupeKey}:processing`;

            // 1. Dual-Read: Check if either lock is already active
            const [oldLockExists, newLockExists] = await Promise.all([
              redis.get(oldLockKey),
              redis.get(newLockKey)
            ]);

            if (oldLockExists || newLockExists) {
              console.log(JSON.stringify({
                tag: "AI_RESPONSE_ORCHESTRATOR_DEDUPED",
                tenantId,
                conversationId,
                reason: "redis_processing_lock_active",
                workerPath,
                responseDedupeKey
              }));
              return buildResult({
                text: '',
                modelUsed: 'deduplicated',
                latencyMs: 0,
                bypassed: true,
                isRetry: false,
                qualityGateFailed: false,
                deduplicated: true,
                responseDedupeKey,
                burstAnchorId
              });
            }

            // 2. Dual-Write: Acquire both locks with NX
            const [setOldSuccess, setNewSuccess] = await Promise.all([
              redis.set(oldLockKey, lockToken, { nx: true, ex: 120 }),
              redis.set(newLockKey, lockToken, { nx: true, ex: 120 })
            ]);

            if (setOldSuccess && setNewSuccess) {
              lockAcquired = true;
              isRedisLockAcquired = true;
            } else {
              // 3. Rollback (Token-Controlled): Safe release without overwriting other workers
              const releaseScript = `
                if redis.call("get", KEYS[1]) == ARGV[1] then
                  return redis.call("del", KEYS[1])
                else
                  return 0
                end
              `;
              const rollbackPromises: Promise<any>[] = [];
              if (setOldSuccess) {
                rollbackPromises.push(redis.eval(releaseScript, [oldLockKey], [lockToken]));
              }
              if (setNewSuccess) {
                rollbackPromises.push(redis.eval(releaseScript, [newLockKey], [lockToken]));
              }
              await Promise.all(rollbackPromises);

              console.log(JSON.stringify({
                tag: "AI_RESPONSE_ORCHESTRATOR_DEDUPED",
                tenantId,
                conversationId,
                reason: "redis_processing_lock_conflict",
                workerPath,
                responseDedupeKey
              }));
              return buildResult({
                text: '',
                modelUsed: 'deduplicated',
                latencyMs: 0,
                bypassed: true,
                isRetry: false,
                qualityGateFailed: false,
                deduplicated: true,
                responseDedupeKey,
                burstAnchorId
              });
            }
          }
        } catch (redisErr) {
          console.warn('[AIResponseOrchestrator] Redis lock acquire failed, falling back to DB:', redisErr);
        }

        // D2. DB Fallback Lock (Atomic Postgres Update tenant/channel/conversation bound)
        if (!lockAcquired) {
          const nowIso = new Date().toISOString();
          const updateResult = await db.executeSafe({
            text: `
              UPDATE conversations 
              SET metadata = jsonb_set(
                jsonb_set(COALESCE(metadata, '{}'::jsonb), '{response_dedupe_key}', to_jsonb($1::text)),
                '{processing_locked_at}', to_jsonb($2::text)
              )
              WHERE id = $3 
                AND tenant_id = $4
                AND channel_id = $5
                AND (
                  metadata->>'processing_locked_at' IS NULL
                  OR (metadata->>'processing_locked_at')::timestamptz < NOW() - INTERVAL '120 seconds'
                )
                AND (
                  metadata->>'last_processed_dedupe_key' IS NULL
                  OR metadata->>'last_processed_dedupe_key' <> $1
                )
              RETURNING id
            `,
            values: [responseDedupeKey, nowIso, conversationId, tenantId, resolvedChannelId]
          }) as any[];

          if (updateResult.length > 0) {
            lockAcquired = true;
            isDbLockAcquired = true;
          } else {
            console.log(JSON.stringify({
              tag: "AI_RESPONSE_ORCHESTRATOR_DEDUPED",
              tenantId,
              conversationId,
              reason: "db_processing_lock_active",
              workerPath,
              responseDedupeKey
            }));
            return buildResult({
              text: '',
              modelUsed: 'deduplicated',
              latencyMs: 0,
              bypassed: true,
              isRetry: false,
              qualityGateFailed: false,
              deduplicated: true,
              responseDedupeKey,
              burstAnchorId
            });
          }
        }
      }
    }

    // ────────────────────────────────────────────────────────
    // 2. RESPONSE GENERATION PIPELINE
    // ────────────────────────────────────────────────────────
    try {
      // 1. Fetch CRM / Identity Context
      let unifiedContext: any = passedUnifiedContext || null;
      if (!unifiedContext && conversationId && customerId && !sandbox) {
        try {
          unifiedContext = await IdentityEngine.getContext(tenantId, customerId, conversationId);
        } catch (e) {
          console.error('[AIResponseOrchestrator] Error fetching identity context:', e);
        }
      }

      if (!unifiedContext) {
        unifiedContext = {};
      }

      // 3. Debounce & Turn Aggregation
      const history = await ConversationTurnAggregator.aggregate(
        tenantId,
        phoneNumber,
        passedHistory,
        10
      );
      unifiedContext.history = history;
      unifiedContext.currentMessageText = inboundText;
      unifiedContext.currentMessageMediaType = mediaType;

      // 3b. Resolve Language Response Policy with full history and tenant settings
      try {
        const { LanguageResponsePolicy } = await import('./language-response-policy');
        tenantDefaultLang = brain.context.config?.defaultLanguage || undefined;
        const channelFixedLang = brain.context.config?.fixedLanguage || undefined;
        const languagePolicy = LanguageResponsePolicy.resolve(
          inboundText,
          history.map(m => ({ role: m.role, content: m.content || '' })),
          tenantDefaultLang,
          channelFixedLang
        );
        replyLanguage = languagePolicy.replyLanguage;
        unifiedContext.languageContext = {
          detected_patient_language: languagePolicy.replyLanguageName,
          reply_language: languagePolicy.replyLanguageName,
          language_confidence: languagePolicy.languageConfidence,
          language_detection_source: 'latest_patient_message'
        };
      } catch (langErr) {
        console.warn('[AIResponseOrchestrator] Language policy resolution failed:', langErr);
      }
      unifiedContext.currentMessageText = inboundText;
      unifiedContext.currentMessageMediaType = mediaType;

      // P0.29: Turkey Visit Intent detection & persistence
      const { TurkeyVisitIntentResolver } = require('./turkey-visit-intent-resolver');
      const resolvedIntentFromMsg = TurkeyVisitIntentResolver.detect(inboundText);
      const hasExplicitCall = TurkeyVisitIntentResolver.hasExplicitCallRequest(inboundText);

      let currentVisitIntent = convMeta.turkey_visit_intent || 'turkey_visit_intent_unknown';
      if (resolvedIntentFromMsg) {
        currentVisitIntent = resolvedIntentFromMsg;
      }
      if (hasExplicitCall) {
        currentVisitIntent = 'turkey_visit_intent_positive';
      }

      if (currentVisitIntent !== convMeta.turkey_visit_intent) {
        convMeta.turkey_visit_intent = currentVisitIntent;
        if (!sandbox && conversationId) {
          try {
            const conv = await db.executeSafe({
              text: `SELECT metadata FROM conversations WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
              values: [conversationId, tenantId]
            }) as any[];
            const currentMeta = conv[0]?.metadata || {};
            currentMeta.turkey_visit_intent = currentVisitIntent;
            
            await db.executeSafe({
              text: `UPDATE conversations SET metadata = $1, updated_at = NOW() WHERE id = $2 AND tenant_id = $3`,
              values: [JSON.stringify(currentMeta), conversationId, tenantId]
            });
          } catch (dbErr) {
            console.error('[AIResponseOrchestrator] Failed to save turkey_visit_intent to DB:', dbErr);
          }
        }
      }
      unifiedContext.turkeyVisitIntent = currentVisitIntent;

      // 4. P0.16-G: Active Department Arbitration (extended priority chain)
      // Priority order:
      //   1. Current message alias      (DepartmentAliasResolver)
      //   2. Recent conversation        (RecentDepartmentContextResolver) ← P0.16-G
      //   3. Topic switch resolver      (ConversationTopicSwitchResolver)
      //   4. Stale CRM/opportunity      (staleDept)
      const tenantAliasConfig = brain.context.config?.departmentAliases || null;
      const staleDept = unifiedContext.opportunity?.department || unifiedContext.conversation?.department || null;

      // Step 4a: Current message alias resolution
      const aliasArbitration = DepartmentAliasResolver.resolveWithStalenessCheck(
        inboundText,
        staleDept,
        tenantAliasConfig
      );
      const currentMsgDept = aliasArbitration.isOverride ? aliasArbitration.activeDepartment : null;

      // Step 4b: P0.16-G — Recent conversation context (runs when current message has no dept keyword)
      let recentContextDept: string | null = null;
      let recentContextSource = 'none';
      let recentContextConfidence = 'none';
      if (!currentMsgDept && history.length > 0) {
        const safeHistory = history
          .filter(m => m.content != null)
          .map(m => ({ role: m.role, content: m.content as string }));
        const recentResult = RecentDepartmentContextResolver.resolve(
          safeHistory,
          10,
          tenantAliasConfig
        );
        if (recentResult) {
          recentContextDept = recentResult.department;
          recentContextSource = recentResult.matchedBy;
          recentContextConfidence = recentResult.confidence;
          console.log(JSON.stringify({
            tag: 'RECENT_DEPARTMENT_CONTEXT_RESOLVED',
            tenantId,
            conversationId: conversationId || 'unknown',
            resolvedDepartment: recentResult.department,
            confidence: recentResult.confidence,
            matchedBy: recentResult.matchedBy,
            staleDepartment: staleDept,
            workerPath
          }));
        }
      }

      // Step 4c: Topic switch resolver — receives best-known dept so far
      const step4cInput = currentMsgDept || recentContextDept || staleDept;
      const topicSwitch = ConversationTopicSwitchResolver.resolve(
        inboundText,
        step4cInput,
        unifiedContext.conversation?.metadata,
        tenantAliasConfig
      );

      // Step 4d: Final resolved department — first non-null wins
      const resolvedActiveDepartment =
        currentMsgDept ||
        recentContextDept ||
        topicSwitch.activeTopic ||
        staleDept;

      // Gradual branch department check (only when sandbox is false)
      if (!sandbox) {
        const inboundSettings = cachedInboundSettings || { enabled: false, dryRun: true, rolloutPercentage: 0, departmentMode: 'selected', allowedDepartments: [] };

        if (inboundSettings.departmentMode === 'selected') {
          if (!resolvedActiveDepartment || !inboundSettings.allowedDepartments.includes(resolvedActiveDepartment)) {
            console.log(JSON.stringify({
              tag: "AI_RESPONSE_ORCHESTRATOR_BYPASSED",
              tenantId,
              conversationId,
              reason: "department_not_allowed",
              resolvedActiveDepartment,
              allowedDepartments: inboundSettings.allowedDepartments
            }));
            return buildResult({
              text: '',
              modelUsed: 'department_not_allowed',
              latencyMs: Date.now() - startTime,
              bypassed: true,
              isRetry: false,
              qualityGateFailed: false
            });
          }
        }
      }

      if (resolvedActiveDepartment) {
        if (!unifiedContext.conversation) unifiedContext.conversation = {};
        unifiedContext.conversation.department = resolvedActiveDepartment;
        if (unifiedContext.opportunity) {
          unifiedContext.opportunity.department = resolvedActiveDepartment;
        }

        // Telemetry: log when stale CRM was overridden
        if (staleDept && staleDept !== resolvedActiveDepartment) {
          console.log(JSON.stringify({
            tag: 'ACTIVE_DEPARTMENT_OVERRIDE',
            tenantId,
            conversationId: conversationId || 'unknown',
            staleDepartment: staleDept,
            resolvedDepartment: resolvedActiveDepartment,
            source: currentMsgDept ? 'current_message' : recentContextSource || 'topic_switch',
            workerPath
          }));
        }
      }

      // Inject previous topics as facts/context
      if (topicSwitch.previousTopics.length > 0) {
        if (!unifiedContext.patient_known_facts) unifiedContext.patient_known_facts = [];
        unifiedContext.patient_known_facts.push(`Geçmiş İlgilenilen Branşlar: ${topicSwitch.previousTopics.join(', ')}.`);
      }

      // 5. Approved Learning hints injection
      try {
        const { TenantLearningRuntimeResolver } = await import('@/lib/services/ai/tenant-learning-runtime-resolver');
        if (channelId) {
          unifiedContext.approvedLearningHints = await TenantLearningRuntimeResolver.resolveHints(brain, channelId);
        } else {
          unifiedContext.approvedLearningHints = [];
        }
      } catch {
        unifiedContext.approvedLearningHints = [];
      }

      // 5b. Resolve Intent Arbitration, Greeting-Only, and Intent Elevation
      const { PendingQuestionResolver } = require('./pending-question-resolver');
      const { ShortAnswerInterpreter } = require('./short-answer-interpreter');
      const { ConversationStateArbitrator } = require('./conversation-state-arbitrator');

      const _tenantDeptKw = TenantConfigResolver.getIntentDepartmentKeywords(brain) ?? undefined;
      const rawPendingSlot = PendingQuestionResolver.resolve(history);
      const rawInterpretedIntent = ShortAnswerInterpreter.interpret(inboundText, rawPendingSlot);
      const routedIntent = ConversationIntentRouter.route(inboundText, _tenantDeptKw);

      const arbitration = ConversationStateArbitrator.arbitrate({
        lastUserMessage: inboundText,
        rawPendingSlot: rawPendingSlot || 'generic_none',
        rawInterpretedIntent: rawInterpretedIntent || 'none',
        routerIntent: routedIntent,
        history,
        convMeta,
        unifiedContext
      });

      let effectiveIntent = arbitration.effectiveIntent;
      let overrideReason = 'none';

      // Turn indicators: bot has not responded in this conversation yet?
      const assistantHistory = history.filter(m => m.role === 'assistant');
      const isFirstAssistantTurn = assistantHistory.length === 0;

      // Has active/latest form or open opportunity?
      const hasForm = !!(unifiedContext?.latestForm || (Array.isArray(unifiedContext?.patient_known_facts) && unifiedContext.patient_known_facts.length > 0) || unifiedContext?.opportunity);

      // Check if the form/opportunity has already been addressed by the bot
      let formAlreadyAddressed = false;
      if (hasForm) {
        let latestFormCreatedAt: Date | null = null;
        if (unifiedContext?.latestForm?.created_at) {
          latestFormCreatedAt = new Date(unifiedContext.latestForm.created_at);
        } else if (unifiedContext?.opportunity?.created_at) {
          latestFormCreatedAt = new Date(unifiedContext.opportunity.created_at);
        }

        // Check opportunity metadata first
        const oppMeta = unifiedContext?.opportunity?.metadata || {};
        if (oppMeta.form_greeted_at || oppMeta.form_followup_started_at || oppMeta.form_context_handled || oppMeta.arrival_date) {
          formAlreadyAddressed = true;
        }

        if (!formAlreadyAddressed && latestFormCreatedAt) {
          try {
            // Get all conversations for this customer or phone, ignoring soft-deleted ones
            const convs = await db.executeSafe({
              text: `SELECT id, metadata FROM conversations 
                     WHERE tenant_id = $1 
                       AND (customer_id = $2 OR phone_number = $3)
                       AND (metadata IS NULL OR metadata->>'deleted_at' IS NULL)`,
              values: [tenantId, customerId || null, phoneNumber || null]
            }) as any[];

            const convIds = convs.map(c => c.id);
            
            // Check metadata of all these conversations
            for (const c of convs) {
              const meta = c.metadata || {};
              if (
                meta.form_greeted_at || 
                meta.form_followup_started_at || 
                meta.form_context_handled || 
                meta.arrival_date
              ) {
                formAlreadyAddressed = true;
                break;
              }
            }

            if (!formAlreadyAddressed && convIds.length > 0) {
              // Check if any outbound message exists in any of these conversations after latestFormCreatedAt
              const outboundAfterForm = await db.executeSafe({
                text: `SELECT id FROM messages 
                       WHERE tenant_id = $1 
                         AND conversation_id = ANY($2) 
                         AND direction = 'out' 
                         AND created_at > $3 
                       LIMIT 1`,
                values: [tenantId, convIds, latestFormCreatedAt]
              }) as any[];
              if (outboundAfterForm.length > 0) {
                formAlreadyAddressed = true;
              }
            }
          } catch (err) {
            console.warn('[AIResponseOrchestrator] Failed to query past form greetings:', err);
          }
        }
      }

      // Elevate greeting if unaddressed form exists
      if (effectiveIntent === 'greeting' && isFirstAssistantTurn && hasForm && !formAlreadyAddressed) {
        effectiveIntent = 'form_followup';
        overrideReason = 'greeting_with_active_unaddressed_form';
        
        console.log(JSON.stringify({
          tag: 'INTENT_OVERRIDE',
          tenantId,
          conversationId,
          originalIntent: routedIntent,
          effectiveIntent,
          overrideReason,
          isFirstAssistantTurn,
          hasForm,
          formAlreadyAddressed
        }));
      }

      // Populate unifiedContext values for prompt builder
      unifiedContext.effectiveIntent = effectiveIntent;
      unifiedContext.overrideReason = overrideReason;
      unifiedContext.formAlreadyAddressed = formAlreadyAddressed;

      // Resolve isGreetingOnly context for Bot Reply prompt generation
      const hasQuotedReply = !!(mediaMetadata?.native?.quoted_message_snapshot || mediaMetadata?.native?.reply_to_provider_message_id);
      if (inboundText && !hasQuotedReply) {
        const lowerContent = inboundText.toLowerCase().trim();
        const defaultGreetings = ['merhaba', 'merhabalar', 'selam', 'iyi günler', 'iyi akşamlar', 'iyi sabahlar', 'günaydın', 'kolay gelsin', 'iyi çalışmalar'];
        const greetings: string[] = (brain?.context?.config?.greetingTokens && Array.isArray(brain.context.config.greetingTokens) && brain.context.config.greetingTokens.length > 0)
          ? brain.context.config.greetingTokens.map((t: string) => t.toLowerCase().trim())
          : defaultGreetings;
        
        const isInitialFormWelcome = !formAlreadyAddressed && isFirstAssistantTurn && hasForm;

        if (greetings.includes(lowerContent) || (lowerContent.length < 20 && greetings.some(g => lowerContent.includes(g)))) {
          if (!isInitialFormWelcome && effectiveIntent !== 'form_followup') {
            unifiedContext.isGreetingOnly = true;
          } else {
            delete unifiedContext.isGreetingOnly;
          }
        } else {
          delete unifiedContext.isGreetingOnly;
        }
      }

      // 6. Build Prompt
      const phase = unifiedContext.opportunity?.stage || 'lead';
      const systemPromptText = PromptBuilder.buildSystemPrompt(brain, phase, false, unifiedContext);

      // 7. Check for LLM Bypass/Challenge cases
      const cleanInbound = inboundText.toLowerCase().trim();
      const isBotAccusation = ['bot musun', 'sen bot musun', 'are you a bot', 'botsun', 'robot musun', 'yapay zeka mısın', 'yapay zeka misin', 'insan mısın', 'insan misin'].some(kw => cleanInbound.includes(kw));
      const isAiAccusation = ['yapay zeka', 'yapayzeka', 'gpt', 'gemini', 'openai', 'claude', 'dil modeli', 'hangi model'].some(kw => cleanInbound.includes(kw));
      const isPromptChallenge = ['prompt', 'promt', 'sistem prompt', 'system prompt', 'talimatların', 'sistem talimati', 'kuralın ne', 'direktifin ne', 'uydurma'].some(kw => cleanInbound.includes(kw));
      const isAngryPromptChallenge = isPromptChallenge && ['şikayet', 'sikayet', 'rezalet', 'berbat', 'kötü', 'sinir', 'bıktım', 'yeter', 'dalga'].some(kw => cleanInbound.includes(kw));

      // Resolve doctor directory — use resolvedActiveDepartment from full priority chain
      const doctorsList = DoctorDirectoryResolver.getDoctors(brain, resolvedActiveDepartment || undefined);
      const doctorNames = doctorsList.map(d => d.name);
      const hasDoctorDirectory = doctorsList.length > 0;

      // Doctor lookup check
      const isDoctorLookup = ['doktor', 'hekim', 'uzman', 'cerrah', 'hoca'].some(kw => cleanInbound.includes(kw));
      const shouldBypassDoctorLookup = isDoctorLookup && !hasDoctorDirectory;

      // P0.16-I: Mixed intent detection — doctor_lookup + process_question in same burst
      const isProcessQuestion = ['süreç', 'surec', 'nasıl ışliyor', 'nasıl çalışıyor', 'nasıl yürüyor', 'tanı', 'tedavi', 'muayene', 'operasyon', 'ameliyat', 'aşama', 'adım'].some(kw => cleanInbound.includes(kw));
      const isMixedDoctorProcess = isDoctorLookup && isProcessQuestion;

      // P0.30 Gate Diet: isNextStepRequest bypass removed — LLM handles next-step/process questions.
      // 'ne zaman' was also removed from router keywords to prevent misrouting.

      // P0.16-K: Multi-intent detection (address+price+doctor+process in one message)
      const isMultiIntentQuery = MultiIntentConsultantComposer.isMultiIntent(inboundText);

      // P0.16-K: Doctor names request detection (with repeat check)
      const isDoctorNamesRequest = /doktor\s+isim|hekim\s+isim|doktor\s+isimleri|kimler\s+var|hangi\s+doktorlar|doktor\s+list/.test(cleanInbound);
      const hasPreviousDoctorAsk = history.some(m =>
        m.role === 'user' &&
        /doktor\s+isim|hekim\s+isim|hangi\s+doktorlar/.test((m.content || '').toLowerCase())
      );

      // P0.16-K: "başka bilgi" / open-ended continuation — kept for LLM hint injection only, NOT for bypass
      // P0.16-K: match both Turkish ş and ASCII s for real WhatsApp messages
      const isOpenContinuation = /ba(?:ş|s)ka\s+(?:bir\s+)?(bilgi|soru|[şs]ey)|ba(?:ş|s)ka\s+bir\s+(?:ş|s)ey\s+sorabilir|daha\s+fazla\s+bilgi|bir\s+(?:ş|s)ey\s+daha/i.test(inboundText);

      // P0.16-L: routeAll — full intent matrix
      // P0.30 Gate Diet: isCannotTravelObjection, isDistanceObjection, isPoliteClose kept as
      // detection variables but their bypass blocks are removed. LLM + tenant prompt handles these.
      const allIntents = ConversationIntentRouter.routeAll(inboundText, _tenantDeptKw);
      const isThanksButContinue = allIntents.includes('thanks_but_continue');
      const isOpenContinuationIntent = allIntents.includes('open_continuation') || isOpenContinuation;

      // P0.16-L: Conversation frame (extends ConsultantConversationStateResolver with duration/objections)
      const safeHistoryForFrame = history.filter(m => m.content != null).map(m => ({ role: m.role, content: m.content as string }));
      const conversationFrame = ConversationFrameResolver.resolve(safeHistoryForFrame);
      const selfParticipant = conversationFrame.participants.find(p => p.relation === 'self') || null;
      const locationLabel = selfParticipant?.location || null;

      // Telemetry: doctor lookup department selection
      if (isDoctorLookup) {
        console.log(JSON.stringify({
          tag: 'DOCTOR_LOOKUP_DEPARTMENT_SELECTED',
          tenantId,
          conversationId: conversationId || 'unknown',
          resolvedActiveDepartment: resolvedActiveDepartment || null,
          staleDepartment: staleDept,
          source: currentMsgDept ? 'current_message' : recentContextDept ? 'recent_conversation' : staleDept ? 'stale_crm' : 'null',
          confidence: currentMsgDept ? 'high' : recentContextConfidence,
          hasDoctorDirectory,
          shouldBypass: isDoctorLookup && !hasDoctorDirectory,
          workerPath
        }));
      }

      // Check for recall frustration with facts
      const isRecallFrustration = ['söyledim', 'soyledim', 'belirttim', 'belirtmiştim', 'belirtmistim', 'yazdım ya', 'yazdim ya', 'aynı şeyi söyleme', 'ayni seyi soyleme'].some(kw => cleanInbound.includes(kw));
      const { buildRecallFactsSummary } = require('./context-aware-safe-fallback');
      const recallSummary = buildRecallFactsSummary(history);
      const isRecallWithFacts = isRecallFrustration && recallSummary.length > 0;

      // P0.30 Gate Diet: isThanksButContinueBypass and isOpenContinuationBypass removed.
      // LLM handles these naturally via hint injection at L2121.

      const isCallbackConfirmation = effectiveIntent === 'callback_confirmation' || effectiveIntent === 'schedule_confirmation';
      // P0.30 Gate Diet: Removed inboundText.length < 50 limit — arbitrary cap caused longer arrival answers to bypass LLM
      const isArrivalDateAnswer = effectiveIntent === 'arrival_date_answer' && !inboundText.includes('?');
      const isCallbackTimeAnswer = effectiveIntent === 'callback_time_answer';

      // P0.30 Gate Diet: shouldCreateTask narrowed.
      // Problem: Any 'görüşme' in ANY history msg caused new msgs to be treated as callback answers.
      // Fix: history-based path now requires:
      //   - Bot asked for time in LAST msg (lastBotAskedTime)
      //   - User's CURRENT msg is callback_time_answer intent (giving time, not asking a question)
      //   - Callback not already confirmed
      // This allows "ertesi gün" → bypass when bot asked for time, but blocks
      // "ne zaman gelebilirim" → generic_other → LLM (won't reach callback_time_answer intent).
      const isPositiveIntent = currentVisitIntent === 'turkey_visit_intent_positive';
      const lastBotAskedTime = history.length > 0 &&
        history[history.length - 1].role === 'assistant' &&
        /saat|zaman|gün|gun|tarih|ne zaman|uygun/i.test(history[history.length - 1].content || '');
      const isAppointmentContext = history.some(m =>
        /randevu|arama|görüşme|gorusme|telefon/i.test(m.content || '')
      );
      // Callback already confirmed if: bypass source recorded OR DB-level confirmed_at set.
      // Both must be checked — source covers in-memory bypass path, confirmed_at covers DB-written confirmations.
      const callbackAlreadyConfirmed = !!(
        convMeta?.last_callback_offer?.source === 'callback_confirmation_bypass' ||
        convMeta?.last_callback_offer?.confirmed_at
      );
      // isCallbackTimeAnswer confirms user is providing time info (not asking a question)
      const shouldCreateTask = isPositiveIntent || hasExplicitCall ||
        (!callbackAlreadyConfirmed && lastBotAskedTime && isAppointmentContext && isCallbackTimeAnswer);
      const shouldBypassCallbackTimeAnswer = isCallbackTimeAnswer && shouldCreateTask;


      // P0.30 Gate Diet: Removed from bypass chain:
      //   isNextStepRequest, isThanksButContinueBypass, isOpenContinuationBypass,
      //   isCannotTravelObjection, isDistanceObjection, isPoliteClose
      // These are conversational decisions — LLM + tenant prompt handles them better.
      const isLlmBypassChallenge = isPromptChallenge || isBotAccusation || isAiAccusation || isAngryPromptChallenge
        || shouldBypassDoctorLookup || isRecallWithFacts || isMultiIntentQuery || isDoctorNamesRequest
        || isCallbackConfirmation || isArrivalDateAnswer || shouldBypassCallbackTimeAnswer;

      let text = '';
      let bypassed = false;
      let modelUsed = 'gemini-2.5-flash';
      let inputTokens = 0;
      let outputTokens = 0;
      let isCallbackTimeAnswerPath = false;

      if (isLlmBypassChallenge) {
        // P0.16-H/K Telemetry: intent list
        const intentList: string[] = [];
        if (shouldBypassDoctorLookup) intentList.push('doctor_lookup');
        if (isRecallWithFacts)        intentList.push('recall_frustration');
        if (isPromptChallenge)        intentList.push('prompt_challenge');
        if (isBotAccusation || isAiAccusation) intentList.push('identity_question');
        if (isMixedDoctorProcess)     intentList.push('process_question');
        if (isMultiIntentQuery)       intentList.push('multi_intent_query');
        if (isDoctorNamesRequest)     intentList.push('doctor_names_request');
        if (isCallbackConfirmation)   intentList.push('callback_confirmation');
        if (isArrivalDateAnswer)      intentList.push('arrival_date_answer');
        if (shouldBypassCallbackTimeAnswer) intentList.push('callback_time_answer');


        if (intentList.length > 0) {
          console.log(JSON.stringify({
            tag: 'MULTI_INTENT_DEPARTMENT_SELECTED',
            tenantId,
            conversationId: conversationId || 'unknown',
            resolvedActiveDepartment: resolvedActiveDepartment || null,
            staleDepartment: staleDept,
            source: currentMsgDept ? 'current_message' : recentContextDept ? 'recent_conversation' : staleDept ? 'stale_crm' : 'null',
            intentList,
            confidence: currentMsgDept ? 'high' : recentContextConfidence,
            isMixedDoctorProcess,
            workerPath
          }));
        }

        // Resolve consultant state for all bypass paths (P0.16-K)
        const safeHistoryForState = history.filter(m => m.content != null).map(m => ({ role: m.role, content: m.content as string }));
        const consultantState = ConsultantConversationStateResolver.resolve(safeHistoryForState);

        let fallbackResult: any;

        // ── P0.16-K: Multi-intent query (4-question burst) — highest priority ──
        if (isMultiIntentQuery) {
          const composed = MultiIntentConsultantComposer.compose(
            inboundText,
            brain,
            safeHistoryForState,
            resolvedActiveDepartment || null,
            workerPath
          );
          if (composed) {
            fallbackResult = { text: composed.text, finalPath: 'multi_intent_consultant_composed' };
            console.log(JSON.stringify({
              tag: 'LIVE_TEST_PARITY_PATH_SELECTED',
              path: 'multi_intent_consultant_composed',
              intentCount: composed.intentList.length,
              tenantId,
              conversationId: conversationId || 'unknown',
              workerPath
            }));
          }
        }

        // ── P0.16-K: Doctor names request ────────────────────────────────────
        if (!fallbackResult && isDoctorNamesRequest) {
          // Collect departments from consultant state (multi-patient aware)
          const depts: string[] = [];
          for (const p of consultantState.participants) {
            if (p.department && !depts.includes(p.department)) depts.push(p.department);
          }
          if (depts.length === 0 && resolvedActiveDepartment) depts.push(resolvedActiveDepartment);
          const doctorPolicy = DoctorNamesPolicy.resolve(brain, depts, hasPreviousDoctorAsk);
          fallbackResult = { text: doctorPolicy.text, finalPath: `doctor_names_policy_${doctorPolicy.mode}` };
          console.log(JSON.stringify({
            tag: 'LIVE_TEST_PARITY_PATH_SELECTED',
            path: `doctor_names_policy_${doctorPolicy.mode}`,
            tenantId,
            conversationId: conversationId || 'unknown',
            workerPath
          }));
        }

        // ── P0.16-M: Mixed doctor+process — DoctorNamesPolicy + inline process (legacy ContextAwareSafeFallbackResolver removed) ─
        if (!fallbackResult && isMixedDoctorProcess) {
          // Doctor part — use DoctorNamesPolicy (avoids legacy "bu ekrandan" text)
          const mixedDepts: string[] = [];
          for (const p of consultantState.participants) {
            if (p.department && !mixedDepts.includes(p.department)) mixedDepts.push(p.department);
          }
          if (mixedDepts.length === 0 && resolvedActiveDepartment) mixedDepts.push(resolvedActiveDepartment);
          const mixedDoctorPolicy = DoctorNamesPolicy.resolve(brain, mixedDepts, hasPreviousDoctorAsk);

          // Process part — inline consultant-owned response
          const dept = resolvedActiveDepartment || (mixedDepts[0] || 'ilgili bölümümüz');
          const processText = [
            `${dept} sürecinde ilk adım uzman hekim değerlendirmesidir.`,
            `Bu değerlendirmede mevcut bulgularınız (varsa MR/tetkikler) incelenerek size özel bir tedavi planı oluşturulur.`,
            `Sonraki adım için kısa bir telefon görüşmesi planlanabilir.`,
            `Hangi gün ve saat aralığında uygun olursunuz?`,
          ].join('\n');

          const composedText = [mixedDoctorPolicy.text, processText]
            .filter(t => t && t.trim().length > 0)
            .join('\n\n');
          fallbackResult = { text: composedText, finalPath: 'mixed_intent_doctor_process' };
          console.log(JSON.stringify({
            tag: 'MIXED_INTENT_COMPOSED',
            tenantId,
            conversationId: conversationId || 'unknown',
            resolvedActiveDepartment: resolvedActiveDepartment || null,
            doctorPolicyMode: mixedDoctorPolicy.mode,
            workerPath
          }));
        }

        // ── P0.27: Callback Confirmation Bypass ──────────────────
        if (!fallbackResult && isCallbackConfirmation) {
          // 1. Try to read from conversation.metadata.last_callback_offer first
          const lastOffer = convMeta?.last_callback_offer;
          let parsedSugg: any = null;
          
          if (lastOffer && lastOffer.proposed_due_at) {
            const dt = new Date(lastOffer.proposed_due_at);
            if (!isNaN(dt.getTime())) {
              const formatter = new Intl.DateTimeFormat('en-US', {
                timeZone: 'Europe/Istanbul',
                year: 'numeric', month: '2-digit', day: '2-digit',
                hour: '2-digit', minute: '2-digit',
                hour12: false
              });
              const parts = formatter.formatToParts(dt);
              const getVal = (type: string) => parts.find(p => p.type === type)?.value || '';
              const yyyy = getVal('year');
              const mm = getVal('month');
              const dd = getVal('day');
              const hh = getVal('hour');
              const min = getVal('minute');
              
              parsedSugg = {
                suggested_date: `${yyyy}-${mm}-${dd}`,
                suggested_time: `${hh}:${min}`,
                proposed_date: lastOffer.proposed_due_at,
                suggested_timezone_basis: lastOffer.timezone || 'Europe/Istanbul'
              };
            }
          }
          
          // 2. Fallback to parsing from last assistant message (restricted)
          if (!parsedSugg) {
            const assistantHistory = history.filter(m => m.role === 'assistant');
            const lastAssistantMsg = (assistantHistory.length > 0 ? assistantHistory[assistantHistory.length - 1].content : '') || '';
            const isGenuineOffer = 
              lastOffer?.source === 'bot_callback_offer' || 
              lastOffer?.source === 'callback_confirmation_bypass' ||
              effectiveIntent === 'call_scheduling_request' || 
              effectiveIntent === 'callback_confirmation';
              
            const isArrivalBypassResponse = 
              lastAssistantMsg.includes('geliş tarihi') || 
              lastAssistantMsg.includes('geliş tarihiniz') ||
              lastAssistantMsg.includes('not aldım');

            if (isGenuineOffer && !isArrivalBypassResponse) {
              const { parseDeterministicSuggestion } = require('../../utils/date-parser');
              parsedSugg = parseDeterministicSuggestion(lastAssistantMsg, new Date(), null, null);
            }
          }
          
          let responseText = '';
          let isSuccess = false;

          if (parsedSugg) {
            const userMessages = history.filter(m => m.role === 'user');
            const recentUserTexts = userMessages.slice(-3).map(m => (m.content || '').toLowerCase()).join(' ');
            const hasRecentTurkeyTimeExplicit = /\b(t%C3%BCrkiye saati|türkiye saati|tr saat|ts\b)/i.test(recentUserTexts) || /\b(türkiye saatiyle)\b/i.test(inboundText.toLowerCase());
            const hasRecentPatientTimeExplicit = /\b(yerel saat|kendi saat|benim saat|hollanda saat|almanya saat|local time)\b/i.test(recentUserTexts) || /\b(yerel saatle|kendi saatimle|local saatle)\b/i.test(inboundText.toLowerCase());

            const res = await processCallbackSuggestion({
              parsedSugg,
              convMeta,
              unifiedContext,
              country: unifiedContext?.opportunity?.country || convMeta?.patient_country || null,
              replyLanguage: replyLanguage || 'en',
              tenantDefaultLang: tenantDefaultLang || 'en',
              timezone: timezone || brain.context.config?.timezone || 'Europe/Istanbul',
              sandbox,
              tenantId,
              channelId: channelId || 'whatsapp',
              phoneNumber,
              history,
              db,
              isTurkeyBasisInherited: hasRecentTurkeyTimeExplicit,
              isPatientBasisInherited: hasRecentPatientTimeExplicit
            });
            responseText = res.responseText;
            isSuccess = res.isSuccess;
          }

          if (!isSuccess && !responseText) {
            responseText = `Aranmak istediğiniz uygun bir gün ve saat aralığı belirtebilir misiniz? Görüşme talebinizi bu saat aralığıyla birlikte hasta danışmanımıza iletilmesi için not alıyorum. 🙏`;
          }
          
          fallbackResult = { text: responseText, finalPath: 'callback_confirmation_bypass' };
          console.log(JSON.stringify({
            tag: 'LIVE_TEST_PARITY_PATH_SELECTED',
            path: 'callback_confirmation_bypass',
            tenantId,
            conversationId: conversationId || 'unknown',
            workerPath
          }));
        }

        // P0.28: arrival_date_answer bypass
        if (!fallbackResult && isArrivalDateAnswer) {
          const parsed = DateAnswerResolver.parse(inboundText, brain.context.config?.timezone || 'Europe/Istanbul');
          const normalizedDate = parsed.raw || inboundText.trim();

          const facts = ConversationKnownFactsResolver.resolve({
            history: history.filter((m: any) => m.content != null).map((m: any) => ({ role: m.role, content: m.content as string })),
            opportunity: unifiedContext?.opportunity,
            profile: unifiedContext?.profile,
            latestForm: unifiedContext?.latestForm,
            conversation: unifiedContext?.conversation
          });
          const { CallPreferenceLabelResolver } = require('./call-preference-label-resolver');
          const callTime = facts.preferredCallTime || '';
          const cleanCallTime = callTime ? CallPreferenceLabelResolver.resolve(callTime) : 'en yakın uygun çalışma saatlerinde';

          const resolvedIndustry = brain.context.config?.industry || (brain.prompts.metadata as any)?.industry || '';
          const isHealthcare = resolvedIndustry === 'healthcare' || resolvedIndustry === 'medical';
          // Deterministic cliches avoided per Rule 6 (no "Müşteri temsilcimiz")
          const agentLabelPossessive = 'Hasta danışmanımızın';

          const responseText = `Teşekkür ederim, ${normalizedDate} tarihini not aldım. ${agentLabelPossessive} sizi ${cleanCallTime} araması için notunuzu iletiyorum 🙏`;

          if (!sandbox) {
            try {
              const convCheck = await db.executeSafe({
                text: `SELECT metadata FROM conversations WHERE id = $1 LIMIT 1`,
                values: [conversationId]
              }) as any[];
              const existingMeta = convCheck[0]?.metadata || {};
              const updatedMeta = {
                ...existingMeta,
                arrival_date: normalizedDate
              };
              delete updatedMeta.phone_number;
              delete updatedMeta.patient_name;
              delete updatedMeta.raw_message;

              // P0.28.1: Clean up old/stale last_callback_offer if it conflicts with arrival date or is unverified bot offer
              if (updatedMeta.last_callback_offer) {
                let shouldDeleteOffer = false;
                const proposedDueAt = updatedMeta.last_callback_offer.proposed_due_at;
                if (proposedDueAt) {
                  const proposedDateOnly = proposedDueAt.split('T')[0]; // YYYY-MM-DD
                  if (parsed.date) {
                    const parsedDateOnly = parsed.date.toISOString().split('T')[0];
                    if (proposedDateOnly === parsedDateOnly) {
                      shouldDeleteOffer = true;
                    }
                  }
                }
                if (updatedMeta.last_callback_offer.source === 'bot_callback_offer') {
                  shouldDeleteOffer = true;
                }
                if (shouldDeleteOffer) {
                  delete updatedMeta.last_callback_offer;
                }
              }

              await db.executeSafe({
                text: `UPDATE conversations SET metadata = $1, updated_at = NOW() WHERE id = $2`,
                values: [JSON.stringify(updatedMeta), conversationId]
              });

              if (unifiedContext?.opportunity?.id) {
                await db.executeSafe({
                  text: `UPDATE opportunities SET travel_date = $1, updated_at = NOW() WHERE id = $2`,
                  values: [normalizedDate, unifiedContext.opportunity.id]
                });
              }
            } catch (dbErr) {
              console.error('[AIResponseOrchestrator] Failed to update arrival date in DB:', dbErr);
            }
          }

          fallbackResult = { text: responseText, finalPath: 'arrival_date_bypass' };
          console.log(JSON.stringify({
            tag: 'LIVE_TEST_PARITY_PATH_SELECTED',
            path: 'arrival_date_bypass',
            tenantId,
            conversationId: conversationId || 'unknown',
            workerPath
          }));
        }

        // P0.28.2: callback_time_answer bypass
        if (!fallbackResult && isCallbackTimeAnswer) {
          if (!shouldCreateTask) {
            // Do NOT create task. Resolve using ContextAwareSafeFallbackResolver
            fallbackResult = ContextAwareSafeFallbackResolver.resolve({
              inboundText,
              brain,
              identityConfig: brain.prompts.metadata?.identity || brain.context.config?.identity || {},
              unifiedContext,
              channelId,
              systemPromptText,
              resolvedActiveDepartment: resolvedActiveDepartment || null,
              replyLanguage,
              turkeyVisitIntent: currentVisitIntent,
              formAlreadyAddressed
            });
            console.log(JSON.stringify({
              tag: 'LIVE_TEST_PARITY_PATH_SELECTED',
              path: 'callback_time_answer_intent_gated_fallback',
              tenantId,
              conversationId: conversationId || 'unknown',
              workerPath,
              currentVisitIntent
            }));
          } else {
            // Task creation allowed! Execute normal P0.28.2 callback time answer parsing and task creation.
            const { parseDeterministicSuggestion } = require('../../utils/date-parser');
            const assistantHistory = history.filter(m => m.role === 'assistant');
            const lastAssistantMsg = (assistantHistory.length > 0 ? assistantHistory[assistantHistory.length - 1].content : '') || '';
            const parsedSugg = parseDeterministicSuggestion(inboundText, new Date(), null, lastAssistantMsg);

            let responseText = '';
            let isSuccess = false;
            const country = unifiedContext?.opportunity?.country || convMeta?.patient_country || null;

            if (parsedSugg) {
              const userMessages = history.filter(m => m.role === 'user');
              const recentUserTexts = userMessages.slice(-3).map(m => (m.content || '').toLowerCase()).join(' ');
              const hasRecentTurkeyTimeExplicit = /\b(t%C3%BCrkiye saati|türkiye saati|tr saat|ts\b)/i.test(recentUserTexts) || /\b(türkiye saatiyle)\b/i.test(inboundText.toLowerCase());
              const hasRecentPatientTimeExplicit = /\b(yerel saat|kendi saat|benim saat|hollanda saat|almanya saat|local time)\b/i.test(recentUserTexts) || /\b(yerel saatle|kendi saatimle|local saatle)\b/i.test(inboundText.toLowerCase());

              const res = await processCallbackSuggestion({
                parsedSugg,
                convMeta,
                unifiedContext,
                country,
                replyLanguage: replyLanguage || 'en',
                tenantDefaultLang: tenantDefaultLang || 'en',
                timezone: timezone || brain.context.config?.timezone || 'Europe/Istanbul',
                sandbox,
                tenantId,
                channelId: channelId || 'whatsapp',
                phoneNumber,
                history,
                db,
                isTurkeyBasisInherited: hasRecentTurkeyTimeExplicit,
                isPatientBasisInherited: hasRecentPatientTimeExplicit
              });
              responseText = res.responseText;
              isSuccess = res.isSuccess;
            }

            if (!responseText) {
              if (hasRelativeOrPeriodKeywords(inboundText)) {
                responseText = buildRelativeDaypartClarification(inboundText, country, convMeta, unifiedContext, timezone || brain.context.config?.timezone || 'Europe/Istanbul', replyLanguage, tenantDefaultLang);
              } else {
                // Rule 3: Ask for clarification instead of uydurma when parsing fails
                responseText = `Aranmak istediğiniz uygun bir gün ve saat aralığı belirtebilir misiniz? Görüşme talebinizi bu saat aralığıyla birlikte hasta danışmanımıza iletilmesi için not alıyorum. 🙏`;
              }
            }
            
            fallbackResult = { text: responseText, finalPath: 'callback_time_answer_bypass' };
            isCallbackTimeAnswerPath = true; // flag to skip last_callback_offer writing
            console.log(JSON.stringify({
              tag: 'LIVE_TEST_PARITY_PATH_SELECTED',
              path: 'callback_time_answer_bypass',
              tenantId,
              conversationId: conversationId || 'unknown',
              workerPath
            }));
          }
        }

        // ── Default: other bypass intents via ContextAwareSafeFallbackResolver ─
        if (!fallbackResult) {
          fallbackResult = ContextAwareSafeFallbackResolver.resolve({
            inboundText,
            brain,
            identityConfig: brain.prompts.metadata?.identity || brain.context.config?.identity || {},
            unifiedContext,
            channelId,
            systemPromptText,
            resolvedActiveDepartment: resolvedActiveDepartment || null,
            replyLanguage,
            turkeyVisitIntent: currentVisitIntent,
            formAlreadyAddressed
          });
        }

        text = fallbackResult.text;
        bypassed = true;
        modelUsed = 'bypass';

        console.log(JSON.stringify({
          tag: "AI_RESPONSE_ORCHESTRATOR_FALLBACK_APPLIED",
          tenantId,
          conversationId: conversationId || 'unknown',
          reason: "llm_bypass_challenge",
          workerPath
        }));
      } else {
        // P0.16-K: "başka bilgi" open-continuation — ensure LLM doesn't close conversation
        let llmSystemPrompt = systemPromptText;
        if (isOpenContinuation || isOpenContinuationIntent || isThanksButContinue) {
          llmSystemPrompt = systemPromptText + '\n\n[NOT: Kullanıcı konuşmayı sürdürmek istiyor. "İyi günler" veya kapatma cümlesi KULLANMA. Yeni sorusunu bekle veya yardıma açık olduğunu nazikçe belirt.]';
        }

        // P0.16-M: Short affirmative ("tamam", "olur", "evet", "peki") — inject conversation-state-first directive
        // Prevents LLM from regressing to stale CRM context (Kardiyoloji/Ağustos 2026 etc.)
        const isShortAffirmative = /^(?:tamam|olur|evet|peki|harika|super|süper|anla[ydş]|anlad[ıi]m|anlaşıldı|anlasild[ıi]|tamamdır|tamamdir|tamamsa)[\.!?\s]*$/i.test(inboundText.trim());
        if (isShortAffirmative && history.length > 2) {
          llmSystemPrompt = llmSystemPrompt + '\n\n[ÖNEMLİ KURAL: Kullanıcı kısa bir onay/kabul mesajı gönderdi. Son konuşma bağlamına (hastanın şikayeti, branş, konum) göre yanıt ver. CRM kayıtlarındaki eski departman/tarih bilgilerine (Kardiyoloji, Ağustos 2026 vb.) GÖRE HAREKET ETME. Asıl konuşmayı referans al.]';
        }

        // P0.16-M: Conversation frame priority — inject active state BEFORE CRM context
        if (conversationFrame.participants.length > 0 && history.length > 1) {
          const frameSelfParticipant = conversationFrame.participants.find(p => p.relation === 'self');
          if (frameSelfParticipant?.complaint && frameSelfParticipant.complaint !== '') {
            const frameNote = `\n\n[AKTIF KONUŞMA DURUMU (yüksek öncelik): Hasta şikayeti: "${frameSelfParticipant.complaint}". Konum: "${frameSelfParticipant.location || 'bilinmiyor'}". CRM/form kayıtlarındaki önceki bilgiler bu konuşma bağlamıyla çelişiyorsa KONUŞMAYI referans al.]`;
            llmSystemPrompt = llmSystemPrompt + frameNote;
          }
        }

        // P0.16-K: Inject conversation summary to LLM prompt (max 10 lines)
        const safeHistoryForLLM = history.filter(m => m.content != null).map(m => ({ role: m.role, content: m.content as string }));
        const conversationSummary = ConsultantConversationStateResolver.buildPromptSummary(safeHistoryForLLM);
        if (conversationSummary) {
          llmSystemPrompt = llmSystemPrompt + conversationSummary;
        }

        // Run LLM Response generation
        const formattedMessages: ChatMessage[] = [
          { role: 'system' as const, content: llmSystemPrompt },
          ...history
        ];
        if (history.length === 0 || history[history.length - 1].role !== 'user') {
          formattedMessages.push({ role: 'user' as const, content: inboundText });
        }

        const llmModel = brain.context.settings?.aiModel || 'gemini-2.5-flash';
        const apiKey = brain.context.config?.raw?.gemini_api_key || process.env.GEMINI_API_KEY || '';

        const aiConfig = {
          provider: 'gemini' as const,
          modelId: llmModel,
          apiKey,
          temperature: 0.7,
          maxTokens: brain.context.settings?.maxResponseTokens || 1500
        };

        const orchestrator = new AIOrchestrator();
        
        const response = await orchestrator.generateResponse(
          formattedMessages,
          aiConfig,
          tenantId,
          conversationId || 'sandbox_test_conversation',
          { sandbox }
        );
        
        text = response.text || '';
        modelUsed = response.modelUsed || llmModel;
        inputTokens = response.inputTokens || 0;
        outputTokens = response.outputTokens || 0;

        if (modelUsed === 'fallback') {
          console.log(JSON.stringify({
            tag: "AI_RESPONSE_ORCHESTRATOR_FALLBACK_APPLIED",
            tenantId,
            conversationId: conversationId || 'unknown',
            reason: response.finishReason || "llm_generation_error",
            workerPath
          }));

          // P0.28: Context-aware fallback resolution
          const assistantHistory = history.filter((m: any) => m.role === 'assistant');
          const lastAssistantMsg = assistantHistory.length > 0 ? (assistantHistory[assistantHistory.length - 1].content || '') : '';
          const lowerUser = inboundText.toLowerCase().trim();

          const isArrivalDateQuestion = (text: string) => {
            const lowerText = text.toLowerCase();
            return [
              'gelmeyi düşündüğünüz', 'gelmeyi dusundugunuz', 'ne zaman gelmeyi', 'ziyaret tarihi',
              'tarih aralığı', 'tarih araligi', 'tahmini tarih', 'tahmini ziyaret', 'gelmeyi planlıyorsunuz',
              'gelmeyi planliyorsunuz', 'geliş tarih'
            ].some(kw => lowerText.includes(kw));
          };

          const isSpecificCallTimeOffer = (text: string) => {
            const lowerText = text.toLowerCase();
            const hasCallKw = [
              'görüşmek', 'gorusmek', 'arayalım', 'arayalim', 'arayebiliriz',
              'arama planlama', 'telefon görüşmesi', 'telefon gorusmesi',
              'danışmanımızla', 'danismanimizla', 'arama teklif', 'telefonla gorusalim', 'telefonla görüşelim'
            ].some(kw => lowerText.includes(kw));
            if (!hasCallKw) return false;

            const hasTimeOrDate = [
              'saat', 'saatiyle', 'saatinde', 'pazartesi', 'salı', 'sali', 'çarşamba', 'carsamba', 'perşembe', 'persembe', 'cuma', 'cumartesi', 'pazar',
              'yarın', 'yarin', 'bugün', 'bugun', 'haziran', 'temmuz', 'ağustos', 'agustos', 'eylül', 'eylul', 'ekim', 'kasım', 'kasim', 'aralık', 'aralik'
            ].some(kw => lowerText.includes(kw)) || /\d{1,2}[:.]\d{2}/.test(lowerText);

            return hasTimeOrDate;
          };

          const dateIndicators = [
            'ocak', 'şubat', 'subat', 'mart', 'nisan', 'mayıs', 'mayis', 'haziran',
            'temmuz', 'ağustos', 'agustos', 'eylül', 'eylul', 'ekim', 'kasım', 'kasim', 'aralık', 'aralik',
            'ay sonu', 'ay başı', 'ay basi', 'ayın sonu', 'ayın başı'
          ];
          const isDateMessage = dateIndicators.some(kw => lowerUser.includes(kw)) || /\d{1,2}[./]\d{1,2}/.test(lowerUser);

          const affirmatives = ['evet', 'olur', 'tamam', 'ok', 'okay', 'yes', 'uygun', 'uygundur', 'evet uygun', 'kabul', 'tamamdir', 'hay hay', 'tabii', 'onaylıyorum', 'arayabilirsiniz', 'arayın', 'arayin', 'ararlar'];
          const isAffirmative = affirmatives.some(kw => lowerUser === kw || lowerUser.startsWith(kw + ' ') || lowerUser.endsWith(' ' + kw) || lowerUser.includes(' ' + kw + ' '));

          if (isArrivalDateQuestion(lastAssistantMsg) && isDateMessage) {
            const parsed = DateAnswerResolver.parse(inboundText, brain.context.config?.timezone || 'Europe/Istanbul');
            const normalizedDate = parsed.raw || inboundText.trim();

            const facts = ConversationKnownFactsResolver.resolve({
              history: history.filter((m: any) => m.content != null).map((m: any) => ({ role: m.role, content: m.content as string })),
              opportunity: unifiedContext?.opportunity,
              profile: unifiedContext?.profile,
              latestForm: unifiedContext?.latestForm,
              conversation: unifiedContext?.conversation
            });
            const { CallPreferenceLabelResolver } = require('./call-preference-label-resolver');
            const callTime = facts.preferredCallTime || '';
            const cleanCallTime = callTime ? CallPreferenceLabelResolver.resolve(callTime) : 'en yakın uygun çalışma saatlerinde';

            const resolvedIndustry = brain.context.config?.industry || (brain.prompts.metadata as any)?.industry || '';
            const isHealthcare = resolvedIndustry === 'healthcare' || resolvedIndustry === 'medical';
            // Deterministic cliches avoided per Rule 6 (no "Müşteri temsilcimiz")
            const agentLabelPossessive = 'Hasta danışmanımızın';

            text = `Teşekkür ederim, ${normalizedDate} tarihini not aldım. ${agentLabelPossessive} sizi ${cleanCallTime} araması için notunuzu iletiyorum 🙏`;
            
            if (!sandbox) {
              try {
                const convCheck = await db.executeSafe({
                  text: `SELECT metadata FROM conversations WHERE id = $1 LIMIT 1`,
                  values: [conversationId]
                }) as any[];
                const existingMeta = convCheck[0]?.metadata || {};
                const updatedMeta = {
                  ...existingMeta,
                  arrival_date: normalizedDate
                };
                delete updatedMeta.phone_number;
                delete updatedMeta.patient_name;
                delete updatedMeta.raw_message;

                // P0.28.1: Clean up old/stale last_callback_offer if it conflicts with arrival date or is unverified bot offer
                if (updatedMeta.last_callback_offer) {
                  let shouldDeleteOffer = false;
                  const proposedDueAt = updatedMeta.last_callback_offer.proposed_due_at;
                  if (proposedDueAt) {
                    const proposedDateOnly = proposedDueAt.split('T')[0]; // YYYY-MM-DD
                    if (parsed.date) {
                      const parsedDateOnly = parsed.date.toISOString().split('T')[0];
                      if (proposedDateOnly === parsedDateOnly) {
                        shouldDeleteOffer = true;
                      }
                    }
                  }
                  if (updatedMeta.last_callback_offer.source === 'bot_callback_offer') {
                    shouldDeleteOffer = true;
                  }
                  if (shouldDeleteOffer) {
                    delete updatedMeta.last_callback_offer;
                  }
                }

                await db.executeSafe({
                  text: `UPDATE conversations SET metadata = $1, updated_at = NOW() WHERE id = $2`,
                  values: [JSON.stringify(updatedMeta), conversationId]
                });

                if (unifiedContext?.opportunity?.id) {
                  await db.executeSafe({
                    text: `UPDATE opportunities SET travel_date = $1, updated_at = NOW() WHERE id = $2`,
                    values: [normalizedDate, unifiedContext.opportunity.id]
                  });
                }
              } catch (dbErr) {
                console.error('[AIResponseOrchestrator] Failed to update arrival date in DB during fallback recovery:', dbErr);
              }
            }
          } else if (isSpecificCallTimeOffer(lastAssistantMsg) && isAffirmative) {
            // Deterministic cliches avoided per Rule 6 (no "temsilci" or "Müşteri temsilcimiz")
            const agentLabel = 'hasta danışmanımıza';
            text = `Teyidinizi aldım. Telefon görüşmesi için belirttiğiniz zamanı ilgili ${agentLabel} iletiyorum. Görüşmek üzere. 🙏`;
          } else if (isCallbackTimeAnswer) {
            const { parseDeterministicSuggestion } = require('../../utils/date-parser');
            const parsedSugg = parseDeterministicSuggestion(inboundText, new Date(), null, lastAssistantMsg);

            let responseText = '';
            let isSuccess = false;
            const country = unifiedContext?.opportunity?.country || convMeta?.patient_country || null;

            if (parsedSugg) {
              const userMessages = history.filter(m => m.role === 'user');
              const recentUserTexts = userMessages.slice(-3).map(m => (m.content || '').toLowerCase()).join(' ');
              const hasRecentTurkeyTimeExplicit = /\b(t%C3%BCrkiye saati|türkiye saati|tr saat|ts\b)/i.test(recentUserTexts) || /\b(türkiye saatiyle)\b/i.test(inboundText.toLowerCase());
              const hasRecentPatientTimeExplicit = /\b(yerel saat|kendi saat|benim saat|hollanda saat|almanya saat|local time)\b/i.test(recentUserTexts) || /\b(yerel saatle|kendi saatimle|local saatle)\b/i.test(inboundText.toLowerCase());

              const res = await processCallbackSuggestion({
                parsedSugg,
                convMeta,
                unifiedContext,
                country,
                replyLanguage: replyLanguage || 'en',
                tenantDefaultLang: tenantDefaultLang || 'en',
                timezone: timezone || brain.context.config?.timezone || 'Europe/Istanbul',
                sandbox,
                tenantId,
                channelId: channelId || 'whatsapp',
                phoneNumber,
                history,
                db,
                isTurkeyBasisInherited: hasRecentTurkeyTimeExplicit,
                isPatientBasisInherited: hasRecentPatientTimeExplicit
              });
              responseText = res.responseText;
              isSuccess = res.isSuccess;
            }

            if (!responseText) {
              if (hasRelativeOrPeriodKeywords(inboundText)) {
                responseText = buildRelativeDaypartClarification(inboundText, country, convMeta, unifiedContext, timezone || brain.context.config?.timezone || 'Europe/Istanbul', replyLanguage, tenantDefaultLang);
              } else {
                responseText = `Aranmak istediğiniz uygun bir gün ve saat aralığı belirtebilir misiniz? Görüşme talebinizi bu saat aralığıyla birlikte hasta danışmanımıza iletilmesi için not alıyorum. 🙏`;
              }
            }

            text = responseText;
            isCallbackTimeAnswerPath = true; // flag to skip last_callback_offer writing
          }
        }
      }


      let ctaOfferedRecently = false;
      if (Array.isArray(history)) {
        const last3Assistant = assistantHistory.slice(-3);
        ctaOfferedRecently = last3Assistant.some((m: any) => {
          const textLower = (m.content || '').toLowerCase();
          return ['randevu', 'görüşme', 'gorusme', 'arayalım', 'arayalim', 'arayebiliriz', 'arama', 'telefon'].some(kw => textLower.includes(kw));
        });
      }

      const qgOptions = {
        ctaOfferedRecently,
        angryPatientMode: isAngryPromptChallenge,
        personaName: brain.prompts.metadata?.identity?.personaName || brain.context.config?.identity?.personaName,
        organizationName: brain.prompts.metadata?.identity?.organizationName || brain.context.config?.identity?.organizationName,
        organizationShortName: brain.prompts.metadata?.identity?.organizationShortName || brain.context.config?.identity?.organizationShortName,
        identityAlreadyIntroduced: !isFirstAssistantTurn,
        asksIdentity: isBotAccusation,
        asksName: isBotAccusation,
        patientClaimsBot: isBotAccusation || isAiAccusation,
        patientProvidedAvailability: !!unifiedContext?.patientProvidedAvailability
      };


      // Run Turkish Quality Gate check on LLM response
      let qualityGateValid = true;
      let qualityGateReason = '';
      
      if (!bypassed) {
        const qualityGate = MultilingualQualityGate.validate({
          responseText: text,
          replyLanguage: replyLanguage === 'tr' ? 'Türkçe' : 'İngilizce',
          qualityGateLocale: replyLanguage === 'tr' ? 'tr' : 'generic',
          qgOptions
        });
        
        if (qualityGate.valid) {
          text = qualityGate.morphologyCorrectedText || text;
        } else {
          qualityGateValid = false;
          qualityGateReason = qualityGate.reason || 'quality_gate_failed';

          console.log(JSON.stringify({
            tag: "AI_RESPONSE_ORCHESTRATOR_FALLBACK_APPLIED",
            tenantId,
            conversationId: conversationId || 'unknown',
            reason: `quality_gate_failed:${qualityGateReason}`,
            workerPath
          }));
        }
      }

      // 9. Morphology Guard — applies to ALL response paths (LLM + bypass + mixed)
      const morphology = TurkishMorphologyGuard.check(text, true, doctorNames);
      if (morphology.hasMorphologyError && morphology.correctedText) {
        text = morphology.correctedText;
      }
      // P0.16-I: TURKISH_MORPHOLOGY_GUARD_APPLIED telemetry (safe metadata only)
      if (morphology.hasMorphologyError || morphology.correctionApplied) {
        console.log(JSON.stringify({
          tag: 'TURKISH_MORPHOLOGY_GUARD_APPLIED',
          tenantId,
          conversationId: conversationId || 'unknown',
          workerPath,
          responseSource: modelUsed === 'fallback' ? 'fallback/context_aware_fallback' : (bypassed ? 'bypass' : 'llm'),
          detectedPatterns: morphology.errors.map(e => e.pattern),
          changed: morphology.correctionApplied
        }));
      }

      // 9b-9c. P0.16-M: FinalPipelineEnforcer — mandatory chain (normalizer + formatter + telemetry)
      // Replaces separate 9b/9c steps; enforces FINAL_RESPONSE_SOURCE telemetry for all paths
      // Also runs checkLegacyBlock to catch any "bu ekrandan" text that slipped through
      const legacyBlock = FinalPipelineEnforcer.checkLegacyBlock(text);
      if (legacyBlock) {
        text = legacyBlock;
        console.log(JSON.stringify({ tag: 'FINAL_PIPELINE_ENFORCED', reason: 'legacy_block', tenantId, conversationId: conversationId || 'unknown', workerPath }));
      }
      const finalPipeCtx = {
        tenantId,
        conversationId: conversationId || undefined,
        workerPath,
        responseSource: modelUsed === 'fallback' ? 'fallback/context_aware_fallback' : (bypassed ? (modelUsed === 'bypass' ? 'bypass' : 'bypass_unknown') : 'llm'),
        complaint: selfParticipant?.complaint || undefined,
        location: locationLabel || undefined,
        channel: channelId ? 'whatsapp' : undefined,
        replyLanguage,
      };
      const finalPipeResult = FinalPipelineEnforcer.enforce(text, finalPipeCtx);
      text = finalPipeResult.text;

      // 10. Outbound Guard Checks
      // P0.17-FP BUGFIX: Inject identityConfig into unifiedContext before FinalOutboundGuard.process
      // so that the guard's internal recovery (ContextAwareSafeFallbackResolver) has the persona name.
      // Without this, recovery falls through to 'Merhaba, ben hastane iletişim asistanıyım.' generic path.
      if (unifiedContext && !unifiedContext.identityConfig) {
        const resolvedIdentityForGuard = brain.prompts.metadata?.identity || brain.context.config?.identity || {};
        if (Object.keys(resolvedIdentityForGuard).length > 0) {
          unifiedContext.identityConfig = resolvedIdentityForGuard;
        }
      }
      text = FinalOutboundGuard.process(text, {
        tenantId,
        channelId,
        conversationId: conversationId || 'unknown',
        inboundText,
        unifiedContext,
        industry: brain.context.config?.industry || (brain.prompts.metadata as any)?.industry || '',
        systemPromptText,
        promptVersion: brain.prompts.metadata?.version || undefined,
        workerPath,
        responseDedupeKey: responseDedupeKey || undefined,
        aggregatedMessageCount: history.length,
        intent: topicSwitch.hasSwitched ? 'topic_switch' : (isLlmBypassChallenge ? 'prompt_challenge' : 'generic_other'),
        fallbackApplied: bypassed || !qualityGateValid,
        fallbackReason: qualityGateReason || (bypassed ? 'llm_bypass_challenge' : undefined),
        doctorDirectoryHit: hasDoctorDirectory,
        topicSwitchApplied: topicSwitch.hasSwitched
      });

      // 11. WhatsApp formatting policy applied
      text = ResponseFormattingPolicy.format(text);

      // P0.27: Save last_callback_offer to conversation metadata if the bot response proposes a date/time
      if (!sandbox && conversationId && text && !isCallbackTimeAnswerPath && effectiveIntent !== 'arrival_date_answer' && effectiveIntent !== 'callback_time_answer' && effectiveIntent !== 'call_time_answer') {
        try {
          const { parseDeterministicSuggestion } = require('../../utils/date-parser');
          const parsedSugg = parseDeterministicSuggestion(text, new Date(), null, null);
          if (parsedSugg.suggested_date && parsedSugg.suggested_time && parsedSugg.proposed_date) {
            const db = withTenantDB(tenantId);
            // Fetch existing metadata to preserve other fields
            const conv = await db.executeSafe({
              text: `SELECT metadata FROM conversations WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
              values: [conversationId, tenantId]
            }) as any[];
            const currentMeta = conv[0]?.metadata || {};
            const updatedMeta = {
              ...currentMeta,
              last_callback_offer: {
                proposed_due_at: parsedSugg.proposed_date,
                timezone: parsedSugg.suggested_timezone_basis || 'Europe/Istanbul',
                source: 'bot_callback_offer',
                offered_at: new Date().toISOString()
              }
            };
            await db.executeSafe({
              text: `UPDATE conversations SET metadata = $1 WHERE id = $2 AND tenant_id = $3`,
              values: [JSON.stringify(updatedMeta), conversationId, tenantId]
            });
          }
        } catch (err) {
          console.error('[AIResponseOrchestrator] Failed to save last_callback_offer metadata:', err);
        }
      }

      if (conversationId) {
        console.log(JSON.stringify({
          tag: "AI_RESPONSE_ORCHESTRATOR_COMPLETED",
          tenantId,
          conversationId,
          workerPath,
          responseDedupeKey,
          latencyMs: Date.now() - startTime
        }));
      }

      return buildResult({
        text,
        modelUsed,
        promptVersion: brain.prompts.metadata?.version,
        latencyMs: Date.now() - startTime,
        bypassed,
        isRetry: false,
        qualityGateFailed: !qualityGateValid,
        qualityGateReason: qualityGateReason || undefined,
        inputTokens,
        outputTokens,
        responseDedupeKey: responseDedupeKey || undefined,
        burstAnchorId: burstAnchorId || undefined,
        replyLanguage,
      });

    } finally {
      // ────────────────────────────────────────────────────────
      // 3. RELEASE PROCESSING LOCKS
      // ────────────────────────────────────────────────────────
      if (conversationId && responseDedupeKey) {
        if (sandbox) {
          const activeLock = AIResponseOrchestrator.sandboxLockStore.get(responseDedupeKey);
          if (activeLock && activeLock.token === lockToken) {
            AIResponseOrchestrator.sandboxLockStore.delete(responseDedupeKey);
          }
        } else {
          const db = withTenantDB(tenantId);
          
          if (isRedisLockAcquired) {
            try {
              const { redis } = await import('@/lib/redis');
              if (redis) {
                const oldChannelId = resolvedChannelId || params.channel || 'unknown';
                const oldLockKey = `dedupe:response:${tenantId}:${oldChannelId}:${conversationId}:${burstAnchorId}:processing`;
                const newLockKey = `${responseDedupeKey}:processing`;

                const releaseScript = `
                  if redis.call("get", KEYS[1]) == ARGV[1] then
                    return redis.call("del", KEYS[1])
                  else
                    return 0
                  end
                `;
                await Promise.all([
                  redis.eval(releaseScript, [oldLockKey], [lockToken]),
                  redis.eval(releaseScript, [newLockKey], [lockToken])
                ]);
              }
            } catch (redisErr) {
              console.error('[AIResponseOrchestrator] Redis unlock failed:', redisErr);
            }
          }
          
          if (isDbLockAcquired) {
            try {
              await db.executeSafe({
                text: `UPDATE conversations 
                       SET metadata = COALESCE(metadata, '{}'::jsonb) - 'processing_locked_at' - 'response_dedupe_key'
                       WHERE id = $1 AND tenant_id = $2`,
                values: [conversationId, tenantId]
              });
            } catch (dbErr) {
              console.error('[AIResponseOrchestrator] DB unlock failed:', dbErr);
            }
          }
        }
      }
    }
  }
}

function hasRelativeOrPeriodKeywords(text: string): boolean {
  const { MultilingualTimeIntentResolver } = require('./multilingual-time-intent-resolver');
  const res = MultilingualTimeIntentResolver.resolve(text);
  return res.hasRelativeDate || res.hasDaypart;
}

function buildRelativeDaypartClarification(
  inboundText: string,
  country: string | null,
  convMeta: any,
  unifiedContext: any,
  tenantTz: string = 'Europe/Istanbul',
  replyLanguage?: string,
  tenantDefaultLang?: string
): string {
  const { MultilingualTimeIntentResolver } = require('./multilingual-time-intent-resolver');
  const timeIntentRes = MultilingualTimeIntentResolver.resolve(inboundText);

  // Fallback hierarchy:
  // 1. Detected language from the latest message
  // 2. Conversation/channel reply language
  // 3. Tenant default language
  // 4. System safe default ('en')
  let langCandidate = 'en';
  if (timeIntentRes.detectedLanguageHint && timeIntentRes.detectedLanguageHint !== 'unknown') {
    langCandidate = timeIntentRes.detectedLanguageHint;
  } else if (replyLanguage) {
    langCandidate = replyLanguage;
  } else if (tenantDefaultLang) {
    langCandidate = tenantDefaultLang;
  }

  // Ensure the resolved language is supported, otherwise fallback to 'en'
  const supportedLangs = ['tr', 'en', 'de', 'ar', 'nl'];
  const lang = supportedLangs.includes(langCandidate) ? langCandidate : 'en';

  // 1. Resolve daypart label
  let requestedDaypart = '';
  const daypartLabels: Record<string, Record<string, string>> = {
    morning: { tr: 'sabah', en: 'morning', de: 'Morgen', ar: 'صباحاً', nl: 'ochtend' },
    afternoon: { tr: 'öğle', en: 'afternoon', de: 'Nachmittag', ar: 'بعد الظهر', nl: 'middag' },
    evening: { tr: 'akşam', en: 'evening', de: 'Abend', ar: 'مساءً', nl: 'avond' },
    night: { tr: 'gece', en: 'night', de: 'Nacht', ar: 'ليلاً', nl: 'nacht' }
  };
  if (timeIntentRes.hasDaypart && timeIntentRes.daypart !== 'unknown') {
    requestedDaypart = daypartLabels[timeIntentRes.daypart][lang] || '';
  }

  // 2. Resolve weekday/day label
  const weekdaysMap: { [key: string]: number } = {
    pazartesi: 1, salı: 2, sali: 2, çarşamba: 3, carsamba: 3,
    perşembe: 4, persembe: 4, cuma: 5, cumartesi: 6, pazar: 0,
    monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6, sunday: 0,
    montag: 1, dienstag: 2, mittwoch: 3, donnerstag: 4, freitag: 5, samstag: 6, sonntag: 0,
    maandag: 1, dinsdag: 2, woensdag: 3, donderdag: 4, vrijdag: 5, zaterdag: 6, zondag: 0,
    الاثنين: 1, الثلاثاء: 2, الاربعاء: 3, الخميس: 4, الجمعة: 5, السبت: 6, الاحد: 0
  };

  const clean = MultilingualTimeIntentResolver.normalize(inboundText);
  let matchedWeekday: string | null = null;
  for (const dayName of Object.keys(weekdaysMap)) {
    if (new RegExp(`\\b${dayName}\\b`, 'i').test(clean) || clean.includes(dayName)) {
      matchedWeekday = dayName;
      break;
    }
  }

  const getTzDate = (d: Date, zone: string) => {
    try {
      const utc = d.getTime() + d.getTimezoneOffset() * 60000;
      const formatter = new Intl.DateTimeFormat('en-US', { timeZone: zone, hour12: false, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' });
      const parts = formatter.formatToParts(new Date(utc));
      const map = new Map(parts.map(p => [p.type, p.value]));
      return new Date(Date.UTC(
        parseInt(map.get('year')!, 10),
        parseInt(map.get('month')!, 10) - 1,
        parseInt(map.get('day')!, 10),
        parseInt(map.get('hour')!, 10),
        parseInt(map.get('minute')!, 10),
        parseInt(map.get('second')!, 10)
      ));
    } catch {
      const trTime = d.getTime() + 3 * 3600000;
      return new Date(trTime);
    }
  };

  const nowTenant = getTzDate(new Date(), tenantTz);
  const currentTrDay = nowTenant.getUTCDay();

  let targetDayOfWeek = currentTrDay;

  const dayLabels: Record<string, Record<string, string>> = {
    today: { tr: 'Bugün', en: 'Today', de: 'Heute', ar: 'اليوم', nl: 'Vandaag' },
    tomorrow: { tr: 'Yarın', en: 'Tomorrow', de: 'Morgen', ar: 'غداً', nl: 'Morgen' }
  };

  let targetDayLabel = dayLabels.today[lang];

  if (timeIntentRes.relativeDateType === 'today') {
    targetDayOfWeek = currentTrDay;
    targetDayLabel = dayLabels.today[lang];
  } else if (timeIntentRes.relativeDateType === 'tomorrow') {
    targetDayOfWeek = (currentTrDay + 1) % 7;
    targetDayLabel = dayLabels.tomorrow[lang];
  } else if (matchedWeekday) {
    targetDayOfWeek = weekdaysMap[matchedWeekday];
    targetDayLabel = matchedWeekday.charAt(0).toUpperCase() + matchedWeekday.slice(1);
  } else {
    targetDayOfWeek = currentTrDay;
    targetDayLabel = dayLabels.today[lang];
  }

  const isPastWorkingHours = nowTenant.getUTCHours() >= 21;
  const isSunday = targetDayOfWeek === 0;

  // Sunday rule: counselors offline, suggest Monday
  if (isSunday || (timeIntentRes.relativeDateType === 'today' && currentTrDay === 0) || (timeIntentRes.relativeDateType === 'tomorrow' && currentTrDay === 6 && isPastWorkingHours)) {
    if (lang === 'tr') {
      const daypartSuffix = requestedDaypart ? ` ${requestedDaypart}ı` : '';
      const isToday = targetDayLabel.toLowerCase() === dayLabels.today[lang].toLowerCase();
      const isTomorrow = targetDayLabel.toLowerCase() === dayLabels.tomorrow[lang].toLowerCase();
      const dayLabelToUse = (isToday || isTomorrow) ? (isToday ? dayLabels.today[lang] : dayLabels.tomorrow[lang]) : `${targetDayLabel} günü`;
      return `${dayLabelToUse} için uygunluk net olmayabilir. Pazartesi${daypartSuffix} için uygun olduğunuz saat aralığını yazarsanız görüşme talebinizi hasta danışmanımıza iletilmesi için not alıyorum 🙏`;
    } else if (lang === 'en') {
      const daypartStr = requestedDaypart ? ` ${requestedDaypart}` : '';
      const dayLabelToUse = timeIntentRes.relativeDateType === 'today' ? 'Today' : (timeIntentRes.relativeDateType === 'tomorrow' ? 'Tomorrow' : targetDayLabel);
      return `${dayLabelToUse} might not be available. Please write your preferred time range on Monday${daypartStr} so I can note your call request for our patient advisor 🙏`;
    } else if (lang === 'de') {
      const daypartStr = requestedDaypart ? ` ${requestedDaypart}` : '';
      const dayLabelToUse = timeIntentRes.relativeDateType === 'today' ? 'Heute' : (timeIntentRes.relativeDateType === 'tomorrow' ? 'Morgen' : targetDayLabel);
      return `Die Verfügbarkeit für ${dayLabelToUse} ist möglicherweise nicht gewährleistet. Bitte teilen Sie uns Ihre bevorzugte Uhrzeit für Montag${daypartStr} mit, damit ich Ihre Gesprächsanfrage für unseren Patientenberater notieren kann 🙏`;
    } else if (lang === 'ar') {
      const daypartStr = requestedDaypart ? ` ${requestedDaypart}` : '';
      const dayLabelToUse = timeIntentRes.relativeDateType === 'today' ? 'اليوم' : (timeIntentRes.relativeDateType === 'tomorrow' ? 'غداً' : targetDayLabel);
      return `قد لا تكون المواعيد متاحة في ${dayLabelToUse}. يرجى كتابة الفترة الزمنية المناسبة لك يوم الاثنين${daypartStr} لتسجيل طلب الاتصال لمستشار المرضى لدينا 🙏`;
    } else { // nl
      const daypartStr = requestedDaypart ? ` ${requestedDaypart}` : '';
      const dayLabelToUse = timeIntentRes.relativeDateType === 'today' ? 'Vandaag' : (timeIntentRes.relativeDateType === 'tomorrow' ? 'Morgen' : targetDayLabel);
      return `Beschikbaarheid voor ${dayLabelToUse} is mogelijk niet gegarandeerd. Gelieve uw gewenste tijdsbereik voor maandag${daypartStr} door te geven, zodat ik uw oproepverzoek kan noteren voor onze patiëntadviseur 🙏`;
    }
  }

  // If requested today but working hours are already over
  if (timeIntentRes.relativeDateType === 'today' && isPastWorkingHours) {
    if (lang === 'tr') {
      const daypartSuffix = requestedDaypart ? ` ${requestedDaypart}ı` : '';
      if (currentTrDay === 5) {
        return `Bugün için çalışma saatlerimiz sona ermiştir. Yarın${daypartSuffix} için uygun olduğunuz saat aralığını yazarsanız görüşme talebinizi hasta danışmanımıza iletilmesi için not alıyorum 🙏`;
      } else if (currentTrDay === 6) {
        return `Bugün için çalışma saatlerimiz sona ermiştir. Pazartesi${daypartSuffix} için uygun olduğunuz saat aralığını yazarsanız görüşme talebinizi hasta danışmanımıza iletilmesi için not alıyorum 🙏`;
      } else {
        return `Bugün için çalışma saatlerimiz sona ermiştir. Yarın${daypartSuffix} için uygun olduğunuz saat aralığını yazarsanız görüşme talebinizi hasta danışmanımıza iletilmesi için not alıyorum 🙏`;
      }
    } else if (lang === 'en') {
      const daypartStr = requestedDaypart ? ` ${requestedDaypart}` : '';
      const nextDay = currentTrDay === 5 ? 'tomorrow' : (currentTrDay === 6 ? 'Monday' : 'tomorrow');
      return `Our working hours for today have ended. Please write your preferred time range for ${nextDay}${daypartStr} so I can note your call request for our patient advisor 🙏`;
    } else if (lang === 'de') {
      const daypartStr = requestedDaypart ? ` ${requestedDaypart}` : '';
      const nextDay = currentTrDay === 5 ? 'morgen' : (currentTrDay === 6 ? 'Montag' : 'morgen');
      return `Unsere Arbeitszeiten für heute sind beendet. Bitte teilen Sie uns Ihre bevorzugte Uhrzeit für ${nextDay}${daypartStr} mit, damit ich Ihre Gesprächsanfrage für unseren Patientenberater notieren kann 🙏`;
    } else if (lang === 'ar') {
      const daypartStr = requestedDaypart ? ` ${requestedDaypart}` : '';
      const nextDay = currentTrDay === 5 ? 'غداً' : (currentTrDay === 6 ? 'يوم الاثنين' : 'غداً');
      return `انتهت ساعات العمل اليوم. يرجى كتابة الفترة الزمنية المناسبة لك ${nextDay}${daypartStr} لتسجيل طلب الاتصال لمستشار المرضى لدينا 🙏`;
    } else { // nl
      const daypartStr = requestedDaypart ? ` ${requestedDaypart}` : '';
      const nextDay = currentTrDay === 5 ? 'morgen' : (currentTrDay === 6 ? 'maandag' : 'morgen');
      return `Onze werkuren voor vandaag zijn beëindigd. Gelieve uw gewenste tijdsbereik voor ${nextDay}${daypartStr} door te geven, zodat ik uw oproepverzoek kan noteren voor onze patiëntadviseur 🙏`;
    }
  }

  // Valid day/time requested, ask for specific hour range
  const { resolvePatientTimezone } = require('../../utils/timezone');
  const tzRes = resolvePatientTimezone(country);
  const isDifferentTimezone = tzRes.timezone && tzRes.timezone !== tenantTz;

  const daypartSuffix = requestedDaypart ? ` ${requestedDaypart}` : '';

  // Confirm phrases
  const confirmPhrases: Record<string, string> = {
    tr: `${targetDayLabel}${daypartSuffix} için görüşme talebinizi not alabilirim.`,
    en: `I can note your call request for ${targetDayLabel}${daypartSuffix}.`,
    de: `Ich kann Ihre Gesprächsanfrage für ${targetDayLabel}${daypartSuffix} notieren.`,
    ar: `يمكنني تسجيل طلب الاتصال بك في ${targetDayLabel}${daypartSuffix}.`,
    nl: `Ik kan uw oproepverzoek voor ${targetDayLabel}${daypartSuffix} noteren.`
  };
  const confirmPhrase = confirmPhrases[lang] || confirmPhrases.en;

  if (isDifferentTimezone) {
    const countryTranslations: Record<string, Record<string, string>> = {
      tr: { Germany: 'Almanya', Deutschland: 'Almanya', Netherlands: 'Hollanda', Holland: 'Hollanda', 'United Kingdom': 'İngiltere', France: 'Fransa', Belgium: 'Belçika', Switzerland: 'İsviçre', Denmark: 'Danimarka', Sweden: 'İsveç' },
      en: { Almanya: 'Germany', Deutschland: 'Germany', Hollanda: 'Netherlands', Holland: 'Netherlands', 'United Kingdom': 'UK', Fransa: 'France', Belçika: 'Belgium', İsviçre: 'Switzerland', Danimarka: 'Denmark', İsveç: 'Sweden' },
      de: { Germany: 'Deutschland', Almanya: 'Deutschland', Hollanda: 'Niederlande', Netherlands: 'Niederlande', 'United Kingdom': 'UK', Fransa: 'Frankreich', Belçika: 'Belgien', İsviçre: 'Schweiz', Danimarka: 'Dänemark', İsveç: 'Schweden' },
      nl: { Germany: 'Duitsland', Almanya: 'Duitsland', Hollanda: 'Nederland', Netherlands: 'Nederland', 'United Kingdom': 'VK', Fransa: 'Frankrijk', Belçika: 'België', İsviçre: 'Zwitserland', Danimarka: 'Denemarken', İsveç: 'Zweden' },
      ar: { Germany: 'ألمانيا', Almanya: 'ألمانيا', Hollanda: 'هولندا', Netherlands: 'هولندا', 'United Kingdom': 'بريطانيا', Fransa: 'فرنسا', Belçika: 'بلجيكا', İsviçre: 'سويسرا', Danimarka: 'الدانمارك', İsveç: 'السويد' }
    };

    const patientCountryName = country ? (countryTranslations[lang]?.[country] || (lang === 'tr' ? country : null) || countryTranslations.en[country] || country) : '';

    const clinicTzTranslations: Record<string, Record<string, string>> = {
      'Europe/Istanbul': { tr: 'Türkiye', en: 'Turkey', de: 'Türkei', ar: 'تركيا', nl: 'Turkije' },
      'Europe/Berlin': { tr: 'Almanya', en: 'Germany', de: 'Deutschland', ar: 'ألمانيا', nl: 'Duitsland' },
      'Europe/Amsterdam': { tr: 'Hollanda', en: 'Netherlands', de: 'Niederlande', ar: 'هولندا', nl: 'Nederland' },
      'Europe/London': { tr: 'İngiltere', en: 'UK', de: 'Vereinigtes Königreich', ar: 'بريطانيا', nl: 'VK' }
    };
    const clinicTimezoneName = clinicTzTranslations[tenantTz]?.[lang] || (tenantTz.split('/')[1] || 'clinic');

    if (lang === 'tr') {
      return `${confirmPhrase} Saat aralığını ${patientCountryName} saatinize göre mi, Türkiye saatine göre mi paylaşmak istersiniz? Örneğin 18:00–20:00 gibi net bir aralık yazarsanız hasta danışmanımıza iletilmesi için not alıyorum 🙏`;
    } else if (lang === 'en') {
      return `${confirmPhrase} Would you like the time range to be in your ${patientCountryName} time or ${clinicTimezoneName} time? For example, if you write a clear range like 18:00–20:00, I will note it for our patient advisor 🙏`;
    } else if (lang === 'de') {
      return `${confirmPhrase} Möchten Sie den Zeitraum in Ihrer ${patientCountryName}-Zeit oder in der ${clinicTimezoneName}-Zeit angeben? Wenn Sie beispielsweise einen klaren Bereich wie 18:00–20:00 schreiben, werde ich dies für unseren Patientenberater notieren 🙏`;
    } else if (lang === 'ar') {
      return `${confirmPhrase} هل ترغب في أن تكون الفترة الزمنية بتوقيت ${patientCountryName} أم بتوقيت ${clinicTimezoneName}؟ على سبيل المثال، إذا كتبت فترة محددة مثل 18:00-20:00، سأسجل ذلك لمستشار المرضى لدينا 🙏`;
    } else { // nl
      return `${confirmPhrase} Wilt u dat het tijdsbereik in uw ${patientCountryName}-tijd of in de ${clinicTimezoneName}-tijd is? Als u bijvoorbeeld een duidelijk bereik zoals 18:00–20:00 schrijft, zal ik dit noteren voor onze patiëntadviseur 🙏`;
    }
  } else {
    if (lang === 'tr') {
      return `${confirmPhrase} Örneğin 18:00–20:00 gibi net bir saat aralığı belirtebilir misiniz? Görüşme talebinizi bu saat aralığıyla birlikte hasta danışmanımıza iletilmesi için not alıyorum 🙏`;
    } else if (lang === 'en') {
      return `${confirmPhrase} Could you please specify a clear time range, such as 18:00–20:00? I will note your call request with this range for our patient advisor 🙏`;
    } else if (lang === 'de') {
      return `${confirmPhrase} Könnten Sie bitte einen genauen Zeitraum angeben, z. B. 18:00–20:00? Ich werde Ihre Gesprächsanfrage mit diesem Bereich für unseren Patientenberater notieren 🙏`;
    } else if (lang === 'ar') {
      return `${confirmPhrase} هل يمكنك تحديد فترة زمنية واضحة، مثل 18:00-20:00؟ سأسجل طلب الاتصال بك مع هذه الفترة لمستشار المرضى لدينا 🙏`;
    } else { // nl
      return `${confirmPhrase} Zou u een duidelijk tijdsbereik kunnen opgeven, zoals 18:00–20:00? Ik noteer uw oproepverzoek met dit bereik voor onze patiëntadviseur 🙏`;
    }
  }
}
