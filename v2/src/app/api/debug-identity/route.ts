import { IdentityEngine } from '@/lib/services/ai/engines/identity';
import { normalizePhone } from '@/lib/utils/normalize-phone';
import { NextResponse, NextRequest } from 'next/server';
import { withTenantDB } from '@/lib/core/tenant-db';

export async function GET(req: NextRequest) {
  // Authorization check using ADMIN_SETUP_KEY or SETUP_KEY
  const authHeader = req.headers.get('authorization') || req.nextUrl.searchParams.get('key');
  const setupKey = process.env.ADMIN_SETUP_KEY || process.env.SETUP_KEY || 'quba-setup-2026';
  
  if (authHeader !== setupKey) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const adminDb = withTenantDB('admin-system', true);
    
    // get latest lead
    const latestLeads = await adminDb.executeSafe({
      text: `
        SELECT id, form_name, raw_data, phone_number, customer_id, tenant_id 
        FROM leads 
        ORDER BY created_at DESC LIMIT 1
      `
    }) as any[];
    
    if (!latestLeads || latestLeads.length === 0) {
      return NextResponse.json({ error: 'No leads found' });
    }
    
    const lead = latestLeads[0];
    const normalizedPhone = normalizePhone(lead.phone_number);
    
    const db = withTenantDB(lead.tenant_id);
    const profiles = await db.executeSafe({
      text: `SELECT * FROM customer_profiles WHERE primary_phone = $1 ORDER BY created_at DESC LIMIT 1`,
      values: [normalizedPhone]
    }) as any[];
    const profile = profiles[0];

    let context = null;
    let leadsWithMatchingPhone: any[] = [];
    
    if (profile) {
      context = await IdentityEngine.getContext(profile.tenant_id, profile.id);
      
      leadsWithMatchingPhone = await db.executeSafe({
        text: `
          SELECT form_name, raw_data, phone_number 
          FROM leads 
          WHERE tenant_id = $1 AND (
            customer_id = $2 OR 
            REGEXP_REPLACE(phone_number, '\\D', '', 'g') LIKE '%' || RIGHT($3, 10) || '%'
          )
          ORDER BY created_at DESC 
          LIMIT 5
        `,
        values: [profile.tenant_id, profile.id, profile.primary_phone]
      }) as any[];
    }

    return NextResponse.json({
      latestLead: lead,
      normalizedPhoneFromLead: normalizedPhone,
      profileFound: !!profile,
      profileId: profile?.id,
      profilePhone: profile?.primary_phone,
      leadsMatchingProfileQuery: leadsWithMatchingPhone,
      generatedContext: context
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message, stack: error.stack }, { status: 500 });
  }
}
