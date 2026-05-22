"use server";

import { withActionGuard } from "@/lib/core/action-guard";
import { logAudit } from "@/lib/audit";

// ==========================================
// QUBA AI — Bot Actions (V2-Native)
// Phase 2D-2B: All reads/writes use V2 tables
// V1 dual-write gated behind USE_V1_DUAL_WRITE
// ==========================================

/** When true, writes also sync to V1 settings table for backward compatibility */
function isV1DualWriteEnabled(): boolean {
  return process.env.USE_V1_DUAL_WRITE === 'true';
}

// ─── V2 CHANNEL MAPPING ───
// Maps panel channel IDs to V2 prompt names for lookup
const CHANNEL_PROMPT_MAP: Record<string, string> = {
  whatsapp: 'WhatsApp System Prompt',
  instagram: 'Social TR Prompt',
  foreign: 'Social Foreign Prompt',
};

// Maps panel channel IDs to V2 channel providers for lookup
const CHANNEL_PROVIDER_MAP: Record<string, string> = {
  whatsapp: 'whatsapp',
  instagram: 'meta_instagram',
  foreign: 'meta_instagram',  // foreign uses instagram channel with different group
};

// ==========================================
// READ: getBotSettings (V2 Primary)
// Returns data in same shape as V1 for UI compatibility
// ==========================================
export async function getBotSettings() {
  return withActionGuard(
    { actionName: 'getBotSettings' },
    async (ctx) => {
      // ── V2 READ: Fetch all prompts for this tenant ──
      const prompts = await ctx.db.executeSafe({
        text: `SELECT cp.name, cp.prompt_text, cp.knowledge_prices, cp.knowledge_rules, 
                      cp.is_active, cp.version, cp.updated_at
               FROM channel_prompts cp
               WHERE cp.tenant_id = $1 AND cp.is_active = true`,
        values: [ctx.tenantId]
      });

      // ── V2 READ: Fetch AI profile (use first active group's profile) ──
      const profiles = await ctx.db.executeSafe({
        text: `SELECT cap.ai_model, cap.max_messages, cap.max_response_tokens, 
                      cap.aggression_level, cap.business_hours_json,
                      cap.auto_greeting, cap.greeting_language,
                      cap.updated_at
               FROM channel_ai_profiles cap
               JOIN channel_groups cg ON cap.group_id = cg.id
               WHERE cg.tenant_id = $1 AND cg.status = 'active'
               ORDER BY cap.updated_at DESC LIMIT 1`,
        values: [ctx.tenantId]
      });

      // ── V2 READ: Fetch channel enable states ──
      const channels = await ctx.db.executeSafe({
        text: `SELECT c.provider, c.name, cg.status
               FROM channels c
               JOIN channel_groups cg ON c.group_id = cg.id
               WHERE cg.tenant_id = $1`,
        values: [ctx.tenantId]
      });

      // ── BUILD V1-COMPATIBLE SHAPE ──
      // UI expects: { [key]: { value, updated_at } }
      const result: Record<string, any> = {};

      // Map prompts to V1 keys
      const promptRows = Array.isArray(prompts) ? prompts : [];
      for (const p of promptRows) {
        const v1Key = promptNameToV1Key(p.name);
        if (v1Key) {
          result[v1Key] = { value: p.prompt_text, updated_at: p.updated_at };
        }
        // Knowledge is shared across prompts — use first non-empty
        if (p.knowledge_prices && !result['bot_knowledge_prices']) {
          result['bot_knowledge_prices'] = { value: p.knowledge_prices, updated_at: p.updated_at };
        }
        if (p.knowledge_rules && !result['bot_knowledge_rules']) {
          result['bot_knowledge_rules'] = { value: p.knowledge_rules, updated_at: p.updated_at };
        }
      }

      // Map AI profile to V1 keys
      const profile = Array.isArray(profiles) && profiles.length > 0 ? profiles[0] : null;
      if (profile) {
        result['ai_model'] = { value: profile.ai_model || 'gemini-2.5-flash', updated_at: profile.updated_at };
        result['bot_max_messages'] = { value: String(profile.max_messages || 8), updated_at: profile.updated_at };
        result['bot_max_response_tokens'] = { value: String(profile.max_response_tokens || 1000), updated_at: profile.updated_at };
        result['bot_aggression_level'] = { value: profile.aggression_level || 'medium', updated_at: profile.updated_at };
        const bhJson = profile.business_hours_json;
        const workingHoursValue = (bhJson && typeof bhJson === 'object' && Object.keys(bhJson).length > 0) 
          ? bhJson 
          : { enabled: false };
        result['working_hours'] = { value: JSON.stringify(workingHoursValue), updated_at: profile.updated_at };
        result['bot_auto_greeting'] = { value: profile.auto_greeting ? 'true' : 'false', updated_at: profile.updated_at };
        result['bot_greeting_language'] = { value: profile.greeting_language || 'auto', updated_at: profile.updated_at };
      }

      // Map channel states
      const channelRows = Array.isArray(channels) ? channels : [];
      const hasWhatsapp = channelRows.some((c: any) => c.provider === 'whatsapp');
      const hasInstagram = channelRows.some((c: any) => c.provider === 'meta_instagram');
      result['channel_whatsapp_enabled'] = { value: hasWhatsapp ? 'true' : 'false', updated_at: new Date().toISOString() };
      result['channel_instagram_enabled'] = { value: hasInstagram ? 'true' : 'false', updated_at: new Date().toISOString() };
      result['channel_foreign_enabled'] = { value: hasInstagram ? 'true' : 'false', updated_at: new Date().toISOString() };

      // Fill missing knowledge
      if (!result['bot_knowledge_prices']) result['bot_knowledge_prices'] = { value: '', updated_at: null };
      if (!result['bot_knowledge_rules']) result['bot_knowledge_rules'] = { value: '', updated_at: null };

      return { settings: result };
    }
  ).then(res => {
    if (!res.success) return { success: false, settings: {} as Record<string, any>, error: res.error };
    return { success: true, settings: res.data?.settings as Record<string, any> };
  }).catch(err => {
    return { success: false, settings: {} as Record<string, any>, error: err.message };
  });
}

// ==========================================
// WRITE: saveBotSetting (V2 Primary, V1 Dual-Write Optional)
// ==========================================
export async function saveBotSetting(key: string, value: string) {
  return withActionGuard(
    { 
      actionName: 'saveBotSetting',
      roles: ['owner', 'admin']
    },
    async (ctx) => {
      // ── ROUTE TO V2 TABLE ──
      if (key.startsWith('system_prompt_')) {
        // Guard: strip section markers and check real content length
        const strippedContent = (value || '')
          .replace(/---\s*(IDENTITY|INSTRUCTIONS|CONSTRAINTS)\s*---/g, '')
          .replace(/\s+/g, ' ')
          .trim();
        if (strippedContent.length < 100) {
          console.warn('[PROMPT_SAVE_BLOCKED] Real content too short:', key, 'stripped_len:', strippedContent.length);
          return { success: true };
        }
        // Write to channel_prompts
        const promptName = v1KeyToPromptName(key);
        if (promptName) {
          await ctx.db.executeSafe({
            text: `UPDATE channel_prompts 
                   SET prompt_text = $1, version = version + 1, updated_at = NOW()
                   WHERE tenant_id = $2 AND name = $3 AND is_active = true`,
            values: [value, ctx.tenantId, promptName]
          });
        }
      } else if (key === 'bot_knowledge_prices' || key === 'bot_knowledge_rules') {
        // Write knowledge to ALL active prompts for this tenant
        const col = key === 'bot_knowledge_prices' ? 'knowledge_prices' : 'knowledge_rules';
        await ctx.db.executeSafe({
          text: `UPDATE channel_prompts SET ${col} = $1, updated_at = NOW()
                 WHERE tenant_id = $2 AND is_active = true`,
          values: [value, ctx.tenantId]
        });
      } else if (['ai_model', 'bot_max_messages', 'bot_max_response_tokens', 'bot_aggression_level'].includes(key)) {
        // Write to channel_ai_profiles
        const colMap: Record<string, string> = {
          'ai_model': 'ai_model',
          'bot_max_messages': 'max_messages',
          'bot_max_response_tokens': 'max_response_tokens',
          'bot_aggression_level': 'aggression_level',
        };
        const col = colMap[key];
        const isNumeric = ['max_messages', 'max_response_tokens'].includes(col);
        const dbVal = isNumeric ? parseInt(value) || (col === 'max_messages' ? 8 : 1000) : value;
        
        await ctx.db.executeSafe({
          text: `UPDATE channel_ai_profiles SET ${col} = $1, updated_at = NOW()
                 WHERE group_id IN (
                   SELECT id FROM channel_groups WHERE tenant_id = $2 AND status = 'active'
                 )`,
          values: [dbVal, ctx.tenantId]
        });
      } else if (key === 'working_hours') {
        // Write business hours to channel_ai_profiles
        let parsed: any = { enabled: false };
        try { parsed = JSON.parse(value); } catch(e) {}
        
        await ctx.db.executeSafe({
          text: `UPDATE channel_ai_profiles SET business_hours_json = $1, updated_at = NOW()
                 WHERE group_id IN (
                   SELECT id FROM channel_groups WHERE tenant_id = $2 AND status = 'active'
                 )`,
          values: [JSON.stringify(parsed), ctx.tenantId]
        });
      } else if (key === 'bot_auto_greeting') {
        await ctx.db.executeSafe({
          text: `UPDATE channel_ai_profiles SET auto_greeting = $1, updated_at = NOW()
                 WHERE group_id IN (
                   SELECT id FROM channel_groups WHERE tenant_id = $2 AND status = 'active'
                 )`,
          values: [value === 'true', ctx.tenantId]
        });
      } else if (key === 'bot_greeting_language') {
        await ctx.db.executeSafe({
          text: `UPDATE channel_ai_profiles SET greeting_language = $1, updated_at = NOW()
                 WHERE group_id IN (
                   SELECT id FROM channel_groups WHERE tenant_id = $2 AND status = 'active'
                 )`,
          values: [value, ctx.tenantId]
        });
      }

      // ── V1 DUAL WRITE (optional) ──
      if (isV1DualWriteEnabled()) {
        try {
          await ctx.db.executeSafe({
            text: `INSERT INTO settings (key, value, tenant_id, updated_at) 
                   VALUES ($1, $2, $3, NOW())
                   ON CONFLICT (tenant_id, key) 
                   DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at`,
            values: [key, value, ctx.tenantId]
          });
        } catch (e) {
          // Non-fatal: V1 dual-write failure doesn't block V2
        }
      }

      // Audit log
      logAudit({
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        userEmail: ctx.email,
        action: "bot_setting_changed",
        entityType: "setting",
        entityId: key,
        details: { newValue: value.substring(0, 200), source: 'v2' },
      });

      // Auto-version brain prompts on save
      if (key.startsWith('system_prompt')) {
        try {
          const { BrainVersionService } = await import('@/lib/services/brain-version.service');
          await BrainVersionService.saveVersion({
            tenantId: ctx.tenantId,
            systemPrompt: value,
            promptKey: key,
            changedBy: ctx.email || 'admin',
            changeSummary: `${key} güncellendi (V2)`,
          });
        } catch (e) {
          // Non-fatal
        }
      }

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
      const { defaultPrompts } = await import('@/lib/domain/conversation/prompts');
      return {
        whatsapp: defaultPrompts.whatsapp,
        turkish: defaultPrompts.instagram,
        foreign: defaultPrompts.foreign
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
        ctx.db.executeSafe({ text: `SELECT COUNT(*) as c FROM messages WHERE tenant_id = $1 AND direction = 'out' AND created_at >= NOW() - CAST($2 AS INTERVAL)`, values: [ctx.tenantId, interval] }),
        ctx.db.executeSafe({ text: `SELECT COUNT(*) as c FROM conversations WHERE tenant_id = $1 AND status = 'human' AND last_message_at >= NOW() - CAST($2 AS INTERVAL)`, values: [ctx.tenantId, interval] }),
        ctx.db.executeSafe({ text: `SELECT COUNT(*) as c FROM conversations WHERE tenant_id = $1 AND created_at >= NOW() - CAST($2 AS INTERVAL)`, values: [ctx.tenantId, interval] }),
        ctx.db.executeSafe({ text: `SELECT AVG(EXTRACT(EPOCH FROM (m.created_at - c.created_at)) / 60) as avg_min
            FROM conversations c
            JOIN messages m ON m.phone_number = c.phone_number AND m.direction = 'out'
            WHERE c.tenant_id = $1
              AND c.created_at >= NOW() - CAST($2 AS INTERVAL)
              AND m.created_at = (SELECT MIN(created_at) FROM messages WHERE phone_number = c.phone_number AND direction = 'out')`, values: [ctx.tenantId, interval] })
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

      const usage = await ctx.db.executeSafe({
        text: `SELECT 
                 COALESCE(model_used, 'gemini-2.5-flash') as model_used, 
                 COUNT(*) as message_count,
                 SUM(COALESCE(prompt_tokens, 150)) as total_prompt_tokens,
                 SUM(COALESCE(completion_tokens, 200)) as total_completion_tokens
               FROM messages 
               WHERE tenant_id = $1 AND direction = 'out' 
                 AND created_at >= NOW() - CAST($2 AS INTERVAL)
               GROUP BY COALESCE(model_used, 'gemini-2.5-flash') ORDER BY message_count DESC`,
        values: [ctx.tenantId, interval]
      });

      const channelBreakdown = await ctx.db.executeSafe({
        text: `SELECT channel, COUNT(*) as c FROM messages 
               WHERE tenant_id = $1 AND direction = 'out' 
                 AND created_at >= NOW() - CAST($2 AS INTERVAL)
               GROUP BY channel`,
        values: [ctx.tenantId, interval]
      });

      const USD_TRY_RATE = 36.50;
      let totalCostUsd = 0;
      let totalPromptTokens = 0;
      let totalCompletionTokens = 0;
      const modelBreakdown: Record<string, { count: number; costUsd: number; costTry: number; label: string }> = {};

      for (const row of (usage as any[])) {
        const m = row.model_used;
        const costs = MODEL_COSTS[m] || MODEL_COSTS['gemini-2.5-flash'];
        const promptT = parseInt(row.total_prompt_tokens) || 0;
        const completionT = parseInt(row.total_completion_tokens) || 0;
        const costUsd = ((promptT / 1_000_000) * costs.input) + ((completionT / 1_000_000) * costs.output);
        
        totalCostUsd += costUsd;
        totalPromptTokens += promptT;
        totalCompletionTokens += completionT;
        modelBreakdown[m] = { count: parseInt(row.message_count), costUsd, costTry: costUsd * USD_TRY_RATE, label: costs.label };
      }

      const channelMap: Record<string, number> = {};
      for (const row of (channelBreakdown as any[])) {
        channelMap[row.channel || 'whatsapp'] = parseInt(row.c) || 0;
      }

      const totalMessages = Object.values(modelBreakdown).reduce((s, m) => s + m.count, 0);

      return {
        models: modelBreakdown,
        channels: channelMap,
        totalMessages,
        totalPromptTokens,
        totalCompletionTokens,
        totalCostUsd,
        totalCostTry: totalCostUsd * USD_TRY_RATE,
        avgCostPerMessageUsd: totalMessages > 0 ? totalCostUsd / totalMessages : 0,
        avgCostPerMessageTry: totalMessages > 0 ? (totalCostUsd * USD_TRY_RATE) / totalMessages : 0,
        exchangeRate: USD_TRY_RATE
      };
    }
  ).then(res => res.data || { 
    models: {}, channels: {}, totalMessages: 0, totalPromptTokens: 0, totalCompletionTokens: 0,
    totalCostUsd: 0, totalCostTry: 0, avgCostPerMessageUsd: 0, avgCostPerMessageTry: 0, exchangeRate: 36.50
  });
}

export async function getRecentBotConversations(limit: number = 8) {
  return withActionGuard(
    { actionName: 'getRecentBotConversations' },
    async (ctx) => {
      const convs = await ctx.db.executeSafe({
        text: `SELECT 
                 c.phone_number, c.patient_name, c.channel, c.status, c.temperature,
                 c.phase, c.department, c.message_count, c.last_message_at, c.lead_score,
                 (SELECT content FROM messages WHERE phone_number = c.phone_number AND direction = 'in' ORDER BY created_at DESC LIMIT 1) as last_patient_msg,
                 (SELECT COUNT(*) FROM messages WHERE phone_number = c.phone_number AND direction = 'out') as bot_msg_count
               FROM conversations c
               WHERE c.tenant_id = $1 AND c.message_count > 0
               ORDER BY c.last_message_at DESC LIMIT $2`,
        values: [ctx.tenantId, limit]
      });

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

// ==========================================
// TEST BOT PROMPT (V2 Primary)
// ==========================================
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
        // V2: Read from channel_prompts
        const promptName = CHANNEL_PROMPT_MAP[channel] || CHANNEL_PROMPT_MAP['whatsapp'];
        const dbPrompt = await ctx.db.executeSafe({
          text: `SELECT prompt_text FROM channel_prompts 
                 WHERE tenant_id = $1 AND name = $2 AND is_active = true LIMIT 1`,
          values: [ctx.tenantId, promptName]
        });
        finalPrompt = dbPrompt[0]?.prompt_text || 'Sen bir dijital asistansın. Kısa, sıcak ve profesyonel cevaplar ver.';
      }

      // V2: Read knowledge from channel_prompts
      const kbData = await ctx.db.executeSafe({
        text: `SELECT knowledge_prices, knowledge_rules FROM channel_prompts 
               WHERE tenant_id = $1 AND is_active = true LIMIT 1`,
        values: [ctx.tenantId]
      });
      const prices = kbData[0]?.knowledge_prices || '';
      const rules = kbData[0]?.knowledge_rules || '';

      let knowledgeInjection = '';
      if (prices) {
        knowledgeInjection += `\n\n[FİYAT LİSTESİ VE HİZMETLER]\nAşağıdaki fiyat ve hizmet bilgilerini baz al:\n${prices}`;
      }
      if (rules) {
        knowledgeInjection += `\n\n[ÖZEL KURALLAR VE TALİMATLAR]\nLütfen şu kurallara kesinlikle uy:\n${rules}`;
      }

      finalPrompt += knowledgeInjection;

      // V2: Read AI model from channel_ai_profiles
      const profileData = await ctx.db.executeSafe({
        text: `SELECT cap.ai_model FROM channel_ai_profiles cap
               JOIN channel_groups cg ON cap.group_id = cg.id
               WHERE cg.tenant_id = $1 AND cg.status = 'active' LIMIT 1`,
        values: [ctx.tenantId]
      });
      const model = profileData[0]?.ai_model || 'gemini-2.5-flash';

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

// ==========================================
// HELPERS — V1 ↔ V2 Key Mapping
// ==========================================

function promptNameToV1Key(name: string): string | null {
  const map: Record<string, string> = {
    'WhatsApp System Prompt': 'system_prompt_whatsapp',
    'Social TR Prompt': 'system_prompt_tr',
    'Social Foreign Prompt': 'system_prompt_foreign',
  };
  return map[name] || null;
}

function v1KeyToPromptName(key: string): string | null {
  const map: Record<string, string> = {
    'system_prompt_whatsapp': 'WhatsApp System Prompt',
    'system_prompt_tr': 'Social TR Prompt',
    'system_prompt_foreign': 'Social Foreign Prompt',
  };
  return map[key] || null;
}
