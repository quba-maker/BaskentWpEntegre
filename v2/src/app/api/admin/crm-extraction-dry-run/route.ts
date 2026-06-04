import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { withTenantDB } from "@/lib/core/tenant-db";
import { extractFormFields } from "@/lib/utils/form-field-extractor";
import { normalizeCountry } from "@/lib/utils/country-normalizer";
import { extractFromPatientMessageDeterministic, shouldRunAiExtractor } from "@/lib/utils/patient-message-extractor";
import { logger } from "@/lib/core/logger";

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const log = logger.withContext({ module: 'crm-extraction-dry-run' });
  
  try {
    // 1. Authenticated Admin / Platform Admin Guard
    const session = await getSession();
    if (!session || (session.role !== 'platform_admin' && session.role !== 'admin')) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const tenantId = session.tenantId;
    if (!tenantId) {
      return NextResponse.json({ error: "Tenant context not found in session" }, { status: 400 });
    }

    log.info(`[DRY_RUN] Starting CRM extraction dry-run check`, { tenantId, user: session.email });

    const db = withTenantDB(tenantId);

    // 2. Fetch the last 200 conversations
    const conversations = await db.executeSafe({
      text: `
        SELECT 
          c.id as conversation_id,
          c.phone_number,
          c.patient_name,
          c.department,
          c.country,
          c.last_message_content,
          c.last_message_direction,
          c.customer_id,
          opp.id as opp_id,
          opp.department as opp_department,
          opp.country as opp_country,
          opp.metadata as opp_metadata
        FROM conversations c
        LEFT JOIN LATERAL (
          SELECT id, department, country, metadata 
          FROM opportunities 
          WHERE conversation_id = c.id 
            AND tenant_id = c.tenant_id 
            AND stage NOT IN ('lost', 'not_qualified', 'arrived')
          ORDER BY created_at DESC LIMIT 1
        ) opp ON true
        WHERE c.tenant_id = $1
        ORDER BY c.last_message_at DESC NULLS LAST
        LIMIT 200
      `,
      values: [tenantId]
    }) as any[];

    // 3. Fetch latest 1000 leads for multi-phone mapping
    const leads = await db.executeSafe({
      text: `
        SELECT form_name, raw_data, phone_number, customer_id, created_at 
        FROM leads 
        WHERE tenant_id = $1 
        ORDER BY created_at DESC 
        LIMIT 1000
      `,
      values: [tenantId]
    }) as any[];

    // Stats accumulator
    const stats = {
      totalAnalyzed: conversations.length,
      formCampaignHigh: 0,
      freeTextHigh: 0,
      mediumCandidate: 0,
      countryNormalization: 0,
      skippedDueLocks: 0,
      skippedDueExisting: 0,
      noChange: 0
    };

    const details = [];

    // Valid departments enum
    const validEnums = [
      'Ortopedi', 'Kardiyoloji', 'Gastroenteroloji', 'Estetik', 'Diş', 'Diş Estetiği', 
      'Göz', 'Tüp Bebek', 'Organ Nakli', 'Onkoloji', 'Obezite', 'Nöroloji', 'Üroloji', 
      'Dermatoloji', 'Genel Cerrahi', 'Beyin Cerrahi', 'KBB', 'Göğüs Hastalıkları', 
      'Endokrinoloji', 'Fizik Tedavi', 'Çocuk Sağlığı', 'Kadın Doğum', 'Psikiyatri', 'Check-Up'
    ];

    // 4. Process each conversation
    for (const c of conversations) {
      const oppMetadata = typeof c.opp_metadata === 'string' ? JSON.parse(c.opp_metadata) : (c.opp_metadata || {});
      const isDeptLocked = oppMetadata.department_locked === true;
      const isCountryLocked = oppMetadata.country_locked === true;
      const existingDept = c.opp_department || c.department || null;
      const existingCountry = c.opp_country || c.country || null;

      // Suffix/prefix normalization helper
      const phoneNumber = c.phone_number || '';
      const cleanPhone = phoneNumber.replace(/\D/g, '');

      // Multi-Phone Lead Routing Lookup matching worker logic
      let matchedLead: any = null;
      
      // Step 1: customer_id
      if (c.customer_id) {
        matchedLead = leads.find(l => l.customer_id === c.customer_id);
      }

      // Step 2 & 3: Phone array match
      if (!matchedLead && cleanPhone) {
        matchedLead = leads.find(l => {
          const lp = l.phone_number?.replace(/\D/g, '');
          return lp === cleanPhone;
        });
      }

      // Step 4: _all_phones JSON array match
      if (!matchedLead && cleanPhone) {
        matchedLead = leads.find(l => {
          if (!l.raw_data) return false;
          try {
            const rawObj = typeof l.raw_data === 'string' ? JSON.parse(l.raw_data) : l.raw_data;
            if (rawObj && rawObj._all_phones) {
              const phonesArr = typeof rawObj._all_phones === 'string' ? JSON.parse(rawObj._all_phones) : rawObj._all_phones;
              if (Array.isArray(phonesArr)) {
                return phonesArr.map(p => p.replace(/\D/g, '')).includes(cleanPhone);
              }
            }
          } catch (_) {}
          return false;
        });
      }

      // Step 5: Suffix fallback (unique match on last 10 digits)
      if (!matchedLead && cleanPhone.length >= 10) {
        const last10 = cleanPhone.slice(-10);
        const suffixMatches = leads.filter(l => l.phone_number?.replace(/\D/g, '').endsWith(last10));
        if (suffixMatches.length === 1) {
          matchedLead = suffixMatches[0];
        }
      }

      // 5. Run Extractor & Normalizer
      let formExt: any = null;
      if (matchedLead?.raw_data) {
        try {
          const parsedForm = typeof matchedLead.raw_data === 'string' ? JSON.parse(matchedLead.raw_data) : matchedLead.raw_data;
          formExt = extractFormFields(parsedForm);
        } catch (_) {}
      }

      const msgExt = extractFromPatientMessageDeterministic(c.last_message_content || '');
      const aiEligible = shouldRunAiExtractor(
        c.last_message_content || '',
        c.last_message_direction || 'in',
        'text',
        isDeptLocked && isCountryLocked
      );

      // Determine extracted dept and country candidates
      let candidateDept: string | null = null;
      let deptConfidence: 'high' | 'medium' | 'low' = 'low';
      let deptSource = 'None';

      if (formExt?.department && formExt.confidence >= 0.8) {
        candidateDept = formExt.department;
        deptConfidence = 'high';
        deptSource = `Form Campaign: ${formExt.departmentSource || 'campaign'}`;
      } else if (msgExt?.departmentCandidate && msgExt.departmentConfidence === 'high') {
        candidateDept = msgExt.departmentCandidate;
        deptConfidence = 'high';
        deptSource = 'Deterministic Message (High)';
      } else if (msgExt?.departmentCandidate && msgExt.departmentConfidence === 'medium') {
        candidateDept = msgExt.departmentCandidate;
        deptConfidence = 'medium';
        deptSource = 'Deterministic Message (Medium)';
      } else if (aiEligible) {
        deptConfidence = 'low';
        deptSource = 'Eligible for AI Fallback';
      }

      // Normalization of country
      const rawCountryText = formExt?.country || existingCountry || null;
      const norm = normalizeCountry(rawCountryText, phoneNumber);
      
      const isCountryDirtyVal = rawCountryText !== null && (rawCountryText.toLowerCase() === 'tc d' || rawCountryText.toLowerCase() === 'tcd' || rawCountryText.toLowerCase() === 'tc');
      const countryNormalizedVal = norm.country;
      const countryConf = norm.countryConfidence;

      // Stats increment and action resolution
      let action = 'No Change';
      let rowConfidence = 'None';

      if (isDeptLocked || isCountryLocked) {
        stats.skippedDueLocks++;
        action = 'Skipped (Locked)';
      } else if (existingDept) {
        stats.skippedDueExisting++;
        action = 'Skipped (Existing Dept Set)';
      } else if (deptConfidence === 'high') {
        if (deptSource.startsWith('Form')) {
          stats.formCampaignHigh++;
        } else {
          stats.freeTextHigh++;
        }
        action = `Will Update: ${candidateDept}`;
        rowConfidence = 'High';
      } else if (deptConfidence === 'medium') {
        stats.mediumCandidate++;
        action = `UI Candidate Only: ${candidateDept}`;
        rowConfidence = 'Medium';
      } else {
        stats.noChange++;
      }

      if (countryNormalizedVal && isCountryDirtyVal) {
        stats.countryNormalization++;
        if (action === 'No Change') {
          action = `Will Normalize Country: ${countryNormalizedVal}`;
        } else {
          action += ` & Normalize Country: ${countryNormalizedVal}`;
        }
      }

      details.push({
        conversationId: c.conversation_id,
        patientName: c.patient_name || 'Isimsiz Hasta',
        phoneNumber: c.phone_number,
        existingDept: existingDept || 'Belirtilmemiş',
        extractedDept: candidateDept || 'Belirlenemedi',
        deptSource,
        existingCountry: existingCountry || 'Belirtilmemiş',
        normalizedCountry: countryNormalizedVal || 'Belirlenemedi',
        confidence: rowConfidence,
        action
      });
    }

    log.info(`[DRY_RUN] Completed simulation successfully`, { 
      totalAnalyzed: stats.totalAnalyzed,
      formCampaignHigh: stats.formCampaignHigh,
      freeTextHigh: stats.freeTextHigh,
      mediumCandidate: stats.mediumCandidate,
      countryNormalization: stats.countryNormalization,
      skippedDueLocks: stats.skippedDueLocks,
      skippedDueExisting: stats.skippedDueExisting
    });

    return NextResponse.json({ stats, details });

  } catch (error: any) {
    log.error(`[DRY_RUN_FAILED] Error executing dry-run simulation`, error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
