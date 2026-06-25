import { TenantBrain } from '../../brain/tenant-brain';

export interface Doctor {
  name: string;
  department: string;
}

export class DoctorDirectoryResolver {
  private static readonly DOCTOR_LINE_PATTERN = /\b(?:prof\.?|doç\.?|doc\.?|op\.?|uzm\.?|dr\.?|dt\.?|öğr\.?\s*gör\.?)\b/i;
  private static readonly EXPLICIT_DIRECTORY_HEADING_PATTERN =
    /(?:(?:verified|dogrulanmis|guncel)\s+(?:hekim|doktor|bilgi)\s+(?:listesi|kadrosu|arsivi|directory)|(?:hekim|doktor)\s+(?:listesi|kadrosu|arsivi|directory))/i;
  private static readonly UNSAFE_INSTRUCTION_HEADING_PATTERN =
    /\b(?:hasta|sorarsa|kural|talimat|yasak|kullan|cevap|[öo]rnek|payla[şs]|listele)\b/i;

  private static stripBullet(line: string): string {
    return line.replace(/^[*\-•]\s*/, '').trim();
  }

  private static normalizeSearchText(text: string): string {
    return text
      .replace(/İ/g, 'I')
      .replace(/ı/g, 'i')
      .replace(/Ş/g, 'S')
      .replace(/ş/g, 's')
      .replace(/Ğ/g, 'G')
      .replace(/ğ/g, 'g')
      .replace(/Ü/g, 'U')
      .replace(/ü/g, 'u')
      .replace(/Ö/g, 'O')
      .replace(/ö/g, 'o')
      .replace(/Ç/g, 'C')
      .replace(/ç/g, 'c')
      .toLowerCase();
  }

  private static isDoctorLine(line: string): boolean {
    return this.DOCTOR_LINE_PATTERN.test(line);
  }

  private static splitInlineDoctorList(text: string): string[] {
    return text
      .split(/,\s*(?=(?:prof\.?|doç\.?|doc\.?|op\.?|uzm\.?|dr\.?|dt\.?|öğr\.?\s*gör\.?))/i)
      .map(part => part.trim())
      .filter(Boolean);
  }

  private static isUnsafeInstructionHeading(line: string): boolean {
    return this.UNSAFE_INSTRUCTION_HEADING_PATTERN.test(this.normalizeSearchText(line));
  }

  private static extractExplicitDoctorDirectoryBlocks(source: string): string[] {
    const lines = source.split('\n');
    const blocks: string[] = [];
    let collecting = false;
    let current: string[] = [];

    const flush = () => {
      if (current.length > 0) {
        blocks.push(current.join('\n'));
        current = [];
      }
    };

    for (const rawLine of lines) {
      const line = rawLine.trim();
      const normalizedLine = this.normalizeSearchText(line);
      const isDirectoryHeading = this.EXPLICIT_DIRECTORY_HEADING_PATTERN.test(normalizedLine);
      const isMajorSection = /^-{3,}.*-{3,}$/.test(line) || /^={3,}/.test(line) || /^#{1,6}\s+/.test(line);

      if (isDirectoryHeading) {
        if (collecting) flush();
        collecting = true;
        continue;
      }

      if (collecting && isMajorSection && !isDirectoryHeading) {
        flush();
        collecting = false;
        continue;
      }

      if (collecting) {
        current.push(rawLine);
      }
    }

    if (collecting) flush();
    return blocks;
  }

  private static extractDoctorEntries(source: string): string[] {
    const entries: string[] = [];
    let currentDepartment: string | null = null;
    const lines = source.split('\n').map(line => line.trim()).filter(Boolean);

    for (const line of lines) {
      const withoutBullet = this.stripBullet(line);
      const isBullet = /^[*\-•]\s*/.test(line);
      const isHeading = /:$/.test(line) && !this.isDoctorLine(line);

      const colonIndex = withoutBullet.indexOf(':');
      if (colonIndex > 0 && this.isDoctorLine(withoutBullet.slice(colonIndex + 1))) {
        const department = withoutBullet.slice(0, colonIndex).trim();
        if (!this.isUnsafeInstructionHeading(department)) {
          for (const doctor of this.splitInlineDoctorList(withoutBullet.slice(colonIndex + 1))) {
            entries.push(`${doctor} - ${department}`);
          }
        }
        continue;
      }

      if (isHeading) {
        const heading = line.replace(/:$/, '').trim();
        currentDepartment = this.isUnsafeInstructionHeading(heading) ? null : heading;
        continue;
      }

      if (this.isUnsafeInstructionHeading(withoutBullet)) {
        if (!isBullet) currentDepartment = null;
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

  private static pushUniqueEntries(target: string[], entries: string[]): void {
    const seen = new Set(target.map(item => this.normalizeSearchText(item)));
    for (const entry of entries) {
      const clean = entry.trim();
      if (!clean) continue;
      const key = this.normalizeSearchText(clean);
      if (seen.has(key)) continue;
      seen.add(key);
      target.push(clean);
    }
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

    // Fallback: parse only explicit verified doctor-directory blocks.
    // Never parse the whole prompt/rules text as a doctor directory; tenant prompts
    // often contain instructions such as "Hasta X sorarsa..." and those must not
    // become patient-facing doctor data.
    if (rawList.length === 0 && brain.prompts?.systemPrompt) {
      rawList = this.extractExplicitDoctorDirectoryBlocks(brain.prompts.systemPrompt)
        .flatMap(block => this.extractDoctorEntries(block));
    }

    const knowledgeSources = [
      brain.context.knowledge?.rules,
      brain.context.knowledge?.prices,
      brain.context.config?.knowledgeRules,
      brain.context.config?.knowledge_rules,
      brain.context.config?.verifiedInfoArchive,
      brain.context.config?.verified_info_archive
    ].filter((v): v is string => typeof v === 'string' && v.trim().length > 0);

    // Knowledge archive is the tenant-verified source of truth. Parse it even
    // when a smaller prompt-local doctor block was already found; otherwise a
    // narrow service-specific block (e.g. only spine doctors) hides the full
    // verified directory (e.g. Dermatology, Gynecology).
    for (const source of knowledgeSources) {
      const explicitBlocks = this.extractExplicitDoctorDirectoryBlocks(source);
      const parsed = explicitBlocks.length > 0
        ? explicitBlocks.flatMap(block => this.extractDoctorEntries(block))
        : this.extractDoctorEntries(source);
      this.pushUniqueEntries(rawList, parsed);
    }

    const doctors: Doctor[] = [];
    const seenDoctors = new Set<string>();
    for (const line of rawList) {
      // Parse doctor entry, e.g. "Prof. Dr. Aytekin GÜVEN - Kardiyoloji" or just "Prof. Dr. Aytekin GÜVEN"
      const parts = line.split('-').map(p => p.trim());
      const name = parts[0];
      const dept = parts[1] || 'Genel';
      const key = this.normalizeSearchText(`${name} - ${dept}`);
      if (seenDoctors.has(key)) continue;
      seenDoctors.add(key);
      doctors.push({ name, department: dept });
    }

    if (!department) {
      return doctors;
    }

    const cleanDept = department.toLocaleLowerCase('tr-TR').trim();
    
    return doctors.filter(doc => {
      const docDept = doc.department.toLocaleLowerCase('tr-TR');
      // Match department name or common synonyms
      if (cleanDept.includes('kardiyoloji') && docDept.includes('kardiyo')) return true;
      if (cleanDept.includes('dermatoloji') && (docDept.includes('dermatoloji') || docDept.includes('deri'))) return true;
      if (cleanDept.includes('cildiye') && (docDept.includes('dermatoloji') || docDept.includes('deri'))) return true;
      if ((cleanDept.includes('kadın') || cleanDept.includes('kadin') || cleanDept.includes('doğum') || cleanDept.includes('dogum') || cleanDept.includes('jinekoloji')) &&
          (docDept.includes('kadın') || docDept.includes('kadin') || docDept.includes('doğum') || docDept.includes('dogum') || docDept.includes('jinekoloji'))) return true;
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
