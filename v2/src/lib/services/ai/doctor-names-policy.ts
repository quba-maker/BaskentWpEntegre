/**
 * P0.16-K: DoctorNamesPolicy
 *
 * Handles doctor name requests with a 3-tier policy:
 *   1. first_soft   — first time asking → soft "uzmanlarımız değerlendirme yapar" answer
 *   2. verified_list — tenant has verified doctor directory → share it
 *   3. unavailable   — insistent, no verified list → honest unavailable, no fabrication
 *
 * RULES:
 * - Never hardcode doctor names
 * - Never fabricate doctor names
 * - Never say "şu an bu ekrandan net doğrulayamıyorum" (robotic)
 * - Names only from verified tenant config/directory
 * - If two departments: give separate answer per department
 */

import type { TenantBrain } from '../../brain/tenant-brain';
import { DoctorDirectoryResolver } from './doctor-directory-resolver';

export type DoctorPolicyMode = 'first_soft' | 'verified_list' | 'unavailable';

export interface DoctorNamesPolicyResult {
  mode: DoctorPolicyMode;
  text: string;
  departments: string[];
}

export class DoctorNamesPolicy {
  /**
   * Generates a response for a doctor name request.
   *
   * @param brain        Tenant brain (for verified doctor directory)
   * @param departments  List of relevant departments (1 or 2 for multi-patient)
   * @param isRepeat     True if user has already asked once in this conversation
   */
  public static resolve(
    brain: TenantBrain,
    departments: string[],
    isRepeat: boolean
  ): DoctorNamesPolicyResult {
    const activeDepts = departments.filter(Boolean);

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
      // verified_list: share the confirmed names
      mode = 'verified_list';
      const blocks: string[] = [];

      for (const { dept, doctors } of allVerified) {
        const nameList = doctors.map(d => `• ${d.name}`).join('\n');
        blocks.push(`${dept} bölümünde sistemde doğrulanmış uzmanlar:\n${nameList}`);
      }

      // Departments without verified list
      const unverified = perDept.filter(pd => pd.doctors.length === 0);
      for (const { dept } of unverified) {
        blocks.push(`${dept} için doğrulanmış hekim listesine bu ekrandan ulaşamıyorum; danışman ekibimiz en uygun uzmanı netleştirir.`);
      }

      if (activeDepts.length >= 2) {
        text = `İki bölüm için ayrı yanıtlayayım.\n\n${blocks.join('\n\n')}`;
      } else {
        text = blocks.join('\n\n');
      }

    } else if (!isRepeat) {
      // first_soft: gentle answer, no fabrication
      mode = 'first_soft';

      if (activeDepts.length >= 2) {
        const deptLines = activeDepts.map((d, i) => `${i + 1}. ${d}`).join('\n');
        text = `Bu konuda isimleri yanlış vermek istemem.\n\n${deptLines}\n\nHer bölümde uzman hekimlerimiz bulunuyor. Görüşme sırasında hangi uzmanın size en uygun olduğu netleştirilecektir.`;
      } else {
        const dept = activeDepts[0] || 'ilgili bölüm';
        text = `Bu konuda isimleri yanlış vermek istemem. ${dept} alanında uzman hekimlerimiz bulunuyor; görüşme sırasında en uygun uzman bilgisi netleştirilecektir.`;
      }

    } else {
      // unavailable + repeat insistence — honest, natural, no mechanical phrase
      mode = 'unavailable';

      if (activeDepts.length >= 2) {
        const deptLines = activeDepts.map((d, i) => `${i + 1}. ${d}`).join('\n');
        text = `Onaylı hekim listesine şu an bu sistemden ulaşamıyorum.\n\n${deptLines}\n\nDanışman ekibimiz görüşmede her iki bölüm için de en uygun uzmanı size doğrudan iletecektir.`;
      } else {
        const dept = activeDepts[0] || 'ilgili bölüm';
        text = `Onaylı hekim listesine şu an bu sistemden ulaşamıyorum. ${dept} için görüşme sırasında en uygun uzman danışman ekibimiz tarafından size iletilecektir.`;
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
      }));
    } catch { /* non-fatal */ }

    return { mode, text, departments: activeDepts };
  }
}
