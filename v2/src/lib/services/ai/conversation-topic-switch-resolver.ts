import { DepartmentAliasResolver } from './department-alias-resolver';

export interface TopicSwitchResult {
  hasSwitched: boolean;
  activeTopic: string | null;
  previousTopics: string[];
}

export class ConversationTopicSwitchResolver {
  // P0.18: Renamed to DEFAULT_DEPARTMENTS — can be overridden per-tenant via brain.context.config.topicDepartments
  private static DEFAULT_DEPARTMENTS = [
    { name: 'Kardiyoloji', keywords: ['kalp', 'kardiyo', 'kardiyoloji', 'heart', 'coronary', 'bypass', 'anjiyo', 'ritim bozukluğu'] },
    { name: 'Plastik ve Rekonstrüktif Cerrahi', keywords: ['estetik', 'burun', 'rhinoplasty', 'nose job', 'rinoplasti', 'plastik cerrahi', 'liposuction', 'meme estetiği', 'saç ekimi'] },
    { name: 'Organ Nakli Merkezi', keywords: ['nakil', 'karaciğer', 'böbrek', 'organ nakli', 'transplant', 'liver transplant', 'kidney transplant'] },
    { name: 'Beyin ve Sinir Cerrahisi', keywords: ['fıtık', 'fitik', 'bel fıtığı', 'boyun fıtığı', 'fıtığı', 'fıtıklar', 'beyin cerrahi', 'omurilik'] }
  ];

  /**
   * P0.18: Returns the department list for topic detection.
   * Priority: tenantDepartments param > DEFAULT_DEPARTMENTS
   */
  private static getEffectiveDepartments(
    tenantDepartments?: { name: string; keywords: string[] }[] | null
  ): { name: string; keywords: string[] }[] {
    if (tenantDepartments && tenantDepartments.length > 0) return tenantDepartments;
    return this.DEFAULT_DEPARTMENTS;
  }

  /**
   * Evaluates if the latest user message represents a switch in topic compared to the active department.
   * If a switch is detected (or if currentDepartment is null and a department is found),
   * it determines the new activeTopic.
   *
   * P0.16-F FIX: Also resolves activeTopic on FIRST mention (currentDepartment = null)
   * so that stale CRM/opportunity context doesn't override the current message.
   *
   * P0.18: tenantDepartments param allows brain config override for non-healthcare tenants.
   */
  public static resolve(
    latestInbound: string,
    currentDepartment: string | null,
    metadata?: any,
    tenantAliasConfig?: Record<string, string> | null,
    tenantDepartments?: { name: string; keywords: string[] }[] | null
  ): TopicSwitchResult {
    if (!latestInbound) {
      return { hasSwitched: false, activeTopic: currentDepartment, previousTopics: metadata?.previousTopics || [] };
    }

    const text = latestInbound.toLowerCase();
    const departments = this.getEffectiveDepartments(tenantDepartments);

    // Step 1: Try DepartmentAliasResolver for richer keyword matching (P0.16-F)
    let matchedDept: string | null = null;
    const aliasResult = DepartmentAliasResolver.resolve(latestInbound, tenantAliasConfig || null);
    if (aliasResult) {
      matchedDept = aliasResult.canonical;
    } else {
      // Step 2: Fallback to inline departments list (default or tenant-overridden)
      for (const dept of departments) {
        if (dept.keywords.some(kw => text.includes(kw))) {
          matchedDept = dept.name;
          break;
        }
      }
    }

    const previousTopics: string[] = Array.isArray(metadata?.previousTopics)
      ? [...metadata.previousTopics]
      : [];

    if (currentDepartment && !previousTopics.includes(currentDepartment)) {
      previousTopics.push(currentDepartment);
    }

    // P0.16-F: If currentDepartment is null but we matched a dept from the message,
    // treat this as an initial topic detection (no "switch" but activeTopic is set)
    if (matchedDept && !currentDepartment) {
      return {
        hasSwitched: false, // not a switch, it's a first detection
        activeTopic: matchedDept,
        previousTopics: previousTopics.filter(t => t !== matchedDept)
      };
    }

    if (matchedDept && currentDepartment && matchedDept !== currentDepartment) {
      // Topic switched — archive old department in previousTopics
      const filteredPrev = previousTopics.filter(t => t !== matchedDept);
      return {
        hasSwitched: true,
        activeTopic: matchedDept,
        previousTopics: filteredPrev
      };
    }

    return {
      hasSwitched: false,
      activeTopic: matchedDept || currentDepartment,
      previousTopics
    };
  }
}
