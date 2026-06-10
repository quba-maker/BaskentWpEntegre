/**
 * PHASE 2L-P1: Template Resolver Service
 * 
 * Resolves the best greeting template for a given lead based on:
 * 1. tenant + form_name + language  (most specific)
 * 2. tenant + department + language
 * 3. tenant + language (is_default=true)
 * 4. tenant + 'tr' (is_default=true) — Turkish fallback
 * 5. System hardcoded fallback — last resort
 * 
 * Variable rendering: {{patient_name}}, {{tenant_name}}, etc.
 * Null/undefined variables → safe empty string or natural sentence drop.
 * Max rendered body: 4096 chars (WhatsApp limit).
 */

import { TenantDB } from '@/lib/core/tenant-db';

// ═══════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════

export interface TemplateResolveContext {
  tenantId: string;
  tenantName: string;
  patientName?: string;
  formName?: string;
  department?: string;
  country?: string;
  coordinatorName?: string;
  language?: string;  // pre-resolved language hint
  phoneNumber?: string;  // for phone-prefix language detection
  omitPatientName?: boolean; // dynamic configuration to hide patient name in templates
}

export interface ResolvedTemplate {
  templateId: string | null;
  templateName: string;
  language: string;
  body: string;        // raw template body with {{variables}}
  rendered: string;    // final rendered text ready to send
  source: 'form_match' | 'department_match' | 'default' | 'fallback' | 'system_hardcoded';
  template_non_compliant?: boolean;
  compliance_warning?: string;
}

export interface TemplateListItem {
  id: string;
  name: string;
  language: string;
  body: string;
  formName: string | null;
  department: string | null;
  isDefault: boolean;
}

// ═══════════════════════════════════════════════════════════
// LANGUAGE DETECTION
// ═══════════════════════════════════════════════════════════

const COUNTRY_LANG_MAP: Record<string, string> = {
  'türkiye': 'tr', 'turkey': 'tr', 'turkiye': 'tr',
  'azerbaycan': 'tr', 'azerbaijan': 'tr',
  'kuzey kıbrıs': 'tr', 'kktc': 'tr', 'north cyprus': 'tr',
  // English-primary countries
  'united kingdom': 'en', 'uk': 'en', 'england': 'en',
  'united states': 'en', 'usa': 'en', 'us': 'en',
  'canada': 'en', 'australia': 'en', 'new zealand': 'en',
  'ireland': 'en', 'south africa': 'en',
};

function detectLanguage(ctx: TemplateResolveContext, greetingLang?: string): string {
  // 1. Explicit language hint (from lead form data)
  if (ctx.language && ctx.language !== 'auto') return ctx.language;

  // 2. Channel AI profile greeting_language
  if (greetingLang && greetingLang !== 'auto') return greetingLang;

  // 3. Country-based detection
  if (ctx.country) {
    const normalized = ctx.country.toLowerCase().trim();
    if (COUNTRY_LANG_MAP[normalized]) return COUNTRY_LANG_MAP[normalized];
  }

  // 4. Phone prefix detection
  if (ctx.phoneNumber) {
    const clean = ctx.phoneNumber.replace(/\D/g, '');
    if (clean.startsWith('90') || clean.startsWith('0')) return 'tr';
  }

  // 5. Default: Turkish
  return 'tr';
}

// ═══════════════════════════════════════════════════════════
// VARIABLE RENDERING
// ═══════════════════════════════════════════════════════════

const MAX_RENDERED_LENGTH = 4096;

function renderTemplate(body: string, ctx: TemplateResolveContext): string {
  const omitPatientName = ctx.omitPatientName ?? false;
  const variables: Record<string, string> = {
    patient_name: omitPatientName ? '' : (ctx.patientName?.trim() || ''),
    tenant_name: ctx.tenantName || 'Ekibimiz',
    form_name: ctx.formName || '',
    department: ctx.department || '',
    country: ctx.country || '',
    coordinator_name: ctx.coordinatorName || '',
  };

  let rendered = body;
  for (const [key, value] of Object.entries(variables)) {
    rendered = rendered.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
  }

  // Clean up: remove "Merhaba !" (empty patient_name) → "Merhaba!"
  rendered = rendered.replace(/Merhaba\s*,/g, 'Merhaba,');
  rendered = rendered.replace(/Hello\s*,/g, 'Hello,');
  rendered = rendered.replace(/Merhaba\s*!/g, 'Merhaba!');
  rendered = rendered.replace(/Hello\s*!/g, 'Hello!');

  // Clean up double spaces from empty variables
  rendered = rendered.replace(/\s{2,}/g, ' ').trim();

  // Enforce max length
  if (rendered.length > MAX_RENDERED_LENGTH) {
    rendered = rendered.substring(0, MAX_RENDERED_LENGTH - 3) + '...';
  }

  return rendered;
}

// ═══════════════════════════════════════════════════════════
// RESOLVER
// ═══════════════════════════════════════════════════════════

export class TemplateResolverService {
  /**
   * Resolves the best template for a given context.
   * Falls back gracefully through 5 layers.
   */
  static async resolve(
    db: TenantDB, 
    ctx: TemplateResolveContext, 
    greetingLang?: string, 
    templateType: 'greeting' | 'remarketing' = 'greeting'
  ): Promise<ResolvedTemplate> {
    const lang = detectLanguage(ctx, greetingLang);
    let resolved: ResolvedTemplate | null = null;
    let firstNonCompliantFallback: ResolvedTemplate | null = null;

    // Resolve omitPatientName configuration dynamically from settings
    let omitPatientName = false;
    try {
      const settingsRows = await db.executeSafe({
        text: `SELECT value FROM settings WHERE tenant_id = $1::uuid AND key = 'omit_patient_name' LIMIT 1`,
        values: [ctx.tenantId]
      }) as any[];
      if (settingsRows.length > 0) {
        omitPatientName = settingsRows[0].value === 'true' || settingsRows[0].value === true;
      }
    } catch (_) {}
    ctx.omitPatientName = omitPatientName;
    
    // Dynamic import to avoid circular dependencies
    const { isNonCompliant, sanitizePatientFacingMessage } = await import('@/lib/utils/patient-message-sanitizer');

    const checkAndSetResolved = (rows: any[], source: ResolvedTemplate['source']) => {
      for (const row of rows) {
        const body = row.body;
        const rendered = renderTemplate(body, ctx);
        const nonCompliant = isNonCompliant(body) || isNonCompliant(rendered);
        
        const candidate: ResolvedTemplate = {
          templateId: row.id,
          templateName: row.name,
          language: row.language || lang,
          body,
          rendered,
          source,
          template_non_compliant: nonCompliant,
          compliance_warning: nonCompliant ? "İsimli/cinsiyetli hitap barındırıyor." : undefined
        };

        if (!nonCompliant) {
          resolved = candidate;
          return true; // Found a compliant template!
        } else if (!firstNonCompliantFallback) {
          // Save the very first non-compliant template we see to fallback on if NO compliant template exists
          firstNonCompliantFallback = candidate;
        }
      }
      return false; // No compliant template in this batch
    };
    
    try {
      // ── Layer 1: form_name + language match ──
      if (ctx.formName) {
        const rows = await db.executeSafe({
          text: `SELECT id, name, language, body FROM message_templates
                 WHERE tenant_id = $1::uuid AND template_type = $4
                   AND form_name = $2 AND language = $3 AND is_active = true
                 ORDER BY created_at DESC`,
          values: [ctx.tenantId, ctx.formName, lang, templateType]
        }) as any[];
        checkAndSetResolved(rows, 'form_match');
      }

      // ── Layer 2: department + language match ──
      if (!resolved && ctx.department) {
        const rows = await db.executeSafe({
          text: `SELECT id, name, language, body FROM message_templates
                 WHERE tenant_id = $1::uuid AND template_type = $4
                   AND department = $2 AND language = $3 AND is_active = true
                   AND form_name IS NULL
                 ORDER BY created_at DESC`,
          values: [ctx.tenantId, ctx.department, lang, templateType]
        }) as any[];
        checkAndSetResolved(rows, 'department_match');
      }

      // ── Layer 3: default template for detected language ──
      if (!resolved) {
        const defaultRows = await db.executeSafe({
          text: `SELECT id, name, language, body FROM message_templates
                 WHERE tenant_id = $1::uuid AND template_type = $3
                   AND language = $2 AND is_default = true AND is_active = true
                 ORDER BY created_at ASC`,
          values: [ctx.tenantId, lang, templateType]
        }) as any[];
        checkAndSetResolved(defaultRows, 'default');
      }

      // ── Layer 4: Turkish default fallback ──
      if (!resolved && lang !== 'tr') {
        const trRows = await db.executeSafe({
          text: `SELECT id, name, language, body FROM message_templates
                 WHERE tenant_id = $1::uuid AND template_type = $2
                   AND language = 'tr' AND is_default = true AND is_active = true
                 ORDER BY created_at ASC`,
          values: [ctx.tenantId, templateType]
        }) as any[];
        checkAndSetResolved(trRows, 'fallback');
      }

      // ── Layer 5: Any available template ──
      if (!resolved) {
        const anyRows = await db.executeSafe({
          text: `SELECT id, name, language, body FROM message_templates
                 WHERE tenant_id = $1::uuid AND template_type = $2 AND is_active = true
                 ORDER BY is_default DESC, created_at ASC`,
          values: [ctx.tenantId, templateType]
        }) as any[];
        checkAndSetResolved(anyRows, 'fallback');
      }
    } catch (_) {
      // Template table might not exist yet — fall through to hardcoded
    }

    // If no compliant template was found anywhere, use the first non-compliant one we saw
    if (!resolved && firstNonCompliantFallback) {
      resolved = firstNonCompliantFallback;
    }

    if (!resolved) {
      // ── Layer 6: System hardcoded — zero-dependency guaranteed ──
      resolved = this.getSystemFallback(ctx, lang, templateType);
      const nonCompliant = isNonCompliant(resolved.body) || isNonCompliant(resolved.rendered);
      resolved.template_non_compliant = nonCompliant;
      if (nonCompliant) {
        resolved.compliance_warning = "İsimli/cinsiyetli hitap barındırıyor.";
      }
      resolved.rendered = sanitizePatientFacingMessage(resolved.rendered);
    }

    return resolved;
  }

  /**
   * Hardcoded fallback — identical to P0 behavior.
   * Ensures system never breaks even if message_templates table is empty/missing.
   */
  private static getSystemFallback(
    ctx: TemplateResolveContext, 
    lang: string, 
    templateType: 'greeting' | 'remarketing' = 'greeting'
  ): ResolvedTemplate {
    const isTurkish = lang === 'tr';
    const greeting = isTurkish ? 'Merhaba!' : 'Hello!';
    const tenantName = ctx.tenantName || 'Ekibimiz';
    const dept = ctx.department || (isTurkish ? 'bölüm' : 'department');

    let body = "";
    if (templateType === 'remarketing') {
      body = isTurkish
        ? `${greeting} Sizinle daha önce ${dept} bölümümüz için görüşmüştük. Tedavi planınızla ilgili sormak istediğiniz veya netleştirmek istediğiniz bir konu var mıdır? 😊`
        : `${greeting} We previously discussed your request for the ${dept} department. Do you have any questions or need further assistance regarding your treatment plan? 😊`;
    } else {
      body = isTurkish
        ? `${greeting} ${tenantName} olarak size yazıyoruz 🙏\n\nDoldurduğunuz form bize ulaştı. Talebiniz hakkında detaylı bilgi alabilir miyiz?`
        : `${greeting} We are reaching out from ${tenantName} 🙏\n\nWe received your form. Could you provide more details about your request?`;
    }

    return {
      templateId: null,
      templateName: isTurkish 
        ? (templateType === 'remarketing' ? 'Sistem Varsayılan Takip (TR)' : 'Sistem Varsayılanı (TR)') 
        : (templateType === 'remarketing' ? 'System Default Follow-up (EN)' : 'System Default (EN)'),
      language: lang,
      body,
      rendered: body,
      source: 'system_hardcoded',
    };
  }

  /**
   * Renders a specific template body with given context.
   * Used when coordinator selects a different template in the UI.
   */
  static renderWithContext(body: string, ctx: TemplateResolveContext): string {
    return renderTemplate(body, ctx);
  }

  /**
   * Lists all greeting templates available for a tenant.
   * Used for the template selector dropdown.
   */
  static async listGreetingTemplates(db: TenantDB, tenantId: string): Promise<TemplateListItem[]> {
    return this.listTemplates(db, tenantId, 'greeting');
  }

  /**
   * Generic template listing for any type (greeting, remarketing).
   */
  static async listTemplates(
    db: TenantDB, 
    tenantId: string, 
    templateType: 'greeting' | 'remarketing' = 'greeting'
  ): Promise<TemplateListItem[]> {
    try {
      const rows = await db.executeSafe({
        text: `SELECT id, name, language, body, form_name, department, is_default
               FROM message_templates
               WHERE tenant_id = $1::uuid AND template_type = $2 AND is_active = true
               ORDER BY is_default DESC, language ASC, name ASC`,
        values: [tenantId, templateType]
      }) as any[];

      return rows.map((r: any) => ({
        id: r.id,
        name: r.name,
        language: r.language,
        body: r.body,
        formName: r.form_name || null,
        department: r.department || null,
        isDefault: r.is_default,
      }));
    } catch (_) {
      return [];
    }
  }

  /**
   * Detects the best language for a lead.
   * Exported for use by prepareGreetingDraft.
   */
  static detectLanguageForLead(ctx: TemplateResolveContext, greetingLang?: string): string {
    return detectLanguage(ctx, greetingLang);
  }
}
