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
}

export interface ResolvedTemplate {
  templateId: string | null;
  templateName: string;
  language: string;
  body: string;        // raw template body with {{variables}}
  rendered: string;    // final rendered text ready to send
  source: 'form_match' | 'department_match' | 'default' | 'fallback' | 'system_hardcoded';
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
  const variables: Record<string, string> = {
    patient_name: ctx.patientName?.trim() || '',
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
  rendered = rendered.replace(/Merhaba\s+!/g, 'Merhaba!');
  rendered = rendered.replace(/Hello\s+!/g, 'Hello!');

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
  static async resolve(db: TenantDB, ctx: TemplateResolveContext, greetingLang?: string): Promise<ResolvedTemplate> {
    const lang = detectLanguage(ctx, greetingLang);
    
    try {
      // ── Layer 1: form_name + language match ──
      if (ctx.formName) {
        const rows = await db.executeSafe({
          text: `SELECT id, name, language, body FROM message_templates
                 WHERE tenant_id = $1 AND template_type = 'greeting'
                   AND form_name = $2 AND language = $3 AND is_active = true
                 ORDER BY created_at DESC LIMIT 1`,
          values: [ctx.tenantId, ctx.formName, lang]
        }) as any[];

        if (rows.length > 0) {
          return {
            templateId: rows[0].id,
            templateName: rows[0].name,
            language: lang,
            body: rows[0].body,
            rendered: renderTemplate(rows[0].body, ctx),
            source: 'form_match',
          };
        }
      }

      // ── Layer 2: department + language match ──
      if (ctx.department) {
        const rows = await db.executeSafe({
          text: `SELECT id, name, language, body FROM message_templates
                 WHERE tenant_id = $1 AND template_type = 'greeting'
                   AND department = $2 AND language = $3 AND is_active = true
                   AND form_name IS NULL
                 ORDER BY created_at DESC LIMIT 1`,
          values: [ctx.tenantId, ctx.department, lang]
        }) as any[];

        if (rows.length > 0) {
          return {
            templateId: rows[0].id,
            templateName: rows[0].name,
            language: lang,
            body: rows[0].body,
            rendered: renderTemplate(rows[0].body, ctx),
            source: 'department_match',
          };
        }
      }

      // ── Layer 3: default template for detected language ──
      const defaultRows = await db.executeSafe({
        text: `SELECT id, name, language, body FROM message_templates
               WHERE tenant_id = $1 AND template_type = 'greeting'
                 AND language = $2 AND is_default = true AND is_active = true
               LIMIT 1`,
        values: [ctx.tenantId, lang]
      }) as any[];

      if (defaultRows.length > 0) {
        return {
          templateId: defaultRows[0].id,
          templateName: defaultRows[0].name,
          language: lang,
          body: defaultRows[0].body,
          rendered: renderTemplate(defaultRows[0].body, ctx),
          source: 'default',
        };
      }

      // ── Layer 4: Turkish default fallback ──
      if (lang !== 'tr') {
        const trRows = await db.executeSafe({
          text: `SELECT id, name, language, body FROM message_templates
                 WHERE tenant_id = $1 AND template_type = 'greeting'
                   AND language = 'tr' AND is_default = true AND is_active = true
                 LIMIT 1`,
          values: [ctx.tenantId]
        }) as any[];

        if (trRows.length > 0) {
          return {
            templateId: trRows[0].id,
            templateName: trRows[0].name,
            language: 'tr',
            body: trRows[0].body,
            rendered: renderTemplate(trRows[0].body, ctx),
            source: 'fallback',
          };
        }
      }

      // ── Layer 5: Any available template ──
      const anyRows = await db.executeSafe({
        text: `SELECT id, name, language, body FROM message_templates
               WHERE tenant_id = $1 AND template_type = 'greeting' AND is_active = true
               ORDER BY is_default DESC, created_at ASC LIMIT 1`,
        values: [ctx.tenantId]
      }) as any[];

      if (anyRows.length > 0) {
        return {
          templateId: anyRows[0].id,
          templateName: anyRows[0].name,
          language: anyRows[0].language,
          body: anyRows[0].body,
          rendered: renderTemplate(anyRows[0].body, ctx),
          source: 'fallback',
        };
      }
    } catch (_) {
      // Template table might not exist yet — fall through to hardcoded
    }

    // ── Layer 6: System hardcoded — zero-dependency guaranteed ──
    return this.getSystemFallback(ctx, lang);
  }

  /**
   * Hardcoded fallback — identical to P0 behavior.
   * Ensures system never breaks even if message_templates table is empty/missing.
   */
  private static getSystemFallback(ctx: TemplateResolveContext, lang: string): ResolvedTemplate {
    const isTurkish = lang === 'tr';
    const name = ctx.patientName?.trim();
    const greeting = name
      ? (isTurkish ? `Merhaba ${name}!` : `Hello ${name}!`)
      : (isTurkish ? 'Merhaba!' : 'Hello!');
    const tenantName = ctx.tenantName || 'Ekibimiz';

    const body = isTurkish
      ? `${greeting} ${tenantName} olarak size yazıyoruz 🙏\n\nDoldurduğunuz form bize ulaştı. Talebiniz hakkında detaylı bilgi alabilir miyiz?`
      : `${greeting} We are reaching out from ${tenantName} 🙏\n\nWe received your form. Could you provide more details about your request?`;

    return {
      templateId: null,
      templateName: isTurkish ? 'Sistem Varsayılanı (TR)' : 'System Default (EN)',
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
    try {
      const rows = await db.executeSafe({
        text: `SELECT id, name, language, body, form_name, department, is_default
               FROM message_templates
               WHERE tenant_id = $1 AND template_type = 'greeting' AND is_active = true
               ORDER BY is_default DESC, language ASC, name ASC`,
        values: [tenantId]
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
