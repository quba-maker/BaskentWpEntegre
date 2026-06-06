import * as path from 'path';
import * as fs from 'fs';
import { config } from 'dotenv';
import { neon } from '@neondatabase/serverless';
import { TemplateResolverService } from '../src/lib/services/template-resolver.service';
import { FormGreetingHandoffService } from '../src/lib/services/form-greeting-handoff.service';

const envPath = path.join(__dirname, '../.env.local');
if (fs.existsSync(envPath)) {
  config({ path: envPath });
}

const dbUrl = process.env.DATABASE_URL;
const sql = neon(dbUrl!);

const dbMock: any = {
  executeSafe: async (query: any) => {
    try {
      const res = await sql.query(query.text, query.values);
      return res.rows;
    } catch (err: any) {
      console.error("DB Error in executeSafe:", err.message);
      throw err;
    }
  }
};

async function checkForTenant(tenantId: string, tenantName: string) {
  const leadId = '0cd8a537-c9b9-4273-94dd-c78f220233ec';
  
  // Fetch lead
  const leads = await sql`
    SELECT id, phone_number, patient_name, form_name,
           linked_opportunity_id, customer_id, country, raw_data, created_at
    FROM leads
    WHERE id = ${leadId}::uuid
  `;

  if (leads.length === 0) {
    console.log(`Lead not found for tenant: ${tenantName}`);
    return;
  }

  const lead = leads[0];
  const phone = lead.phone_number;

  const inbounds = await sql`
    SELECT id FROM messages 
    WHERE tenant_id = ${tenantId}::uuid AND RIGHT(phone_number, 10) = RIGHT(${phone}, 10) AND direction = 'in'
  `;
  const hardBlockedBecausePatientAlreadyInbound = inbounds.length > 0;

  const oppId = lead.linked_opportunity_id || null;
  let conversationId = null;
  if (oppId) {
    const opp = await sql`
      SELECT conversation_id FROM opportunities WHERE id = ${oppId}::uuid AND tenant_id = ${tenantId}::uuid LIMIT 1
    `;
    conversationId = opp[0]?.conversation_id || null;
  }
  if (!conversationId) {
    const convRes = await sql`
      SELECT id FROM conversations WHERE tenant_id = ${tenantId}::uuid AND RIGHT(phone_number, 10) = RIGHT(${phone}, 10) LIMIT 1
    `;
    conversationId = convRes[0]?.id || null;
  }

  // Resolve greeting language config
  let greetingLang = 'auto';
  const profileRes = await sql`
    SELECT cap.greeting_language FROM channel_ai_profiles cap
    JOIN channel_groups cg ON cap.group_id = cg.id
    WHERE cg.tenant_id = ${tenantId}::uuid AND cg.status = 'active'
    ORDER BY cg.sort_order ASC LIMIT 1
  `;
  if (profileRes.length > 0) {
    greetingLang = profileRes[0].greeting_language || 'auto';
  }

  let leadLanguage: string | undefined;
  let leadDepartment: string | undefined;
  try {
    const rawData = typeof lead.raw_data === 'string' ? JSON.parse(lead.raw_data) : (lead.raw_data || {});
    leadLanguage = rawData.language || rawData.Language || rawData.dil || rawData.Dil || undefined;
    leadDepartment = rawData.department || rawData.Department || rawData.departman || rawData.Departman || rawData.bolum || rawData.Bölüm || undefined;
  } catch (_) {}

  const resolved = await TemplateResolverService.resolve(dbMock, {
    tenantId,
    tenantName,
    patientName: lead.patient_name || '',
    formName: lead.form_name || undefined,
    department: leadDepartment || undefined,
    country: lead.country || undefined,
    phoneNumber: phone,
  }, greetingLang);

  const hasRealTemplate = resolved.templateId !== null && resolved.source !== 'system_hardcoded';
  const isNonCompliant = resolved.template_non_compliant || false;

  console.log(`[Tenant: ${tenantName}] Readiness:`, {
    templateConfigExists: hasRealTemplate,
    templateName: resolved.templateName,
    templateNonCompliant: isNonCompliant,
    source: resolved.source,
    isWithin24hWindow: false,
  });
}

async function main() {
  await checkForTenant('caab9ea1-9591-45e4-bbc5-9c9b498982c8', 'Başkent Üniversitesi (baskent)');
  await checkForTenant('7ac1432a-a432-497a-8526-9394f51d0e2a', 'Başkent Hastanesi Shadow (baskent-shadow)');
}

main().catch(console.error);
