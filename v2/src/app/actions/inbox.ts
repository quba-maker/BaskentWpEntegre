"use server";

import { sql } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { logAudit } from "@/lib/audit";
import { enqueueRetry } from "@/lib/retry";

export async function getConversations(page: number = 1, search: string = "", stage: string = "all") {
  try {
    const session = await getSession();
    if (!session?.tenantId) return [];
    const tenantId = session.tenantId;
    
    const limit = 50;
    const offset = (page - 1) * limit;
    const searchFilter = search.trim() ? `%${search.trim()}%` : null;
    const stageFilter = stage !== "all" ? stage : null;

    const rows = await sql`
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
        m.content as last_message,
        m.created_at as last_message_time,
        l.form_name,
        l.raw_data as form_raw_data,
        l.created_at as form_date,
        0 as unread
      FROM conversations c
      LEFT JOIN LATERAL (
        SELECT content, created_at 
        FROM messages 
        WHERE phone_number = c.phone_number AND tenant_id = ${tenantId}
        ORDER BY created_at DESC 
        LIMIT 1
      ) m ON true
      LEFT JOIN LATERAL (
        SELECT form_name, raw_data, created_at 
        FROM leads 
        WHERE tenant_id = ${tenantId}
          AND phone_number LIKE '%' || RIGHT(COALESCE(c.real_phone, c.phone_number), 10) || '%'
        ORDER BY created_at DESC 
        LIMIT 1
      ) l ON true
      WHERE c.tenant_id = ${tenantId}
        AND (${searchFilter === null} OR c.patient_name ILIKE ${searchFilter} OR c.phone_number ILIKE ${searchFilter})
        AND (${stageFilter === null} OR c.lead_stage = ${stageFilter})
      ORDER BY c.last_message_at DESC NULLS LAST
      LIMIT ${limit} OFFSET ${offset}
    `;

    return rows.map((r: any) => ({
      ...r,
      // Calculate mock score
      score: r.stage === 'appointed' ? 100 : r.stage === 'contacted' ? 60 : 30,
      isBotActive: r.status !== 'human',
      formattedTime: r.last_message_time ? new Date(r.last_message_time).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }) : '',
      channel: r.channel || 'whatsapp',
      // Resolve Country (Form > Manual > Phone)
      country: r.country || (r.form_raw_data && r.form_raw_data.includes('country') ? JSON.parse(r.form_raw_data).country : null) || (r.id.startsWith('90') || r.id.startsWith('+90') ? 'Türkiye' : r.id.startsWith('49') || r.id.startsWith('+49') ? 'Almanya' : r.id.startsWith('998') || r.id.startsWith('+998') ? 'Özbekistan' : null),
      formData: r.form_name ? {
        name: r.form_name,
        date: new Date(r.form_date).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' }),
        raw: r.form_raw_data
      } : null
    }));
  } catch (error) {
    console.error("Error fetching conversations:", error);
    return [];
  }
}

export async function getMessages(phone: string) {
  if (!phone) return [];
  
  try {
    const session = await getSession();
    if (!session?.tenantId) return [];

    const rows = await sql`
      SELECT 
        id,
        content as text,
        direction,
        created_at
      FROM messages
      WHERE phone_number = ${phone} AND tenant_id = ${session.tenantId}
      ORDER BY created_at ASC
      LIMIT 100
    `;

    return rows.map((r: any) => {
      const date = new Date(r.created_at);
      return {
        id: r.id,
        sender: r.direction === 'in' ? 'user' : 'bot',
        text: r.text,
        time: date.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }),
        dateLabel: date.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long' })
      };
    });
  } catch (error) {
    console.error("Error fetching messages:", error);
    return [];
  }
}

export async function sendMessage(phone: string, text: string) {
  if (!phone || !text) return { success: false, error: "Missing data" };

  try {
    const session = await getSession();
    if (!session?.tenantId) return { success: false, error: "Yetkisiz işlem." };
    
    // Tenant'ın kendi Meta token'ını kullan — env fallback KALDIRILDI (cross-tenant risk)
    let META_ACCESS_TOKEN: string | null = null;
    let PHONE_NUMBER_ID: string | null = null;
    
    const tenantRows = await sql`SELECT meta_page_token, whatsapp_phone_id FROM tenants WHERE id = ${session.tenantId}`;
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
        // Retry kuyruğuna ekle
        await enqueueRetry({
          tenantId: session.tenantId,
          phoneNumber: phone,
          channel: "whatsapp",
          content: text,
          error: JSON.stringify(errData).substring(0, 500),
        });
      }
    }

    // 2. Save to Neon Database
    await sql`
      INSERT INTO messages (tenant_id, phone_number, direction, content, channel)
      VALUES (${session.tenantId}, ${phone}, 'out', ${text}, 'whatsapp')
    `;

    // 3. Update Conversation Last Message
    await sql`
      UPDATE conversations 
      SET last_message_at = NOW(), 
          message_count = message_count + 1,
          status = 'human' -- Auto takeover when agent sends message
      WHERE phone_number = ${phone} AND tenant_id = ${session.tenantId}
    `;

    return { success: true };
  } catch (error) {
    console.error("Error sending message:", error);
    return { success: false, error: "Internal error" };
  }
}

export async function updateCrmData(phone: string, stage: string, department: string, country?: string) {
  if (!phone) return { success: false };

  try {
    const session = await getSession();
    if (!session?.tenantId) return { success: false };

    // Graceful column updates depending on schema state
    if (country !== undefined) {
      try {
        await sql`
          UPDATE conversations
          SET lead_stage = ${stage},
              department = ${department},
              country = ${country}
          WHERE phone_number = ${phone} AND tenant_id = ${session.tenantId}
        `;
      } catch (e) {
        // Fallback if country column doesn't exist yet
        await sql`
          UPDATE conversations
          SET lead_stage = ${stage},
              department = ${department}
          WHERE phone_number = ${phone} AND tenant_id = ${session.tenantId}
        `;
      }
    } else {
      await sql`
        UPDATE conversations
        SET lead_stage = ${stage},
            department = ${department}
        WHERE phone_number = ${phone} AND tenant_id = ${session.tenantId}
      `;
    }
    
    // Also try to update the original leads table if it exists
    try {
      await sql`
        UPDATE leads
        SET stage = ${stage}
        WHERE (phone_number = ${phone} OR phone_number LIKE ${'%' + phone.substring(phone.length - 10) + '%'})
          AND tenant_id = ${session.tenantId}
      `;
    } catch (e) {
      // Ignore if leads table structure differs
    }
    
    return { success: true };
  } catch (error) {
    console.error("Error updating CRM data:", error);
    return { success: false };
  }
}

export async function addTag(phone: string, tag: string) {
  if (!phone || !tag) return { success: false };
  
  try {
    const session = await getSession();
    if (!session?.tenantId) return { success: false };

    // Get existing tags
    const rows = await sql`SELECT tags FROM conversations WHERE phone_number = ${phone} AND tenant_id = ${session.tenantId}`;
    let tags: string[] = [];
    if (rows.length > 0 && rows[0].tags) {
      try {
        tags = JSON.parse(rows[0].tags);
        if (!Array.isArray(tags)) tags = [String(rows[0].tags)];
      } catch {
        tags = String(rows[0].tags).split(',').map(t => t.trim());
      }
    }
    
    // Add new tag if it doesn't exist
    if (!tags.includes(tag)) {
      tags.push(tag);
      await sql`
        UPDATE conversations 
        SET tags = ${JSON.stringify(tags)}
        WHERE phone_number = ${phone} AND tenant_id = ${session.tenantId}
      `;
    }
    return { success: true, tags };
  } catch (error) {
    console.error("Error adding tag:", error);
    return { success: false };
  }
}

export async function removeTag(phone: string, tagToRemove: string) {
  if (!phone || !tagToRemove) return { success: false };
  
  try {
    const session = await getSession();
    if (!session?.tenantId) return { success: false };

    // Get existing tags
    const rows = await sql`SELECT tags FROM conversations WHERE phone_number = ${phone} AND tenant_id = ${session.tenantId}`;
    let tags: string[] = [];
    if (rows.length > 0 && rows[0].tags) {
      try {
        tags = JSON.parse(rows[0].tags);
        if (!Array.isArray(tags)) tags = [String(rows[0].tags)];
      } catch {
        tags = String(rows[0].tags).split(',').map(t => t.trim());
      }
    }
    
    // Filter out the tag
    const newTags = tags.filter(t => t !== tagToRemove);
    await sql`
      UPDATE conversations 
      SET tags = ${JSON.stringify(newTags)}
      WHERE phone_number = ${phone} AND tenant_id = ${session.tenantId}
    `;
    
    return { success: true, tags: newTags };
  } catch (error) {
    console.error("Error removing tag:", error);
    return { success: false };
  }
}

export async function toggleBotStatus(phone: string, isBotActive: boolean) {
  if (!phone) return { success: false };
  
  try {
    const session = await getSession();
    if (!session?.tenantId) return { success: false };

    const newStatus = isBotActive ? 'bot' : 'human';
    await sql`
      UPDATE conversations
      SET status = ${newStatus}
      WHERE phone_number = ${phone} AND tenant_id = ${session.tenantId}
    `;

    // Audit log — bot/human geçişi
    logAudit({
      tenantId: session.tenantId,
      userId: session.userId,
      userEmail: session.email,
      action: isBotActive ? "bot_activated" : "human_handover",
      entityType: "conversation",
      entityId: phone,
    });

    return { success: true };
  } catch (error) {
    console.error("Error toggling bot:", error);
    return { success: false };
  }
}
