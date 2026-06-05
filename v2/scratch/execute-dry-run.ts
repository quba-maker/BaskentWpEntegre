import * as fs from 'fs';
import * as path from 'path';

// Load .env.local manually before importing database service
try {
  const envPath = path.resolve(__dirname, '../.env.local');
  if (fs.existsSync(envPath)) {
    const envConfig = fs.readFileSync(envPath, 'utf8');
    for (const line of envConfig.split('\n')) {
      const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
      if (match) {
        const key = match[1];
        let val = match[2] || '';
        if (val.startsWith('"') && val.endsWith('"')) {
          val = val.substring(1, val.length - 1);
        }
        process.env[key] = val;
      }
    }
  }
} catch (e) {
  console.error("Failed to load .env.local", e);
}

async function runDryRun() {
  const { withTenantDB } = await import("../src/lib/core/tenant-db");
  const { extractFormFields } = await import("../src/lib/utils/form-field-extractor");
  const { normalizeCountry } = await import("../src/lib/utils/country-normalizer");
  const { extractFromPatientMessageDeterministic, shouldRunAiExtractor } = await import("../src/lib/utils/patient-message-extractor");

  const tenantId = "caab9ea1-9591-45e4-bbc5-9c9b498982c8"; // Target tenant UUID
  const db = withTenantDB(tenantId);

  console.log("Fetching conversations and leads...");
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

  console.log(`Loaded ${conversations.length} conversations and ${leads.length} leads.`);

  const stats = {
    totalAnalyzed: conversations.length,
    emptyDepartment: 0,
    formCampaignHigh: 0,
    freeTextHigh: 0,
    mediumCandidate: 0,
    countryNormalization: 0,
    skippedDueLocks: 0,
    skippedDueExisting: 0,
    departmentConflicts: 0,
    noChange: 0
  };

  const details = [];

  const { resolveDepartmentWithConflict } = await import("../src/lib/utils/crm-conflict-resolver");

  for (const c of conversations) {
    const oppMetadata = typeof c.opp_metadata === 'string' ? JSON.parse(c.opp_metadata) : (c.opp_metadata || {});
    const isDeptLocked = oppMetadata.department_locked === true;
    const isCountryLocked = oppMetadata.country_locked === true;
    const existingDept = c.opp_department || c.department || null;
    const existingCountry = c.opp_country || c.country || null;

    if (!existingDept) {
      stats.emptyDepartment++;
    }

    const phoneNumber = c.phone_number || '';
    const cleanPhone = phoneNumber.replace(/\D/g, '');

    // Multi-Phone Lead Routing Lookup matching worker logic
    let matchedLead: any = null;
    if (c.customer_id) {
      matchedLead = leads.find(l => l.customer_id === c.customer_id);
    }
    if (!matchedLead && cleanPhone) {
      matchedLead = leads.find(l => l.phone_number?.replace(/\D/g, '') === cleanPhone);
    }
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
    if (!matchedLead && cleanPhone.length >= 10) {
      const last10 = cleanPhone.slice(-10);
      const suffixMatches = leads.filter(l => l.phone_number?.replace(/\D/g, '').endsWith(last10));
      if (suffixMatches.length === 1) {
        matchedLead = suffixMatches[0];
      }
    }

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

    const resolvedDeptObj = resolveDepartmentWithConflict({
      existingDept,
      formCampaignDept: formExt?.departmentSource === 'campaign_name' || formExt?.departmentSource === 'form_name' ? formExt.department : null,
      formCampaignConfidence: formExt?.departmentSource === 'campaign_name' || formExt?.departmentSource === 'form_name' ? formExt.confidence : 0,
      formComplaintDept: formExt?.departmentSource === 'complaint_keyword' ? formExt.department : null,
      formComplaintConfidence: formExt?.departmentSource === 'complaint_keyword' ? formExt.confidence : 0,
      patientMsgDept: msgExt?.departmentCandidate || null,
      patientMsgConfidence: msgExt?.departmentConfidence || 'low',
      isLocked: isDeptLocked
    });

    const candidateDept = resolvedDeptObj.suggestedDept;
    const deptConfidence = resolvedDeptObj.confidence;
    const deptSource = resolvedDeptObj.source;
    const hasConflict = resolvedDeptObj.hasConflict;
    const writeAllowed = resolvedDeptObj.writeAllowed;

    const rawCountryText = formExt?.country || existingCountry || null;
    const norm = normalizeCountry(rawCountryText, phoneNumber);
    
    const isCountryDirtyVal = rawCountryText !== null && (rawCountryText.toLowerCase() === 'tc d' || rawCountryText.toLowerCase() === 'tcd' || rawCountryText.toLowerCase() === 'tc');
    const countryNormalizedVal = norm.country;
    const countryConf = norm.countryConfidence;

    let action = 'No Change';

    if (hasConflict) {
      stats.departmentConflicts++;
      action = `Conflict: ${resolvedDeptObj.conflictReason}`;
    } else if (isDeptLocked || isCountryLocked) {
      stats.skippedDueLocks++;
      action = 'Skipped (Locked)';
    } else if (existingDept) {
      stats.skippedDueExisting++;
      action = 'Skipped (Exists)';
    } else if (deptConfidence === 'high') {
      if (deptSource === 'form_campaign') {
        stats.formCampaignHigh++;
      } else {
        stats.freeTextHigh++;
      }
      action = `Update: ${candidateDept}`;
    } else if (deptConfidence === 'medium') {
      stats.mediumCandidate++;
      action = `Suggested Candidate: ${candidateDept}`;
    } else {
      stats.noChange++;
    }

    if (countryNormalizedVal && isCountryDirtyVal) {
      stats.countryNormalization++;
    }

    details.push({
      conversationId: c.conversation_id,
      patientName: c.patient_name || 'İsimsiz Hasta',
      current_department: existingDept || 'Belirtilmemiş',
      suggested_department: candidateDept || 'Belirlenemedi',
      department_confidence: deptConfidence.toUpperCase(),
      current_country: existingCountry || 'Belirtilmemiş',
      suggested_country: countryNormalizedVal || 'Belirlenemedi',
      country_confidence: countryConf.toUpperCase(),
      recommended_action: action,
      write_allowed: writeAllowed ? 'Yes' : 'No',
      form_campaign_department: formExt?.departmentSource === 'campaign_name' || formExt?.departmentSource === 'form_name' ? formExt.department : null,
      patient_message_department: msgExt?.departmentCandidate || null,
      has_department_conflict: hasConflict
    });
  }

  console.log("\n==================================================");
  console.log("DRY-RUN STATS:");
  console.log("==================================================");
  console.log(JSON.stringify(stats, null, 2));
  console.log("==================================================");

  console.log("\n==================================================");
  console.log("CONFLICT CASES:");
  console.log("==================================================");
  console.log(JSON.stringify(details.filter(d => d.has_department_conflict), null, 2));
  console.log("==================================================");

  // console.log("\n10 SAMPLE CASES TABLE:");
  // console.table(details.slice(0, 10));
}

runDryRun().catch(console.error);
