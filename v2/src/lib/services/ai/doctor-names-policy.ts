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

export class DoctorNamesPolicy {
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
          blocks.push(`${dept} bölümünde sistemde doğrulanmış uzmanlar:\n${nameList}`);
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
