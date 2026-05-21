import { NextRequest, NextResponse } from "next/server";
import { withTenantDB } from "@/lib/core/tenant-db";
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
    const systemDb = withTenantDB('admin-system', true);
    const tenants = await systemDb.executeSafe({
      text: `
        SELECT id, name, slug, whatsapp_phone_id, whatsapp_business_id, meta_page_token, meta_page_id, instagram_id 
        FROM tenants 
        WHERE status = 'active'
      `
    }) as any[];

    for (const t of tenants) {
      log.info(`Processing tenant: ${t.name}`);

      const hasWhatsapp = t.whatsapp_phone_id || t.whatsapp_business_id;
      const hasMessenger = t.meta_page_id;
      const hasInstagram = t.instagram_id;

      if (!hasWhatsapp && !hasMessenger && !hasInstagram) continue;

      // 1. Create Default Channel Group if not exists
      const existingGroup = await systemDb.executeSafe({
        text: `SELECT id FROM channel_groups WHERE tenant_id = $1 AND name = 'Varsayılan Grup' LIMIT 1`,
        values: [t.id]
      }) as any[];
      let groupId;

      if (existingGroup.length > 0) {
        groupId = existingGroup[0].id;
      } else {
        const newGroup = await systemDb.executeSafe({
          text: `
            INSERT INTO channel_groups (tenant_id, name, description) 
            VALUES ($1, 'Varsayılan Grup', 'Otomatik taşınan entegrasyonlar') 
            RETURNING id
          `,
          values: [t.id]
        }) as any[];
        groupId = newGroup[0].id;
        report.recoveredGroups++;
      }

      const tokenJson = t.meta_page_token ? JSON.stringify({ accessToken: t.meta_page_token }) : '{}';

      // 2. Migrate WhatsApp
      if (hasWhatsapp) {
        const identifier = t.whatsapp_phone_id || t.whatsapp_business_id;
        const existingChannel = await systemDb.executeSafe({
          text: `SELECT id FROM channels WHERE group_id = $1 AND provider = 'whatsapp' AND identifier = $2`,
          values: [groupId, identifier]
        }) as any[];
        
        if (existingChannel.length === 0) {
          const newCh = await systemDb.executeSafe({
            text: `
              INSERT INTO channels (group_id, provider, identifier, name) 
              VALUES ($1, 'whatsapp', $2, 'WhatsApp') 
              RETURNING id
            `,
            values: [groupId, identifier]
          }) as any[];
          report.recoveredChannels++;
          
          await systemDb.executeSafe({
            text: `
              INSERT INTO channel_integrations (channel_id, provider, credentials_encrypted, health_status) 
              VALUES ($1, 'whatsapp', $2, 'healthy')
            `,
            values: [newCh[0].id, tokenJson]
          });
          report.recoveredIntegrations++;
        }
      }

      // 3. Migrate Messenger
      if (hasMessenger) {
        const existingChannel = await systemDb.executeSafe({
          text: `SELECT id FROM channels WHERE group_id = $1 AND provider = 'messenger' AND identifier = $2`,
          values: [groupId, t.meta_page_id]
        }) as any[];
        
        if (existingChannel.length === 0) {
          const newCh = await systemDb.executeSafe({
            text: `
              INSERT INTO channels (group_id, provider, identifier, name) 
              VALUES ($1, 'messenger', $2, 'Messenger') 
              RETURNING id
            `,
            values: [groupId, t.meta_page_id]
          }) as any[];
          report.recoveredChannels++;
          
          await systemDb.executeSafe({
            text: `
              INSERT INTO channel_integrations (channel_id, provider, credentials_encrypted, health_status) 
              VALUES ($1, 'messenger', $2, 'healthy')
            `,
            values: [newCh[0].id, tokenJson]
          });
          report.recoveredIntegrations++;
        }
      }

      // 4. Migrate Instagram
      if (hasInstagram) {
        const existingChannel = await systemDb.executeSafe({
          text: `SELECT id FROM channels WHERE group_id = $1 AND provider = 'instagram' AND identifier = $2`,
          values: [groupId, t.instagram_id]
        }) as any[];
        
        if (existingChannel.length === 0) {
          const newCh = await systemDb.executeSafe({
            text: `
              INSERT INTO channels (group_id, provider, identifier, name) 
              VALUES ($1, 'instagram', $2, 'Instagram') 
              RETURNING id
            `,
            values: [groupId, t.instagram_id]
          }) as any[];
          report.recoveredChannels++;
          
          await systemDb.executeSafe({
            text: `
              INSERT INTO channel_integrations (channel_id, provider, credentials_encrypted, health_status) 
              VALUES ($1, 'instagram', $2, 'healthy')
            `,
            values: [newCh[0].id, tokenJson]
          });
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
