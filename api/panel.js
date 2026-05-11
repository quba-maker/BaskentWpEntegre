import { neon } from '@neondatabase/serverless';
import axios from 'axios';

// 🔒 Simple in-memory rate limiter (IP başına dakikada max 120 istek)
const rateLimitMap = new Map();
const RATE_LIMIT = 120;
const RATE_WINDOW = 60000; // 1 dakika
setInterval(() => rateLimitMap.clear(), RATE_WINDOW);

function checkRateLimit(ip) {
  const count = rateLimitMap.get(ip) || 0;
  rateLimitMap.set(ip, count + 1);
  return count < RATE_LIMIT;
}

export default async function handler(req, res) {
  const allowedOrigins = [process.env.PANEL_ORIGIN || 'https://baskent-wp-entegre.vercel.app', 'http://localhost:3000'];
  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
  else res.setHeader('Access-Control-Allow-Origin', allowedOrigins[0]);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // 🔒 Rate Limiting
  const clientIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';
  if (!checkRateLimit(clientIp)) {
    return res.status(429).json({ error: 'Çok fazla istek. Lütfen biraz bekleyin.' });
  }

  const authHeader = req.headers.authorization;
  const PANEL_PASSWORD = process.env.PANEL_PASSWORD;
  if (!PANEL_PASSWORD) return res.status(500).json({ error: 'Server config error: PANEL_PASSWORD not set' });
  // Media endpoint için query param token desteği (img tag Authorization header gönderemez)
  const queryToken = req.query.token;
  const isMediaReq = req.query.action === 'media';
  if (authHeader !== `Bearer ${PANEL_PASSWORD}` && !(isMediaReq && queryToken === PANEL_PASSWORD)) {
    return res.status(401).json({ error: 'Yetkisiz', needsAuth: true });
  }

  const sql = neon(process.env.DATABASE_URL);
  const { action } = req.query;
  const META = process.env.META_ACCESS_TOKEN;
  const PHONE_ID = process.env.PHONE_NUMBER_ID;

  try {
    // DASHBOARD
    if (action === 'dashboard') {
      // Auto-migrate db for channel column
      try {
        await sql`ALTER TABLE conversations ADD COLUMN IF NOT EXISTS channel VARCHAR(50) DEFAULT 'whatsapp'`;
        await sql`ALTER TABLE messages ADD COLUMN IF NOT EXISTS channel VARCHAR(50) DEFAULT 'whatsapp'`;
        
        // Otomatik Yabancı Sayfa ID tespiti (Kullanıcıyı yormamak için)
        const check = await sql`SELECT value FROM settings WHERE key = 'foreign_page_id'`;
        if (check.length === 0 || !check[0].value) {
          try {
            const token = process.env.IG_TOKEN_1;
            const igRes = await axios.get(`https://graph.instagram.com/v25.0/me?access_token=${token}`);
            if (igRes.data && igRes.data.id) {
              if (check.length > 0) {
                await sql`UPDATE settings SET value = ${igRes.data.id} WHERE key = 'foreign_page_id'`;
              } else {
                await sql`INSERT INTO settings (key, value) VALUES ('foreign_page_id', ${igRes.data.id})`;
              }
            }
          } catch(e) { console.error('Otomatik ID tespiti hatasi:', e.message); }
        }
      } catch(e) {}

      const total = await sql`SELECT COUNT(*) as c FROM messages`;
      const today = await sql`SELECT COUNT(*) as c FROM messages WHERE created_at >= CURRENT_DATE`;
      const active = await sql`SELECT COUNT(*) as c FROM conversations WHERE status = 'active'`;
      const human = await sql`SELECT COUNT(*) as c FROM conversations WHERE status = 'human'`;
      const recent = await sql`SELECT m.*, c.patient_name FROM messages m LEFT JOIN conversations c ON m.phone_number = c.phone_number ORDER BY m.created_at DESC LIMIT 15`;

      // Lead istatistikleri
      let leadStats = { todayLeads: 0, totalLeads: 0, contacted: 0, appointed: 0, lost: 0, campaigns: [], conversionRate: 0, avgResponseMin: 0, hotLeads: 0, responseRate: 0, channelBreakdown: {}, funnelPhases: {} };
      try {
        const lt = await sql`SELECT COUNT(*) as c FROM leads WHERE created_at >= CURRENT_DATE`;
        const la = await sql`SELECT COUNT(*) as c FROM leads`;
        const lc = await sql`SELECT COUNT(*) as c FROM leads WHERE stage IN ('contacted','responded','discovery')`;
        const lp = await sql`SELECT COUNT(*) as c FROM leads WHERE stage = 'appointed'`;
        const ll = await sql`SELECT COUNT(*) as c FROM leads WHERE stage = 'lost'`;
        const camps = await sql`SELECT form_name, COUNT(*) as count, 
          SUM(CASE WHEN stage = 'appointed' THEN 1 ELSE 0 END) as appointed
          FROM leads WHERE form_name IS NOT NULL AND form_name != '' 
          GROUP BY form_name ORDER BY count DESC LIMIT 8`;
        
        // 🎯 Dönüşüm Oranı
        const totalLeadCount = parseInt(la[0].c) || 1;
        const appointedCount = parseInt(lp[0].c) || 0;
        const conversionRate = Math.round((appointedCount / totalLeadCount) * 100);
        
        // ⏱ Ortalama İlk Yanıt Süresi (dakika)
        let avgResponseMin = 0;
        try {
          const respTime = await sql`
            SELECT AVG(EXTRACT(EPOCH FROM (m.created_at - l.created_at)) / 60) as avg_min
            FROM leads l
            JOIN messages m ON m.phone_number = l.phone_number AND m.direction = 'out'
            WHERE l.created_at > NOW() - INTERVAL '30 days'
            AND m.created_at = (SELECT MIN(created_at) FROM messages WHERE phone_number = l.phone_number AND direction = 'out')
          `;
          avgResponseMin = Math.round(respTime[0]?.avg_min || 0);
        } catch(e) {}
        
        // 🔥 Sıcak leadler (şu an insana devredilmiş, bekleyen)
        let hotLeads = 0;
        try {
          const hl = await sql`SELECT COUNT(*) as c FROM conversations WHERE temperature = 'hot' AND status = 'human'`;
          hotLeads = parseInt(hl[0].c);
        } catch(e) {}
        
        // 📊 Yanıt oranı (kaç lead cevap verdi)
        let responseRate = 0;
        try {
          const responded = await sql`
            SELECT COUNT(DISTINCT l.phone_number) as c 
            FROM leads l 
            JOIN messages m ON m.phone_number = l.phone_number AND m.direction = 'in'
            WHERE l.created_at > NOW() - INTERVAL '30 days'
          `;
          const totalRecent = await sql`SELECT COUNT(*) as c FROM leads WHERE created_at > NOW() - INTERVAL '30 days'`;
          const recentTotal = parseInt(totalRecent[0].c) || 1;
          responseRate = Math.round((parseInt(responded[0].c) / recentTotal) * 100);
        } catch(e) {}
        
        // 📱 Kanal dağılımı
        let channelBreakdown = {};
        try {
          const channels = await sql`SELECT COALESCE(last_channel, channel, 'whatsapp') as ch, COUNT(*) as c FROM conversations GROUP BY ch`;
          channels.forEach(r => { channelBreakdown[r.ch] = parseInt(r.c); });
        } catch(e) {}
        
        // 🔄 Funnel faz dağılımı
        let funnelPhases = {};
        try {
          const phases = await sql`SELECT COALESCE(phase, 'greeting') as p, COUNT(*) as c FROM conversations WHERE status != 'human' GROUP BY p`;
          phases.forEach(r => { funnelPhases[r.p] = parseInt(r.c); });
        } catch(e) {}
        
        // 🏥 Show-up Rate
        let showUpRate = 0;
        let avgSatisfaction = 0;
        try {
          const showedTotal = await sql`SELECT COUNT(*) as c FROM events WHERE showed_up IS NOT NULL`;
          const showedYes = await sql`SELECT COUNT(*) as c FROM events WHERE showed_up = true`;
          const totalShowEvents = parseInt(showedTotal[0].c) || 1;
          showUpRate = Math.round((parseInt(showedYes[0].c) / totalShowEvents) * 100);
          
          const sat = await sql`SELECT AVG(satisfaction_score) as avg FROM events WHERE satisfaction_score IS NOT NULL`;
          avgSatisfaction = parseFloat(sat[0]?.avg || 0).toFixed(1);
        } catch(e) {}
        
        leadStats = { todayLeads: lt[0].c, totalLeads: la[0].c, contacted: lc[0].c, appointed: lp[0].c, lost: ll[0].c, campaigns: camps, conversionRate, avgResponseMin, hotLeads, responseRate, channelBreakdown, funnelPhases, showUpRate, avgSatisfaction };
      } catch(e) {}

      return res.json({ totalMessages: total[0].c, todayMessages: today[0].c, activeConversations: active[0].c, humanConversations: human[0].c, recentMessages: recent, leadStats });
    }

    // VARSAYILAN PROMPT
    if (action === 'default-prompt') {
      const { defaultPrompts } = await import('../lib/ai/prompts.js');
      return res.json({ 
        wp: defaultPrompts.whatsapp, 
        tr: defaultPrompts.instagram, 
        en: defaultPrompts.foreign 
      });
    }

    // ALERTS (Zorbay Bildirim Sistemi)
    if (action === 'alerts') {
      try {
        // 1. Operatör Gecikme Kontrolü (5 Dakika Kuralı - SLA)
        // İnsan modunda olup, son mesajı hastadan gelen ve üzerinden 5 dakika geçen görüşmeleri bul
        const delayed = await sql`
          SELECT c.phone_number, c.patient_name 
          FROM conversations c
          WHERE c.status = 'human'
            AND (SELECT direction FROM messages WHERE phone_number = c.phone_number ORDER BY created_at DESC LIMIT 1) = 'in'
            AND (SELECT created_at FROM messages WHERE phone_number = c.phone_number ORDER BY created_at DESC LIMIT 1) < NOW() - INTERVAL '5 minutes'
        `;
        
        for (const chat of delayed) {
          // Son 1 saat içinde bu hasta için SLA alarmı üretilmiş mi bak (spami önlemek için)
          const existing = await sql`SELECT id FROM alerts WHERE phone_number = ${chat.phone_number} AND alert_type = 'sla_violation' AND created_at > NOW() - INTERVAL '1 hour'`;
          if (existing.length === 0) {
            const msg = `⚠️ SLA İHLALİ: ${chat.patient_name || chat.phone_number} 5 dakikadan uzun süredir cevap bekliyor!`;
            await sql`INSERT INTO alerts (phone_number, alert_type, message) VALUES (${chat.phone_number}, 'sla_violation', ${msg})`;
          }
        }

        // 2. Aktif alarmları getir
        const activeAlerts = await sql`SELECT * FROM alerts WHERE is_read = false ORDER BY created_at DESC`;
        return res.json(activeAlerts);
      } catch (e) {
        return res.json([]);
      }
    }

    if (action === 'mark-alert-read') {
      try {
        await sql`UPDATE alerts SET is_read = true WHERE id = ${req.body.id}`;
        return res.json({ success: true });
      } catch (e) {
        return res.status(500).json({ error: e.message });
      }
    }

    // ═══════════════════════════════════════════════════════
    // KOMUTA MERKEZİ — Birleşik Analitik Özeti
    // ═══════════════════════════════════════════════════════
    if (action === 'analytics-summary' && req.method === 'GET') {
      const from = req.query.from || new Date(Date.now() - 30*24*60*60*1000).toISOString().slice(0,10);
      const to = req.query.to || new Date().toISOString().slice(0,10);
      const fromDate = from + ' 00:00:00';
      const toDate = to + ' 23:59:59';
      
      try {
        const [
          totalLeads, pipelineCounts, dailyLeads, dailyMessages,
          modelUsage, channelBreakdown, campaignPerf, deptPerf,
          responseMetrics, countryBreakdown, lostLeads, allTimeStats,
          hourlyDist
        ] = await Promise.all([
          // 1. Toplam lead (tarih aralığında)
          sql`SELECT COUNT(*) as count FROM leads WHERE created_at BETWEEN ${fromDate} AND ${toDate}`,
          
          // 2. Pipeline aşama dağılımı
          sql`SELECT lead_stage, COUNT(*) as count FROM conversations WHERE lead_stage IS NOT NULL AND lead_stage != '' GROUP BY lead_stage`,
          
          // 3. Günlük lead akışı (grafik için)
          sql`SELECT DATE(created_at) as date, COUNT(*) as count FROM leads WHERE created_at BETWEEN ${fromDate} AND ${toDate} GROUP BY DATE(created_at) ORDER BY date`,
          
          // 4. Günlük mesaj trafiği
          sql`SELECT DATE(created_at) as date, COUNT(*) as total, 
                SUM(CASE WHEN direction = 'in' THEN 1 ELSE 0 END) as incoming,
                SUM(CASE WHEN direction = 'out' THEN 1 ELSE 0 END) as outgoing
              FROM messages WHERE created_at BETWEEN ${fromDate} AND ${toDate} GROUP BY DATE(created_at) ORDER BY date`,
          
          // 5. Model kullanımı (maliyet hesabı için)
          sql`SELECT model_used, COUNT(*) as count FROM messages WHERE direction = 'out' AND model_used IS NOT NULL AND model_used != 'panel' AND created_at BETWEEN ${fromDate} AND ${toDate} GROUP BY model_used ORDER BY count DESC`,
          
          // 6. Kanal dağılımı
          sql`SELECT COALESCE(channel, 'whatsapp') as channel, COUNT(DISTINCT phone_number) as users, COUNT(*) as messages FROM messages WHERE created_at BETWEEN ${fromDate} AND ${toDate} GROUP BY COALESCE(channel, 'whatsapp')`,
          
          // 7. Kampanya performansı
          sql`SELECT form_name, COUNT(*) as lead_count,
                SUM(CASE WHEN stage IN ('appointed','hot_lead') THEN 1 ELSE 0 END) as converted,
                SUM(CASE WHEN stage = 'lost' THEN 1 ELSE 0 END) as lost
              FROM leads WHERE form_name IS NOT NULL AND created_at BETWEEN ${fromDate} AND ${toDate} GROUP BY form_name ORDER BY lead_count DESC`,
          
          // 8. Bölüm performansı
          sql`SELECT department, COUNT(*) as count,
                SUM(CASE WHEN lead_stage IN ('appointed','hot_lead') THEN 1 ELSE 0 END) as converted
              FROM conversations WHERE department IS NOT NULL AND department != '' GROUP BY department ORDER BY count DESC`,
          
          // 9. Yanıt süreleri
          sql`SELECT 
                AVG(EXTRACT(EPOCH FROM (first_out.t - first_in.t))/60)::int as avg_response_min,
                COUNT(DISTINCT first_in.phone_number) as total_conversations
              FROM (SELECT phone_number, MIN(created_at) as t FROM messages WHERE direction='in' AND created_at BETWEEN ${fromDate} AND ${toDate} GROUP BY phone_number) first_in
              JOIN (SELECT phone_number, MIN(created_at) as t FROM messages WHERE direction='out' AND created_at BETWEEN ${fromDate} AND ${toDate} GROUP BY phone_number) first_out
              ON first_in.phone_number = first_out.phone_number
              WHERE first_out.t > first_in.t`,
          
          // 10. Ülke/Şehir dağılımı
          sql`SELECT city, COUNT(*) as count,
                SUM(CASE WHEN stage IN ('appointed','hot_lead') THEN 1 ELSE 0 END) as converted
              FROM leads WHERE city IS NOT NULL AND city != '' AND created_at BETWEEN ${fromDate} AND ${toDate} GROUP BY city ORDER BY count DESC LIMIT 15`,
          
          // 11. Kayıp lead detayları
          sql`SELECT c.phone_number, c.patient_name, c.department, c.lead_stage, c.updated_at,
                (SELECT content FROM messages WHERE phone_number = c.phone_number AND direction='in' ORDER BY created_at DESC LIMIT 1) as last_message
              FROM conversations c WHERE c.lead_stage = 'lost' ORDER BY c.updated_at DESC LIMIT 20`,
          
          // 12. Tüm zamanlara ait genel sayılar
          sql`SELECT 
                (SELECT COUNT(*) FROM conversations) as total_conversations,
                (SELECT COUNT(*) FROM messages) as total_messages,
                (SELECT COUNT(*) FROM leads) as total_leads,
                (SELECT COUNT(*) FROM conversations WHERE lead_stage = 'appointed') as total_appointed,
                (SELECT COUNT(*) FROM conversations WHERE lead_stage = 'lost') as total_lost,
                (SELECT COUNT(*) FROM conversations WHERE status = 'human') as human_conversations`,
          
          // 13. Saatlik dağılım
          sql`SELECT EXTRACT(HOUR FROM created_at)::int as hour, COUNT(*) as count FROM messages WHERE created_at BETWEEN ${fromDate} AND ${toDate} GROUP BY EXTRACT(HOUR FROM created_at) ORDER BY hour`
        ]);

        // Model maliyet hesabı (tahmini)
        const modelCosts = { 'gemini-2.5-flash-lite': 0.001, 'gemini-2.5-flash': 0.003, 'gemini-2.5-pro': 0.02, 'handover manager': 0.003, 'follow-up': 0.001 };
        const modelData = modelUsage.map(m => ({
          model: m.model_used,
          count: +m.count,
          estimatedCost: +(+m.count * (modelCosts[m.model_used] || 0.001)).toFixed(3)
        }));
        const totalAICost = modelData.reduce((s, m) => s + m.estimatedCost, 0);

        // Pipeline funnel hesabı
        const stageOrder = ['new', 'contacted', 'discovery', 'negotiation', 'hot_lead', 'appointed', 'lost'];
        const stageLabels = { new: 'Yeni Lead', contacted: 'İlk Temas', discovery: 'Analiz', negotiation: 'İkna', hot_lead: 'Sıcak Lead', appointed: 'Randevu Alındı', lost: 'Kaybedildi' };
        const funnel = stageOrder.map(s => {
          const found = pipelineCounts.find(p => p.lead_stage === s);
          return { stage: s, label: stageLabels[s] || s, count: found ? +found.count : 0 };
        });
        const totalInPipeline = funnel.reduce((s, f) => s + f.count, 0) || 1;

        // Dönüşüm oranı
        const appointedCount = funnel.find(f => f.stage === 'appointed')?.count || 0;
        const lostCount = funnel.find(f => f.stage === 'lost')?.count || 0;
        const conversionRate = totalInPipeline > 0 ? Math.round((appointedCount / totalInPipeline) * 100) : 0;

        return res.json({
          period: { from, to },
          kpi: {
            totalLeads: +totalLeads[0]?.count || 0,
            conversionRate,
            appointedCount,
            lostCount,
            avgResponseMin: +responseMetrics[0]?.avg_response_min || 0,
            totalAICost: +totalAICost.toFixed(2),
            humanSavings: Math.round(totalAICost > 0 ? (500 / totalAICost) : 0), // AI vs koordinatör
            activeConversations: +allTimeStats[0]?.total_conversations || 0,
            totalMessages: +allTimeStats[0]?.total_messages || 0,
            humanConversations: +allTimeStats[0]?.human_conversations || 0
          },
          funnel,
          dailyLeads: dailyLeads.map(d => ({ date: d.date, count: +d.count })),
          dailyMessages: dailyMessages.map(d => ({ date: d.date, total: +d.total, incoming: +d.incoming, outgoing: +d.outgoing })),
          hourly: hourlyDist.map(h => ({ hour: +h.hour, count: +h.count })),
          models: modelData,
          channels: channelBreakdown.map(c => ({ channel: c.channel, users: +c.users, messages: +c.messages })),
          campaigns: campaignPerf.map(c => ({ name: c.form_name, leads: +c.lead_count, converted: +c.converted, lost: +c.lost })),
          departments: deptPerf.map(d => ({ name: d.department, count: +d.count, converted: +d.converted })),
          countries: countryBreakdown.map(c => ({ city: c.city, count: +c.count, converted: +c.converted })),
          lostLeads: lostLeads.map(l => ({ phone: l.phone_number, name: l.patient_name, dept: l.department, lastMessage: l.last_message, date: l.updated_at }))
        });
      } catch (e) {
        console.error('analytics-summary error:', e.message);
        return res.status(500).json({ error: e.message });
      }
    }

    // ÇAPRAZ KANAL + LEAD SCORING (form listesindeki her kart için)
    if (action === 'lead-context' && req.method === 'GET') {
      const phone = (req.query.phone || '').replace(/[\s\-\(\)\+]/g, '');
      if (!phone) return res.json({ score: 0, channels: [], lastMessage: null, conversationStatus: null });

      try {
        // Normalise: sadece son 10 haneye göre esnek (LIKE) arama yap
        let cleanPhone = (phone || '').replace(/\D/g, '');
        const searchPhone = cleanPhone.length > 10 ? cleanPhone.substring(cleanPhone.length - 10) : cleanPhone;
        const likePattern = `%${searchPhone}%`;

        const [conv, msgs, lead] = await Promise.all([
          sql`SELECT status, phase, lead_stage, tags, created_at FROM conversations WHERE phone_number LIKE ${likePattern} LIMIT 1`,
          sql`SELECT direction, channel, content, created_at FROM messages WHERE phone_number LIKE ${likePattern} ORDER BY created_at DESC LIMIT 10`,
          sql`SELECT stage, score, contacted_at, responded_at FROM leads WHERE phone_number LIKE ${likePattern} ORDER BY created_at DESC LIMIT 1`
        ]);

        // Kanal tespiti
        const channelSet = new Set();
        msgs.forEach(m => { if (m.channel) channelSet.add(m.channel); else channelSet.add('whatsapp'); });
        const channels = [...channelSet];

        // Lead Skorlama
        let score = 0;
        if (lead.length > 0) {
          score += 10; // Form doldurdu
          if (lead[0].contacted_at) score += 10; // Bot ulaştı
          if (lead[0].responded_at) score += 15; // Cevap verdi
        }
        if (conv.length > 0) score += 20; // WhatsApp/IG'dan yazdı
        const inMsgs = msgs.filter(m => m.direction === 'in');
        score += Math.min(inMsgs.length * 5, 30); // Her gelen mesaj +5 (max 30)

        // Son mesaj önizlemesi
        const lastMsgIn = msgs.find(m => m.direction === 'in');
        const lastMessage = lastMsgIn ? {
          content: (lastMsgIn.content || '').substring(0, 80),
          channel: lastMsgIn.channel || 'whatsapp',
          created_at: lastMsgIn.created_at
        } : null;

        // Lead stage: conversations tablosundan veya leads tablosundan
        const leadStage = (conv.length > 0 && conv[0].lead_stage) ? conv[0].lead_stage : (lead.length > 0 ? lead[0].stage : null);

        // Conversation tag'leri (evrensel etiketler)
        let convTags = [];
        if (conv.length > 0 && conv[0].tags) {
          try { convTags = JSON.parse(conv[0].tags); } catch(e) {}
        }

        return res.json({
          score,
          channels,
          lastMessage,
          conversationStatus: conv.length > 0 ? conv[0].status : null,
          leadStage: leadStage || null,
          messageCount: msgs.length,
          tags: convTags
        });
      } catch (e) {
        console.error('lead-context error:', e.message);
        return res.json({ score: 0, channels: [], lastMessage: null, conversationStatus: null });
      }
    }

    // KONUŞMALAR
    // TODO: Temporary endpoint to clear cached prompts
    if (action === 'clear-prompts') {
      await sql`DELETE FROM settings WHERE key LIKE 'system_prompt%'`;
      return new Response(JSON.stringify({ ok: true, message: 'Prompts cleared' }), { headers });
    }

    if (action === 'conversations') {
      const list = await sql`
        SELECT c.*, 
               (SELECT content FROM messages WHERE phone_number = c.phone_number ORDER BY created_at DESC LIMIT 1) as last_message,
               (SELECT channel FROM messages WHERE phone_number = c.phone_number AND channel IS NOT NULL ORDER BY created_at DESC LIMIT 1) as last_channel,
               l.id as lead_id, l.form_name as lead_form_name, l.stage as lead_stage
        FROM conversations c 
        LEFT JOIN leads l ON l.phone_number = c.phone_number
        ORDER BY c.last_message_at DESC
      `;
      return res.json(list);
    }

    // KONUŞMA DETAY
    if (action === 'conversation-detail') {
      const cleanPhone = (req.query.phone || '').replace(/\D/g, '');
      const searchPhone = cleanPhone.length > 10 ? cleanPhone.substring(cleanPhone.length - 10) : cleanPhone;
      const likePattern = `%${searchPhone}%`;
      const msgs = await sql`SELECT * FROM messages WHERE phone_number LIKE ${likePattern} ORDER BY created_at ASC`;
      // Hasta'nın form geçmişini de ekle (raw_data dahil — form cevapları)
      let forms = [];
      try { forms = await sql`SELECT form_name, city, email, tags, stage, raw_data, created_at, contacted_at FROM leads WHERE phone_number LIKE ${likePattern} ORDER BY created_at DESC`; } catch(e){}
      return res.json({ messages: msgs, forms });
    }


    // MESAJLARI SİL
    if (action === 'delete-messages' && req.method === 'POST') {
      const { phone } = req.body;
      const cleanPhone = (phone || '').replace(/\D/g, '');
      const searchPhone = cleanPhone.length > 10 ? cleanPhone.substring(cleanPhone.length - 10) : cleanPhone; // son 10 haneyi al (5546833306)
      const likePattern = `%${searchPhone}%`;
      
      // 1. Mesajları sil
      await sql`DELETE FROM messages WHERE phone_number LIKE ${likePattern}`;
      // 2. Conversation'ı tamamen sıfırla ve notları temizle
      await sql`UPDATE conversations SET 
        message_count = 0, 
        status = 'active', 
        lead_stage = 'new',
        phase = 'greeting',
        temperature = 'cold',
        last_message_at = NULL,
        notes = NULL,
        tags = '[]',
        lead_score = 0
      WHERE phone_number LIKE ${likePattern}`;
      // 3. Conversation states sıfırla (brain.js phase tracker)
      try { await sql`DELETE FROM conversation_states WHERE phone_number LIKE ${likePattern}`; } catch(e) {}
      // 4. Lead stage'i de sıfırla ama LEADS tablosunu silme! Form verileri anayasa için kalsın.
      try { await sql`UPDATE leads SET stage = 'new' WHERE phone_number LIKE ${likePattern}`; } catch(e) {}
      
      return res.json({ success: true });
    }

    // HASTA BİLGİSİ GÜNCELLE (CRM)
    if (action === 'update-patient' && req.method === 'POST') {
      const { phone, patient_name, tags, notes, department, patient_type, lead_stage, status } = req.body;
      let parsedTags = [];
      try { parsedTags = JSON.parse(tags || '[]'); } catch(e){}

      // lead_stage sütunu yoksa oluştur (migration)
      try { await sql`ALTER TABLE conversations ADD COLUMN IF NOT EXISTS lead_stage VARCHAR(50) DEFAULT 'new'`; } catch(e) {}

      // Çoklu format arama (LIKE ile sağlam)
      const cleanPhone = (phone || '').replace(/\D/g, '');
      const searchPhone = cleanPhone.length > 10 ? cleanPhone.substring(cleanPhone.length - 10) : cleanPhone;
      const likePattern = `%${searchPhone}%`;
      
      // SELECT + INSERT/UPDATE (ON CONFLICT UNIQUE constraint yok)
      const existing = await sql`SELECT id, phone_number FROM conversations WHERE phone_number LIKE ${likePattern} LIMIT 1`;
      if (existing.length > 0) {
        await sql`
          UPDATE conversations SET 
            patient_name = COALESCE(NULLIF(${patient_name || null}, ''), patient_name),
            tags = CASE WHEN ${tags || '[]'} != '[]' THEN ${tags || '[]'} ELSE tags END,
            notes = CASE WHEN ${notes || ''} != '' THEN ${notes || ''} ELSE notes END,
            department = COALESCE(NULLIF(${department || null}, ''), department),
            lead_stage = COALESCE(NULLIF(${lead_stage || null}, ''), lead_stage),
            status = COALESCE(NULLIF(${status || null}, ''), status)
          WHERE phone_number LIKE ${likePattern}
        `;
      } else {
        await sql`
          INSERT INTO conversations (phone_number, patient_name, tags, notes, department, patient_type, status, lead_stage)
          VALUES (${cleanPhone}, ${patient_name || null}, ${tags || '[]'}, ${notes || ''}, ${department || null}, ${patient_type || 'Yerli'}, ${status || 'active'}, ${lead_stage || 'new'})
        `;
      }
      if (lead_stage) {
        // leads tablosunda da güncelle (varsa)
        await sql`UPDATE leads SET stage = ${lead_stage} WHERE phone_number LIKE ${likePattern}`;
        
        // 📊 BACKEND SHEETS SYNC — Sheets'e lead durumunu yaz (her yerden çalışır)
        try {
          const SHEETS_API_KEY = process.env.GOOGLE_SHEETS_API_KEY;
          const SPREADSHEET_ID = process.env.GOOGLE_SPREADSHEET_ID;
          const APPS_SCRIPT_URL = process.env.GOOGLE_SHEET_UPDATE_URL || process.env.GOOGLE_SHEET_URL;
          if (!SHEETS_API_KEY || !SPREADSHEET_ID) return res.json({ sheets: [], error: 'Sheets config missing' });
          const stageLabels = { new: 'Yeni', contacted: 'İlk Temas', discovery: 'Analiz', negotiation: 'İkna', hot_lead: 'Sıcak Lead', appointed: 'Randevu Alındı', lost: 'Kayıp' };
          const stageLabel = stageLabels[lead_stage] || lead_stage;
          
          // 1) Spreadsheet meta → tüm sekme isimlerini çek
          const metaResp = await axios.get(`https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}`, {
            params: { key: SHEETS_API_KEY, fields: 'sheets.properties' }
          });
          const tabs = metaResp.data.sheets
            .filter(s => !s.properties.hidden)
            .map(s => s.properties.title);
          
          // 2) Her sekmede telefon + durum sütununu bul
          const last10 = cleanPhone.length > 10 ? cleanPhone.slice(-10) : cleanPhone;
          
          for (const tabName of tabs) {
            try {
              const dataResp = await axios.get(
                `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${encodeURIComponent(tabName)}`,
                { params: { key: SHEETS_API_KEY, valueRenderOption: 'FORMATTED_VALUE' } }
              );
              const values = dataResp.data.values || [];
              if (values.length < 2) continue;
              
              const headers = values[0];
              const phoneColIdx = headers.findIndex(h => /phone|telefon|tel|whatsapp|cep/i.test((h || '').toLowerCase()));
              // lead_status sütununu öncelikli ara, yoksa genel durum/status/aşama sütununa fallback
              let statusColIdx = headers.findIndex(h => /^lead[_\s]?status$/i.test((h || '').trim()));
              if (statusColIdx === -1) statusColIdx = headers.findIndex(h => /^(durum|aşama|lead[_\s]?stage)$/i.test((h || '').trim()));
              if (statusColIdx === -1) statusColIdx = headers.findIndex(h => /lead_status|lead_stage/i.test((h || '').toLowerCase()));
              if (phoneColIdx === -1 || statusColIdx === -1) continue;
              
              // 3) Satırı bul
              for (let r = 1; r < values.length; r++) {
                const cellPhone = (values[r][phoneColIdx] || '').replace(/\D/g, '');
                if (cellPhone.length >= 10 && (cellPhone.endsWith(last10) || last10.endsWith(cellPhone.slice(-10)))) {
                  // 4) Apps Script ile güncelle
                  await axios.post(APPS_SCRIPT_URL, {
                    action: 'updateCell',
                    sheet: tabName,
                    row: r + 1, // 1-indexed (header = 1, data = 2+)
                    col: statusColIdx + 1,
                    value: stageLabel
                  }, { timeout: 8000 });
                  console.log(`📊 Backend Sheets sync: ${tabName} satır ${r+1} → ${stageLabel}`);
                  break; // Bulundu, durdur
                }
              }
            } catch(tabErr) { /* sessizce devam */ }
          }
        } catch(sheetsErr) { console.error('Backend Sheets sync hatası:', sheetsErr.message); }
      }

      // OTOMATİK RANDEVU OLUŞTURMA
      if (lead_stage === 'appointment_request' || lead_stage === 'appointed' || lead_stage === 'hot_lead' ||
          parsedTags.includes('Randevu İstiyor') || parsedTags.includes('Randevu Alındı')) {
        try {
          // Sadece aktif (bekleyen, planlanmış, onaylanmış) bir randevusu var mı diye bak. İptal olanlar için yenisi açılabilir.
          const activeEvent = await sql`SELECT id FROM events WHERE phone_number LIKE ${likePattern} AND event_type = 'appointment_request' AND status IN ('pending', 'scheduled', 'confirmed')`;
          if (activeEvent.length === 0) {
            await sql`INSERT INTO events (phone_number, event_type, details, status) 
                      VALUES (${cleanPhone}, 'appointment_request', 'Panel üzerinden manuel randevu etiketi/durumu eklendi', 'pending')`;
          }
        } catch(e) { console.error('Manuel randevu ekleme hatasi:', e); }
      }

      return res.json({ success: true });
    }

    // HASTA BİLGİSİ OKU
    if (action === 'get-patient') {
      const phone = (req.query.phone || '').replace(/[\s\-\(\)\+]/g, '');
      // Son 10 hane ile esnek arama (tüm format farklılıklarını yakala)
      const cleanP = phone.replace(/\D/g, '');
      const searchPhone = cleanP.length > 10 ? cleanP.substring(cleanP.length - 10) : cleanP;
      const likePattern = `%${searchPhone}%`;
      
      const p = await sql`SELECT * FROM conversations WHERE phone_number LIKE ${likePattern} LIMIT 1`;
      const conv = p[0] || {};
      
      // Lead tablosundan form bilgilerini çek (LIKE ile son 10 hane arama — format farklılıklarını yakala)
      try {
        const cleanP = phone.replace(/\D/g, '');
        const last10 = cleanP.substring(cleanP.length - 10);
        const leadLike = `%${last10}%`;
        
        const leads = await sql`SELECT * FROM leads WHERE phone_number LIKE ${leadLike} ORDER BY created_at DESC LIMIT 1`;
        if (leads.length > 0) {
          const lead = leads[0];
          conv.lead_id = lead.id;
          conv.lead_form_name = lead.form_name;
          conv.lead_city = lead.city;
          conv.lead_email = lead.email;
          conv.lead_tags = lead.tags;
          // lead_stage: conversations tablosundaki değer öncelikli (form detayından set edilen)
          // Eğer conversations'ta lead_stage yoksa leads tablosundan al
          if (!conv.lead_stage || conv.lead_stage === 'new') {
            conv.lead_stage = lead.stage || 'new';
          }
          conv.lead_date = lead.created_at;
          conv.lead_ad_id = lead.ad_id;
          conv.lead_notes = lead.notes;
          conv.lead_score = lead.score;
          conv.has_lead = true;
          
          // 🏥 Bölüm otomatik doldurma: Lead tags'ten VEYA form name'den department'i çıkar
          if (!conv.department) {
            let detectedDept = '';
            // Önce tags'ten dene
            if (lead.tags) {
              try {
                const leadTags = typeof lead.tags === 'string' ? JSON.parse(lead.tags) : lead.tags;
                const medicalTags = (leadTags || []).filter(t => !['Genel', 'Ortaasya', 'Avrupa', 'Yerli', 'Gurbetçi', 'Yabancı Turist'].includes(t));
                if (medicalTags.length > 0) detectedDept = medicalTags.join(', ');
              } catch(e) {}
            }
            // Tags'te yoksa form name'den tespit et
            if (!detectedDept && lead.form_name) {
              const fn = lead.form_name.toLowerCase();
              const deptMap = [
                [/ortoped/i, 'Ortopedi'], [/kardiyoloji|kalp/i, 'Kardiyoloji'], [/estetik/i, 'Estetik'],
                [/di[sş]|implant/i, 'Diş'], [/g[oö]z|katarakt/i, 'Göz'], [/t[uü]p.?bebek|ivf/i, 'Tüp Bebek'],
                [/nakil|organ/i, 'Organ Nakli'], [/onkoloji|kanser/i, 'Onkoloji'], [/obezite|bariatrik/i, 'Obezite'],
                [/n[oö]roloji|beyin/i, 'Nöroloji'], [/[uü]roloji|prostat/i, 'Üroloji'], [/check.?up/i, 'Check-Up']
              ];
              for (const [re, tag] of deptMap) {
                if (re.test(fn)) { detectedDept = tag; break; }
              }
            }
            if (detectedDept) {
              conv.department = detectedDept;
              await sql`UPDATE conversations SET department = ${conv.department} WHERE phone_number LIKE ${leadLike}`;
              console.log(`🏥 Bölüm otomatik dolduruldu: ${conv.department} (kaynak: ${lead.tags ? 'tags' : 'form_name'})`);  
            }
          }
          
          // Hasta adı lead'den gelip conversation'da yoksa otomatik eşleştirelim
          if (lead.patient_name && !conv.patient_name) {
            conv.patient_name = lead.patient_name;
            await sql`UPDATE conversations SET patient_name = ${lead.patient_name} WHERE phone_number LIKE ${leadLike}`;
          }
        }
      } catch(e) { console.error('Lead eşleştirme hatası:', e.message); }
      
      // lead_stage fallback
      if (!conv.lead_stage) conv.lead_stage = 'new';
      
      return res.json(conv);
    }

    // KONUŞMA DURUMU
    if (action === 'conversation-status' && req.method === 'POST') {
      const { phone, status } = req.body;
      await sql`UPDATE conversations SET status = ${status} WHERE phone_number = ${phone}`;
      return res.json({ success: true });
    }

    // ETİKETLER
    if (action === 'tags' && req.method === 'GET') {
      return res.json(await sql`SELECT * FROM tags ORDER BY name`);
    }
    if (action === 'tags' && req.method === 'POST') {
      const { name, color } = req.body;
      await sql`INSERT INTO tags (name, color) VALUES (${name}, ${color || '#3b82f6'})`;
      return res.json({ success: true });
    }
    if (action === 'tags' && req.method === 'DELETE') {
      await sql`DELETE FROM tags WHERE id = ${req.query.id}`;
      return res.json({ success: true });
    }

    // MESAJ GÖNDER
    if (action === 'send-message' && req.method === 'POST') {
      const { phone, message, channel } = req.body;
      const targetChannel = channel || 'whatsapp';
      
      try {
        if (targetChannel === 'whatsapp') {
          await axios({ method: 'POST', url: `https://graph.facebook.com/v25.0/${PHONE_ID}/messages`, headers: { Authorization: `Bearer ${META}` },
            data: { messaging_product: 'whatsapp', to: phone, type: 'text', text: { body: message } }
          });
        } else if (targetChannel === 'messenger') {
          const { sendMessengerMessage } = await import('../lib/channels/messenger.js');
          await sendMessengerMessage(phone, message);
        } else if (targetChannel === 'instagram') {
          const { sendInstagramMessage } = await import('../lib/channels/instagram.js');
          await sendInstagramMessage(phone, message);
        }
      } catch (sendErr) {
        console.error('❌ Mesaj gönderme hatası:', sendErr.response?.data || sendErr.message);
        return res.status(500).json({ error: sendErr.response?.data?.error?.message || sendErr.message });
      }
      
      await sql`INSERT INTO messages (phone_number, direction, content, model_used, channel) VALUES (${phone}, 'out', ${message}, 'panel', ${targetChannel})`;
      await sql`UPDATE conversations SET last_message_at = NOW(), message_count = message_count + 1, channel = ${targetChannel} WHERE phone_number = ${phone}`;
      return res.json({ success: true });
    }

    // ŞABLON MESAJ GÖNDER (24 saat penceresi kapalıysa)
    if (action === 'send-template' && req.method === 'POST') {
      const { phone, template_name, language_code } = req.body;
      const lang = language_code || 'tr';
      try {
        await axios({
          method: 'POST',
          url: `https://graph.facebook.com/v25.0/${PHONE_ID}/messages`,
          headers: { Authorization: `Bearer ${META}` },
          data: {
            messaging_product: 'whatsapp',
            to: phone,
            type: 'template',
            template: { name: template_name, language: { code: lang } }
          }
        });
        await sql`INSERT INTO messages (phone_number, direction, content, model_used, channel) VALUES (${phone}, 'out', ${'[Şablon: ' + template_name + ']'}, 'panel-template', 'whatsapp')`;
        await sql`UPDATE conversations SET last_message_at = NOW(), message_count = message_count + 1 WHERE phone_number = ${phone}`;
        return res.json({ success: true });
      } catch(e) {
        return res.status(500).json({ error: e.response?.data?.error?.message || e.message });
      }
    }

    // META ŞABLONLARINI LİSTELE
    if (action === 'whatsapp-templates') {
      try {
        // WABA_ID otomatik tespiti
        let wabaId = process.env.WABA_ID;
        if (!wabaId) {
          // PHONE_NUMBER_ID üzerinden WABA_ID bul
          try {
            const phoneInfo = await axios.get(`https://graph.facebook.com/v25.0/${PHONE_ID}?fields=id`, {
              headers: { Authorization: `Bearer ${META}` }
            });
            // Business Account ID'yi phone number'ın parent'ından al
            const bizAccounts = await axios.get(`https://graph.facebook.com/v25.0/${PHONE_ID}/whatsapp_business_account`, {
              headers: { Authorization: `Bearer ${META}` }
            });
            wabaId = bizAccounts.data?.id;
          } catch(autoErr) {
            // Son çare: doğrudan business accounts endpoint'ini dene
            try {
              const biz = await axios.get(`https://graph.facebook.com/v25.0/me/businesses`, {
                headers: { Authorization: `Bearer ${META}` }
              });
              if (biz.data?.data?.[0]?.id) {
                const wabaRes = await axios.get(`https://graph.facebook.com/v25.0/${biz.data.data[0].id}/owned_whatsapp_business_accounts`, {
                  headers: { Authorization: `Bearer ${META}` }
                });
                wabaId = wabaRes.data?.data?.[0]?.id;
              }
            } catch(e2) {}
          }
        }
        
        if (!wabaId) {
          return res.json({ templates: [], note: 'WABA_ID bulunamadı. Vercel env olarak WABA_ID ekleyin veya Meta Business ayarlarından bulun.' });
        }

        const r = await axios.get(`https://graph.facebook.com/v25.0/${wabaId}/message_templates`, {
          headers: { Authorization: `Bearer ${META}` },
          params: { limit: 50 }
        });
        const approved = (r.data.data || []).filter(t => t.status === 'APPROVED');
        return res.json({ templates: approved, wabaId });
      } catch(e) {
        return res.json({ templates: [], error: e.response?.data?.error?.message || e.message });
      }
    }

    // TOPLU MESAJ (24h kuralı ile)
    if (action === 'bulk-message' && req.method === 'POST') {
      const { tag, message, templateName } = req.body;
      let conversations;
      if (tag === '__all__') {
        conversations = await sql`SELECT c.phone_number, 
          (SELECT created_at FROM messages WHERE phone_number = c.phone_number AND direction = 'in' ORDER BY created_at DESC LIMIT 1) as last_in
          FROM conversations c`;
      } else {
        conversations = await sql`SELECT c.phone_number, 
          (SELECT created_at FROM messages WHERE phone_number = c.phone_number AND direction = 'in' ORDER BY created_at DESC LIMIT 1) as last_in
          FROM conversations c WHERE c.tags LIKE ${'%' + tag + '%'}`;
      }
      let sent = 0, failed = 0, templateUsed = 0;
      for (const c of conversations) {
        try {
          const hoursSince = c.last_in ? (Date.now() - new Date(c.last_in).getTime()) / 3600000 : 999;
          if (hoursSince < 24) {
            // Pencere açık → normal metin
            await axios({ method: 'POST', url: `https://graph.facebook.com/v25.0/${PHONE_ID}/messages`, headers: { Authorization: `Bearer ${META}` },
              data: { messaging_product: 'whatsapp', to: c.phone_number, type: 'text', text: { body: message } }
            });
            await sql`INSERT INTO messages (phone_number, direction, content, model_used) VALUES (${c.phone_number}, 'out', ${message}, 'toplu')`;
          } else {
            // Pencere kapalı → şablon kullan
            const tpl = templateName || 'randevu_hatirlatma';
            await axios({ method: 'POST', url: `https://graph.facebook.com/v25.0/${PHONE_ID}/messages`, headers: { Authorization: `Bearer ${META}` },
              data: { messaging_product: 'whatsapp', to: c.phone_number, type: 'template', template: { name: tpl, language: { code: 'tr' } } }
            });
            await sql`INSERT INTO messages (phone_number, direction, content, model_used) VALUES (${c.phone_number}, 'out', ${'[Şablon: ' + tpl + ']'}, 'toplu')`;
            templateUsed++;
          }
          sent++;
        } catch (e) { failed++; }
      }
      return res.json({ success: true, sent, failed, templateUsed, total: conversations.length });
    }

    // MEDYA GÖNDER (URL ile)
    if (action === 'send-media' && req.method === 'POST') {
      const { phone, media_url, media_type, caption } = req.body;
      const mediaData = { messaging_product: 'whatsapp', to: phone, type: media_type };
      if (media_type === 'image') mediaData.image = { link: media_url, caption: caption || '' };
      else if (media_type === 'document') mediaData.document = { link: media_url, caption: caption || '', filename: 'belge.pdf' };
      else if (media_type === 'video') mediaData.video = { link: media_url, caption: caption || '' };

      await axios({ method: 'POST', url: `https://graph.facebook.com/v25.0/${PHONE_ID}/messages`, headers: { Authorization: `Bearer ${META}` }, data: mediaData });
      await sql`INSERT INTO messages (phone_number, direction, content, model_used, media_url, media_type) VALUES (${phone}, 'out', ${caption || media_type + ' gönderildi'}, 'panel', ${media_url}, ${media_type})`;
      return res.json({ success: true });
    }

    // AYARLAR
    if (action === 'settings' && req.method === 'GET') {
      const s = await sql`SELECT * FROM settings`; const r = {}; s.forEach(x => r[x.key] = x.value); return res.json(r);
    }
    if (action === 'settings' && (req.method === 'POST' || req.method === 'PUT')) {
      const { key, value } = req.body;
      const ex = await sql`SELECT * FROM settings WHERE key = ${key}`;
      if (ex.length > 0) await sql`UPDATE settings SET value = ${value}, updated_at = NOW() WHERE key = ${key}`;
      else await sql`INSERT INTO settings (key, value) VALUES (${key}, ${value})`;
      return res.json({ success: true });
    }

    // ŞABLONLAR
    if (action === 'templates' && req.method === 'GET') return res.json(await sql`SELECT * FROM templates ORDER BY created_at DESC`);
    if (action === 'templates' && req.method === 'POST') { const { title, content, category } = req.body; await sql`INSERT INTO templates (title, content, category) VALUES (${title}, ${content}, ${category})`; return res.json({ success: true }); }
    if (action === 'templates' && req.method === 'DELETE') { await sql`DELETE FROM templates WHERE id = ${req.query.id}`; return res.json({ success: true }); }

    // ANALİTİK
    if (action === 'analytics') {
      const daily = await sql`SELECT DATE(created_at) as date, COUNT(*) as count FROM messages WHERE created_at >= CURRENT_DATE - INTERVAL '7 days' GROUP BY DATE(created_at) ORDER BY date`;
      const topPhones = await sql`SELECT phone_number, COUNT(*) as count FROM messages WHERE direction = 'in' GROUP BY phone_number ORDER BY count DESC LIMIT 5`;
      const modelUsage = await sql`SELECT model_used, COUNT(*) as count FROM messages WHERE model_used IS NOT NULL GROUP BY model_used ORDER BY count DESC`;
      const hourly = await sql`SELECT EXTRACT(HOUR FROM created_at) as hour, COUNT(*) as count FROM messages WHERE direction = 'in' AND created_at >= CURRENT_DATE - INTERVAL '7 days' GROUP BY hour ORDER BY hour`;
      const tagStats = await sql`SELECT tags FROM conversations WHERE tags != '[]' AND tags IS NOT NULL`;
      return res.json({ daily, topPhones, modelUsage, hourly, tagStats });
    }

    // LEADS
    if (action === 'leads') {
      const { stage, tag } = req.query;
      let leads;
      if (stage && stage !== 'all') leads = await sql`SELECT * FROM leads WHERE stage = ${stage} ORDER BY created_at DESC`;
      else if (tag) leads = await sql`SELECT * FROM leads WHERE tags LIKE ${'%' + tag + '%'} ORDER BY created_at DESC`;
      else leads = await sql`SELECT * FROM leads ORDER BY created_at DESC LIMIT 100`;
      return res.json(leads);
    }
    
    if (action === 'debug_db') {
       try {
         const dummyId = String(Date.now());
         const savePhone = 'test_' + dummyId.slice(-10);
         const name = '<test lead: dummy data for full_name>';
         const tags = ['Genel'];
         
         await sql`INSERT INTO leads (
            phone_number, patient_name, email, city, form_id, form_name, ad_id, leadgen_id, tags, raw_data, stage
         ) VALUES (
            ${savePhone}, ${name}, '<test lead: dummy data for email>', '<test lead: dummy data for city>', '1505866894451965', 'Gurbetçiler Form Randevu-Kardiyoloji', '<test lead: dummy data for ad_id>',
            ${dummyId}, ${JSON.stringify(tags)}, '{}', 'new'
         ) ON CONFLICT (leadgen_id) DO UPDATE SET phone_number = ${savePhone}, patient_name = ${name}, stage = 'new'`;
         
         const existing = await sql`SELECT id FROM conversations WHERE phone_number = ${savePhone}`;
         if (existing.length === 0) {
           await sql`INSERT INTO conversations (phone_number, patient_name, tags, status) VALUES (${savePhone}, ${name}, ${JSON.stringify(tags)}, 'active')`;
         } else {
           await sql`UPDATE conversations SET patient_name = ${name}, tags = ${JSON.stringify(tags)} WHERE phone_number = ${savePhone}`;
         }

         return res.json({ success: true, message: 'DB Insert worked fine for leads AND conversations' });
       } catch(e) {
         return res.json({ success: false, error: e.message, hint: 'This is the error blocking leads.' });
       }
    }


    // LEAD AŞAMA GÜNCELLE
    if (action === 'update-lead' && req.method === 'POST') {
      const { id, stage, notes } = req.body;
      if (stage) await sql`UPDATE leads SET stage = ${stage} WHERE id = ${id}`;
      await sql`UPDATE leads SET stage = ${stage} WHERE id = ${id}`;
      if (notes !== undefined) await sql`UPDATE leads SET notes = ${notes} WHERE id = ${id}`;
      if (stage === 'responded') await sql`UPDATE leads SET responded_at = NOW() WHERE id = ${id}`;
      return res.json({ success: true });
    }

    // RANDEVU TALEPLERİNİ (GELEN TALEPLER) SIFIRLA
    if (action === 'clear-appointments') {
      try { await sql`DELETE FROM events`; } catch(e) {}
      return res.json({ success: true });
    }

    // BELİRLİ BİR NUMARAYI TÜM VERİTABANINDAN SİL (HARD DELETE)
    if (action === 'hard-delete-lead') {
      const { phone } = req.body;
      if (!phone) return res.status(400).json({error: 'Telefon numarası gerekli'});
      let cleanPhone = phone.replace(/\D/g, '');
      const likePattern = `%${cleanPhone.substring(cleanPhone.length - 10)}%`;
      console.log(`🗑️ HARD DELETE başlatıldı: ${phone} → pattern: ${likePattern}`);
      
      // Her tabloyu bağımsız try/catch ile sil — biri patlarsa diğerleri etkilenmesin
      try { const r = await sql`DELETE FROM messages WHERE phone_number LIKE ${likePattern}`; console.log('  ✓ messages silindi'); } catch(e) { console.error('  ✗ messages:', e.message); }
      try { const r = await sql`DELETE FROM conversation_states WHERE phone_number LIKE ${likePattern}`; console.log('  ✓ conversation_states silindi'); } catch(e) { console.error('  ✗ conversation_states:', e.message); }
      try { const r = await sql`DELETE FROM events WHERE phone_number LIKE ${likePattern}`; console.log('  ✓ events silindi'); } catch(e) { console.error('  ✗ events:', e.message); }
      // ⚠️ leads tablosunu SİLME — form verileri kaynak veridir, sohbet sıfırlansa bile korunmalı
      // try { const r = await sql`DELETE FROM leads WHERE phone_number LIKE ${likePattern}`; console.log('  ✓ leads silindi'); } catch(e) { console.error('  ✗ leads:', e.message); }
      try { const r = await sql`DELETE FROM conversations WHERE phone_number LIKE ${likePattern}`; console.log('  ✓ conversations silindi'); } catch(e) { console.error('  ✗ conversations:', e.message); }
      
      console.log(`🗑️ HARD DELETE tamamlandı: ${phone}`);
      return res.json({ success: true });
    }

    // LEAD İSTATİSTİK
    if (action === 'lead-stats') {
      const byStage = await sql`SELECT stage, COUNT(*) as count FROM leads GROUP BY stage`;
      const byCampaign = await sql`SELECT form_name, COUNT(*) as count, stage FROM leads GROUP BY form_name, stage ORDER BY form_name`;
      const byTag = await sql`SELECT tags, COUNT(*) as count FROM leads GROUP BY tags ORDER BY count DESC`;
      const today = await sql`SELECT COUNT(*) as count FROM leads WHERE created_at >= CURRENT_DATE`;
      const total = await sql`SELECT COUNT(*) as count FROM leads`;
      return res.json({ byStage, byCampaign, byTag, todayLeads: today[0].count, totalLeads: total[0].count });
    }

    // RANDEVU TALEPLERİ
    if (action === 'appointments') {
      try {
        await sql`CREATE TABLE IF NOT EXISTS events (
          id SERIAL PRIMARY KEY, phone_number VARCHAR(20), event_type VARCHAR(50),
          details TEXT, status VARCHAR(20) DEFAULT 'pending', created_at TIMESTAMP DEFAULT NOW()
        )`;
        
       // Ek kolonları ekle (migration)
        try { await sql`ALTER TABLE events ADD COLUMN IF NOT EXISTS coordinator_notes TEXT`; } catch(e) {}
        try { await sql`ALTER TABLE events ADD COLUMN IF NOT EXISTS confirmed_by_patient BOOLEAN DEFAULT false`; } catch(e) {}
        try { await sql`ALTER TABLE events ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMP`; } catch(e) {}
        
        const events = await sql`
          SELECT DISTINCT ON (e.id) e.*, c.patient_name, c.department, c.patient_type, c.lead_stage, l.form_name, l.city, l.raw_data as lead_raw_data
          FROM events e 
          LEFT JOIN conversations c ON c.phone_number = e.phone_number
          LEFT JOIN leads l ON l.phone_number = e.phone_number
          WHERE e.event_type = 'appointment_request'
          ORDER BY e.id DESC, l.created_at DESC LIMIT 100
        `;
        const counts = {
          pending: events.filter(e => e.status === 'pending').length,
          called: events.filter(e => e.status === 'called').length,
          scheduled: events.filter(e => ['scheduled', 'confirmed'].includes(e.status)).length,
          lost: events.filter(e => ['lost', 'cancelled', 'noshow'].includes(e.status)).length
        };
        return res.json({ events, counts });
      } catch(e) {
        console.error('Randevu çekme hatası:', e.message);
        return res.json({ events: [], counts: { pending: 0, called: 0, scheduled: 0, lost: 0 } });
      }
    }

    // 📋 RANDEVU DETAY — Tekil hasta detayı (sağ panel için)
    if (action === 'appointment-detail') {
      const eventId = req.query.id;
      if (!eventId) return res.status(400).json({ error: 'id gerekli' });
      
      try {
        const ev = await sql`
          SELECT e.*, c.patient_name, c.department, c.patient_type, c.tags as conv_tags, c.lead_stage, c.notes as conv_notes,
            l.form_name, l.city, l.email, l.raw_data, l.tags as lead_tags
          FROM events e
          LEFT JOIN conversations c ON c.phone_number = e.phone_number
          LEFT JOIN leads l ON l.phone_number = e.phone_number
          WHERE e.id = ${eventId}
          ORDER BY l.created_at DESC LIMIT 1
        `;
        if (ev.length === 0) return res.status(404).json({ error: 'Event bulunamadı' });
        
        // Son 10 mesaj
        const msgs = await sql`
          SELECT direction, content, created_at, model_used FROM messages 
          WHERE phone_number = ${ev[0].phone_number} 
          ORDER BY created_at DESC LIMIT 10
        `;
        
        // Hatırlatma durumu
        const reminders = await sql`
          SELECT content, created_at FROM messages 
          WHERE phone_number = ${ev[0].phone_number} AND model_used = 'reminder'
          ORDER BY created_at DESC LIMIT 5
        `;
        
        return res.json({ event: ev[0], messages: msgs.reverse(), reminders });
      } catch(e) {
        console.error('Randevu detay hatası:', e.message);
        return res.status(500).json({ error: e.message });
      }
    }

    // 📅 iCal EXPORT — Tek randevuyu .ics olarak indir
    if (action === 'appointment-ical') {
      const eventId = req.query.id;
      if (!eventId) return res.status(400).json({ error: 'id gerekli' });
      
      try {
        const ev = await sql`
          SELECT e.*, c.patient_name, c.department 
          FROM events e 
          LEFT JOIN conversations c ON c.phone_number = e.phone_number 
          WHERE e.id = ${eventId}
        `;
        if (ev.length === 0) return res.status(404).json({ error: 'Event bulunamadı' });
        
        const apt = ev[0];
        const startDate = new Date(apt.scheduled_date);
        const endDate = new Date(startDate.getTime() + 60 * 60 * 1000); // 1 saat
        const fmt = d => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
        
        const ical = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Baskent CRM//Randevu//TR
BEGIN:VEVENT
UID:apt-${apt.id}@baskent-crm
DTSTART:${fmt(startDate)}
DTEND:${fmt(endDate)}
SUMMARY:🏥 ${apt.patient_name || 'Hasta'} - ${apt.department || 'Genel'}
DESCRIPTION:Hasta: ${apt.patient_name || 'Bilinmiyor'}\\nTel: ${apt.phone_number}\\nBölüm: ${apt.department || 'Genel'}${apt.assigned_doctor ? '\\nDoktor: ' + apt.assigned_doctor : ''}${apt.coordinator_notes ? '\\nNot: ' + apt.coordinator_notes : ''}
LOCATION:Başkent Üniversitesi Konya Hastanesi
STATUS:CONFIRMED
END:VEVENT
END:VCALENDAR`;
        
        res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename=randevu-${apt.id}.ics`);
        return res.send(ical);
      } catch(e) {
        return res.status(500).json({ error: e.message });
      }
    }

    // RANDEVU DURUM GÜNCELLE & TAKVİMLE
    if (action === 'update-appointment' && req.method === 'POST') {
      const { id, status, scheduled_date, assigned_doctor, coordinator_notes } = req.body;
      
      if (scheduled_date) {
        await sql`UPDATE events SET status = 'scheduled', scheduled_date = ${scheduled_date}, assigned_doctor = ${assigned_doctor || null} WHERE id = ${id}`;
      } else if (coordinator_notes !== undefined) {
        // Sadece koordinatör notu güncelle
        await sql`UPDATE events SET coordinator_notes = ${coordinator_notes} WHERE id = ${id}`;
      } else {
        await sql`UPDATE events SET status = ${status} WHERE id = ${id}`;
      }
      
      // 🏷️ Evrensel Etiket Senkronizasyonu — Hasta Takibi & Form'da görünsün
      const ev = await sql`SELECT phone_number FROM events WHERE id = ${id}`;
      if (ev.length > 0) {
        const phone = ev[0].phone_number;
        const conv = await sql`SELECT tags FROM conversations WHERE phone_number = ${phone}`;
        let tags = []; try { tags = JSON.parse(conv[0]?.tags || '[]'); } catch(e) {}
        
        // Randevu etiketlerini temizle
        tags = tags.filter(t => !['Randevu İstiyor', 'Randevu Alındı', 'Takvimde', 'Olumsuz', 'İptal'].includes(t));
        
        const effectiveStatus = scheduled_date ? 'scheduled' : (status || 'pending');
        
        if (effectiveStatus === 'confirmed' || effectiveStatus === 'scheduled' || scheduled_date) {
          tags.push(scheduled_date ? 'Takvimde' : 'Randevu Alındı');
          await sql`UPDATE leads SET stage = 'appointed' WHERE phone_number = ${phone}`;
          await sql`UPDATE conversations SET lead_stage = 'appointed' WHERE phone_number = ${phone}`;
        } else if (effectiveStatus === 'lost' || effectiveStatus === 'cancelled') {
          tags.push('Olumsuz');
          await sql`UPDATE leads SET stage = 'lost' WHERE phone_number = ${phone}`;
          await sql`UPDATE conversations SET lead_stage = 'lost' WHERE phone_number = ${phone}`;
        } else if (effectiveStatus === 'called') {
          tags.push('Randevu İstiyor');
        }
        
        await sql`UPDATE conversations SET tags = ${JSON.stringify(tags)} WHERE phone_number = ${phone}`;
      }
      return res.json({ success: true });
    }

    // SHOW-UP TAKİBİ — Hasta geldi mi?
    if (action === 'update-showup' && req.method === 'POST') {
      const { id, showed_up, no_show_reason, treatment_completed, satisfaction_score } = req.body;
      
      if (showed_up === true) {
        await sql`UPDATE events SET showed_up = true, showed_up_at = NOW(), status = 'completed' WHERE id = ${id}`;
        // Tedavi tamamlandı mı?
        if (treatment_completed) {
          await sql`UPDATE events SET treatment_completed = true WHERE id = ${id}`;
        }
        if (satisfaction_score) {
          await sql`UPDATE events SET satisfaction_score = ${satisfaction_score} WHERE id = ${id}`;
        }
        // Lead stage güncelle
        const ev = await sql`SELECT phone_number FROM events WHERE id = ${id}`;
        if (ev.length > 0) {
          await sql`UPDATE leads SET stage = 'appointed' WHERE phone_number = ${ev[0].phone_number}`;
        }
      } else {
        await sql`UPDATE events SET showed_up = false, no_show_reason = ${no_show_reason || 'Bilinmiyor'}, status = 'noshow' WHERE id = ${id}`;
        const ev = await sql`SELECT phone_number FROM events WHERE id = ${id}`;
        if (ev.length > 0) {
          await sql`UPDATE leads SET stage = 'lost' WHERE phone_number = ${ev[0].phone_number}`;
        }
      }
      return res.json({ success: true });
    }

    // BİLDİRİM SAYACI
    if (action === 'notifications') {
      try {
        await sql`CREATE TABLE IF NOT EXISTS events (
          id SERIAL PRIMARY KEY, phone_number VARCHAR(20), event_type VARCHAR(50),
          details TEXT, status VARCHAR(20) DEFAULT 'pending', created_at TIMESTAMP DEFAULT NOW()
        )`;
      } catch(e) {}
      const pendingApts = await sql`SELECT COUNT(*) as c FROM events WHERE event_type = 'appointment_request' AND status = 'pending'`;
      const newMessages = await sql`SELECT COUNT(*) as c FROM messages WHERE direction = 'in' AND created_at > NOW() - INTERVAL '1 hour'`;
      return res.json({ 
        pendingAppointments: Number(pendingApts[0].c),
        recentMessages: Number(newMessages[0].c),
        total: Number(pendingApts[0].c) + (Number(newMessages[0].c) > 0 ? 1 : 0)
      });
    }

    // 📎 MEDYA PROXY — WhatsApp medya dosyalarını panelde göster
    if (action === 'media') {
      const mediaId = req.query.id;
      if (!mediaId) return res.status(400).json({ error: 'media id gerekli' });
      
      try {
        const META = process.env.META_ACCESS_TOKEN;
        // 1. Media URL al
        const mediaInfo = await axios.get(`https://graph.facebook.com/v25.0/${mediaId}`, {
          headers: { Authorization: `Bearer ${META}` }
        });
        const mediaUrl = mediaInfo.data.url;
        const mimeType = mediaInfo.data.mime_type || 'image/jpeg';
        
        // 2. Dosyayı indir ve proxy olarak ilet
        const mediaRes = await axios.get(mediaUrl, {
          headers: { Authorization: `Bearer ${META}` },
          responseType: 'arraybuffer'
        });
        
        res.setHeader('Content-Type', mimeType);
        res.setHeader('Cache-Control', 'public, max-age=86400'); // 24 saat cache
        return res.send(Buffer.from(mediaRes.data));
      } catch(e) {
        console.error('Media proxy hatası:', e.response?.data || e.message);
        return res.status(404).json({ error: 'Medya bulunamadı veya süresi dolmuş' });
      }
    }

    // GELİŞMİŞ ANALİTİK
    if (action === 'advanced-analytics') {
      // Kampanya dönüşüm oranları
      const campaignConversion = await sql`
        SELECT l.form_name, 
               COUNT(*) as total,
               COUNT(CASE WHEN l.stage IN ('responded', 'discovery', 'negotiation', 'hot_lead') THEN 1 END) as responded,
               COUNT(CASE WHEN l.stage = 'appointed' THEN 1 END) as appointed
        FROM leads l 
        WHERE l.form_name IS NOT NULL AND l.form_name != ''
        GROUP BY l.form_name ORDER BY total DESC
      `;
      
      // Bölüm talep analizi (etiketlerden)
      const allTags = await sql`SELECT tags FROM conversations WHERE tags IS NOT NULL AND tags != '[]'`;
      const deptCounts = {};
      allTags.forEach(row => {
        try {
          const tags = JSON.parse(row.tags);
          tags.forEach(t => { if (!['Genel','Gurbetçi','Fiyat Sordu','Randevu İstiyor','Randevu Alındı','Görüşme Devam'].includes(t)) deptCounts[t] = (deptCounts[t]||0)+1; });
        } catch(e) {}
      });
      
      // Bot vs Personel performans
      const botMsgs = await sql`SELECT COUNT(*) as c FROM messages WHERE direction = 'out' AND model_used NOT IN ('panel', 'toplu', 'follow-up', 'lead-auto', 'mesai-disi', 'fallback') AND model_used IS NOT NULL`;
      const humanMsgs = await sql`SELECT COUNT(*) as c FROM messages WHERE direction = 'out' AND model_used = 'panel'`;
      
      // Uluslararası hastalar
      const intlPatients = await sql`SELECT COUNT(*) as c FROM conversations WHERE phone_number NOT LIKE '90%' AND phone_number NOT LIKE 'test%'`;
      const totalPatients = await sql`SELECT COUNT(*) as c FROM conversations WHERE phone_number NOT LIKE 'test%'`;
      
      // Ortalama yanıt süresi (yaklaşık)
      const avgResponse = await sql`
        SELECT AVG(EXTRACT(EPOCH FROM (out_msg.created_at - in_msg.created_at))) as avg_seconds
        FROM messages in_msg
        JOIN LATERAL (
          SELECT created_at FROM messages 
          WHERE phone_number = in_msg.phone_number AND direction = 'out' AND created_at > in_msg.created_at
          ORDER BY created_at ASC LIMIT 1
        ) out_msg ON true
        WHERE in_msg.direction = 'in' AND in_msg.created_at > NOW() - INTERVAL '7 days'
      `;

      return res.json({
        campaignConversion,
        departmentDemand: Object.entries(deptCounts).map(([name, count]) => ({name, count})).sort((a,b) => b.count - a.count),
        botMessages: Number(botMsgs[0].c),
        humanMessages: Number(humanMsgs[0].c),
        intlPatients: Number(intlPatients[0].c),
        totalPatients: Number(totalPatients[0].c),
        avgResponseSeconds: Math.round(Number(avgResponse[0]?.avg_seconds || 0))
      });
    }

    return res.status(400).json({ error: 'Geçersiz action' });
  } catch (error) {
    console.error('Panel API hatası:', error);
    return res.status(500).json({ error: error.message });
  }
}

function getDefaultPrompt() {
  return `Sen Başkent Üniversitesi Konya Hastanesi'nde çalışan gerçek bir hasta danışmanısın. Adın yok, sadece hastanenin danışmanısın.

HASTANE HAKKINDA:
- Başkent Üniversitesi Konya Uygulama ve Araştırma Merkezi
- Kurucusu: Prof. Dr. Mehmet Haberal (Türkiye'nin ilk böbrek nakli, dünyanın ilk canlı donörden karaciğer nakli)
- Türkiye'nin önde gelen akademik tıp kurumlarından biri

KONUM ve İLETİŞİM:
- Adres: Hocacihan Mahallesi, Saray Caddesi No:1, Selçuklu/KONYA
- Telefon: 0332 257 06 06
- Uluslararası: +90 501 015 42 42
- E-posta: info@baskenthastanesi.com

ORGAN NAKLİ (Tüm Başkent):
- 3422+ Böbrek, 724+ Karaciğer, 376+ Kornea, 148+ Kalp, 1372+ Kemik İliği Nakli

TIBBI BÖLÜMLER:
Acil Tıp, Anesteziyoloji, Beyin Cerrahisi, Çocuk Cerrahisi, Çocuk Kalp-Damar Cerrahisi, Çocuk Kardiyolojisi, Çocuk Hastalıkları, Dermatoloji, Diş Hekimliği (Ortodonti, Pedodonti, Periodontoloji, Protetik, Çene Cerrahisi), Enfeksiyon Hastalıkları, Fizik Tedavi, Genel Cerrahi, Göğüs Hastalıkları, Göz Hastalıkları, Gastroenteroloji, Dahiliye, Nefroloji, Romatoloji, Kadın Doğum, Kalp Damar Cerrahisi, Kardiyoloji, KBB, Nöroloji, Nükleer Tıp, Ortopedi, Radyoloji, Psikiyatri, Onkoloji, Patoloji, Üroloji, Neonatoloji

MERKEZLER:
- Organ Nakli Merkezi, Tüp Bebek (IVF - 1998'den beri), Kalp Merkezi, Girişimsel Radyoloji, Uyku Merkezi, Obezite Cerrahisi, Karaciğer-Pankreas-Safra Yolları, Check-Up

ULUSLARARASI HİZMETLER:
- Tercüman desteği (Arapça, Rusça, İngilizce)
- Havalimanı transfer, konaklama yardımı
- Uluslararası sigorta kabul edilir
- Tıbbi değerlendirme 24-72 saat

DOKTOR KURALI: ASLA doktor ismi verme. "Alanında uzman doktorlarımız var, randevuda sizin için en uygun doktor yönlendirilecek" de.

KONUŞMA: İlk mesaj hariç "Merhaba" deme. Kısa (2-3 cümle), samimi, doğal yaz. Fiyat ASLA verme, randevuya yönlendir.`;
}
