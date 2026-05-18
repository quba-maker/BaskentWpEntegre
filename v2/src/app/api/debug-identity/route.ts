import { IdentityEngine } from '@/lib/services/ai/engines/identity';
import { normalizePhone } from '@/lib/utils/normalize-phone';
import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';

export async function GET() {
  try {
    // get latest lead
    const latestLeads = await sql`
      SELECT id, form_name, raw_data, phone_number, customer_id, tenant_id 
      FROM leads 
      ORDER BY created_at DESC LIMIT 1
    `;
    
    if (!latestLeads || latestLeads.length === 0) {
      return NextResponse.json({ error: 'No leads found' });
    }
    
    const lead = latestLeads[0];
    const normalizedPhone = normalizePhone(lead.phone_number);
    
    const profiles = await sql`SELECT * FROM customer_profiles WHERE primary_phone = ${normalizedPhone} ORDER BY created_at DESC LIMIT 1`;
    const profile = profiles[0];

    let context = null;
    let leadsWithMatchingPhone: any[] = [];
    
    if (profile) {
      context = await IdentityEngine.getContext(profile.id);
      
      leadsWithMatchingPhone = await sql`
        SELECT form_name, raw_data, phone_number 
        FROM leads 
        WHERE tenant_id = ${profile.tenant_id} AND (
          customer_id = ${profile.id} OR 
          REGEXP_REPLACE(phone_number, '\\D', '', 'g') LIKE '%' || RIGHT(${profile.primary_phone}, 10) || '%'
        )
        ORDER BY created_at DESC 
        LIMIT 5
      `;
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
