import { NextResponse } from 'next/server';
import { withTenantDB } from '@/lib/core/tenant-db';
import { normalizePhoneForIdentity } from '@/lib/utils/phone-identity';

function isValidPatientName(name?: string | null): boolean {
  if (!name) return false;
  const cleaned = name.trim();
  if (cleaned.length < 2) return false;
  if (/^[0-9+\-\s()]+$/.test(cleaned)) return false; // purely numbers/symbols
  if (/isimsiz|test|user/i.test(cleaned)) return false;
  return true;
}

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const apply = searchParams.get('apply') === 'true';
  const tenantIdParam = searchParams.get('tenant_id');

  try {
    const sysDb = withTenantDB('admin-system', true);
    const tenantRes = await sysDb.executeSafe({
      text: `SELECT id, name FROM tenants`
    }) as any[];

    const activeTenants = tenantIdParam 
      ? tenantRes.filter(t => t.id === tenantIdParam)
      : tenantRes;

    const report: any = {
      success: true,
      mode: apply ? 'live' : 'dry-run',
      timestamp: new Date().toISOString(),
      tenantsRun: activeTenants.map(t => t.name),
      summary: {
        totalAnalyzed: 0,
        appliedLinks: 0,
        manualReviewRequired: 0,
        blocked: 0
      },
      results: [] as any[],
      rollbackSql: [] as string[]
    };

    for (const tenant of activeTenants) {
      const db = withTenantDB(tenant.id);

      // Find conversations missing customer profiles
      const orphans = await db.executeSafe({
        text: `SELECT id, phone_number, patient_name, tags 
               FROM conversations 
               WHERE customer_id IS NULL AND phone_number IS NOT NULL`
      }) as any[];

      for (const conv of orphans) {
        report.summary.totalAnalyzed++;

        const phone = conv.phone_number;
        const idObj = normalizePhoneForIdentity(phone);
        const normalized = idObj.e164 || idObj.digits;
        const suffix = idObj.nationalSuffix || phone.slice(-10);

        // 1. Check direct matches in customer_profiles
        let profiles = await db.executeSafe({
          text: `SELECT id, first_name, primary_phone 
                 FROM customer_profiles 
                 WHERE tenant_id = $1 AND (primary_phone = $2 OR RIGHT(primary_phone, 10) = $3)`,
          values: [tenant.id, normalized, suffix]
        }) as any[];

        let matchReason = '';
        let confidence: 'high' | 'medium' | 'low' = 'low';

        // 2. If no direct match, check leads (handling secondary phones containment)
        if (profiles.length === 0) {
          const leadMatch = await db.executeSafe({
            text: `
              SELECT DISTINCT customer_id 
              FROM leads 
              WHERE tenant_id = $1 
                AND customer_id IS NOT NULL 
                AND (
                  phone_number = $2 
                  OR (
                    raw_data IS NOT NULL 
                    AND raw_data != ''
                    AND raw_data LIKE '%_all_phones%'
                    AND (
                      CASE
                        WHEN jsonb_typeof(raw_data::jsonb->'_all_phones') = 'array' 
                          THEN (raw_data::jsonb->'_all_phones') @> jsonb_build_array($2)
                        WHEN jsonb_typeof(raw_data::jsonb->'_all_phones') = 'string' 
                          THEN (raw_data::jsonb->>'_all_phones')::jsonb @> jsonb_build_array($2)
                        ELSE false
                      END
                    )
                  )
                )
            `,
            values: [tenant.id, normalized]
          }) as any[];

          if (leadMatch.length === 1) {
            const pRes = await db.executeSafe({
              text: `SELECT id, first_name, primary_phone FROM customer_profiles WHERE id = $1 AND tenant_id = $2`,
              values: [leadMatch[0].customer_id, tenant.id]
            }) as any[];
            if (pRes.length === 1) {
              profiles = pRes;
              matchReason = 'lead_linked_customer';
            }
          }
        } else {
          matchReason = profiles[0].primary_phone === normalized ? 'exact_phone' : 'suffix_match';
        }

        let status: 'apply_candidate' | 'manual_review_required' | 'blocked' = 'manual_review_required';
        let matchedProfile = null;

        if (profiles.length === 1) {
          matchedProfile = profiles[0];
          const isValidName = isValidPatientName(matchedProfile.first_name);

          if (matchReason === 'exact_phone') {
            confidence = isValidName ? 'high' : 'medium';
          } else if (matchReason === 'lead_linked_customer') {
            confidence = isValidName ? 'high' : 'medium';
          } else if (matchReason === 'suffix_match') {
            // Check country compatibility
            const pIdObj = normalizePhoneForIdentity(matchedProfile.primary_phone);
            if (pIdObj.countryHint === idObj.countryHint) {
              confidence = isValidName ? 'high' : 'medium';
            } else {
              confidence = 'low';
              matchReason = 'suffix_country_mismatch';
            }
          }

          if (confidence === 'high') {
            status = 'apply_candidate';
          } else {
            status = 'manual_review_required';
          }
        } else if (profiles.length > 1) {
          confidence = 'low';
          matchReason = 'multiple_profiles_collision';
          status = 'blocked';
        } else {
          confidence = 'low';
          matchReason = 'no_matching_profile';
          status = 'manual_review_required';
        }

        const details = {
          tenant_name: tenant.name,
          tenant_id: tenant.id,
          conversation_id: conv.id,
          phone_number: phone,
          patient_name: conv.patient_name,
          confidence,
          match_reason: matchReason,
          status,
          target_customer: matchedProfile ? {
            id: matchedProfile.id,
            name: matchedProfile.first_name,
            phone: matchedProfile.primary_phone
          } : null
        };

        report.results.push(details);

        if (status === 'apply_candidate') {
          if (apply) {
            // Live Apply
            await db.executeSafe({
              text: `UPDATE conversations SET customer_id = $1 WHERE id = $2 AND tenant_id = $3`,
              values: [matchedProfile.id, conv.id, tenant.id]
            });

            // Write audit log
            await db.executeSafe({
              text: `INSERT INTO ai_audit_logs (tenant_id, action, reasoning_summary, result_summary)
                     VALUES ($1, $2, $3, $4)`,
              values: [
                tenant.id,
                'orphan_repair_linked',
                `Linked conversation ${conv.id} to customer ${matchedProfile.id} via match reason: ${matchReason}`,
                JSON.stringify({
                  conversation_id: conv.id,
                  phone_number: phone,
                  customer_id: matchedProfile.id,
                  confidence
                })
              ]
            });

            report.summary.appliedLinks++;
            report.rollbackSql.push(
              `-- Rollback link for conv ${conv.id} on tenant ${tenant.id}\nUPDATE conversations SET customer_id = NULL WHERE id = '${conv.id}' AND tenant_id = '${tenant.id}';`
            );
          } else {
            // Dry Run
            report.summary.appliedLinks++;
            report.rollbackSql.push(
              `-- Dry-run rollback simulation for conv ${conv.id} on tenant ${tenant.id}\nUPDATE conversations SET customer_id = NULL WHERE id = '${conv.id}' AND tenant_id = '${tenant.id}';`
            );
          }
        } else if (status === 'manual_review_required') {
          report.summary.manualReviewRequired++;
        } else if (status === 'blocked') {
          report.summary.blocked++;
        }
      }
    }

    return NextResponse.json(report);
  } catch (error: any) {
    console.error('Orphan repair error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
