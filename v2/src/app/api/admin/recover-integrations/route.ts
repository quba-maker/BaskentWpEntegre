import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { logger } from "@/lib/core/logger";

// ==========================================
// QUBA AI — Integration Recovery & Migration
// Run via GET /api/admin/recover-integrations
// ==========================================

export async function GET(req: NextRequest) {
  // Simple protection
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET || 'dev'}`) {
    if (process.env.NODE_ENV === 'production') {
       return new NextResponse("Unauthorized", { status: 401 });
    }
  }

  const log = logger.withContext({ module: 'IntegrationRecovery' });
  const report = {
    recoveredGroups: 0,
    recoveredChannels: 0,
    recoveredIntegrations: 0,
    errors: [] as string[]
  };

  try {
    const tenants = await sql`
      SELECT id, name, slug, whatsapp_phone_id, whatsapp_business_id, meta_page_token, meta_page_id, instagram_id 
      FROM tenants 
      WHERE status = 'active'
    `;

    for (const t of tenants) {
      log.info(`Processing tenant: ${t.name}`);

      const hasWhatsapp = t.whatsapp_phone_id || t.whatsapp_business_id;
      const hasMessenger = t.meta_page_id;
      const hasInstagram = t.instagram_id;

      if (!hasWhatsapp && !hasMessenger && !hasInstagram) continue;

      // 1. Create Default Channel Group if not exists
      const existingGroup = await sql`SELECT id FROM channel_groups WHERE tenant_id = ${t.id} AND name = 'Varsayılan Grup' LIMIT 1`;
      let groupId;

      if (existingGroup.length > 0) {
        groupId = existingGroup[0].id;
      } else {
        const newGroup = await sql`
          INSERT INTO channel_groups (tenant_id, name, description) 
          VALUES (${t.id}, 'Varsayılan Grup', 'Otomatik taşınan entegrasyonlar') 
          RETURNING id
        `;
        groupId = newGroup[0].id;
        report.recoveredGroups++;
      }

      const tokenJson = t.meta_page_token ? JSON.stringify({ accessToken: t.meta_page_token }) : '{}';

      // 2. Migrate WhatsApp
      if (hasWhatsapp) {
        const identifier = t.whatsapp_phone_id || t.whatsapp_business_id;
        const existingChannel = await sql`SELECT id FROM channels WHERE group_id = ${groupId} AND provider = 'whatsapp' AND identifier = ${identifier}`;
        
        if (existingChannel.length === 0) {
          const newCh = await sql`
            INSERT INTO channels (group_id, provider, identifier, name) 
            VALUES (${groupId}, 'whatsapp', ${identifier}, 'WhatsApp') 
            RETURNING id
          `;
          report.recoveredChannels++;
          
          await sql`
            INSERT INTO channel_integrations (channel_id, provider, credentials_encrypted, health_status) 
            VALUES (${newCh[0].id}, 'whatsapp', ${tokenJson}, 'healthy')
          `;
          report.recoveredIntegrations++;
        }
      }

      // 3. Migrate Messenger
      if (hasMessenger) {
        const existingChannel = await sql`SELECT id FROM channels WHERE group_id = ${groupId} AND provider = 'messenger' AND identifier = ${t.meta_page_id}`;
        
        if (existingChannel.length === 0) {
          const newCh = await sql`
            INSERT INTO channels (group_id, provider, identifier, name) 
            VALUES (${groupId}, 'messenger', ${t.meta_page_id}, 'Messenger') 
            RETURNING id
          `;
          report.recoveredChannels++;
          
          await sql`
            INSERT INTO channel_integrations (channel_id, provider, credentials_encrypted, health_status) 
            VALUES (${newCh[0].id}, 'messenger', ${tokenJson}, 'healthy')
          `;
          report.recoveredIntegrations++;
        }
      }

      // 4. Migrate Instagram
      if (hasInstagram) {
        const existingChannel = await sql`SELECT id FROM channels WHERE group_id = ${groupId} AND provider = 'instagram' AND identifier = ${t.instagram_id}`;
        
        if (existingChannel.length === 0) {
          const newCh = await sql`
            INSERT INTO channels (group_id, provider, identifier, name) 
            VALUES (${groupId}, 'instagram', ${t.instagram_id}, 'Instagram') 
            RETURNING id
          `;
          report.recoveredChannels++;
          
          await sql`
            INSERT INTO channel_integrations (channel_id, provider, credentials_encrypted, health_status) 
            VALUES (${newCh[0].id}, 'instagram', ${tokenJson}, 'healthy')
          `;
          report.recoveredIntegrations++;
        }
      }
    }

    log.info("Migration Complete", report);
    return NextResponse.json({ success: true, report });

  } catch (err: any) {
    log.error("Migration Failed", err);
    report.errors.push(err.message);
    return NextResponse.json({ success: false, report, error: err.message }, { status: 500 });
  }
}
