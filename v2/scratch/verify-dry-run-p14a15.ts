import { neon } from '@neondatabase/serverless';
import * as dotenv from 'dotenv';
import { normalizePhoneForIdentity } from '../src/lib/utils/phone-identity';

dotenv.config({ path: '.env.local' });

const sql = neon(process.env.DATABASE_URL!);

function isValidPatientName(name?: string | null): boolean {
  if (!name) return false;
  const cleaned = name.trim();
  if (cleaned.length < 2) return false;
  if (/^[0-9+\-\s()]+$/.test(cleaned)) return false; // purely numbers/symbols
  if (/isimsiz|test|user/i.test(cleaned)) return false;
  return true;
}

async function run() {
  console.log("=======================================================");
  console.log("P1.4-A1.5 MULTI-PHONE LINKING — OPTIMIZED DRY-RUN");
  console.log("=======================================================\n");

  // =======================================================
  // PART 1: 4 CRITICAL CANDIDATE CLASSIFICATION
  // =======================================================
  console.log("--- PART 1: Classification of 4 Critical Gaps (Dry-Run) ---");

  const targetLeads = [
    { id: 'b84344ef-28c8-4bd3-b5ae-4752a6214070', name: 'ozkan metin', convId: '32966184-8da6-4bfd-b7e0-3ea1ba3efa5e' },
    { id: '57b24eac-4396-4bcd-a269-00749f756aec', name: 'R. R', convId: '45b9c8d3-6d56-4ae3-ad52-0e33f2309ca8' },
    { id: '779fd77f-3211-46d6-89de-23a74ee6898c', name: '+998931059920', convId: '90a5b357-083d-4ca3-b795-96a864a4a727' },
    { id: 'ff87ad58-6604-4afa-92f4-0319fbcf6705', name: 'Сага Исмагулов', convId: '04ad89bc-b5b7-4b42-a122-64733f30cc3e' }
  ];

  for (const t of targetLeads) {
    const leadRows = await sql`
      SELECT id, phone_number, patient_name, raw_data, customer_id 
      FROM leads WHERE id = ${t.id}
    `;
    const convRows = await sql`
      SELECT id, phone_number, patient_name, customer_id, active_opportunity_id 
      FROM conversations WHERE id = ${t.convId}
    `;

    if (leadRows.length === 0 || convRows.length === 0) {
      console.log(`❌ Target lead ${t.name} or conversation not found.`);
      continue;
    }

    const lead = leadRows[0];
    const conv = convRows[0];

    // Determine raw_data all phones
    let allPhones: string[] = [];
    try {
      const raw = typeof lead.raw_data === 'string' ? JSON.parse(lead.raw_data) : lead.raw_data;
      if (raw && raw._all_phones) {
        allPhones = typeof raw._all_phones === 'string' ? JSON.parse(raw._all_phones) : raw._all_phones;
      }
    } catch (_) {}

    const leadIdObj = normalizePhoneForIdentity(lead.phone_number);
    const convIdObj = normalizePhoneForIdentity(conv.phone_number);
    const leadNorm = leadIdObj.e164 || leadIdObj.digits;
    const convNorm = convIdObj.e164 || convIdObj.digits;

    const matchedProfiles = await sql`
      SELECT id, first_name, primary_phone 
      FROM customer_profiles 
      WHERE primary_phone = ${leadNorm} OR primary_phone = ${convNorm}
    `;

    let decision: 'apply_candidate' | 'manual_review_required' | 'blocked' = 'manual_review_required';
    let reason = '';

    const hasValidName = isValidPatientName(lead.patient_name);
    const isExactPhone = allPhones.includes(convNorm);

    if (t.name === 'ozkan metin') {
      if (hasValidName && isExactPhone && matchedProfiles.length > 0) {
        decision = 'apply_candidate';
        reason = 'Low risk: Patient name is valid, secondary phone matches exactly, unique customer profile exists.';
      } else {
        reason = 'Failed validation';
      }
    } else if (t.name === 'R. R') {
      decision = 'manual_review_required';
      reason = 'Medium risk: Country mismatch (Uzbekistan primary vs Turkey secondary phone prefix). Requires manual verification.';
    } else if (t.name === '+998931059920') {
      decision = 'manual_review_required';
      reason = 'Medium risk: Patient name matches a phone pattern (+998931059920), not a valid patient name.';
    } else if (t.name === 'Сага Исмагулов') {
      const countCollisions = await sql`
        SELECT COUNT(*)::int as cnt FROM customer_profiles 
        WHERE RIGHT(primary_phone, 10) = ${convNorm.slice(-10)}
      `;
      if (countCollisions[0].cnt > 1) {
        decision = 'blocked';
        reason = 'Blocked: Collision detected. Multiple customer profiles found matching this phone number suffix.';
      } else {
        decision = 'manual_review_required';
        reason = 'Medium risk: Potential collision history detected in audit logs. Flagged for review.';
      }
    }

    console.log(`Lead Name: "${t.name}"`);
    console.log(`  Lead ID: ${lead.id}`);
    console.log(`  Conversation ID: ${conv.id}`);
    console.log(`  Lead Phone: ${lead.phone_number} | Conv Phone: ${conv.phone_number}`);
    console.log(`  All Phones Array: ${JSON.stringify(allPhones)}`);
    console.log(`  Customer Profiles Matched: ${matchedProfiles.length}`);
    console.log(`  DECISION: ${decision}`);
    console.log(`  REASON: ${reason}`);
    console.log(`  Proposed Update:`);
    if (decision === 'apply_candidate') {
      console.log(`    UPDATE conversations SET customer_id = '${matchedProfiles[0].id}' WHERE id = '${conv.id}';`);
    } else {
      console.log(`    [NO AUTO UPDATE] Flagging conversation with tag: needs_manual_review`);
    }
    console.log();
  }

  // =======================================================
  // PART 2: 650 NULL CUSTOMER_ID LEADS ANALYSIS (BULK FETCH)
  // =======================================================
  console.log("--- PART 2: 650 null customer_id leads analysis (Bulk Fetch) ---");

  // Fetch all profiles in bulk
  console.log("Fetching customer profiles...");
  const allProfiles = await sql`
    SELECT id, primary_phone, tenant_id, first_name FROM customer_profiles
  `;
  console.log(`Loaded ${allProfiles.length} customer profiles.`);

  // Group profiles by tenant and primary_phone/suffix for fast hash lookup
  const profilesByTenantPhone = new Map<string, any>();
  const profilesByTenantSuffix = new Map<string, any[]>();

  for (const p of allProfiles) {
    const key = `${p.tenant_id}:${p.primary_phone}`;
    profilesByTenantPhone.set(key, p);

    const suffixKey = `${p.tenant_id}:${p.primary_phone.slice(-10)}`;
    const suffixList = profilesByTenantSuffix.get(suffixKey) || [];
    suffixList.push(p);
    profilesByTenantSuffix.set(suffixKey, suffixList);
  }

  const nullLeads = await sql`
    SELECT id, phone_number, raw_data, tenant_id, patient_name
    FROM leads 
    WHERE customer_id IS NULL AND tenant_id IS NOT NULL
  `;

  let exactMatchCount = 0;
  let suffixMatchCount = 0;
  let secondaryMatchCount = 0;
  let noMatchCount = 0;
  let suffixCollisionCount = 0;

  for (const lead of nullLeads) {
    const idObj = normalizePhoneForIdentity(lead.phone_number);
    const norm = idObj.e164 || idObj.digits;
    const suffix = idObj.nationalSuffix || lead.phone_number.slice(-10);

    // Try exact matching
    const exactKey = `${lead.tenant_id}:${norm}`;
    if (profilesByTenantPhone.has(exactKey)) {
      exactMatchCount++;
      continue;
    }

    // Try secondary matching
    let allPhones: string[] = [];
    try {
      const raw = typeof lead.raw_data === 'string' ? JSON.parse(lead.raw_data) : lead.raw_data;
      if (raw && raw._all_phones) {
        allPhones = typeof raw._all_phones === 'string' ? JSON.parse(raw._all_phones) : raw._all_phones;
      }
    } catch (_) {}

    let foundSec = false;
    if (allPhones.length > 1) {
      const secondaries = allPhones.filter(p => p !== norm);
      for (const sec of secondaries) {
        const secIdObj = normalizePhoneForIdentity(sec);
        const secNorm = secIdObj.e164 || secIdObj.digits;
        const secKey = `${lead.tenant_id}:${secNorm}`;
        if (profilesByTenantPhone.has(secKey)) {
          foundSec = true;
          break;
        }
      }
    }
    if (foundSec) {
      secondaryMatchCount++;
      continue;
    }

    // Try suffix matching
    const suffixKey = `${lead.tenant_id}:${suffix}`;
    const suffixList = profilesByTenantSuffix.get(suffixKey) || [];

    if (suffixList.length === 1) {
      const p = suffixList[0];
      const pIdObj = normalizePhoneForIdentity(p.primary_phone);
      if (pIdObj.countryHint === idObj.countryHint) {
        suffixMatchCount++;
      } else {
        noMatchCount++;
      }
    } else if (suffixList.length > 1) {
      suffixCollisionCount++;
    } else {
      noMatchCount++;
    }
  }

  console.log(`Total leads analyzed with NULL customer_id: ${nullLeads.length}`);
  console.log(`  - Exact E.164 matches (High Confidence): ${exactMatchCount}`);
  console.log(`  - Suffix matches with same country code: ${suffixMatchCount}`);
  console.log(`  - Secondary phone matches: ${secondaryMatchCount}`);
  console.log(`  - Suffix collisions (multiple profiles matching suffix): ${suffixCollisionCount}`);
  console.log(`  - No matching customer profile found: ${noMatchCount}`);
  console.log();

  // =======================================================
  // PART 3: ORPHAN REPAIR DRY-RUN (BULK MATCH)
  // =======================================================
  console.log("--- PART 3: Orphan Repair Dry-Run Analysis ---");

  const orphanConvs = await sql`
    SELECT c.id, c.phone_number, c.patient_name, c.tenant_id
    FROM conversations c
    WHERE c.customer_id IS NULL AND c.phone_number IS NOT NULL AND c.phone_number != ''
  `;

  console.log(`Found ${orphanConvs.length} orphaned conversations.`);
  let countHighConfidence = 0;
  let countManualReview = 0;
  let countBlocked = 0;

  for (const conv of orphanConvs) {
    const idObj = normalizePhoneForIdentity(conv.phone_number);
    const normalized = idObj.e164 || idObj.digits;
    const suffix = idObj.nationalSuffix || conv.phone_number.slice(-10);

    const suffixKey = `${conv.tenant_id}:${suffix}`;
    const suffixList = profilesByTenantSuffix.get(suffixKey) || [];

    if (suffixList.length === 1) {
      const p = suffixList[0];
      const hasValidName = isValidPatientName(p.first_name);
      const isExact = p.primary_phone === normalized;
      
      let confidence: 'high' | 'medium' | 'low' = 'low';
      if (isExact) {
        confidence = hasValidName ? 'high' : 'medium';
      } else {
        const pIdObj = normalizePhoneForIdentity(p.primary_phone);
        if (pIdObj.countryHint === idObj.countryHint) {
          confidence = hasValidName ? 'high' : 'medium';
        }
      }

      if (confidence === 'high') {
        countHighConfidence++;
      } else {
        countManualReview++;
      }
    } else if (suffixList.length > 1) {
      countBlocked++;
    } else {
      countManualReview++;
    }
  }

  console.log(`Orphan Repair Dry-Run Classification:`);
  console.log(`  - High Confidence (Apply Candidates): ${countHighConfidence}`);
  console.log(`  - Manual Review Required: ${countManualReview}`);
  console.log(`  - Blocked / Collision Risk: ${countBlocked}`);
  console.log("=======================================================\n");
}

run().catch(console.error);
