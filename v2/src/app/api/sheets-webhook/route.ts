import { NextRequest, NextResponse } from 'next/server';
import { withTenantDB } from '@/lib/core/tenant-db';
import { logger } from '@/lib/core/logger';
import { CredentialsService } from '@/lib/services/credentials.service';

const log = logger.withContext({ module: 'SheetsWebhook' });

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { sheetName, data } = body;

    // Tenant belirleme (query param veya body'den)
    const tenantSlug = request.nextUrl.searchParams.get('tenant') || body.tenant_slug;
    const systemDb = withTenantDB('admin-system', true);
    
    let tenantId: string | null = null;
    let tenantMeta: any = null;
    if (tenantSlug) {
      const tenants = await systemDb.executeSafe({
        text: `SELECT id, name FROM tenants WHERE slug = $1 AND status = 'active'`,
        values: [tenantSlug]
      }) as any[];
      if (tenants && tenants.length > 0) {
        tenantId = tenants[0].id;
        tenantMeta = tenants[0];
      }
    }
    // Fallback: tenant yoksa baskent'i kullan (geriye uyumluluk)
    if (!tenantId) {
      const fallback = await systemDb.executeSafe({
        text: `SELECT id, name FROM tenants WHERE slug = 'baskent' LIMIT 1`,
        values: []
      }) as any[];
      if (fallback && fallback.length > 0) {
        tenantId = fallback[0].id;
        tenantMeta = fallback[0];
      }
    }

    if (!tenantId) {
      return NextResponse.json({ success: false, error: 'No active tenant found' }, { status: 404 });
    }

    const db = withTenantDB(tenantId);

    // Sheet config — tenant bazlı kontrol
    let activeSheets: string[] = [];
    try {
      const configRes = await db.executeSafe({
        text: `SELECT value FROM settings WHERE key = 'google_sheets_config' AND tenant_id = $1 LIMIT 1`,
        values: [tenantId]
      }) as any[];
      if (configRes && configRes.length > 0) {
        activeSheets = JSON.parse(configRes[0].value)?.activeSheets || [];
      }
    } catch (e) {}
    
    // Allow if activeSheets is empty (not configured yet) OR if sheetName is in activeSheets
    if (activeSheets.length > 0 && !activeSheets.includes(sheetName)) {
      return NextResponse.json({ success: true, message: `Sheet '${sheetName}' is ignored by configuration.` });
    }

    if (!data) {
      return NextResponse.json({ success: false, error: 'No data provided' }, { status: 400 });
    }

    // Convert keys to lowercase for robust matching
    const rowKeys = Object.keys(data);
    const lowercaseData: Record<string, any> = {};
    rowKeys.forEach(k => {
      lowercaseData[k.toLowerCase().trim()] = data[k];
    });

    // 2. Find critical columns (Madde 6: Priority on whatsapp_number, fallback to phone)
    const keys = Object.keys(lowercaseData);
    
    // Find WhatsApp Number first
    let primaryPhoneKey = keys.find(h => h.includes('whatsapp') || h.includes('iletişim') || h.includes('wp'));
    let secondaryPhoneKey = keys.find(h => h.includes('telefon') || h.includes('phone') || h === 'numara' || h.includes('cep'));
    
    if (!primaryPhoneKey && secondaryPhoneKey) {
      primaryPhoneKey = secondaryPhoneKey;
      secondaryPhoneKey = undefined;
    }

    const nameKey = keys.find(h => 
      !h.endsWith('id') && !h.endsWith('_id') && !h.includes(' id') &&
      (h.includes('isim') || h.includes('soyad') || h === 'ad' || h === 'adı' || h === 'adınız' || h === 'name' || h === 'full name' || h === 'full_name')
    );
    const emailKey = keys.find(h => h.includes('mail') || h.includes('e-posta'));
    const countryKey = keys.find(h => h.includes('ülke') || h.includes('country'));
    const dateKey = keys.find(h => h.includes('tarih') || h.includes('date') || h.includes('created') || h.includes('zaman') || h.includes('time'));
    const noteKey = keys.find(h => 
      h === 'not' || h === 'notlar' || h === 'notes' || h === 'note' || h.includes('geri dönüş') || h.includes('açıklama') || h.includes('feedback') || h === 'açıklamalar'
    );
    const formNameKey = keys.find(h => 
      !h.endsWith('id') && !h.endsWith('_id') && !h.includes(' id') &&
      (h.includes('form adı') || h.includes('form name') || h.includes('form_name') || 
       h.includes('kampanya adı') || h.includes('campaign_name') || h.includes('campaign name') || 
       h === 'kampanya' || h === 'campaign' || h === 'form')
    );

    if (!primaryPhoneKey) {
      return NextResponse.json({ success: false, error: 'Phone/WhatsApp column not found' }, { status: 400 });
    }

    // Clean Phone Numbers
    let phone1 = String(lowercaseData[primaryPhoneKey] || '').replace(/[^0-9]/g, '');
    let phone2 = secondaryPhoneKey ? String(lowercaseData[secondaryPhoneKey] || '').replace(/[^0-9]/g, '') : '';
    
    // Auto-fix TR numbers
    if (phone1.startsWith('0')) phone1 = '90' + phone1.substring(1);
    if (phone2.startsWith('0')) phone2 = '90' + phone2.substring(1);
    
    if (phone1.length < 10 && phone2.length >= 10) {
      phone1 = phone2;
      phone2 = '';
    }

    if (phone1.length < 10) {
      return NextResponse.json({ success: false, error: 'Invalid phone number length' }, { status: 400 });
    }
    
    phone1 = phone1.substring(0, 20);
    phone2 = phone2.substring(0, 20);

    let name = nameKey && lowercaseData[nameKey] ? String(lowercaseData[nameKey]).substring(0, 100) : null;
    let email = emailKey && lowercaseData[emailKey] ? String(lowercaseData[emailKey]).substring(0, 200) : null;
    let formName = formNameKey && lowercaseData[formNameKey] ? String(lowercaseData[formNameKey]).substring(0, 200) : 'Google Sheets';
    let dateStr = dateKey && lowercaseData[dateKey] ? String(lowercaseData[dateKey]) : null;
    let noteStr = noteKey && lowercaseData[noteKey] ? String(lowercaseData[noteKey]).substring(0, 5000) : null;

    const raw_data = { ...data };
    const country = countryKey ? String(lowercaseData[countryKey]) : null;
    if (country) {
      raw_data['country'] = country;
    }

    // 3. Upsert into DB using phone1
    const existing = await db.executeSafe({
      text: `SELECT id FROM leads WHERE phone_number LIKE '%' || RIGHT($1, 10) || '%' AND tenant_id = $2 LIMIT 1`,
      values: [phone1, tenantId]
    }) as any[];
        
    if (existing && existing.length === 0) {
      // Parse Date
      let createdAt = new Date();
      if (dateStr) {
        const parts = dateStr.match(/(\d+)/g);
        if (parts && parts.length >= 3) {
          const p0 = parseInt(parts[0]);
          const p1 = parseInt(parts[1]) - 1; 
          const p2 = parseInt(parts[2]);
          let y = p2, m = p1, d = p0;
          if (p0 > 31) { y = p0; d = p2; }
          const hr = parts.length > 3 ? parseInt(parts[3]) : 0;
          const min = parts.length > 4 ? parseInt(parts[4]) : 0;
          const sec = parts.length > 5 ? parseInt(parts[5]) : 0;
          const parsedDate = new Date(y, m, d, hr, min, sec);
          if (!isNaN(parsedDate.getTime())) createdAt = parsedDate;
        } else {
          const standardParsed = new Date(dateStr);
          if (!isNaN(standardParsed.getTime())) createdAt = standardParsed;
        }
      }

      // Create lead — tenant_id ile
      const leadResult = await db.executeSafe({
        text: `
          INSERT INTO leads (tenant_id, phone_number, patient_name, email, form_name, raw_data, stage, created_at, notes)
          VALUES ($1, $2, $3, $4, $5, $6, 'new', $7, $8)
          RETURNING id
        `,
        values: [tenantId, phone1, name, email, formName, JSON.stringify(raw_data), createdAt.toISOString(), noteStr]
      }) as any[];

      // 🔗 Unified Identity: Form → customer_profiles bağlantısı
      try {
        const { IdentityEngine } = await import('@/lib/services/ai/engines/identity');
        const customerId = await IdentityEngine.resolveIdentity({
          tenantId: tenantId!,
          phoneNumber: phone1,
          email: email || undefined,
          firstName: name || undefined
        });
        if (leadResult && leadResult[0]?.id) {
          await IdentityEngine.linkLead(tenantId!, leadResult[0].id, customerId);
        }
        log.info('[IDENTITY] Form linked to customer profile', { customerId, phone: phone1 });
      } catch (idErr) {
        log.error('[IDENTITY] Non-fatal: Could not link form to identity', idErr instanceof Error ? idErr : new Error(String(idErr)));
      }
      
      // Auto-Outbound Bot Logic — Tenant'ın Meta token'ını kullan
      let META_ACCESS_TOKEN = process.env.META_ACCESS_TOKEN || null;
      let PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID || null;
      if (tenantId) {
        const creds = await CredentialsService.resolveCredentials(tenantId, "whatsapp");
        if (creds.accessToken) META_ACCESS_TOKEN = creds.accessToken;
        if (creds.whatsappPhoneNumberId) PHONE_NUMBER_ID = creds.whatsappPhoneNumberId;
      }

      // 🔒 Otonom Karşılama kontrolü — tenant bazlı
      const autoGreetingSetting = await db.executeSafe({
        text: `SELECT value FROM settings WHERE key = 'bot_auto_greeting' AND tenant_id = $1`,
        values: [tenantId]
      }) as any[];
      const autoGreetingEnabled = autoGreetingSetting.length === 0 || autoGreetingSetting[0].value !== 'false';

      if (META_ACCESS_TOKEN && PHONE_NUMBER_ID && autoGreetingEnabled) {
        // 🌐 Karşılama Dili kontrolü — tenant bazlı
        const greetingLangSetting = await db.executeSafe({
          text: `SELECT value FROM settings WHERE key = 'bot_greeting_language' AND tenant_id = $1`,
          values: [tenantId]
        }) as any[];
        const greetingLang = greetingLangSetting.length > 0 ? greetingLangSetting[0].value : 'auto';
        
        const isTurkish = greetingLang === 'tr' ? true : greetingLang === 'en' ? false : phone1.startsWith('90');
        const tenantName = tenantMeta?.name || 'Ekibimiz';
        const greeting = name ? (isTurkish ? `Merhaba ${name}!` : `Hello ${name}!`) : (isTurkish ? 'Merhaba!' : 'Hello!');
        const welcomeMsg = isTurkish
          ? `${greeting} ${tenantName} olarak size yazıyoruz 🙏\n\nDoldurduğunuz form bize ulaştı. Talebiniz hakkında detaylı bilgi alabilir miyiz?`
          : `${greeting} We are reaching out from ${tenantName} 🙏\n\nWe received your form. Could you provide more details about your request?`;

        let activePhone = phone1;
        let botSuccess = false;

        // Try Phone 1
        const sendWhatsApp = async (phoneToTry: string) => {
          const response = await fetch(`https://graph.facebook.com/v25.0/${PHONE_NUMBER_ID}/messages`, {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${META_ACCESS_TOKEN}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              messaging_product: "whatsapp",
              to: phoneToTry,
              type: "text",
              text: { body: welcomeMsg },
            }),
          });
          return response.ok;
        };

        botSuccess = await sendWhatsApp(phone1);

        // Fallback to Phone 2 if Phone 1 fails
        if (!botSuccess && phone2 && phone2 !== phone1) {
          log.info(`Fallback: 1. Numara başarısız, 2. Numara deneniyor`, { phone1, phone2 });
          botSuccess = await sendWhatsApp(phone2);
          if (botSuccess) activePhone = phone2; // Update active phone
        }

        // Create Conversation and Message
        if (botSuccess) {
          const tags = ["Google Sheets", formName];
          const existingConv = await db.executeSafe({
            text: `SELECT id FROM conversations WHERE phone_number = $1`,
            values: [activePhone]
          }) as any[];
          let convId: any = existingConv[0]?.id;
          
          // Get channel_id for active whatsapp channel of this tenant
          let whatsappChannelId: string | null = null;
          try {
            const chs = await db.executeSafe({
              text: `SELECT c.id FROM channels c JOIN channel_groups cg ON c.group_id = cg.id WHERE cg.tenant_id = $1 AND c.provider = 'whatsapp' LIMIT 1`,
              values: [tenantId]
            }) as any[];
            if (chs.length > 0) whatsappChannelId = chs[0].id;
          } catch (err) {
            log.error('Failed to resolve WhatsApp channel ID for sheets webhook', err);
          }

          if (existingConv.length === 0) {
            const newConv = await db.executeSafe({
              text: `INSERT INTO conversations (tenant_id, phone_number, patient_name, tags, status, department, channel, channel_id) VALUES ($1, $2, $3, $4, 'bot', 'Genel', 'whatsapp', $5) RETURNING id`,
              values: [tenantId, activePhone, name, JSON.stringify(tags), whatsappChannelId]
            }) as any[];
            convId = newConv[0]?.id;
          } else {
            // If conversation exists but has no channel_id, update it
            await db.executeSafe({
              text: `UPDATE conversations SET channel_id = COALESCE(channel_id, $1), channel = COALESCE(channel, 'whatsapp') WHERE id = $2`,
              values: [whatsappChannelId, convId]
            });
          }
          // 🔗 Link conversation to same customer profile
          if (convId) {
            try {
              const { IdentityEngine } = await import('@/lib/services/ai/engines/identity');
              const cid = await IdentityEngine.resolveIdentity({ tenantId: tenantId!, phoneNumber: activePhone });
              await IdentityEngine.linkConversation(tenantId!, String(convId), cid);
            } catch (_) {}
          }
          await db.executeSafe({
            text: `INSERT INTO messages (tenant_id, conversation_id, phone_number, direction, content, channel, channel_id) VALUES ($1, $2, $3, 'out', $4, 'whatsapp', $5)`,
            values: [tenantId, convId, activePhone, welcomeMsg, whatsappChannelId]
          });
          await db.executeSafe({
            text: `UPDATE leads SET stage = 'contacted', contacted_at = NOW(), phone_number = $1 WHERE phone_number = $2 AND tenant_id = $3`,
            values: [activePhone, phone1, tenantId]
          });
        }
      }
      
      return NextResponse.json({ success: true, message: 'New lead inserted successfully. Auto-bot triggered.' });
    } else {
      // 🔗 Unified Identity: Form -> customer_profiles bağlantısı (Hatta lead önceden varsa bile)
      try {
        const { IdentityEngine } = await import('@/lib/services/ai/engines/identity');
        const customerId = await IdentityEngine.resolveIdentity({
          tenantId: tenantId!,
          phoneNumber: phone1,
          email: email || undefined,
          firstName: name || undefined
        });
        if (existing && existing[0]?.id) {
          await IdentityEngine.linkLead(tenantId!, existing[0].id, customerId);
        }
        log.info('[IDENTITY] Existing form linked to customer profile', { customerId, phone: phone1 });
      } catch (idErr) {
        log.error('[IDENTITY] Non-fatal: Could not link existing form to identity', idErr instanceof Error ? idErr : new Error(String(idErr)));
      }

      // Update existing lead's note if it has changed
      if (noteStr && noteStr.trim() !== '') {
        await db.executeSafe({
          text: `
            UPDATE leads 
            SET notes = $1 
            WHERE id = $2 AND (notes IS NULL OR notes = '')
          `,
          values: [noteStr, existing[0].id]
        });
      }
      return NextResponse.json({ success: true, message: 'Lead already exists, note updated if available.' });
    }

  } catch (error: any) {
    log.error('Sheets Webhook Error', error instanceof Error ? error : new Error(String(error)));
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
