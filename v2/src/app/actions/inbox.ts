"use server";

import { sql } from "@/lib/db";
import { withActionGuard } from "@/lib/core/action-guard";
import { logAudit } from "@/lib/audit";
import { enqueueRetry } from "@/lib/retry";

// ==========================================
// QUBA AI — Inbox Actions (Zero-Trust Migrated)
// ==========================================

export async function getConversations(page: number = 1, search: string = "", stage: string = "all") {
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
          COALESCE(c.last_message_content, m.content) as last_message,
          c.last_message_at as last_message_time,
          l.form_name,
          l.raw_data as form_raw_data,
          l.created_at as form_date,
          0 as unread
        FROM conversations c
        LEFT JOIN LATERAL (
          SELECT content
          FROM messages 
          WHERE phone_number = c.phone_number AND tenant_id = ${ctx.tenantId}
          ORDER BY created_at DESC 
          LIMIT 1
        ) m ON c.last_message_content IS NULL
        LEFT JOIN LATERAL (
          SELECT form_name, raw_data, created_at 
          FROM leads 
          WHERE tenant_id = ${ctx.tenantId}
            AND phone_number LIKE '%' || RIGHT(COALESCE(c.real_phone, c.phone_number), 10) || '%'
          ORDER BY created_at DESC 
          LIMIT 1
        ) l ON true
        WHERE c.tenant_id = ${ctx.tenantId}
          AND (${searchFilter === null} OR c.patient_name ILIKE ${searchFilter} OR c.phone_number ILIKE ${searchFilter})
          AND (${stageFilter === null} OR c.lead_stage = ${stageFilter})
        ORDER BY c.last_message_at DESC NULLS LAST
        LIMIT ${limit} OFFSET ${offset}
      `);

      const validRows = Array.isArray(rows) ? rows : (rows?.rows || []);

      return validRows.map((r: any) => ({
        ...r,
        score: r.stage === 'appointed' ? 100 : r.stage === 'contacted' ? 60 : 30,
        isBotActive: r.status !== 'human',
        formattedTime: r.last_message_time ? new Date(r.last_message_time).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }) : '',
        channel: r.channel || 'whatsapp',
        country: r.country || (r.form_raw_data && r.form_raw_data.includes('country') ? JSON.parse(r.form_raw_data).country : null) || (r.id.startsWith('90') || r.id.startsWith('+90') ? 'Türkiye' : r.id.startsWith('49') || r.id.startsWith('+49') ? 'Almanya' : null),
        formData: r.form_name ? {
          name: r.form_name,
          date: new Date(r.form_date).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' }),
          raw: r.form_raw_data
        } : null
      }));
    }
  ).then(res => res.data || []);
}

export async function getMessages(phone: string) {
  if (!phone) return [];
  
  return withActionGuard(
    { actionName: 'getMessages' },
    async (ctx) => {
      const rows = await ctx.db.executeSafe(sql`
        SELECT id, content as text, direction, created_at
        FROM messages
        WHERE phone_number = ${phone} AND tenant_id = ${ctx.tenantId}
        ORDER BY created_at ASC
        LIMIT 100
      `);

      const validRows = Array.isArray(rows) ? rows : (rows?.rows || []);

      return validRows.map((r: any) => {
        const date = new Date(r.created_at);
        return {
          id: r.id,
          sender: r.direction === 'in' ? 'user' : 'bot',
          text: r.text,
          time: date.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }),
          dateLabel: date.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long' })
        };
      });
    }
  ).then(res => res.data || []);
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

      if (!META_ACCESS_TOKEN || !PHONE_NUMBER_ID) {
        console.warn("Meta credentials missing, only saving to DB");
      } else {
        const response = await fetch(`https://graph.facebook.com/v25.0/${PHONE_NUMBER_ID}/messages`, {
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

        if (!response.ok) {
          const errData = await response.json();
          console.error("Meta API error:", errData);
          await enqueueRetry({
            tenantId: ctx.tenantId,
            phoneNumber: phone,
            channel: "whatsapp",
            content: text,
            error: JSON.stringify(errData).substring(0, 500),
          });
        }
      }

      await ctx.db.executeSafe(sql`
        INSERT INTO messages (tenant_id, phone_number, direction, content, channel)
        VALUES (${ctx.tenantId}, ${phone}, 'out', ${text}, 'whatsapp')
      `);

      await ctx.db.executeSafe(sql`
        UPDATE conversations 
        SET last_message_at = NOW(), 
            last_message_content = ${text},
            last_message_channel = 'whatsapp',
            message_count = message_count + 1,
            status = 'human'
        WHERE phone_number = ${phone} AND tenant_id = ${ctx.tenantId}
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
            WHERE phone_number = ${phone} AND tenant_id = ${ctx.tenantId}
          `);
        } catch (e) {
          await ctx.db.executeSafe(sql`
            UPDATE conversations
            SET lead_stage = ${stage}, department = ${department}
            WHERE phone_number = ${phone} AND tenant_id = ${ctx.tenantId}
          `);
        }
      } else {
        await ctx.db.executeSafe(sql`
          UPDATE conversations
          SET lead_stage = ${stage}, department = ${department}
          WHERE phone_number = ${phone} AND tenant_id = ${ctx.tenantId}
        `);
      }
      
      try {
        await ctx.db.executeSafe(sql`
          UPDATE leads
          SET stage = ${stage}
          WHERE (phone_number = ${phone} OR phone_number LIKE ${'%' + phone.substring(phone.length - 10) + '%'})
            AND tenant_id = ${ctx.tenantId}
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
        SELECT tags FROM conversations WHERE phone_number = ${phone} AND tenant_id = ${ctx.tenantId}
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
          WHERE phone_number = ${phone} AND tenant_id = ${ctx.tenantId}
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
        SELECT tags FROM conversations WHERE phone_number = ${phone} AND tenant_id = ${ctx.tenantId}
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
        WHERE phone_number = ${phone} AND tenant_id = ${ctx.tenantId}
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
        WHERE phone_number = ${phone} AND tenant_id = ${ctx.tenantId}
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
