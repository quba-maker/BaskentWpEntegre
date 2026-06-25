/**
 * P0.16-K: DoctorNamesPolicy
 *
 * Handles doctor name requests with a 3-tier policy:
 *   1. first_soft   — first time asking → soft localized answer
 *   2. verified_list — tenant has verified doctor directory → share it
 *   3. unavailable   — insistent, no verified list → honest unavailable, no fabrication
 *
 * RULES:
 * - Never hardcode doctor names
 * - Never fabricate doctor names
 * - Names only from verified tenant config/directory
 * - Fully localized for TR, EN, DE, NL, and AR
 * - Outputs clean paragraphs instead of numbered lists
 */

import type { TenantBrain } from '../../brain/tenant-brain';
import { DoctorDirectoryResolver } from './doctor-directory-resolver';

export type DoctorPolicyMode = 'first_soft' | 'verified_list' | 'unavailable';

export interface DoctorNamesPolicyResult {
  mode: DoctorPolicyMode;
  text: string;
  departments: string[];
}

function formatDeptsList(depts: string[], lang: string): string {
  const conj = lang === 'ar' ? ' و ' : lang === 'de' ? ' und ' : lang === 'nl' ? ' en ' : lang === 'en' ? ' and ' : ' ve ';
  if (depts.length === 0) return '';
  if (depts.length === 1) return depts[0];
  return depts.slice(0, -1).join(', ') + conj + depts[depts.length - 1];
}

function normalizeDoctorAskText(text: string): string {
  return (text || '')
    .toLocaleLowerCase('tr-TR')
    .replace(/\u0307/g, '')
    .replace(/ğ/g, 'g').replace(/ü/g, 'u')
    .replace(/ş/g, 's').replace(/ı/g, 'i')
    .replace(/ö/g, 'o').replace(/ç/g, 'c')
    .replace(/[’`´]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

export function isDoctorNameRequestText(text: string, hasPriorDoctorAsk = false): boolean {
  const clean = normalizeDoctorAskText(text);
  if (!clean) return false;

  const directPatterns = [
    /\b(?:doktor|doktorunuz|doktorunuzun|doktorunun|doktorlar|doktorlariniz|doktorlarinizin|doktorlarınız|doktorlarınızın|hekim|hekiminiz|hekiminizin|hekimler|hekimleriniz|hekimlerinizin|uzman|uzmaniniz|uzmaninizin|uzmanınız|uzmanınızın|uzmanlar|hoca|hocanin|hocanın|hocaniz|hocanız|hocanizin|hocanızın|kadro|kadronuz|kadronuzun)\b.{0,70}\b(?:isim|ismi|ismini|isimleri|ad|adi|adini|adlari|kim|kimler|liste|listesi)\b/,
    /\b(?:isim|ismi|ismini|isimleri|ad|adi|adini|adlari)\b.{0,70}\b(?:doktor|doktorunuz|doktorunuzun|doktorlar|hekim|hekimler|uzman|uzmanlar|hoca|hocalar)\b/,
    /\b(?:doktor|hekim|uzman|hoca)\w*\s+(?:ad[ıi]|adi|ismi)\s+(?:ne|nedir|kim)\b/,
    /\b(?:ad[ıi]|adi|ismi)\s+ne\s+(?:doktorun|doktorunuzun|hocan[ıi]n|hocanizin|hocanızın)?\b/,
    /\b(?:doktor|doktorlar|hekim|hekimler|uzman|uzmanlar|hoca|hocalar)\b.{0,50}\b(?:var|vardir|vardır|bulunuyor|calisiyor|çalışıyor)\b/,
    /\b(?:isim|ismi|ismini|isimleri|ad|adi|adini|adlari)\b.{0,70}\b(?:ogren|oren|arastir|bak|ver|paylas|soyle|istiyorum)\b/,
    /\b(?:isim|ad|adi|ad[ıi])\s+(?:soyle|söyle|ver|paylas|paylaş)\b/,
    /\bhangi\s+(?:doktor|hekim|uzman|hoca)\b/,
    /\b(?:doktor|hekim|uzman|hoca)\s+kadrosu\b/,
    /\bkimler\s+var\b/,
  ];

  if (directPatterns.some(pattern => pattern.test(clean))) return true;

  if (hasPriorDoctorAsk) {
    return /\b(?:arastiracam|arastiracagim|bakacagim|isim|ad|liste|kadronuz|hocanin)\b/.test(clean);
  }

  return false;
}

const DOCTOR_QUALITY_WORDS = /\b(?:nasil|nasıl|iyi\s+mi|guvenilir|güvenilir|tecrube|tecrübe|yorum|onerir|önerir|emin|basarili|başarılı|hakkinda|hakkında)\b/;

function doctorSearchTokens(name: string): string[] {
  return normalizeDoctorAskText(name)
    .replace(/\b(?:prof|doc|doç|dr|uzm|op|ogr|gör|gor)\b/g, ' ')
    .split(/\s+/)
    .map(t => t.trim())
    .filter(t => t.length >= 3);
}

export function isDoctorProfileQuestionText(text: string, doctors: { name: string; department: string }[] = []): boolean {
  const clean = normalizeDoctorAskText(text);
  if (!clean) return false;
  const hasDoctorWord = /\b(?:doktor|hekim|uzman|hoca|hocamiz|hocamız)\b/.test(clean);
  const hasQualityWord = DOCTOR_QUALITY_WORDS.test(clean);
  const mentionsKnownDoctor = doctors.some(doc => doctorSearchTokens(doc.name).some(token => clean.includes(token)));
  return hasQualityWord && (hasDoctorWord || mentionsKnownDoctor);
}

export class DoctorNamesPolicy {
  public static resolveDoctorProfile(
    brain: TenantBrain,
    text: string,
    departments: string[],
    lang = 'tr'
  ): DoctorNamesPolicyResult | null {
    const activeDepts = departments.filter(Boolean);
    const scopedDoctors = activeDepts.length > 0
      ? activeDepts.flatMap(dept => DoctorDirectoryResolver.getDoctors(brain, dept))
      : DoctorDirectoryResolver.getDoctors(brain);
    const allDoctors = DoctorDirectoryResolver.getDoctors(brain);
    const doctors = scopedDoctors.length > 0 ? scopedDoctors : allDoctors;
    const clean = normalizeDoctorAskText(text);
    // If the patient names a doctor ("Ufuk hoca nasıl?"), search the whole
    // verified directory first. The active department can be stale or from a
    // previous topic, and blocking the known-name lookup erodes trust.
    const matched = (allDoctors.length > 0 ? allDoctors : doctors)
      .find(doc => doctorSearchTokens(doc.name).some(token => clean.includes(token)));
    if (!matched && !isDoctorProfileQuestionText(text, doctors)) return null;

    const resolvedLang = (lang || 'tr').toLowerCase();
    const doctorLabel = matched?.name || null;
    const deptLabel = matched?.department || (activeDepts[0] || 'ilgili bölüm');
    let responseText: string;

    if (resolvedLang === 'en') {
      responseText = doctorLabel
        ? `${doctorLabel} works in our ${deptLabel} department. I cannot make a personal comparison or subjective evaluation about a physician here, but I can help with appointment planning and the process.`
        : `I cannot make a personal comparison or subjective evaluation about a physician here, but I can help with appointment planning and the process.`;
    } else if (resolvedLang === 'de') {
      responseText = doctorLabel
        ? `${doctorLabel} ist in unserer Abteilung ${deptLabel} tätig. Eine persönliche Bewertung oder ein Vergleich von Ärzten wäre hier nicht richtig; ich kann aber beim Terminablauf und bei der Planung helfen.`
        : `Eine persönliche Bewertung oder ein Vergleich von Ärzten wäre hier nicht richtig; ich kann aber beim Terminablauf und bei der Planung helfen.`;
    } else if (resolvedLang === 'nl') {
      responseText = doctorLabel
        ? `${doctorLabel} werkt op onze afdeling ${deptLabel}. Ik kan hier geen persoonlijke beoordeling of vergelijking van artsen geven, maar ik kan wel helpen met de afspraakplanning en het proces.`
        : `Ik kan hier geen persoonlijke beoordeling of vergelijking van artsen geven, maar ik kan wel helpen met de afspraakplanning en het proces.`;
    } else if (resolvedLang === 'ar') {
      responseText = doctorLabel
        ? `${doctorLabel} يعمل/تعمل في قسم ${deptLabel}. لا يمكنني تقديم تقييم شخصي أو مقارنة بين الأطباء هنا، لكن يمكنني مساعدتكم في خطوات الموعد والتخطيط.`
        : `لا يمكنني تقديم تقييم شخصي أو مقارنة بين الأطباء هنا، لكن يمكنني مساعدتكم في خطوات الموعد والتخطيط.`;
    } else {
      responseText = doctorLabel
        ? `${doctorLabel}, ${deptLabel} bölümümüzde görev yapmaktadır. Hekimlerimiz hakkında kişisel yorum veya başarı kıyaslaması yapmam doğru olmaz; ancak muayene/randevu sürecini netleştirmede yardımcı olabilirim.`
        : `Hekimlerimiz hakkında kişisel yorum veya başarı kıyaslaması yapmam doğru olmaz; ancak muayene/randevu sürecini netleştirmede yardımcı olabilirim.`;
    }

    return {
      mode: matched ? 'verified_list' : 'first_soft',
      text: responseText,
      departments: activeDepts
    };
  }

  /**
   * Generates a response for a doctor name request.
   *
   * @param brain        Tenant brain (for verified doctor directory)
   * @param departments  List of relevant departments
   * @param isRepeat     True if user has already asked once in this conversation
   * @param lang         Response language (tr, en, de, nl, ar)
   */
  public static resolve(
    brain: TenantBrain,
    departments: string[],
    isRepeat: boolean,
    lang = 'tr'
  ): DoctorNamesPolicyResult {
    const activeDepts = departments.filter(Boolean);
    const resolvedLang = (lang || 'tr').toLowerCase();

    // Collect verified doctors per department
    const perDept: { dept: string; doctors: { name: string; department: string }[] }[] = [];
    for (const dept of activeDepts) {
      const doctors = DoctorDirectoryResolver.getDoctors(brain, dept);
      perDept.push({ dept, doctors });
    }

    const allVerified = perDept.filter(pd => pd.doctors.length > 0);
    const hasVerifiedList = allVerified.length > 0;

    let mode: DoctorPolicyMode;
    let text = '';

    if (hasVerifiedList) {
      mode = 'verified_list';
      const blocks: string[] = [];

      for (const { dept, doctors } of allVerified) {
        const nameList = doctors.map(d => `• ${d.name}`).join('\n');
        if (resolvedLang === 'ar') {
          blocks.push(`الأخصائيون المعتمدون في قسم ${dept}:\n${nameList}`);
        } else if (resolvedLang === 'de') {
          blocks.push(`Verifizierte Spezialisten in der Abteilung ${dept}:\n${nameList}`);
        } else if (resolvedLang === 'nl') {
          blocks.push(`Geverifieerde specialisten op de afdeling ${dept}:\n${nameList}`);
        } else if (resolvedLang === 'en') {
          blocks.push(`Verified specialists in the ${dept} department:\n${nameList}`);
        } else {
          blocks.push(`Bu bölüm için elimdeki doğrulanmış hekim bilgisi şu şekildedir:\n${nameList}`);
        }
      }

      // Departments without verified list
      const unverified = perDept.filter(pd => pd.doctors.length === 0);
      for (const { dept } of unverified) {
        if (resolvedLang === 'ar') {
          blocks.push(`لا يمكنني الوصول إلى قائمة الأطباء المعتمدين لـ ${dept} من هذه الشاشة؛ سيقوم فريق المنسقين لدينا بتحديد الأخصائي الأنسب لكم.`);
        } else if (resolvedLang === 'de') {
          blocks.push(`Ich kann über diesen Bildschirm nicht auf die verifizierte Ärzteliste für ${dept} zugreifen; unser Koordinationsteam wird den am besten geeigneten Spezialisten klären.`);
        } else if (resolvedLang === 'nl') {
          blocks.push(`Ik heb via dit scherm geen toegang tot de geverifieerde artsenlijst voor ${dept}; ons coördinatieteam zal de meest geschikte specialist verduidelijken.`);
        } else if (resolvedLang === 'en') {
          blocks.push(`I cannot access the verified doctor list for ${dept} from this screen; our coordinator team will clarify the most suitable specialist.`);
        } else {
          blocks.push(`${dept} için doğrulanmış hekim listesine bu ekrandan ulaşamıyorum; danışman ekibimiz en uygun uzmanı netleştirir.`);
        }
      }

      if (activeDepts.length >= 2) {
        const multiPrefix = resolvedLang === 'ar' ? 'سأجيب على القسمين بشكل منفصل.\n\n'
          : resolvedLang === 'de' ? 'Ich werde für die beiden Abteilungen separat antworten.\n\n'
          : resolvedLang === 'nl' ? 'Ik zal voor de twee afdelingen afzonderlijk antwoorden.\n\n'
          : resolvedLang === 'en' ? 'I will reply separately for the two departments.\n\n'
          : 'İki bölüm için ayrı yanıtlayayım.\n\n';
        text = `${multiPrefix}${blocks.join('\n\n')}`;
      } else {
        text = blocks.join('\n\n');
      }

    } else if (!isRepeat) {
      mode = 'first_soft';
      const formattedDepts = formatDeptsList(activeDepts, resolvedLang) || (resolvedLang === 'ar' ? 'القسم المختص' : resolvedLang === 'de' ? 'die entsprechende Abteilung' : resolvedLang === 'nl' ? 'de desbetreffende afdeling' : resolvedLang === 'en' ? 'the relevant department' : 'ilgili bölüm');

      if (resolvedLang === 'ar') {
        text = `لا أرغب في إعطاء أسماء خاطئة. لدينا أخصائيون في مجال ${formattedDepts}؛ سيتم تحديد الأخصائي الأنسب لكم خلال الاستشارة.`;
      } else if (resolvedLang === 'de') {
        text = `Ich möchte keine falschen Namen nennen. Wir haben Spezialisten im Bereich ${formattedDepts}; der am besten geeignete Spezialist wird während des Beratungsgesprächs geklärt.`;
      } else if (resolvedLang === 'nl') {
        text = `Ik wil geen verkeerde namen doorgeven. We hebben specialisten op het gebied van ${formattedDepts}; de meest geschikte specialist wordt tijdens het consult verduidelijkt.`;
      } else if (resolvedLang === 'en') {
        text = `I wouldn't want to provide incorrect names. We have specialists in the field of ${formattedDepts}; the most suitable specialist will be clarified during the consultation.`;
      } else {
        text = `Bu konuda isimleri yanlış vermek istemem. ${formattedDepts} alanında uzman hekimlerimiz bulunuyor; görüşme sırasında en uygun uzman bilgisi netleştirilecektir.`;
      }

    } else {
      mode = 'unavailable';
      const formattedDepts = formatDeptsList(activeDepts, resolvedLang) || (resolvedLang === 'ar' ? 'القسم المختص' : resolvedLang === 'de' ? 'die entsprechende Abteilung' : resolvedLang === 'nl' ? 'de desbetreffende afdeling' : resolvedLang === 'en' ? 'the relevant department' : 'ilgili bölüm');

      if (resolvedLang === 'ar') {
        text = `لدينا أطباء يعملون في مجال ${formattedDepts}، ولكن لا يمكنني تحديد الأنسب لكم من هنا في الوقت الحالي. سيقوم منسق المرضى لدينا بمشاركة هذه المعلومات معكم مباشرة خلال الاستشارة.`;
      } else if (resolvedLang === 'de') {
        text = `Wir haben Ärzte, die im Bereich ${formattedDepts} tätig sind, aber ich kann von hier aus im Moment nicht klären, wer am besten für Sie geeignet ist. Unser Patientenberater wird diese Informationen während des Beratungsgesprächs direkt mit Ihnen teilen.`;
      } else if (resolvedLang === 'nl') {
        text = `We hebben artsen die werkzaam zijn op het gebied van ${formattedDepts}, maar ik kan van hieruit op dit moment niet verduidelijken wie het meest geschikt voor u is. Onze patiëntencoördinator zal deze informatie tijdens het consult rechtstreeks met u delen.`;
      } else if (resolvedLang === 'en') {
        text = `We have doctors working in the field of ${formattedDepts}, but I cannot clarify from here who is most suitable for you at the moment. Our patient coordinator will share this information directly with you during the consultation.`;
      } else {
        text = `${formattedDepts} alanında çalışan hekimlerimiz var, ancak kimin size en uygun olduğunu şu an buradan netleştiremiyorum. Görüşme sırasında hasta danışmanımız bu bilgiyi doğrudan sizinle paylaşacaktır.`;
      }
    }

    try {
      console.log(JSON.stringify({
        tag: 'DOCTOR_NAMES_POLICY_APPLIED',
        mode,
        departmentCount: activeDepts.length,
        departments: activeDepts,
        hasVerifiedList,
        isRepeat,
        lang: resolvedLang
      }));
    } catch { /* non-fatal */ }

    return { mode, text, departments: activeDepts };
  }
}
