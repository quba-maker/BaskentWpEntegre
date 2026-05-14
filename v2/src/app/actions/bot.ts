"use server";

import { sql } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { logAudit } from "@/lib/audit";

// ==========================================
// VARSAYILAN PROMPTLAR — artık dinamik
// getDefaultPrompts() fonksiyonu tenant adını
// DB'den çekerek generic prompt üretir.
// Başkent'e özel promptlar DB'de (settings tablosu).
// ==========================================

// ==========================================
// SERVER ACTIONS
// ==========================================

export async function getBotSettings() {
  try {
    const session = await getSession();
    if (!session?.tenantId) return { success: false, settings: {} as Record<string, any>, error: "Oturum yok" };
    const tenantId = session.tenantId;
    
    const settings = await sql`
      SELECT key, value, updated_at FROM settings 
      WHERE tenant_id = ${tenantId}
        AND key IN (
          'system_prompt_whatsapp', 
          'system_prompt_tr', 
          'system_prompt_foreign',
          'foreign_page_id',
          'channel_whatsapp_enabled',
          'channel_instagram_enabled',
          'channel_foreign_enabled',
          'bot_auto_greeting',
          'bot_greeting_language',
          'bot_max_messages',
          'bot_working_hours',
          'bot_aggression_level',
          'ai_model',
          'bot_banned_words'
        )
    `;
    
    const result: Record<string, any> = {};
    settings.forEach((s: any) => {
      result[s.key] = { value: s.value, updated_at: s.updated_at };
    });
    
    return { success: true, settings: result as Record<string, any> };
  } catch (error: any) {
    console.error("getBotSettings Error:", error);
    return { success: false, settings: {} as Record<string, any>, error: error.message };
  }
}

export async function saveBotSetting(key: string, value: string) {
  try {
    const session = await getSession();
    if (!session?.tenantId) return { success: false, error: "Oturum yok" };
    if (session.role !== "owner" && session.role !== "admin" && session.role !== "platform_admin") {
      return { success: false, error: "Bot ayarlarını değiştirme yetkiniz yok." };
    }
    const tenantId = session.tenantId;
    
    // UPSERT — tenant bazlı
    const existing = await sql`SELECT id FROM settings WHERE key = ${key} AND tenant_id = ${tenantId}`;
    if (existing.length > 0) {
      await sql`UPDATE settings SET value = ${value}, updated_at = NOW() WHERE key = ${key} AND tenant_id = ${tenantId}`;
    } else {
      await sql`INSERT INTO settings (key, value, tenant_id) VALUES (${key}, ${value}, ${tenantId})`;
    }
    // Audit log — ayar değişikliğini logla
    logAudit({
      tenantId,
      userId: session.userId,
      userEmail: session.email,
      action: "bot_setting_changed",
      entityType: "setting",
      entityId: key,
      details: { newValue: value.substring(0, 200) },
    });

    return { success: true };
  } catch (error: any) {
    console.error("saveBotSetting Error:", error);
    return { success: false, error: error.message };
  }
}

export async function getDefaultPrompts() {
  // Tenant adını DB'den al — generic prompt oluştur
  const session = await getSession();
  let tenantName = "Firma";
  if (session?.tenantId) {
    const t = await sql`SELECT name FROM tenants WHERE id = ${session.tenantId}`;
    if (t[0]?.name) tenantName = t[0].name;
  }

  return {
    whatsapp: `Sen ${tenantName} adına çalışan profesyonel bir müşteri danışmanısın.

GÖREVİN:
Gelen mesajları analiz ederek müşteriye kısa, güven veren, profesyonel cevaplar vermek. Müşteriyi önce anla, sonra doğal akışta randevuya/satışa yönlendir.

TEMEL KURALLAR:
1) Kullanıcının yazdığı dilde cevap ver.
2) Kısa, net ve WhatsApp formatında mesajlar yaz.
3) Samimi, sıcak ama profesyonel ol.
4) ASLA "Sizi şimdi arıyorum" gibi yalan söyleme.

İKNA TEKNİKLERİ:
1. EMPATİ: Müşterinin ihtiyacını anla.
2. SOSYAL KANIT: "Benzer durumda müşterilerimiz çok memnun kaldı."
3. KOLAYLIK: "Tüm süreci biz organize ediyoruz."

HEDEF: Her konuşmayı doğal, ikna edici ve empatik şekilde randevuya/satışa dönüştür.`,

    turkish: `Sen ${tenantName} firmasının Türkçe sosyal medya (Instagram/Facebook) müşteri danışmanısın.

GÖREVİN:
Sosyal medyadan gelen mesajları akıllıca analiz et. Kimin ne amaçla yazdığını tespit et ve ona göre davran.

KURALLAR:
- Kısa ve samimi mesajlar (2-4 cümle)
- Emoji: 1-2 max (🙏, 😊)
- Gerçek müşteriyi 2-3 mesaj sonra doğal şekilde WhatsApp'a yönlendir.`,

    foreign: `You are a professional consultant representing ${tenantName}.

CRITICAL LANGUAGE RULE:
Detect the language of the user's LAST message. Respond ENTIRELY in that language. NEVER default to Turkish.

CONSULTATION FLOW:
1. LISTEN & UNDERSTAND
2. SOLUTION MAPPING
3. THE CLOSE

CORE RULES:
- Professional, warm tone
- 2-4 sentences per message
- Guide to WhatsApp for detailed conversation`
  };
}

export async function getBotStats(period: string = '7d') {
  try {
    const session = await getSession();
    if (!session?.tenantId) return { weeklyMessages: 0, handoverRate: 0, botSuccessRate: 0, avgResponseMin: 0 };
    const tenantId = session.tenantId;
    
    const intervalMap: Record<string, string> = {
      '7d': '7 days',
      '30d': '30 days',
      '90d': '90 days',
      'all': '10 years'
    };
    const interval = intervalMap[period] || '7 days';

    const [botMessages, handovers, totalConvs, avgResponse] = await Promise.all([
      sql`SELECT COUNT(*) as c FROM messages WHERE tenant_id = ${tenantId} AND direction = 'out' AND model_used IS NOT NULL AND model_used != 'panel' AND created_at >= NOW() - CAST(${interval} AS INTERVAL)`,
      sql`SELECT COUNT(*) as c FROM conversations WHERE tenant_id = ${tenantId} AND status = 'human' AND last_message_at >= NOW() - CAST(${interval} AS INTERVAL)`,
      sql`SELECT COUNT(*) as c FROM conversations WHERE tenant_id = ${tenantId} AND created_at >= NOW() - CAST(${interval} AS INTERVAL)`,
      sql`SELECT AVG(EXTRACT(EPOCH FROM (m.created_at - c.created_at)) / 60) as avg_min
          FROM conversations c
          JOIN messages m ON m.phone_number = c.phone_number AND m.direction = 'out'
          WHERE c.tenant_id = ${tenantId}
            AND c.created_at >= NOW() - CAST(${interval} AS INTERVAL)
            AND m.created_at = (SELECT MIN(created_at) FROM messages WHERE phone_number = c.phone_number AND direction = 'out')`
    ]);

    const totalConvsCount = parseInt(totalConvs[0]?.c) || 1;
    const handoverCount = parseInt(handovers[0]?.c) || 0;
    const handoverRate = Math.round((handoverCount / totalConvsCount) * 100);
    const botSuccessRate = 100 - handoverRate;

    return {
      weeklyMessages: parseInt(botMessages[0]?.c) || 0,
      handoverRate,
      botSuccessRate,
      avgResponseMin: Math.round(parseFloat(avgResponse[0]?.avg_min) || 0)
    };
  } catch (error) {
    console.error("getBotStats Error:", error);
    return { weeklyMessages: 0, handoverRate: 0, botSuccessRate: 0, avgResponseMin: 0 };
  }
}

// ==========================================
// AI MODEL USAGE & COST
// ==========================================

const MODEL_COSTS: Record<string, { input: number; output: number; label: string }> = {
  'gemini-2.5-flash': { input: 0.15, output: 0.60, label: 'Gemini 2.5 Flash' },
  'gemini-2.5-flash-lite': { input: 0.04, output: 0.15, label: 'Flash Lite' },
  'gemini-2.5-pro': { input: 1.25, output: 10.0, label: 'Gemini 2.5 Pro' },
};

export async function getModelUsage(period: string = '30d') {
  try {
    const session = await getSession();
    if (!session?.tenantId) return { models: {}, channels: {}, totalMessages: 0, totalCost: 0 };
    const tenantId = session.tenantId;
    
    const intervalMap: Record<string, string> = {
      '7d': '7 days', '30d': '30 days', '90d': '90 days', 'all': '10 years'
    };
    const interval = intervalMap[period] || '30 days';

    const usage = await sql`
      SELECT model_used, COUNT(*) as message_count
      FROM messages 
      WHERE tenant_id = ${tenantId}
        AND direction = 'out' 
        AND model_used IS NOT NULL 
        AND model_used NOT IN ('panel', 'mesai-disi', 'fallback', 'none')
        AND created_at >= NOW() - CAST(${interval} AS INTERVAL)
      GROUP BY model_used ORDER BY message_count DESC
    `;

    const channelBreakdown = await sql`
      SELECT channel, COUNT(*) as c
      FROM messages 
      WHERE tenant_id = ${tenantId}
        AND direction = 'out' 
        AND model_used IS NOT NULL 
        AND model_used NOT IN ('panel', 'mesai-disi', 'fallback', 'none')
        AND created_at >= NOW() - CAST(${interval} AS INTERVAL)
      GROUP BY channel
    `;

    let totalCost = 0;
    const modelBreakdown: Record<string, { count: number; cost: number; label: string }> = {};
    
    usage.forEach((row: any) => {
      const model = row.model_used;
      const count = parseInt(row.message_count);
      const costInfo = MODEL_COSTS[model] || MODEL_COSTS['gemini-2.5-flash'];
      const estimatedCost = count * ((150 * costInfo.input + 200 * costInfo.output) / 1_000_000);
      
      if (!modelBreakdown[model]) {
        modelBreakdown[model] = { count: 0, cost: 0, label: costInfo.label };
      }
      modelBreakdown[model].count += count;
      modelBreakdown[model].cost += estimatedCost;
      totalCost += estimatedCost;
    });

    const channels: Record<string, number> = {};
    let totalChannelMsgs = 0;
    channelBreakdown.forEach((row: any) => {
      channels[row.channel] = parseInt(row.c);
      totalChannelMsgs += parseInt(row.c);
    });

    return { models: modelBreakdown, channels, totalMessages: totalChannelMsgs, totalCost: Math.round(totalCost * 100) / 100 };
  } catch (error) {
    console.error("getModelUsage Error:", error);
    return { models: {}, channels: {}, totalMessages: 0, totalCost: 0 };
  }
}

// ==========================================
// RECENT BOT CONVERSATIONS
// ==========================================

export async function getRecentBotConversations(limit: number = 8) {
  try {
    const session = await getSession();
    if (!session?.tenantId) return [];
    const tenantId = session.tenantId;
    
    const convs = await sql`
      SELECT 
        c.phone_number, c.patient_name, c.channel, c.status, c.temperature,
        c.phase, c.department, c.message_count, c.last_message_at, c.lead_score,
        (SELECT content FROM messages WHERE phone_number = c.phone_number AND direction = 'in' ORDER BY created_at DESC LIMIT 1) as last_patient_msg,
        (SELECT COUNT(*) FROM messages WHERE phone_number = c.phone_number AND direction = 'out' AND model_used IS NOT NULL AND model_used NOT IN ('panel', 'mesai-disi')) as bot_msg_count
      FROM conversations c
      WHERE c.tenant_id = ${tenantId}
        AND c.message_count > 0
      ORDER BY c.last_message_at DESC LIMIT ${limit}
    `;

    return convs.map((c: any) => ({
      phone: c.phone_number,
      name: c.patient_name || c.phone_number,
      channel: c.channel || 'whatsapp',
      status: c.status,
      temperature: c.temperature,
      phase: c.phase,
      department: c.department,
      messageCount: c.message_count,
      botMsgCount: parseInt(c.bot_msg_count) || 0,
      lastMessage: c.last_patient_msg?.substring(0, 80) || '',
      lastMessageAt: c.last_message_at,
      score: c.lead_score || 0
    }));
  } catch (error) {
    console.error("getRecentBotConversations Error:", error);
    return [];
  }
}

// ==========================================
// BOT TEST (PLAYGROUND)
// ==========================================

export async function testBotPrompt(prompt: string, testMessage: string, channel: string = 'whatsapp') {
  try {
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    if (!GEMINI_API_KEY) {
      return { success: false, reply: '⚠️ GEMINI_API_KEY tanımlı değil. Vercel ortam değişkenlerini kontrol edin.', model: '' };
    }
    if (!testMessage.trim()) {
      return { success: false, reply: '⚠️ Test mesajı boş olamaz.', model: '' };
    }

    // Prompt boşsa DB'den çek (tenant-scoped)
    const session = await getSession();
    const tenantId = session?.tenantId;
    let finalPrompt = prompt;
    if (!finalPrompt || finalPrompt.trim().length < 10) {
      const promptKeyMap: Record<string, string> = {
        whatsapp: 'system_prompt_whatsapp',
        instagram: 'system_prompt_tr',
        foreign: 'system_prompt_foreign'
      };
      const key = promptKeyMap[channel] || 'system_prompt_whatsapp';
      const dbPrompt = tenantId 
        ? await sql`SELECT value FROM settings WHERE key = ${key} AND tenant_id = ${tenantId}`
        : await sql`SELECT value FROM settings WHERE key = ${key} LIMIT 1`;
      finalPrompt = dbPrompt[0]?.value || 'Sen bir dijital asistansın. Kısa, sıcak ve profesyonel cevaplar ver.';
    }

    const aiModel = tenantId
      ? await sql`SELECT value FROM settings WHERE key = 'ai_model' AND tenant_id = ${tenantId}`
      : await sql`SELECT value FROM settings WHERE key = 'ai_model' LIMIT 1`;
    const model = aiModel[0]?.value || 'gemini-2.5-flash';

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: finalPrompt }] },
          contents: [{ role: 'user', parts: [{ text: testMessage }] }],
          generationConfig: { temperature: 0.7, maxOutputTokens: 1024 }
        })
      }
    );

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      return { success: false, reply: `⚠️ Gemini API Hatası (${response.status}): ${errData?.error?.message || 'Bilinmeyen hata'}`, model };
    }

    const data = await response.json();
    const botReply = data?.candidates?.[0]?.content?.parts?.[0]?.text || '⚠️ Model yanıt üretmedi.';
    return { success: true, reply: botReply, model };
  } catch (error: any) {
    return { success: false, reply: '❌ Bağlantı hatası: ' + error.message, model: '' };
  }
}
