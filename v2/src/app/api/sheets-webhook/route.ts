import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';

const DATABASE_URL = process.env.DATABASE_URL!;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { sheetName, data } = body;

    // Tenant belirleme (query param veya body'den)
    const tenantSlug = request.nextUrl.searchParams.get('tenant') || body.tenant_slug;
    const sqlDb = neon(DATABASE_URL);
    
    let tenantId: string | null = null;
    let tenantMeta: any = null;
    if (tenantSlug) {
      const tenants = await sqlDb`SELECT * FROM tenants WHERE slug = ${tenantSlug} AND status = 'active'`;
      if (tenants.length > 0) {
        tenantId = tenants[0].id;
        tenantMeta = tenants[0];
      }
    }
    // Fallback: tenant yoksa baskent'i kullan (geriye uyumluluk)
    if (!tenantId) {
      const fallback = await sqlDb`SELECT * FROM tenants WHERE slug = 'baskent' LIMIT 1`;
      if (fallback.length > 0) {
        tenantId = fallback[0].id;
        tenantMeta = fallback[0];
      }
    }

    // Sheet config — tenant bazlı kontrol
    let activeSheets: string[] = [];
    try {
      const configRes = await sqlDb`SELECT value FROM settings WHERE key = 'google_sheets_config' AND tenant_id = ${tenantId} LIMIT 1`;
      if (configRes.length > 0) {
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
    const existing = await sqlDb`SELECT id FROM leads WHERE phone_number LIKE '%' || RIGHT(${phone1}, 10) || '%' AND (tenant_id = ${tenantId} OR tenant_id IS NULL) LIMIT 1`;
        
    if (existing.length === 0) {
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
      await sqlDb`
        INSERT INTO leads (tenant_id, phone_number, patient_name, email, form_name, raw_data, stage, created_at, notes)
        VALUES (${tenantId}, ${phone1}, ${name}, ${email}, ${formName}, ${JSON.stringify(raw_data)}, 'new', ${createdAt.toISOString()}, ${noteStr})
      `;
      
      // Auto-Outbound Bot Logic — Tenant'ın Meta token'ını kullan
      const META_ACCESS_TOKEN = tenantMeta?.meta_page_token || process.env.META_ACCESS_TOKEN;
      const PHONE_NUMBER_ID = tenantMeta?.whatsapp_phone_id || process.env.PHONE_NUMBER_ID;

      // 🔒 Otonom Karşılama kontrolü — tenant bazlı
      const autoGreetingSetting = await sqlDb`SELECT value FROM settings WHERE key = 'bot_auto_greeting' AND tenant_id = ${tenantId}`;
      const autoGreetingEnabled = autoGreetingSetting.length === 0 || autoGreetingSetting[0].value !== 'false';

      if (META_ACCESS_TOKEN && PHONE_NUMBER_ID && autoGreetingEnabled) {
        // 🌐 Karşılama Dili kontrolü — tenant bazlı
        const greetingLangSetting = await sqlDb`SELECT value FROM settings WHERE key = 'bot_greeting_language' AND tenant_id = ${tenantId}`;
        const greetingLang = greetingLangSetting.length > 0 ? greetingLangSetting[0].value : 'auto';
        
        const isTurkish = greetingLang === 'tr' ? true : greetingLang === 'en' ? false : phone1.startsWith('90');
        const greeting = name ? (isTurkish ? `Merhaba ${name}!` : `Hello ${name}!`) : (isTurkish ? 'Merhaba!' : 'Hello!');
        const welcomeMsg = isTurkish
          ? `${greeting} Başkent Üniversitesi Konya Hastanesi'nden yazıyoruz 🙏\n\nDoldurduğunuz form bize ulaştı. Şikayetiniz veya talebiniz hakkında detaylı bilgi alabilir miyiz?`
          : `${greeting} We are reaching out from Başkent University Konya Hospital 🙏\n\nWe received your form. Could you provide more details about your request?`;

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
          console.log(`Fallback: 1. Numara (${phone1}) başarısız, 2. Numara (${phone2}) deneniyor...`);
          botSuccess = await sendWhatsApp(phone2);
          if (botSuccess) activePhone = phone2; // Update active phone
        }

        // Create Conversation and Message
        if (botSuccess) {
          const tags = ["Google Sheets", formName];
          const existingConv = await sqlDb`SELECT id FROM conversations WHERE phone_number = ${activePhone}`;
          if (existingConv.length === 0) {
            await sqlDb`INSERT INTO conversations (tenant_id, phone_number, patient_name, tags, status, department) VALUES (${tenantId}, ${activePhone}, ${name}, ${JSON.stringify(tags)}, 'bot', 'Genel')`;
          }
          await sqlDb`INSERT INTO messages (tenant_id, phone_number, direction, content, model_used) VALUES (${tenantId}, ${activePhone}, 'out', ${welcomeMsg}, 'sheets-auto')`;
          await sqlDb`UPDATE leads SET stage = 'contacted', contacted_at = NOW(), phone_number = ${activePhone} WHERE phone_number = ${phone1} AND tenant_id = ${tenantId}`;
        }
      }
      
      return NextResponse.json({ success: true, message: 'New lead inserted successfully. Auto-bot triggered.' });
    } else {
      // Update existing lead's note if it has changed
      if (noteStr && noteStr.trim() !== '') {
        await sqlDb`
          UPDATE leads 
          SET notes = ${noteStr} 
          WHERE id = ${existing[0].id} AND (notes IS NULL OR notes = '')
        `;
      }
      return NextResponse.json({ success: true, message: 'Lead already exists, note updated if available.' });
    }

  } catch (error: any) {
    console.error('Sheets Webhook Error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
