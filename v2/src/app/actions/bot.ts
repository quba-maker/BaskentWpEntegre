"use server";

import { withActionGuard } from "@/lib/core/action-guard";
import { logAudit } from "@/lib/audit";
import type { ChatMessage } from "@/lib/services/ai/orchestrator";

// ==========================================
// QUBA AI — Bot Actions (V2-Native)
// Phase 2D-2B: All reads/writes use V2 tables
// V1 dual-write gated behind USE_V1_DUAL_WRITE
// ==========================================

/** When true, writes also sync to V1 settings table for backward compatibility */
function isV1DualWriteEnabled(): boolean {
  return process.env.USE_V1_DUAL_WRITE === 'true';
}



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
                      cap.response_delay_seconds, cap.response_style,
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
        result['bot_max_messages'] = { value: String(profile.max_messages ?? 8), updated_at: profile.updated_at };
        result['bot_max_response_tokens'] = { value: String(profile.max_response_tokens || 1000), updated_at: profile.updated_at };
        result['bot_aggression_level'] = { value: profile.aggression_level || 'medium', updated_at: profile.updated_at };
        const bhJson = profile.business_hours_json;
        const workingHoursValue = (bhJson && typeof bhJson === 'object' && Object.keys(bhJson).length > 0) 
          ? bhJson 
          : { enabled: false };
        result['working_hours'] = { value: JSON.stringify(workingHoursValue), updated_at: profile.updated_at };
        result['bot_auto_greeting'] = { value: profile.auto_greeting ? 'true' : 'false', updated_at: profile.updated_at };
        result['bot_greeting_language'] = { value: profile.greeting_language || 'auto', updated_at: profile.updated_at };
        result['response_delay_seconds'] = { value: String(profile.response_delay_seconds !== null && profile.response_delay_seconds !== undefined ? profile.response_delay_seconds : 5), updated_at: profile.updated_at };
        result['response_style'] = { value: profile.response_style || 'balanced', updated_at: profile.updated_at };
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
      } else if (['ai_model', 'bot_max_messages', 'bot_max_response_tokens', 'bot_aggression_level', 'response_delay_seconds', 'response_style'].includes(key)) {
        // Write to channel_ai_profiles
        const colMap: Record<string, string> = {
          'ai_model': 'ai_model',
          'bot_max_messages': 'max_messages',
          'bot_max_response_tokens': 'max_response_tokens',
          'bot_aggression_level': 'aggression_level',
          'response_delay_seconds': 'response_delay_seconds',
          'response_style': 'response_style',
        };
        const col = colMap[key];
        const isNumeric = ['max_messages', 'max_response_tokens', 'response_delay_seconds'].includes(col);
        let dbVal: any = value;
        if (isNumeric) {
          const parsed = parseInt(value);
          if (isNaN(parsed)) {
            dbVal = col === 'max_messages' ? 8 : col === 'response_delay_seconds' ? 5 : 1000;
          } else {
            dbVal = parsed;
          }
        }
        
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
// TEST BOT PROMPT
// ==========================================
export async function testBotPrompt(
  botGroupId: string,
  messages: { role: 'user' | 'assistant'; content: string }[],
  channelId?: string
) {
  return withActionGuard(
    { actionName: 'testBotPrompt' },
    async (ctx) => {
      const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
      if (!GEMINI_API_KEY) {
        return { success: false, reply: '⚠️ GEMINI_API_KEY tanımlı değil.', metadata: null };
      }
      if (!botGroupId) {
        return { success: false, reply: '⚠️ Bot Group ID gerekli.', metadata: null };
      }
      if (!messages || messages.length === 0) {
        return { success: false, reply: '⚠️ Test mesajı geçmişi boş olamaz.', metadata: null };
      }

      // 1. Verify Bot Group ownership
      const botGroupResult = await ctx.db.executeSafe({
        text: `SELECT id, name, display_name, bot_type, icon, color 
               FROM channel_groups 
               WHERE id = $1 AND tenant_id = $2 AND status = 'active'`,
        values: [botGroupId, ctx.tenantId]
      });
      if (botGroupResult.length === 0) {
        throw new Error('Bot grubu bulunamadı veya yetkiniz yok');
      }

      // 2. Verify Channel ownership (if provided)
      if (channelId) {
        const channelResult = await ctx.db.executeSafe({
          text: `SELECT c.id, c.name FROM channels c
                 JOIN channel_groups cg ON c.group_id = cg.id
                 WHERE c.id = $1 AND cg.tenant_id = $2`,
          values: [channelId, ctx.tenantId]
        });
        if (channelResult.length === 0) {
          throw new Error('Kanal bulunamadı veya yetkiniz yok');
        }
      }

      // 3. Fetch active system prompt for this group
      const promptResult = await ctx.db.executeSafe({
        text: `SELECT id, name, prompt_text, version, knowledge_prices, knowledge_rules
               FROM channel_prompts
               WHERE group_id = $1 AND tenant_id = $2 AND is_active = true AND prompt_type = 'system'
               ORDER BY version DESC LIMIT 1`,
        values: [botGroupId, ctx.tenantId]
      });
      if (promptResult.length === 0) {
        return { success: false, reply: '⚠️ Bu bot grubuna bağlı aktif sistem promptu bulunamadı.', metadata: null };
      }
      const activePrompt = promptResult[0];

      // 4. Fetch AI Profile for this group
      const profileResult = await ctx.db.executeSafe({
        text: `SELECT cap.ai_model, cap.max_response_tokens, cap.business_hours_json, cap.aggression_level, cap.response_delay_seconds, cap.response_style
               FROM channel_ai_profiles cap
               JOIN channel_groups cg ON cap.group_id = cg.id
               WHERE group_id = $1 AND cg.tenant_id = $2 LIMIT 1`,
        values: [botGroupId, ctx.tenantId]
      });
      const profile = profileResult[0] || null;
      const aiModel = profile?.ai_model || 'gemini-2.5-flash';
      const maxTokens = profile?.max_response_tokens || 1000;

      // 5. Build dynamic system prompt using PromptBuilder
      const { PromptBuilder } = await import("@/lib/services/ai/prompt-builder");
      const crypto = require('crypto');
      const rawSystemPrompt = activePrompt.prompt_text || '';
      const promptHash = crypto.createHash('sha256').update(rawSystemPrompt).digest('hex');

      const mockBrain = {
        id: `test-brain-${botGroupId}`,
        prompts: {
          systemPrompt: rawSystemPrompt,
          promptHash,
          metadata: {
            industry: 'healthcare' // Default mock industry context
          }
        },
        context: {
          tenantId: ctx.tenantId,
          channel: 'whatsapp',
          config: {
            industry: 'healthcare',
            timezone: 'Europe/Istanbul'
          },
          knowledge: {
            prices: activePrompt.knowledge_prices || '',
            rules: activePrompt.knowledge_rules || ''
          },
          settings: {
            aiModel,
            maxMessages: 20,
            maxResponseTokens: maxTokens,
            workingHours: profile?.business_hours_json || { enabled: false },
            aggressionLevel: profile?.aggression_level || 'medium',
            responseDelaySeconds: profile?.response_delay_seconds !== null && profile?.response_delay_seconds !== undefined ? profile.response_delay_seconds : 5,
            responseStyle: profile?.response_style || 'balanced'
          }
        }
      };

      const systemPromptContent = PromptBuilder.buildSystemPrompt(mockBrain as any, 'lead', false, {
        history: messages,
        currentMessageText: messages[messages.length - 1]?.content || ''
      });

      // 6. Build Message History for LLM
      const { AIOrchestrator } = await import("@/lib/services/ai/orchestrator");
      const formattedMessages: ChatMessage[] = [
        { role: 'system', content: systemPromptContent },
        ...messages.map(m => ({
          role: m.role as 'user' | 'assistant',
          content: m.content
        }))
      ];

      // 7. Execute simulation in AIOrchestrator
      const orchestrator = new AIOrchestrator();
      const config = {
        provider: 'gemini' as const,
        modelId: aiModel,
        apiKey: GEMINI_API_KEY,
        temperature: 0.7,
        maxTokens: maxTokens
      };

      const startTime = Date.now();
      const response = await orchestrator.generateResponse(
        formattedMessages,
        config,
        ctx.tenantId,
        'sandbox_test_conversation',
        { sandbox: true }
      );

      const latencyMs = Date.now() - startTime;

      return {
        success: true,
        reply: response.text || '⚠️ Model yanıt üretmedi.',
        metadata: {
          model: response.modelUsed || aiModel,
          promptVersion: activePrompt.version,
          botGroupId,
          channelId: channelId || null,
          latencyMs,
          sandboxMode: true,
          toolExecution: 'sandbox',
          responseDelaySeconds: profile?.response_delay_seconds !== null && profile?.response_delay_seconds !== undefined ? profile.response_delay_seconds : 5,
          responseStyle: profile?.response_style || 'balanced',
          maxResponseTokens: maxTokens
        }
      };
    }
  ).then(res => {
    if (!res.success) return { success: false, reply: '❌ Hata: ' + res.error, metadata: null };
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

// ==========================================
// READ: getBotChannelBindings (V2-Native)
// Returns real channel↔prompt mapping for Bot page UI
// ==========================================
export async function getBotChannelBindings() {
  return withActionGuard(
    { actionName: 'getBotChannelBindings' },
    async (ctx) => {
      // Fetch all channel→prompt bindings with channel and prompt details
      const bindings = await ctx.db.executeSafe({
        text: `
          SELECT 
            c.id as channel_id,
            c.provider,
            c.identifier,
            c.name as channel_name,
            cg.name as group_name,
            cp.id as prompt_id,
            cp.name as prompt_name,
            ci.health_status,
            ci.last_sync_at,
            ci.credentials_encrypted IS NOT NULL as has_credentials
          FROM channels c
          JOIN channel_groups cg ON c.group_id = cg.id
          LEFT JOIN channel_integrations ci ON ci.channel_id = c.id
          LEFT JOIN channel_prompt_bindings cpb ON cpb.channel_id = c.id
          LEFT JOIN channel_prompts cp ON cpb.prompt_id = cp.id AND cp.tenant_id = $1
          WHERE cg.tenant_id = $1 AND c.provider != 'meta_legacy'
          ORDER BY c.provider, c.name
        `,
        values: [ctx.tenantId]
      });

      // Map bot channel IDs to their bound V2 channels
      const channelBindings: Record<string, {
        channels: {
          id: string;
          provider: string;
          identifier: string;
          name: string;
          group: string;
          promptName: string | null;
          hasCredentials: boolean;
          healthStatus: string | null;
          warnings: string[];
        }[];
      }> = {
        whatsapp: { channels: [] },
        instagram: { channels: [] },
        foreign: { channels: [] },
      };

      for (const row of bindings) {
        const warnings: string[] = [];
        
        // Determine which bot tab this channel belongs to
        let botTab: string | null = null;
        const provider = row.provider;
        
        if (provider === 'whatsapp') {
          botTab = 'whatsapp';
        } else if (provider === 'meta_instagram' || provider === 'instagram') {
          // Check group name to determine TR vs Foreign
          const groupName = (row.group_name || '').toLowerCase();
          if (groupName.includes('foreign') || groupName.includes('en')) {
            botTab = 'foreign';
          } else {
            botTab = 'instagram';
          }
        } else if (provider === 'messenger') {
          // Messenger goes to instagram tab (TR) by default
          botTab = 'instagram';
        }

        if (!botTab) continue;

        // Warnings
        if (!row.prompt_name) warnings.push('Prompt bağlı değil');
        if (!row.has_credentials) warnings.push('Kimlik bilgisi eksik');
        if (provider === 'messenger' && !/^\d{5,}$/.test(row.identifier || '')) {
          warnings.push('PAGE_ID gerekli');
        }
        if (row.health_status !== 'healthy') {
          warnings.push('Sağlık kontrolü bekliyor');
        }

        channelBindings[botTab].channels.push({
          id: row.channel_id,
          provider: provider,
          identifier: row.identifier,
          name: row.channel_name || provider,
          group: row.group_name,
          promptName: row.prompt_name || null,
          hasCredentials: !!row.has_credentials,
          healthStatus: row.health_status,
          warnings,
        });
      }

      return channelBindings;
    }
  ).then(res => {
    if (!res.success) return { success: false, error: res.error };
    return { success: true, bindings: res.data };
  });
}

// ==========================================
// DYNAMIC BOT MANAGEMENT — V2 SaaS Actions
// channel_groups = Bot Entity
// ==========================================

export interface BotData {
  id: string;
  name: string;
  displayName: string;
  description: string | null;
  botType: string;
  icon: string;
  color: string | null;
  sortOrder: number;
  status: string;
  prompt: {
    id: string;
    name: string;
    text: string;
    version: number;
    knowledgePrices: string;
    knowledgeRules: string;
  } | null;
  profile: {
    aiModel: string;
    maxMessages: number;
    maxResponseTokens: number;
    aggressionLevel: string;
    autoGreeting: boolean;
    greetingLanguage: string;
    followUpEnabled: boolean;
    workingHours: any;
    responseDelaySeconds?: number;
    responseStyle?: string;
  } | null;
  channels: {
    id: string;
    provider: string;
    identifier: string;
    name: string;
    hasCredentials: boolean;
    healthStatus: string | null;
    hasPromptBinding: boolean;
  }[];
}

/**
 * Returns all active bots for the current tenant with their prompts, profiles, and channels.
 */
export async function getBots(): Promise<{ success: boolean; bots?: BotData[]; error?: string }> {
  return withActionGuard(
    { actionName: 'getBots' },
    async (ctx) => {
      // 1. Fetch all active bot groups
      const groups = await ctx.db.executeSafe({
        text: `SELECT id, name, display_name, description, bot_type, icon, color, sort_order, status
               FROM channel_groups 
               WHERE tenant_id = $1 AND status = 'active'
               ORDER BY sort_order ASC, created_at ASC`,
        values: [ctx.tenantId]
      });

      const bots: BotData[] = [];

      for (const g of groups) {
        // 2. Fetch prompt for this group
        const prompts = await ctx.db.executeSafe({
          text: `SELECT id, name, prompt_text, version, knowledge_prices, knowledge_rules
                 FROM channel_prompts 
                 WHERE group_id = $1 AND tenant_id = $2 AND is_active = true AND prompt_type = 'system'
                 ORDER BY version DESC LIMIT 1`,
          values: [g.id, ctx.tenantId]
        });
        const prompt = prompts.length > 0 ? {
          id: prompts[0].id,
          name: prompts[0].name,
          text: prompts[0].prompt_text || '',
          version: prompts[0].version || 1,
          knowledgePrices: prompts[0].knowledge_prices || '',
          knowledgeRules: prompts[0].knowledge_rules || '',
        } : null;

        // 3. Fetch AI profile for this group
        const profiles = await ctx.db.executeSafe({
          text: `SELECT cap.ai_model, cap.max_messages, cap.max_response_tokens, cap.aggression_level,
                        cap.auto_greeting, cap.greeting_language, cap.follow_up_enabled, cap.business_hours_json,
                        cap.response_delay_seconds, cap.response_style
                 FROM channel_ai_profiles cap
                 JOIN channel_groups cg ON cap.group_id = cg.id
                 WHERE cap.group_id = $1 AND cg.tenant_id = $2 LIMIT 1`,
          values: [g.id, ctx.tenantId]
        });
        const profile = profiles.length > 0 ? {
          aiModel: profiles[0].ai_model || 'gemini-2.5-flash',
          maxMessages: profiles[0].max_messages ?? 8,
          maxResponseTokens: profiles[0].max_response_tokens || 1000,
          aggressionLevel: profiles[0].aggression_level || 'medium',
          autoGreeting: profiles[0].auto_greeting !== false,
          greetingLanguage: profiles[0].greeting_language || 'auto',
          followUpEnabled: profiles[0].follow_up_enabled !== false,
          workingHours: profiles[0].business_hours_json || { enabled: false },
          responseDelaySeconds: profiles[0].response_delay_seconds !== null && profiles[0].response_delay_seconds !== undefined ? profiles[0].response_delay_seconds : 5,
          responseStyle: profiles[0].response_style || 'balanced',
        } : null;

        // 4. Fetch channels in this group
        const channels = await ctx.db.executeSafe({
          text: `SELECT c.id, c.provider, c.identifier, c.name,
                        ci.credentials_encrypted IS NOT NULL as has_credentials,
                        ci.health_status,
                        EXISTS(SELECT 1 FROM channel_prompt_bindings cpb WHERE cpb.channel_id = c.id AND cpb.is_active = true) as has_prompt_binding
                 FROM channels c
                 LEFT JOIN channel_integrations ci ON ci.channel_id = c.id
                 JOIN channel_groups cg ON c.group_id = cg.id
                 WHERE c.group_id = $1 AND cg.tenant_id = $2 AND c.provider != 'meta_legacy'
                 ORDER BY c.provider, c.name`,
          values: [g.id, ctx.tenantId]
        });

        bots.push({
          id: g.id,
          name: g.name,
          displayName: g.display_name || g.name,
          description: g.description,
          botType: g.bot_type || 'custom',
          icon: g.icon || 'bot',
          color: g.color || '#6366f1',
          sortOrder: g.sort_order || 0,
          status: g.status,
          prompt,
          profile,
          channels: channels.map((c: any) => ({
            id: c.id,
            provider: c.provider,
            identifier: c.identifier,
            name: c.name || c.provider,
            hasCredentials: !!c.has_credentials,
            healthStatus: c.health_status,
            hasPromptBinding: !!c.has_prompt_binding,
          })),
        });
      }

      return bots;
    }
  ).then(res => {
    if (!res.success) return { success: false, error: res.error };
    return { success: true, bots: res.data as BotData[] };
  });
}

/**
 * Creates a new bot (channel_group + channel_prompt + channel_ai_profile).
 */
export async function createBot(input: {
  displayName: string;
  description?: string;
  botType?: string;
  icon?: string;
  color?: string;
  promptText?: string;
  promptName?: string;
}): Promise<{ success: boolean; botId?: string; error?: string }> {
  return withActionGuard(
    { actionName: 'createBot', roles: ['owner', 'admin'] },
    async (ctx) => {
      const { displayName, description, botType, icon, color, promptText, promptName } = input;

      // 1. Create channel_group (bot entity)
      const groupResult = await ctx.db.executeSafe({
        text: `INSERT INTO channel_groups (tenant_id, name, display_name, description, bot_type, icon, color, sort_order, status)
               VALUES ($1, $2, $3, $4, $5, $6, $7, 
                 COALESCE((SELECT MAX(sort_order) + 1 FROM channel_groups WHERE tenant_id = $1), 1),
                 'active')
               RETURNING id`,
        values: [ctx.tenantId, displayName, displayName, description || null, botType || 'custom', icon || 'bot', color || '#6366f1']
      });

      const groupId = groupResult[0]?.id;
      if (!groupId) throw new Error('Failed to create bot group');

      // 2. Create channel_prompt
      const pName = promptName || `${displayName} Prompt`;
      await ctx.db.executeSafe({
        text: `INSERT INTO channel_prompts (group_id, tenant_id, name, prompt_text, prompt_type, is_active, version)
               VALUES ($1, $2, $3, $4, 'system', true, 1)`,
        values: [groupId, ctx.tenantId, pName, promptText || '']
      });

      // 3. Create channel_ai_profile with defaults (tenant_id validated via group)
      await ctx.db.executeSafe({
        text: `INSERT INTO channel_ai_profiles (group_id, ai_model, max_messages, max_response_tokens, aggression_level, auto_greeting, greeting_language, follow_up_enabled)
               SELECT $1, 'gemini-2.5-flash', 8, 1000, 'medium', true, 'auto', true
               FROM channel_groups WHERE id = $1 AND tenant_id = $2`,
        values: [groupId, ctx.tenantId]
      });

      await logAudit({
        tenantId: ctx.tenantId,
        userId: ctx.userId || 'system',
        action: 'bot.created',
        details: { botId: groupId, displayName }
      });

      return groupId;
    }
  ).then(res => {
    if (!res.success) return { success: false, error: res.error };
    return { success: true, botId: res.data as string };
  });
}

/**
 * Updates a bot's display info, prompt, and/or AI profile.
 */
export async function updateBot(
  botId: string,
  updates: {
    displayName?: string;
    description?: string;
    icon?: string;
    color?: string;
    promptText?: string;
    knowledgePrices?: string;
    knowledgeRules?: string;
    aiModel?: string;
    maxMessages?: number;
    maxResponseTokens?: number;
    aggressionLevel?: string;
    autoGreeting?: boolean;
    greetingLanguage?: string;
    followUpEnabled?: boolean;
    workingHours?: any;
    responseStyle?: string;
    responseDelaySeconds?: number;
  }
): Promise<{ success: boolean; error?: string }> {
  return withActionGuard(
    { actionName: 'updateBot', roles: ['owner', 'admin'] },
    async (ctx) => {
      // Verify ownership
      const ownership = await ctx.db.executeSafe({
        text: `SELECT id FROM channel_groups WHERE id = $1 AND tenant_id = $2 AND status = 'active'`,
        values: [botId, ctx.tenantId]
      });
      if (ownership.length === 0) throw new Error('Bot not found or not authorized');

      // Update group display
      if (updates.displayName || updates.description || updates.icon || updates.color) {
        const setClauses: string[] = [];
        const vals: any[] = [];
        let idx = 1;
        if (updates.displayName) { setClauses.push(`display_name = $${idx}, name = $${idx}`); vals.push(updates.displayName); idx++; }
        if (updates.description !== undefined) { setClauses.push(`description = $${idx}`); vals.push(updates.description); idx++; }
        if (updates.icon) { setClauses.push(`icon = $${idx}`); vals.push(updates.icon); idx++; }
        if (updates.color) { setClauses.push(`color = $${idx}`); vals.push(updates.color); idx++; }
        setClauses.push(`updated_at = NOW()`);
        vals.push(ctx.tenantId);
        vals.push(botId);
        await ctx.db.executeSafe({
          text: `UPDATE channel_groups SET ${setClauses.join(', ')} WHERE id = $${idx + 1} AND tenant_id = $${idx}`,
          values: vals
        });
      }

      // Update prompt
      if (updates.promptText !== undefined || updates.knowledgePrices !== undefined || updates.knowledgeRules !== undefined) {
        const setClauses: string[] = ['updated_at = NOW()'];
        const vals: any[] = [];
        let idx = 1;
        if (updates.promptText !== undefined) { setClauses.push(`prompt_text = $${idx}`); vals.push(updates.promptText); idx++; }
        if (updates.knowledgePrices !== undefined) { setClauses.push(`knowledge_prices = $${idx}`); vals.push(updates.knowledgePrices); idx++; }
        if (updates.knowledgeRules !== undefined) { setClauses.push(`knowledge_rules = $${idx}`); vals.push(updates.knowledgeRules); idx++; }
        setClauses.push(`version = version + 1`);
        vals.push(botId, ctx.tenantId);
        await ctx.db.executeSafe({
          text: `UPDATE channel_prompts SET ${setClauses.join(', ')} WHERE group_id = $${idx} AND tenant_id = $${idx + 1} AND is_active = true AND prompt_type = 'system'`,
          values: vals
        });
      }

      // Update AI profile
      const profileFields: string[] = [];
      const profileVals: any[] = [];
      let pIdx = 1;

      // Handle responseStyle and map to maxResponseTokens
      if (updates.responseStyle !== undefined) {
        const style = updates.responseStyle;
        const validStyle = ['short', 'balanced', 'detailed'].includes(style) ? style : 'balanced';
        profileFields.push(`response_style = $${pIdx}`);
        profileVals.push(validStyle);
        pIdx++;

        const tokenMap: Record<string, number> = {
          short: 500,
          balanced: 1000,
          detailed: 2000
        };
        updates.maxResponseTokens = tokenMap[validStyle];
      }

      if (updates.responseDelaySeconds !== undefined) {
        const clampDelay = Math.max(2, Math.min(30, Number(updates.responseDelaySeconds)));
        profileFields.push(`response_delay_seconds = $${pIdx}`);
        profileVals.push(clampDelay);
        pIdx++;
      }

      if (updates.aiModel) { profileFields.push(`ai_model = $${pIdx}`); profileVals.push(updates.aiModel); pIdx++; }
      if (updates.maxMessages !== undefined) { profileFields.push(`max_messages = $${pIdx}`); profileVals.push(updates.maxMessages); pIdx++; }
      if (updates.maxResponseTokens !== undefined) { profileFields.push(`max_response_tokens = $${pIdx}`); profileVals.push(updates.maxResponseTokens); pIdx++; }
      if (updates.aggressionLevel) { profileFields.push(`aggression_level = $${pIdx}`); profileVals.push(updates.aggressionLevel); pIdx++; }
      if (updates.autoGreeting !== undefined) { profileFields.push(`auto_greeting = $${pIdx}`); profileVals.push(updates.autoGreeting); pIdx++; }
      if (updates.greetingLanguage) { profileFields.push(`greeting_language = $${pIdx}`); profileVals.push(updates.greetingLanguage); pIdx++; }
      if (updates.followUpEnabled !== undefined) { profileFields.push(`follow_up_enabled = $${pIdx}`); profileVals.push(updates.followUpEnabled); pIdx++; }
      if (updates.workingHours !== undefined) { profileFields.push(`business_hours_json = $${pIdx}`); profileVals.push(JSON.stringify(updates.workingHours)); pIdx++; }

      if (profileFields.length > 0) {
        profileFields.push(`updated_at = NOW()`);
        profileVals.push(ctx.tenantId);
        profileVals.push(botId);
        await ctx.db.executeSafe({
          text: `UPDATE channel_ai_profiles SET ${profileFields.join(', ')} WHERE group_id = $${pIdx + 1} AND group_id IN (SELECT id FROM channel_groups WHERE tenant_id = $${pIdx})`,
          values: profileVals
        });
      }

      await logAudit({
        tenantId: ctx.tenantId,
        userId: ctx.userId || 'system',
        action: 'bot.updated',
        details: { botId, fields: Object.keys(updates) }
      });
      return true;
    }
  ).then(res => {
    if (!res.success) return { success: false, error: res.error };
    return { success: true };
  });
}

/**
 * Archives a bot. Channels are NOT deleted — they become unassigned.
 */
export async function archiveBot(botId: string): Promise<{ success: boolean; error?: string }> {
  return withActionGuard(
    { actionName: 'archiveBot', roles: ['owner', 'admin'] },
    async (ctx) => {
      // Verify ownership
      const ownership = await ctx.db.executeSafe({
        text: `SELECT id, display_name FROM channel_groups WHERE id = $1 AND tenant_id = $2 AND status = 'active'`,
        values: [botId, ctx.tenantId]
      });
      if (ownership.length === 0) throw new Error('Bot not found or not authorized');

      // Check if WhatsApp channels are attached — warn
      const waChannels = await ctx.db.executeSafe({
        text: `SELECT c.id FROM channels c JOIN channel_groups cg ON c.group_id = cg.id
               WHERE c.group_id = $1 AND cg.tenant_id = $2 AND c.provider = 'whatsapp'`,
        values: [botId, ctx.tenantId]
      });
      if (waChannels.length > 0) {
        throw new Error('SAFETY: Bu bot aktif WhatsApp kanalları içeriyor. Önce kanalları başka bir bota atayın.');
      }

      // Archive the group
      await ctx.db.executeSafe({
        text: `UPDATE channel_groups SET status = 'archived', updated_at = NOW() WHERE id = $1 AND tenant_id = $2`,
        values: [botId, ctx.tenantId]
      });

      // Deactivate prompt bindings for channels in this group
      await ctx.db.executeSafe({
        text: `UPDATE channel_prompt_bindings SET is_active = false 
               WHERE channel_id IN (SELECT c.id FROM channels c JOIN channel_groups cg ON c.group_id = cg.id WHERE c.group_id = $1 AND cg.tenant_id = $2)`,
        values: [botId, ctx.tenantId]
      });

      await logAudit({
        tenantId: ctx.tenantId,
        userId: ctx.userId || 'system',
        action: 'bot.archived',
        details: { botId, name: ownership[0].display_name }
      });
      return true;
    }
  ).then(res => {
    if (!res.success) return { success: false, error: res.error };
    return { success: true };
  });
}

/**
 * Assigns a channel to a bot. Updates group_id and prompt binding atomically.
 * A channel can only be managed by ONE active bot at a time.
 */
export async function assignChannelToBot(
  channelId: string, 
  targetBotId: string
): Promise<{ success: boolean; error?: string }> {
  return withActionGuard(
    { actionName: 'assignChannelToBot', roles: ['owner', 'admin'] },
    async (ctx) => {
      // 1. Verify target bot ownership
      const targetBot = await ctx.db.executeSafe({
        text: `SELECT id FROM channel_groups WHERE id = $1 AND tenant_id = $2 AND status = 'active'`,
        values: [targetBotId, ctx.tenantId]
      });
      if (targetBot.length === 0) throw new Error('Target bot not found');

      // 2. Verify channel ownership
      const channel = await ctx.db.executeSafe({
        text: `SELECT c.id, c.group_id, c.provider, c.name
               FROM channels c 
               JOIN channel_groups cg ON c.group_id = cg.id
               WHERE c.id = $1 AND cg.tenant_id = $2`,
        values: [channelId, ctx.tenantId]
      });
      if (channel.length === 0) throw new Error('Channel not found or not authorized');

      // 3. Move channel to new group
      await ctx.db.executeSafe({
        text: `UPDATE channels SET group_id = $1, updated_at = NOW() 
               WHERE id = $2 AND group_id IN (SELECT id FROM channel_groups WHERE tenant_id = $3)`,
        values: [targetBotId, channelId, ctx.tenantId]
      });

      // 4. Deactivate old prompt bindings
      await ctx.db.executeSafe({
        text: `UPDATE channel_prompt_bindings SET is_active = false 
               WHERE channel_id = $1 AND channel_id IN (
                 SELECT c.id FROM channels c JOIN channel_groups cg ON c.group_id = cg.id WHERE cg.tenant_id = $2
               )`,
        values: [channelId, ctx.tenantId]
      });

      // 5. Create new binding to target bot's active system prompt
      const targetPrompt = await ctx.db.executeSafe({
        text: `SELECT id FROM channel_prompts 
               WHERE group_id = $1 AND tenant_id = $2 AND is_active = true AND prompt_type = 'system'
               ORDER BY version DESC LIMIT 1`,
        values: [targetBotId, ctx.tenantId]
      });

      if (targetPrompt.length > 0) {
        await ctx.db.executeSafe({
          text: `INSERT INTO channel_prompt_bindings (channel_id, prompt_id, is_active, priority)
                 SELECT $1, $2, true, 100
                 FROM channels c JOIN channel_groups cg ON c.group_id = cg.id
                 WHERE c.id = $1 AND cg.tenant_id = $3
                 ON CONFLICT DO NOTHING`,
          values: [channelId, targetPrompt[0].id, ctx.tenantId]
        });
      }

      await logAudit({
        tenantId: ctx.tenantId,
        userId: ctx.userId || 'system',
        action: 'channel.assigned',
        details: { 
          channelId, 
          channelName: channel[0].name,
          fromBotId: channel[0].group_id, 
          toBotId: targetBotId 
        }
      });

      return true;
    }
  ).then(res => {
    if (!res.success) return { success: false, error: res.error };
    return { success: true };
  });
}

/**
 * Returns all unassigned channels (channels in archived groups)
 */
export async function getUnassignedChannels(): Promise<{ success: boolean; channels?: any[]; error?: string }> {
  return withActionGuard(
    { actionName: 'getUnassignedChannels' },
    async (ctx) => {
      const channels = await ctx.db.executeSafe({
        text: `SELECT c.id, c.provider, c.identifier, c.name, cg.name as group_name, cg.status as group_status
               FROM channels c
               JOIN channel_groups cg ON c.group_id = cg.id
               WHERE cg.tenant_id = $1 AND (cg.status = 'archived' OR cg.status = 'inactive')
               AND c.provider != 'meta_legacy'
               ORDER BY c.provider`,
        values: [ctx.tenantId]
      });
      return channels;
    }
  ).then(res => {
    if (!res.success) return { success: false, error: res.error };
    return { success: true, channels: res.data as any[] };
  });
}
