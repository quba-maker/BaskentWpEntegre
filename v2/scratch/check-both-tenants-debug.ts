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
      console.log(`[dbMock.executeSafe] QUERY:`, query.text.replace(/\s+/g, ' '));
      console.log(`[dbMock.executeSafe] VALUES:`, query.values);
      const res = await sql.query(query.text, query.values);
      const rows = Array.isArray(res) ? res : (res ? ((res as any).rows || []) : []);
      console.log(`[dbMock.executeSafe] RESULT COUNT:`, rows.length);
      return rows;
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
  });
}

async function main() {
  await checkForTenant('caab9ea1-9591-45e4-bbc5-9c9b498982c8', 'Başkent Üniversitesi (baskent)');
}

main().catch(console.error);
