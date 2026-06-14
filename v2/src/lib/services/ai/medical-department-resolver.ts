import { TenantBrain } from '../../brain/tenant-brain';

export class MedicalDepartmentResolver {
  private static DEFAULT_MAP: Record<string, string> = {
    'bel fıtığı': 'Beyin ve Sinir Cerrahisi veya Fizik Tedavi',
    'bel fitigi': 'Beyin ve Sinir Cerrahisi veya Fizik Tedavi',
    'boyun fıtığı': 'Beyin ve Sinir Cerrahisi veya Fizik Tedavi',
    'boyun fitigi': 'Beyin ve Sinir Cerrahisi veya Fizik Tedavi',
    'fıtık': 'Beyin ve Sinir Cerrahisi veya Fizik Tedavi',
    'fitik': 'Beyin ve Sinir Cerrahisi veya Fizik Tedavi',
    'fıtığı': 'Beyin ve Sinir Cerrahisi veya Fizik Tedavi',
    'fitigi': 'Beyin ve Sinir Cerrahisi veya Fizik Tedavi'
  };

  /**
   * Resolves a department name based on the user's complaint context.
   * Returns null if no mapping is found or if healthcare is not active.
   */
  public static resolve(complaint: string, brain: TenantBrain): string | null {
    const configIndustry = brain.context.config?.industry;
    const metadataIndustry = (brain.prompts.metadata as any)?.industry;
    const resolvedIndustry = (configIndustry || metadataIndustry || '').toLowerCase();
    
    const isHealthcare = resolvedIndustry === 'healthcare' || resolvedIndustry === 'health';
    if (!isHealthcare) {
      return null;
    }

    if (!complaint) {
      return null;
    }

    const clean = complaint.toLowerCase().trim();

    // 1. Check tenant config/settings department mapping if present
    const tenantMapping = brain.context.config?.department_mapping || brain.context.config?.departmentMapping;
    if (tenantMapping && typeof tenantMapping === 'object') {
      if (tenantMapping[clean]) {
        return String(tenantMapping[clean]);
      }
      for (const key of Object.keys(tenantMapping)) {
        if (clean.includes(key.toLowerCase()) || key.toLowerCase().includes(clean)) {
          return String(tenantMapping[key]);
        }
      }
    }

    // 2. Check default generic mapping
    if (this.DEFAULT_MAP[clean]) {
      return this.DEFAULT_MAP[clean];
    }

    for (const key of Object.keys(this.DEFAULT_MAP)) {
      if (clean.includes(key) || key.includes(clean)) {
        return this.DEFAULT_MAP[key];
      }
    }

    return null;
  }
}
