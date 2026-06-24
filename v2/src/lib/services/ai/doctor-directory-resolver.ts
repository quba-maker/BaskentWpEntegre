import { TenantBrain } from '../../brain/tenant-brain';

export interface Doctor {
  name: string;
  department: string;
}

export class DoctorDirectoryResolver {
  private static readonly DOCTOR_LINE_PATTERN = /\b(?:prof\.?|doç\.?|doc\.?|op\.?|uzm\.?|dr\.?|dt\.?|öğr\.?\s*gör\.?)\b/i;

  private static stripBullet(line: string): string {
    return line.replace(/^[*\-•]\s*/, '').trim();
  }

  private static isDoctorLine(line: string): boolean {
    return this.DOCTOR_LINE_PATTERN.test(line);
  }

  private static extractDoctorEntries(source: string): string[] {
    const entries: string[] = [];
    let currentDepartment: string | null = null;
    const lines = source.split('\n').map(line => line.trim()).filter(Boolean);

    for (const line of lines) {
      const withoutBullet = this.stripBullet(line);
      const isBullet = /^[*\-•]\s*/.test(line);
      const isHeading = /:$/.test(line) && !this.isDoctorLine(line);

      if (isHeading) {
        currentDepartment = line.replace(/:$/, '').trim();
        continue;
      }

      if (!this.isDoctorLine(withoutBullet)) {
        if (!isBullet && currentDepartment && !/:$/.test(line)) {
          currentDepartment = null;
        }
        continue;
      }

      if (/\s+-\s+/.test(withoutBullet)) {
        entries.push(withoutBullet);
      } else if (currentDepartment) {
        entries.push(`${withoutBullet} - ${currentDepartment}`);
      } else {
        entries.push(withoutBullet);
      }
    }

    return entries;
  }

  /**
   * Resolves the list of verified doctors for a specific department.
   * If department is not specified, returns all verified doctors.
   * Returns empty array if no directory exists.
   */
  public static getDoctors(brain: TenantBrain, department?: string): Doctor[] {
    const doctorDirectory = brain.context.config?.doctors || brain.context.config?.doctorDirectory || brain.context.config?.doctor_directory;
    
    let rawList: string[] = [];
    if (doctorDirectory) {
      if (Array.isArray(doctorDirectory)) {
        rawList = doctorDirectory.flatMap(d => this.extractDoctorEntries(String(d)));
      } else if (typeof doctorDirectory === 'string') {
        rawList = this.extractDoctorEntries(doctorDirectory);
      }
    }

    // Fallback: Parse from system prompt if DB config is empty
    if (rawList.length === 0 && brain.prompts?.systemPrompt) {
      const promptText = brain.prompts.systemPrompt;
      const verifiedListIndex = promptText.indexOf('Verified Hekim Listesi:');
      if (verifiedListIndex !== -1) {
        const block = promptText.substring(verifiedListIndex + 'Verified Hekim Listesi:'.length);
        rawList = this.extractDoctorEntries(block);
      } else {
        rawList = this.extractDoctorEntries(promptText);
      }
    }

    const doctors: Doctor[] = [];
    for (const line of rawList) {
      // Parse doctor entry, e.g. "Prof. Dr. Aytekin GÜVEN - Kardiyoloji" or just "Prof. Dr. Aytekin GÜVEN"
      const parts = line.split('-').map(p => p.trim());
      const name = parts[0];
      const dept = parts[1] || 'Genel';
      doctors.push({ name, department: dept });
    }

    if (!department) {
      return doctors;
    }

    const cleanDept = department.toLowerCase().trim();
    
    return doctors.filter(doc => {
      const docDept = doc.department.toLowerCase();
      // Match department name or common synonyms
      if (cleanDept.includes('kardiyoloji') && docDept.includes('kardiyo')) return true;
      if (cleanDept.includes('dermatoloji') && (docDept.includes('dermatoloji') || docDept.includes('deri'))) return true;
      if (cleanDept.includes('cildiye') && (docDept.includes('dermatoloji') || docDept.includes('deri'))) return true;
      if (cleanDept.includes('plastik') && docDept.includes('plastik')) return true;
      if (cleanDept.includes('estetik') && docDept.includes('plastik')) return true;
      if (cleanDept.includes('burun') && docDept.includes('plastik')) return true;
      if (cleanDept.includes('kbb') && docDept.includes('kulak')) return true;
      if (cleanDept.includes('beyin') && docDept.includes('beyin')) return true;
      if (cleanDept.includes('fıtık') && (docDept.includes('beyin') || docDept.includes('fizik'))) return true;
      if (cleanDept.includes('fitik') && (docDept.includes('beyin') || docDept.includes('fizik'))) return true;
      if (cleanDept.includes('organ') && docDept.includes('nakil')) return true;
      if (cleanDept.includes('nakil') && docDept.includes('nakil')) return true;
      
      return docDept.includes(cleanDept) || cleanDept.includes(docDept);
    });
  }

  /**
   * Formats the doctor list as a string.
   */
  public static formatDoctors(doctors: Doctor[]): string {
    return doctors.map(doc => `${doc.name} - ${doc.department}`).join('\n');
  }
}
