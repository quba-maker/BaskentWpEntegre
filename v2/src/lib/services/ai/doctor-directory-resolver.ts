import { TenantBrain } from '../../brain/tenant-brain';

export interface Doctor {
  name: string;
  department: string;
}

export class DoctorDirectoryResolver {
  /**
   * Resolves the list of verified doctors for a specific department.
   * If department is not specified, returns all verified doctors.
   * Returns empty array if no directory exists.
   */
  public static getDoctors(brain: TenantBrain, department?: string): Doctor[] {
    const doctorDirectory = brain.context.config?.doctors || brain.context.config?.doctorDirectory || brain.context.config?.doctor_directory;
    if (!doctorDirectory) {
      return [];
    }

    let rawList: string[] = [];
    if (Array.isArray(doctorDirectory)) {
      rawList = doctorDirectory.map(d => String(d));
    } else if (typeof doctorDirectory === 'string') {
      rawList = doctorDirectory.split('\n').map(d => d.trim()).filter(Boolean);
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
