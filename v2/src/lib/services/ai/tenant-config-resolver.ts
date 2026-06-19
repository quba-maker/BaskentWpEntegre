/**
 * P0.18 — TenantConfigResolver
 *
 * Central helper for resolving tenant-specific configuration values with safe defaults.
 * All hardcoded SaaS-incompatible values are read from brain config first,
 * then fall back to sensible defaults so existing tenants are unaffected.
 *
 * DESIGN PRINCIPLES:
 * - All methods are pure/static — no side effects
 * - Always backward-compatible (existing tenant behavior unchanged)
 * - New tenants can override via brain.context.config or brain.prompts.metadata
 * - Never throws — always returns a safe default
 */

export class TenantConfigResolver {
  /**
   * Resolves the industry/sector for a tenant.
   * Checks brain.prompts.metadata.industry first, then brain.context.config.industry.
   * Returns '' if neither is set (generic/unknown sector).
   */
  static getIndustry(brain: any): string {
    if (!brain) return '';
    const metaIndustry = brain.prompts?.metadata?.industry;
    const configIndustry = brain.context?.config?.industry;
    const raw = metaIndustry || configIndustry || '';
    return typeof raw === 'string' ? raw.toLowerCase().trim() : '';
  }

  /**
   * Returns true if the tenant is in the healthcare sector.
   */
  static isHealthcare(brain: any): boolean {
    const industry = TenantConfigResolver.getIndustry(brain);
    return industry === 'healthcare' || industry === 'health' || industry === 'saglik' || industry === 'sağlık';
  }

  /**
   * Resolves the human-facing agent/consultant name.
   * Priority: identity.agentName > identity.consultantLabel > isHealthcare default > generic default
   *
   * Config path: brain.prompts.metadata.identity.agentName
   *              brain.context.config.identity.agentName
   */
  static getAgentName(brain: any): string {
    const identity = brain?.prompts?.metadata?.identity || brain?.context?.config?.identity || {};
    if (identity.agentName && typeof identity.agentName === 'string' && identity.agentName.trim()) {
      return identity.agentName.trim();
    }
    if (identity.consultantLabel && typeof identity.consultantLabel === 'string' && identity.consultantLabel.trim()) {
      return identity.consultantLabel.trim();
    }
    // Default based on sector
    return TenantConfigResolver.isHealthcare(brain) ? 'hasta danışmanımız' : 'temsilcimiz';
  }

  /**
   * Resolves the organization label for use in fallback texts (e.g. "hastanemizde").
   * Priority: config.institutionLabel > isHealthcare default > generic default
   *
   * Config path: brain.prompts.metadata.identity.institutionLabel
   *              brain.context.config.identity.institutionLabel
   */
  static getInstitutionLabel(brain: any): string {
    const identity = brain?.prompts?.metadata?.identity || brain?.context?.config?.identity || {};
    if (identity.institutionLabel && typeof identity.institutionLabel === 'string' && identity.institutionLabel.trim()) {
      return identity.institutionLabel.trim();
    }
    return TenantConfigResolver.isHealthcare(brain) ? 'hastanemizde' : 'ofisimizde';
  }

  /**
   * Resolves the organization name fallback (used when identityCtx.organizationName is empty).
   * Priority: identity.organizationName > isHealthcare default
   */
  static getOrgNameFallback(brain: any): string {
    const identity = brain?.prompts?.metadata?.identity || brain?.context?.config?.identity || {};
    if (identity.organizationName && typeof identity.organizationName === 'string' && identity.organizationName.trim()) {
      return identity.organizationName.trim();
    }
    return TenantConfigResolver.isHealthcare(brain) ? 'Sağlık Merkezi' : 'Hizmet Merkezi';
  }

  /**
   * Resolves location-based distance objection keywords.
   * Priority: config.locationDistanceKeywords > generic defaults (no city names)
   *
   * Config path: brain.context.config.locationDistanceKeywords (string[])
   *
   * NOTE: City names (konya, istanbul etc.) are INTENTIONALLY excluded from defaults.
   * Tenants who need city-specific keywords should set them in config.
   */
  static getDistanceKeywords(brain: any): string[] {
    const configKw = brain?.context?.config?.locationDistanceKeywords;
    if (Array.isArray(configKw) && configKw.length > 0) {
      return configKw.map((k: string) => k.toLowerCase().trim()).filter(Boolean);
    }
    // Generic defaults — no city names (tenant-agnostic)
    return ['uzak', 'mesafe', 'gelemiyorum', 'gelmem zor', 'cok uzak', 'uzakta', 'uzakligi', 'uzaklığı'];
  }

  /**
   * Resolves greeting detection tokens.
   * Priority: config.greetingTokens > Turkish defaults
   *
   * Config path: brain.context.config.greetingTokens (string[])
   */
  static getGreetingTokens(brain: any): string[] {
    const configTokens = brain?.context?.config?.greetingTokens;
    if (Array.isArray(configTokens) && configTokens.length > 0) {
      return configTokens.map((t: string) => t.toLowerCase().trim()).filter(Boolean);
    }
    return [
      'merhaba', 'merhabalar', 'selam', 'iyi günler', 'iyi akşamlar',
      'iyi sabahlar', 'günaydın', 'kolay gelsin', 'iyi çalışmalar'
    ];
  }

  /**
   * Resolves short confirmation tokens.
   * Priority: config.confirmationTokens > Turkish defaults
   *
   * Config path: brain.context.config.confirmationTokens (string[])
   */
  static getConfirmationTokens(brain: any): string[] {
    const configTokens = brain?.context?.config?.confirmationTokens;
    if (Array.isArray(configTokens) && configTokens.length > 0) {
      return configTokens.map((t: string) => t.toLowerCase().trim()).filter(Boolean);
    }
    return ['olur', 'tamam', 'evet', 'tabi', 'tabii', 'harika', 'süper', 'peki', 'ok', 'okay', 'tamamdır', 'iyi'];
  }

  /**
   * Resolves tenant-specific department list for topic detection.
   * Priority: config.topicDepartments > null (caller uses its own default list)
   *
   * Config path: brain.context.config.topicDepartments
   * Shape: [{ name: string; keywords: string[] }]
   */
  static getTopicDepartments(brain: any): { name: string; keywords: string[] }[] | null {
    const configDepts = brain?.context?.config?.topicDepartments;
    if (Array.isArray(configDepts) && configDepts.length > 0) {
      return configDepts.filter(
        (d: any) => d && typeof d.name === 'string' && Array.isArray(d.keywords)
      );
    }
    return null; // caller uses its own default
  }

  /**
   * Resolves extra complaint patterns for consultant state resolution.
   * Priority: config.complaintPatterns > [] (empty — caller uses its own hardcoded patterns)
   *
   * Config path: brain.context.config.complaintPatterns
   * Shape: [{ pattern: string (regex), complaint: string, department: string }]
   */
  static getExtraComplaintPatterns(brain: any): { pattern: RegExp; complaint: string; department: string }[] {
    const configPatterns = brain?.context?.config?.complaintPatterns;
    if (!Array.isArray(configPatterns) || configPatterns.length === 0) return [];
    const result: { pattern: RegExp; complaint: string; department: string }[] = [];
    for (const p of configPatterns) {
      try {
        if (p.pattern && p.complaint && p.department) {
          result.push({
            pattern: new RegExp(p.pattern, 'gi'),
            complaint: p.complaint,
            department: p.department
          });
        }
      } catch {
        // Malformed regex — skip silently
      }
    }
    return result;
  }
  /**
   * P0.19: Returns a flat string[] of department keywords for ConversationIntentRouter.route/routeAll.
   *
   * Priority:
   *   1. brain.context.config.intentDepartments (flat string[] — direct override)
   *   2. brain.context.config.topicDepartments (structured — flattened keywords)
   *   3. null → caller (ConversationIntentRouter) uses its own DEFAULT_DEPARTMENTS
   *
   * Config path: brain.context.config.intentDepartments (string[]) — simplest override
   *              brain.context.config.topicDepartments ([{name, keywords}]) — structured
   */
  static getIntentDepartmentKeywords(brain: any): string[] | null {
    // 1. Flat override
    const flatOverride = brain?.context?.config?.intentDepartments;
    if (Array.isArray(flatOverride) && flatOverride.length > 0) {
      return flatOverride.map((k: string) => k.toLowerCase().trim()).filter(Boolean);
    }
    // 2. Structured topicDepartments → flatten keywords
    const structured = TenantConfigResolver.getTopicDepartments(brain);
    if (structured && structured.length > 0) {
      return structured.flatMap(d => d.keywords.map(k => k.toLowerCase().trim()));
    }
    return null; // ConversationIntentRouter will use DEFAULT_DEPARTMENTS
  }
}
