"use server";

import { sql } from "@/lib/db";
import { withActionGuard } from "@/lib/core/action-guard";
import { logAudit } from "@/lib/audit";
import { enqueueRetry } from "@/lib/retry";

// ==========================================
// QUBA AI — Inbox Actions (Zero-Trust Migrated)
// ==========================================

export async function getConversations(page: number = 1, search: string = "", stage: string = "all") {
  noStore();
  return withActionGuard(
    { actionName: 'getConversations' },
    async (ctx) => {
      const limit = 50;
      const offset = (page - 1) * limit;
      const searchFilter = search.trim() ? `%${search.trim()}%` : null;
      const stageFilter = stage !== "all" ? stage : null;

      const rows = await ctx.db.executeSafe(sql`
        SELECT 
          c.phone_number as id,
          c.patient_name as name,
          c.department,
          c.country,
          c.status,
          c.phase,
          c.lead_stage as stage,
          c.tags,
          c.channel,
          c.last_message_at,
          EXTRACT(EPOCH FROM c.last_message_at) * 1000 as last_message_time_ms,
          COALESCE(c.last_message_content, m.content) as last_message,
          COALESCE(c.last_message_status, m.status) as last_message_status,
          COALESCE(c.last_message_direction, m.direction) as last_message_direction,
          l.form_name,
          l.raw_data as form_raw_data,
          EXTRACT(EPOCH FROM l.created_at) * 1000 as form_date_ms,
          mem.summary_text as ai_summary,
          mem.buying_intent as ai_buying_intent,
          mem.sentiment as ai_sentiment,
          0 as unread
        FROM conversations c
        LEFT JOIN LATERAL (
          SELECT content, status, direction
          FROM messages 
          WHERE phone_number = c.phone_number AND (messages.tenant_id = ${ctx.tenantId} OR messages.tenant_id IS NULL)
          ORDER BY created_at DESC 
          LIMIT 1
        ) m ON c.last_message_content IS NULL
        LEFT JOIN LATERAL (
          SELECT form_name, raw_data, created_at 
          FROM leads 
          WHERE (leads.tenant_id = ${ctx.tenantId} OR leads.tenant_id IS NULL)
            AND leads.phone_number LIKE '%' || RIGHT(COALESCE(c.real_phone, c.phone_number), 10) || '%'
          ORDER BY created_at DESC 
          LIMIT 1
        ) l ON true
        LEFT JOIN conversation_memory mem ON c.id = mem.conversation_id
        WHERE (c.tenant_id = ${ctx.tenantId} OR c.tenant_id IS NULL)
          AND (${searchFilter === null} OR c.patient_name ILIKE ${searchFilter} OR c.phone_number ILIKE ${searchFilter})
          AND (${stageFilter === null} OR c.lead_stage = ${stageFilter})
        ORDER BY c.last_message_at DESC NULLS LAST
        LIMIT ${limit} OFFSET ${offset}
      `);

      const validRows = Array.isArray(rows) ? rows : ((rows as any)?.rows || []);

      return validRows.map((r: any) => {
        let formattedTime = '';
        if (r.last_message_time_ms) {
          const date = new Date(parseFloat(r.last_message_time_ms));
          const fmtDate = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit' });
          const now = new Date();
          const msgDateStr = fmtDate(date);
          const nowDateStr = fmtDate(now);
          const diffMs = new Date(nowDateStr + "T00:00:00Z").getTime() - new Date(msgDateStr + "T00:00:00Z").getTime();
          const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
          
          if (diffDays === 0) {
            formattedTime = date.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Istanbul' });
          } else if (diffDays === 1) {
            formattedTime = 'Dün';
          } else if (diffDays > 1 && diffDays < 7) {
            formattedTime = date.toLocaleDateString('tr-TR', { weekday: 'long', timeZone: 'Europe/Istanbul' });
            formattedTime = formattedTime.charAt(0).toUpperCase() + formattedTime.slice(1);
          } else {
            formattedTime = date.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Istanbul' });
          }
        }

        return {
          ...r,
          score: r.stage === 'appointed' ? 100 : r.stage === 'contacted' ? 60 : 30,
          isBotActive: r.status !== 'human',
          formattedTime,
          channel: r.channel || 'whatsapp',
          lastMessageStatus: r.last_message_status || 'sent',
          lastMessageDirection: r.last_message_direction || 'in',
          country: r.country || (r.form_raw_data && r.form_raw_data.includes('country') ? JSON.parse(r.form_raw_data).country : null) || (r.id.startsWith('90') || r.id.startsWith('+90') ? 'Türkiye' : r.id.startsWith('49') || r.id.startsWith('+49') ? 'Almanya' : null),
          formData: r.form_name ? {
            name: r.form_name,
            date: r.form_date_ms ? new Date(parseFloat(r.form_date_ms)).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' }) : '',
            raw: r.form_raw_data
          } : null,
          aiSummary: r.ai_summary ? {
            text: r.ai_summary,
            buying_intent: r.ai_buying_intent,
            sentiment: r.ai_sentiment
          } : null
        };
      });
    }
  ).then(res => res.data || []);
}

import { unstable_noStore as noStore } from "next/cache";

export async function getMessages(phone: string) {
  noStore();
  if (!phone) return [];
  
  return withActionGuard(
    { actionName: 'getMessages' },
    async (ctx) => {
      try {
        const cleanPhone = phone.replace(/\D/g, '').slice(-10);
        // Create the string pattern with % wildcards
        const phoneLike = `%${cleanPhone}%`;

        const rows = await ctx.db.executeSafe(sql`
          SELECT * FROM (
            SELECT id, content as text, direction, status, EXTRACT(EPOCH FROM created_at) * 1000 as created_at_ms
            FROM messages
            WHERE phone_number LIKE ${phoneLike} 
              AND (tenant_id = ${ctx.tenantId} OR tenant_id IS NULL)
            ORDER BY created_at DESC
            LIMIT 100
          ) sub
          ORDER BY created_at_ms ASC
        `);

      const validRows = Array.isArray(rows) ? rows : ((rows as any)?.rows || []);

      return validRows.map((r: any) => {
        const date = new Date(parseFloat(r.created_at_ms));
        
        const fmtDate = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit' });
        
        const now = new Date();
        const msgDateStr = fmtDate(date);
        const nowDateStr = fmtDate(now);
        
        const parseDateString = (ds: string) => new Date(ds + "T00:00:00Z");
        
        const diffMs = parseDateString(nowDateStr).getTime() - parseDateString(msgDateStr).getTime();
        const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
        
        let dateLabel = '';
        if (diffDays === 0) {
          dateLabel = 'Bugün';
        } else if (diffDays === 1) {
          dateLabel = 'Dün';
        } else if (diffDays > 1 && diffDays < 7) {
          dateLabel = date.toLocaleDateString('tr-TR', { weekday: 'long', timeZone: 'Europe/Istanbul' });
          dateLabel = dateLabel.charAt(0).toUpperCase() + dateLabel.slice(1);
        } else {
          dateLabel = date.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Istanbul' });
        }

        return {
          id: r.id,
          sender: r.direction === 'in' ? 'user' : (r.direction === 'system' ? 'system' : 'agent'),
          text: r.text,
          timeMs: parseFloat(r.created_at_ms),
          dateLabel,
          status: r.status || 'sent'
        };
      });
      } catch(err: any) {
        console.error("getMessages Error:", err, "Phone:", phone, "Tenant:", ctx.tenantId);
        return [];
      }
    }
  ).then(res => {
    console.log("getMessages Action Result for phone:", phone, "Success:", res.success, "Data Length:", res.data?.length);
    return res.data || [];
  });
}

export async function sendMessage(phone: string, text: string) {
  if (!phone || !text) return { success: false, error: "Missing data" };

  return withActionGuard(
    { actionName: 'sendMessage' },
    async (ctx) => {
      let META_ACCESS_TOKEN: string | null = null;
      let PHONE_NUMBER_ID: string | null = null;
      
      const tenantRows = await ctx.db.executeSafe(sql`
        SELECT meta_page_token, whatsapp_phone_id 
        FROM tenants WHERE id = ${ctx.tenantId}
      `);
      
      if (tenantRows.length > 0) {
        META_ACCESS_TOKEN = tenantRows[0].meta_page_token || process.env.META_ACCESS_TOKEN || null;
        PHONE_NUMBER_ID = tenantRows[0].whatsapp_phone_id || process.env.PHONE_NUMBER_ID || null;
      }

      // Hangi kanaldan geldiğini bul
      const convRows = await ctx.db.executeSafe(sql`
        SELECT channel FROM conversations 
        WHERE phone_number = ${phone} AND (tenant_id = ${ctx.tenantId} OR tenant_id IS NULL)
        LIMIT 1
      `);
      const channel = convRows[0]?.channel || 'whatsapp';

      let response: Response | null = null;
      let providerMessageId: string | null = null;
      let messageStatus = 'pending';

      if (!META_ACCESS_TOKEN) {
        const { logger: inboxLogger } = await import("@/lib/core/logger");
        inboxLogger.withContext({ module: 'Inbox' }).warn("Meta credentials missing, only saving to DB");
      } else {
        if (channel === 'whatsapp' && PHONE_NUMBER_ID) {
          response = await fetch(`https://graph.facebook.com/v25.0/${PHONE_NUMBER_ID}/messages`, {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${META_ACCESS_TOKEN}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              messaging_product: "whatsapp",
              to: phone,
              type: "text",
              text: { body: text },
            }),
          });

          if (response.ok) {
            try {
              const resData = await response.json();
              providerMessageId = resData.messages?.[0]?.id || resData.message_id || null;
              messageStatus = 'sent';
            } catch (e) {
              console.error("Error parsing Meta API response:", e);
              messageStatus = 'sent';
            }
          }
        }
        else if (channel === 'instagram' || channel === 'messenger') {
          const customToken = tenantRows[0].meta_page_token;
          // Legacy sistem gibi tüm tokenları sırayla dene (IGSID sadece kendi sayfasında geçerli olduğu için)
          const fallbackTokens = [process.env.IG_TOKEN_1, process.env.IG_TOKEN_2, process.env.FB_PAGE_TOKEN, META_ACCESS_TOKEN].filter(Boolean);
          const tokensToTry = customToken ? [customToken] : fallbackTokens;
          
          let success = false;
          const baseUrl = channel === 'instagram' 
            ? 'https://graph.instagram.com/v25.0/me/messages'
            : 'https://graph.facebook.com/v25.0/me/messages';

          for (const token of tokensToTry) {
            if (!token) continue;
            response = await fetch(`${baseUrl}?access_token=${token}`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                recipient: { id: phone },
                message: { text: text },
                messaging_type: "MESSAGE_TAG",
                tag: "HUMAN_AGENT"
              }),
            });

            if (response.ok) {
              success = true;
              try {
                const resData = await response.json();
                providerMessageId = resData.messages?.[0]?.id || resData.message_id || null;
                messageStatus = 'sent';
              } catch (e) {
                console.error("Error parsing Meta API response:", e);
                messageStatus = 'sent'; // Even if parse fails, it was successful
              }
              break; // Doğru token'ı bulduk ve gönderdik
            } else {
              const errData = await response.clone().json();
              const { logger: inboxLog2 } = await import("@/lib/core/logger");
              inboxLog2.withContext({ module: 'Inbox' }).info(`Token failed for ${channel}, trying next`, { error: errData.error?.message });
            }
          }
        }

        if (response && !response.ok) {
          const errData = await response.json();
          const { logger: inboxLog3 } = await import("@/lib/core/logger");
          inboxLog3.withContext({ module: 'Inbox' }).error(`Meta API error (${channel})`, undefined, { errData });
          await enqueueRetry({
            tenantId: ctx.tenantId,
            phoneNumber: phone,
            channel: channel,
            content: text,
            error: JSON.stringify(errData).substring(0, 500),
          });
        }
      }

      await ctx.db.executeSafe(sql`
        INSERT INTO messages (tenant_id, phone_number, direction, content, channel, status, provider_message_id)
        VALUES (${ctx.tenantId}, ${phone}, 'out', ${text}, ${channel}, ${messageStatus}, ${providerMessageId})
      `);

      await ctx.db.executeSafe(sql`
        UPDATE conversations 
        SET last_message_at = NOW(), 
            last_message_content = ${text},
            last_message_channel = 'whatsapp',
            last_message_status = ${messageStatus},
            last_message_direction = 'out',
            message_count = message_count + 1,
            status = 'human'
        WHERE phone_number = ${phone} AND (tenant_id = ${ctx.tenantId} OR tenant_id IS NULL)
      `);

      return { success: true };
    }
  ).then(res => {
    if (!res.success) return { success: false, error: res.error };
    return { success: true };
  });
}

export async function updateCrmData(phone: string, stage: string, department: string, country?: string) {
  if (!phone) return { success: false };

  return withActionGuard(
    { actionName: 'updateCrmData' },
    async (ctx) => {
      if (country !== undefined) {
        try {
          await ctx.db.executeSafe(sql`
            UPDATE conversations
            SET lead_stage = ${stage}, department = ${department}, country = ${country}
            WHERE phone_number = ${phone} AND (tenant_id = ${ctx.tenantId} OR tenant_id IS NULL)
          `);
        } catch (e) {
          await ctx.db.executeSafe(sql`
            UPDATE conversations
            SET lead_stage = ${stage}, department = ${department}
            WHERE phone_number = ${phone} AND (tenant_id = ${ctx.tenantId} OR tenant_id IS NULL)
          `);
        }
      } else {
        await ctx.db.executeSafe(sql`
          UPDATE conversations
          SET lead_stage = ${stage}, department = ${department}
          WHERE phone_number = ${phone} AND (tenant_id = ${ctx.tenantId} OR tenant_id IS NULL)
        `);
      }
      
      try {
        await ctx.db.executeSafe(sql`
          UPDATE leads
          SET stage = ${stage}
          WHERE (phone_number = ${phone} OR phone_number LIKE ${'%' + phone.substring(phone.length - 10) + '%'})
            AND (tenant_id = ${ctx.tenantId} OR tenant_id IS NULL)
        `);
      } catch (e) {
        // Ignore if leads table structure differs
      }
      
      logAudit({
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        userEmail: ctx.email,
        action: "crm_updated",
        entityType: "conversation",
        entityId: phone,
        details: { stage, department }
      });

      return { success: true };
    }
  ).then(res => res.success ? { success: true } : { success: false });
}

export async function addTag(phone: string, tag: string) {
  if (!phone || !tag) return { success: false };
  
  return withActionGuard(
    { actionName: 'addTag' },
    async (ctx) => {
      const rows = await ctx.db.executeSafe(sql`
        SELECT tags FROM conversations WHERE phone_number = ${phone} AND (tenant_id = ${ctx.tenantId} OR tenant_id IS NULL)
      `);
      let tags: string[] = [];
      if (rows.length > 0 && rows[0].tags) {
        try {
          tags = JSON.parse(rows[0].tags);
          if (!Array.isArray(tags)) tags = [String(rows[0].tags)];
        } catch {
          tags = String(rows[0].tags).split(',').map(t => t.trim());
        }
      }
      
      if (!tags.includes(tag)) {
        tags.push(tag);
        await ctx.db.executeSafe(sql`
          UPDATE conversations 
          SET tags = ${JSON.stringify(tags)}
          WHERE phone_number = ${phone} AND (tenant_id = ${ctx.tenantId} OR tenant_id IS NULL)
        `);
      }
      return { success: true, tags };
    }
  ).then(res => res.data || { success: false });
}

export async function removeTag(phone: string, tagToRemove: string) {
  if (!phone || !tagToRemove) return { success: false };
  
  return withActionGuard(
    { actionName: 'removeTag' },
    async (ctx) => {
      const rows = await ctx.db.executeSafe(sql`
        SELECT tags FROM conversations WHERE phone_number = ${phone} AND (tenant_id = ${ctx.tenantId} OR tenant_id IS NULL)
      `);
      let tags: string[] = [];
      if (rows.length > 0 && rows[0].tags) {
        try {
          tags = JSON.parse(rows[0].tags);
          if (!Array.isArray(tags)) tags = [String(rows[0].tags)];
        } catch {
          tags = String(rows[0].tags).split(',').map(t => t.trim());
        }
      }
      
      const newTags = tags.filter(t => t !== tagToRemove);
      await ctx.db.executeSafe(sql`
        UPDATE conversations 
        SET tags = ${JSON.stringify(newTags)}
        WHERE phone_number = ${phone} AND (tenant_id = ${ctx.tenantId} OR tenant_id IS NULL)
      `);
      
      return { success: true, tags: newTags };
    }
  ).then(res => res.data || { success: false });
}

export async function toggleBotStatus(phone: string, isBotActive: boolean) {
  if (!phone) return { success: false };
  
  return withActionGuard(
    { actionName: 'toggleBotStatus' },
    async (ctx) => {
      const newStatus = isBotActive ? 'bot' : 'human';
      await ctx.db.executeSafe(sql`
        UPDATE conversations
        SET status = ${newStatus}
        WHERE phone_number = ${phone} AND (tenant_id = ${ctx.tenantId} OR tenant_id IS NULL)
      `);

      logAudit({
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        userEmail: ctx.email,
        action: isBotActive ? "bot_activated" : "human_handover",
        entityType: "conversation",
        entityId: phone,
      });

      return { success: true };
    }
  ).then(res => res.success ? { success: true } : { success: false });
}
