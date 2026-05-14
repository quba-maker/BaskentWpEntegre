"use server";

import { sql } from "@/lib/db";
import { withActionGuard } from "@/lib/core/action-guard";
import { logAudit } from "@/lib/audit";

// ==========================================
// QUBA AI — Bot Actions (Zero-Trust Migrated)
// ==========================================

export async function getBotSettings() {
  return withActionGuard(
    { actionName: 'getBotSettings' },
    async (ctx) => {
      const requestedKeys = [
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
        'bot_banned_words',
        // Legacy keys to fetch for hydration
        'bot_whatsapp_active',
        'bot_instagram_active',
        'bot_foreign_active',
        'working_hours'
      ];

      const settings = await ctx.db.executeSafe(sql`
        SELECT key, value, updated_at FROM settings 
        WHERE tenant_id = ${ctx.tenantId}
          AND key = ANY(${requestedKeys})
      `);

      // Legacy to V2 mapping
      const keyMapper: Record<string, string> = {
        'bot_whatsapp_active': 'channel_whatsapp_enabled',
        'bot_instagram_active': 'channel_instagram_enabled',
        'bot_foreign_active': 'channel_foreign_enabled',
        'working_hours': 'bot_working_hours',
      };
      
      const rows = Array.isArray(settings) ? settings : ((settings as any)?.rows || []);

      const result: Record<string, any> = {};
      rows.forEach((s: any) => {
        const mappedKey = keyMapper[s.key] || s.key;
        if (!result[mappedKey] || new Date(s.updated_at) > new Date(result[mappedKey].updated_at)) {
          result[mappedKey] = { value: s.value, updated_at: s.updated_at };
        }
      });
      
      return { settings: result };
    }
  ).then(res => {
    if (!res.success) return { success: false, settings: {} as Record<string, any>, error: res.error };
    return { success: true, settings: res.data?.settings as Record<string, any> };
  });
}

export async function saveBotSetting(key: string, value: string) {
  return withActionGuard(
    { 
      actionName: 'saveBotSetting',
      roles: ['owner', 'admin'] // Sadece yetkililer bot değiştirebilir
    },
    async (ctx) => {
      // UPSERT — RLS enforced & Idempotent
      await ctx.db.executeSafe(sql`
        INSERT INTO settings (key, value, tenant_id, updated_at) 
        VALUES (${key}, ${value}, ${ctx.tenantId}, NOW())
        ON CONFLICT (tenant_id, key) 
        DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at
      `);

      
      // Audit log
      logAudit({
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        userEmail: ctx.email,
        action: "bot_setting_changed",
        entityType: "setting",
        entityId: key,
        details: { newValue: value.substring(0, 200) },
      });

      return { success: true };
    }
  ).then(res => {
    if (!res.success) return { success: false, error: res.error };
    return { success: true };
  });
}

export async function getDefaultPrompts() {
  return withActionGuard(
    { actionName: 'getDefaultPrompts' },
    async (ctx) => {
      let tenantName = "Firma";
      const t = await ctx.db.executeSafe(sql`SELECT name FROM tenants WHERE id = ${ctx.tenantId}`);
      if (t[0]?.name) tenantName = t[0].name;

      return {
        whatsapp: `Sen ${tenantName} adına çalışan profesyonel bir müşteri danışmanısın.\n\nGÖREVİN:\nGelen mesajları analiz ederek müşteriye kısa, güven veren, profesyonel cevaplar vermek. Müşteriyi önce anla, sonra doğal akışta randevuya/satışa yönlendir.\n\nTEMEL KURALLAR:\n1) Kullanıcının yazdığı dilde cevap ver.\n2) Kısa, net ve WhatsApp formatında mesajlar yaz.\n3) Samimi, sıcak ama profesyonel ol.\n4) ASLA "Sizi şimdi arıyorum" gibi yalan söyleme.\n\nİKNA TEKNİKLERİ:\n1. EMPATİ: Müşterinin ihtiyacını anla.\n2. SOSYAL KANIT: "Benzer durumda müşterilerimiz çok memnun kaldı."\n3. KOLAYLIK: "Tüm süreci biz organize ediyoruz."\n\nHEDEF: Her konuşmayı doğal, ikna edici ve empatik şekilde randevuya/satışa dönüştür.`,
        turkish: `Sen ${tenantName} firmasının Türkçe sosyal medya (Instagram/Facebook) müşteri danışmanısın.\n\nGÖREVİN:\nSosyal medyadan gelen mesajları akıllıca analiz et. Kimin ne amaçla yazdığını tespit et ve ona göre davran.\n\nKURALLAR:\n- Kısa ve samimi mesajlar (2-4 cümle)\n- Emoji: 1-2 max (🙏, 😊)\n- Gerçek müşteriyi 2-3 mesaj sonra doğal şekilde WhatsApp'a yönlendir.`,
        foreign: `You are a professional consultant representing ${tenantName}.\n\nCRITICAL LANGUAGE RULE:\nDetect the language of the user's LAST message. Respond ENTIRELY in that language. NEVER default to Turkish.\n\nCONSULTATION FLOW:\n1. LISTEN & UNDERSTAND\n2. SOLUTION MAPPING\n3. THE CLOSE\n\nCORE RULES:\n- Professional, warm tone\n- 2-4 sentences per message\n- Guide to WhatsApp for detailed conversation`
      };
    }
  ).then(res => res.data || { whatsapp: '', turkish: '', foreign: '' });
}

export async function getBotStats(period: string = '7d') {
  return withActionGuard(
    { actionName: 'getBotStats' },
    async (ctx) => {
      const intervalMap: Record<string, string> = {
        '7d': '7 days', '30d': '30 days', '90d': '90 days', 'all': '10 years'
      };
      const interval = intervalMap[period] || '7 days';

      const [botMessages, handovers, totalConvs, avgResponse] = await Promise.all([
        ctx.db.executeSafe(sql`SELECT COUNT(*) as c FROM messages WHERE tenant_id = ${ctx.tenantId} AND direction = 'out' AND model_used IS NOT NULL AND model_used != 'panel' AND created_at >= NOW() - CAST(${interval} AS INTERVAL)`),
        ctx.db.executeSafe(sql`SELECT COUNT(*) as c FROM conversations WHERE tenant_id = ${ctx.tenantId} AND status = 'human' AND last_message_at >= NOW() - CAST(${interval} AS INTERVAL)`),
        ctx.db.executeSafe(sql`SELECT COUNT(*) as c FROM conversations WHERE tenant_id = ${ctx.tenantId} AND created_at >= NOW() - CAST(${interval} AS INTERVAL)`),
        ctx.db.executeSafe(sql`SELECT AVG(EXTRACT(EPOCH FROM (m.created_at - c.created_at)) / 60) as avg_min
            FROM conversations c
            JOIN messages m ON m.phone_number = c.phone_number AND m.direction = 'out'
            WHERE c.tenant_id = ${ctx.tenantId}
              AND c.created_at >= NOW() - CAST(${interval} AS INTERVAL)
              AND m.created_at = (SELECT MIN(created_at) FROM messages WHERE phone_number = c.phone_number AND direction = 'out')`)
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
    }
  ).then(res => res.data || { weeklyMessages: 0, handoverRate: 0, botSuccessRate: 0, avgResponseMin: 0 });
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
  return withActionGuard(
    { actionName: 'getModelUsage' },
    async (ctx) => {
      const intervalMap: Record<string, string> = {
        '7d': '7 days', '30d': '30 days', '90d': '90 days', 'all': '10 years'
      };
      const interval = intervalMap[period] || '30 days';

      const usage = await ctx.db.executeSafe(sql`
        SELECT model_used, COUNT(*) as message_count
        FROM messages 
        WHERE tenant_id = ${ctx.tenantId}
          AND direction = 'out' 
          AND model_used IS NOT NULL 
          AND model_used NOT IN ('panel', 'mesai-disi', 'fallback', 'none')
          AND created_at >= NOW() - CAST(${interval} AS INTERVAL)
        GROUP BY model_used ORDER BY message_count DESC
      `);

      const channelBreakdown = await ctx.db.executeSafe(sql`
        SELECT channel, COUNT(*) as c
        FROM messages 
        WHERE tenant_id = ${ctx.tenantId}
          AND direction = 'out' 
          AND model_used IS NOT NULL 
          AND model_used NOT IN ('panel', 'mesai-disi', 'fallback', 'none')
          AND created_at >= NOW() - CAST(${interval} AS INTERVAL)
        GROUP BY channel
      `);

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
    }
  ).then(res => res.data || { models: {}, channels: {}, totalMessages: 0, totalCost: 0 });
}

export async function getRecentBotConversations(limit: number = 8) {
  return withActionGuard(
    { actionName: 'getRecentBotConversations' },
    async (ctx) => {
      const convs = await ctx.db.executeSafe(sql`
        SELECT 
          c.phone_number, c.patient_name, c.channel, c.status, c.temperature,
          c.phase, c.department, c.message_count, c.last_message_at, c.lead_score,
          (SELECT content FROM messages WHERE phone_number = c.phone_number AND direction = 'in' ORDER BY created_at DESC LIMIT 1) as last_patient_msg,
          (SELECT COUNT(*) FROM messages WHERE phone_number = c.phone_number AND direction = 'out' AND model_used IS NOT NULL AND model_used NOT IN ('panel', 'mesai-disi')) as bot_msg_count
        FROM conversations c
        WHERE c.tenant_id = ${ctx.tenantId}
          AND c.message_count > 0
        ORDER BY c.last_message_at DESC LIMIT ${limit}
      `);

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
    }
  ).then(res => res.data || []);
}

export async function testBotPrompt(prompt: string, testMessage: string, channel: string = 'whatsapp') {
  return withActionGuard(
    { actionName: 'testBotPrompt' },
    async (ctx) => {
      const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
      if (!GEMINI_API_KEY) {
        return { success: false, reply: '⚠️ GEMINI_API_KEY tanımlı değil.', model: '' };
      }
      if (!testMessage.trim()) {
        return { success: false, reply: '⚠️ Test mesajı boş olamaz.', model: '' };
      }

      let finalPrompt = prompt;
      if (!finalPrompt || finalPrompt.trim().length < 10) {
        const promptKeyMap: Record<string, string> = {
          whatsapp: 'system_prompt_whatsapp',
          instagram: 'system_prompt_tr',
          foreign: 'system_prompt_foreign'
        };
        const key = promptKeyMap[channel] || 'system_prompt_whatsapp';
        const dbPrompt = await ctx.db.executeSafe(sql`
          SELECT value FROM settings WHERE key = ${key} AND tenant_id = ${ctx.tenantId}
        `);
        finalPrompt = dbPrompt[0]?.value || 'Sen bir dijital asistansın. Kısa, sıcak ve profesyonel cevaplar ver.';
      }

      const aiModel = await ctx.db.executeSafe(sql`
        SELECT value FROM settings WHERE key = 'ai_model' AND tenant_id = ${ctx.tenantId}
      `);
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
    }
  ).then(res => {
    if (!res.success) return { success: false, reply: '❌ Bağlantı hatası: ' + res.error, model: '' };
    return res.data!;
  });
}
