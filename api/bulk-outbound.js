import axios from 'axios';
import { sql } from '../lib/db/index.js';

const META_ACCESS_TOKEN = process.env.META_ACCESS_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { sheetName, leads, templateName = 'hello_world' } = req.body;
  if (!leads || !Array.isArray(leads)) return res.status(400).json({ error: 'Invalid leads array' });

  const APPS_SCRIPT_URL = process.env.GOOGLE_SHEET_UPDATE_URL || process.env.GOOGLE_SHEET_URL || 'https://script.google.com/macros/s/AKfycbw_iaJ0zqgOFYAGlkCnGnKQOzYQtPJWtbLMIEMIPuVbVkXOnDyq_1jMmII554s85sxu/exec';
  const results = { success: 0, failed: 0, details: [] };

  // Helper for formatting phone number (Meta WhatsApp requires numbers without + or leading 00, just country code and number)
  const formatPhone = (p) => {
    let clean = p.replace(/\D/g, '');
    // If it starts with 0 but no country code, default to Turkey 90
    if (clean.startsWith('0') && clean.length === 11) clean = '90' + clean.substring(1);
    return clean;
  };

  for (const lead of leads) {
    const { rowIndex, phone, name } = lead;
    const formattedPhone = formatPhone(phone);
    
    if (!formattedPhone || formattedPhone.length < 10) {
      results.failed++;
      results.details.push({ phone, status: 'invalid_number' });
      continue;
    }

    try {
      // 1. Send WhatsApp Template Message
      // NOTE: User must have 'lead_greeting' approved in Meta Business Manager.
      const metaResponse = await axios({
        method: 'POST',
        url: `https://graph.facebook.com/v25.0/${PHONE_NUMBER_ID}/messages`,
        headers: { Authorization: `Bearer ${META_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
        data: {
          messaging_product: 'whatsapp',
          to: formattedPhone,
          type: 'template',
          template: {
            name: templateName,
            language: { code: templateName === 'hello_world' ? 'en_US' : 'tr' }
            // If the template has variables (like name), we would add 'components' here.
          }
        }
      });

      // 2. Add to Conversations DB
      // We simulate an outgoing message to create the conversation thread
      const dbText = `[OTOMATİK KAMPANYA MESAJI]\nŞablon: ${templateName}`;
      await sql`
        INSERT INTO messages (phone_number, direction, content, model_used, channel)
        VALUES (${formattedPhone}, 'out', ${dbText}, 'panel', 'whatsapp')
      `;

      // Make sure the conversation is active, phase is greeting, and mark it as a lead
      try {
        await sql`
          INSERT INTO conversations (phone_number, channel, status, patient_name, phase, has_lead, updated_at)
          VALUES (${formattedPhone}, 'whatsapp', 'active', ${name || null}, 'greeting', true, NOW())
          ON CONFLICT (phone_number) 
          DO UPDATE SET 
            status = 'active',
            phase = 'greeting',
            has_lead = true,
            patient_name = COALESCE(conversations.patient_name, ${name || null}),
            updated_at = NOW()
        `;
      } catch (dbErr) {
        // Fallback: has_lead/phase columns may not exist yet — use simpler query
        console.warn('has_lead/phase columns missing, using fallback:', dbErr.message);
        await sql`
          INSERT INTO conversations (phone_number, channel, status, patient_name, updated_at)
          VALUES (${formattedPhone}, 'whatsapp', 'active', ${name || null}, NOW())
          ON CONFLICT (phone_number) 
          DO UPDATE SET 
            status = 'active',
            patient_name = COALESCE(conversations.patient_name, ${name || null}),
            updated_at = NOW()
        `;
      }

      // 3. Update Google Sheets (Mark as Processed)
      // We assume the Google Sheet API has action: 'updateCell' built-in.
      // We need to know which column "Durum" is. For now, we will assume it's column 10 (J), 
      // but ideally the frontend passes the statusColIndex.
      const statusCol = lead.statusColIndex || 10;
      await axios.post(APPS_SCRIPT_URL, {
        action: 'updateCell',
        sheet: sheetName,
        row: rowIndex + 2, // 1-indexed + header
        col: statusCol,
        value: 'SİSTEME ALINDI ✅'
      }, { timeout: 10000 }).catch(e => console.error("Sheet update failed", e.message));

      results.success++;
      results.details.push({ phone: formattedPhone, status: 'success' });
      
    } catch (err) {
      console.error(`Bulk Outbound Error for ${formattedPhone}:`, err.response?.data || err.message);
      
      // Şablon hatası varsa mevcut şablonları çekip hataya ekle
      let availableTemplates = '';
      try {
        const bizAccounts = await axios.get(`https://graph.facebook.com/v25.0/${PHONE_NUMBER_ID}/whatsapp_business_account`, { headers: { Authorization: `Bearer ${META_ACCESS_TOKEN}` } });
        const wabaId = bizAccounts.data?.id;
        if (wabaId) {
          const r = await axios.get(`https://graph.facebook.com/v25.0/${wabaId}/message_templates?limit=50`, { headers: { Authorization: `Bearer ${META_ACCESS_TOKEN}` } });
          const approved = (r.data.data || []).filter(t => t.status === 'APPROVED').map(t => t.name);
          availableTemplates = approved.length > 0 ? `\n(Mevcut Onaylı Şablonlar: ${approved.join(', ')})` : '\n(Hiç onaylı şablon bulunamadı)';
        }
      } catch(e) { console.error('Template fetch failed', e.message); }

      results.failed++;
      results.details.push({ phone: formattedPhone, status: 'failed', error: (err.response?.data?.error?.message || err.message) + availableTemplates });
    }
  }

  res.json({ success: true, results });
}
