import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { withTenantDB } from "@/lib/core/tenant-db";
import { QueueService } from "@/lib/queue/queue.service";
import { logger } from "@/lib/core/logger";

const log = logger.withContext({ module: 'ThreeSixtyDialogWebhook' });

export const maxDuration = 60;

// GET — Light validation
export async function GET(req: NextRequest) {
  const secretParam = req.nextUrl.searchParams.get("secret") || "";
  const expectedSecret = process.env.THREE_SIXTY_DIALOG_WEBHOOK_SECRET || "";

  if (expectedSecret && secretParam === expectedSecret) {
    return new NextResponse("360DIALOG_WEBHOOK_OK", { status: 200 });
  }

  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

// POST — Webhook event ingestion & normalization
export async function POST(req: NextRequest) {
  const startTime = Date.now();
  const traceId = crypto.randomUUID();

  // 1. Webhook Secret Validation (Header-first, Query fallback)
  const headerSecret = req.headers.get("x-360dialog-secret");
  const querySecret = req.nextUrl.searchParams.get("secret");
  const expectedSecret = process.env.THREE_SIXTY_DIALOG_WEBHOOK_SECRET;

  if (expectedSecret) {
    const isHeaderMatch = headerSecret && headerSecret.trim() === expectedSecret.trim();
    const isQueryMatch = querySecret && querySecret.trim() === expectedSecret.trim();

    if (!isHeaderMatch && !isQueryMatch) {
      log.warn("[SECURITY_DENIED] Webhook secret mismatch or missing. Access denied.");
      return new NextResponse("FORBIDDEN", { status: 403 });
    }
  }

  // 2. Parse Raw Payload
  let rawBody = "";
  let body: any = null;

  try {
    rawBody = await req.clone().text().catch(() => "");
    if (!rawBody) {
      return new NextResponse("BAD_REQUEST", { status: 400 });
    }
    body = JSON.parse(rawBody);
  } catch (e: any) {
    log.error("Malformed JSON payload in 360dialog webhook", e);
    return new NextResponse("BAD_REQUEST", { status: 400 });
  }

  // 3. Resolve Channel DB Ownership (Strict isolation)
  // Retrieve channelId from query parameters
  const channelId = req.nextUrl.searchParams.get("channel_id");
  if (!channelId) {
    log.warn("[ROUTING_FAILED] Webhook missing channel_id query parameter.");
    return new NextResponse("EVENT_RECEIVED_UNROUTABLE", { status: 200 });
  }

  try {
    const systemDb = withTenantDB('admin-system', true);
    
    // RLS-aware ownership query
    const channelResults = await systemDb.executeSafe({
      text: `
        SELECT 
          c.id as channel_id,
          c.provider,
          c.identifier,
          cg.id as group_id,
          t.id as tenant_id,
          t.slug as tenant_slug,
          t.name as tenant_name,
          t.status as tenant_status
        FROM channels c
        JOIN channel_groups cg ON c.group_id = cg.id
        JOIN tenants t ON cg.tenant_id = t.id
        WHERE c.id = $1 AND t.status = 'active' AND c.status = 'active'
        LIMIT 1
      `,
      values: [channelId]
    }) as any[];

    if (channelResults.length === 0) {
      log.warn("[ROUTING_FAILED] Active channel or tenant not found for channelId.", { channelId });
      return new NextResponse("EVENT_RECEIVED_UNROUTABLE", { status: 200 });
    }

    const channelRow = channelResults[0];
    const tenantId = channelRow.tenant_id;
    const tenantSlug = channelRow.tenant_slug;

    // 4. Provider raw payload logging (to channel_events with zero-secret exposure)
    const tenantDb = withTenantDB(tenantId);
    const adminDb = withTenantDB(tenantId, true); // Admin bypass needed because channel_events table lacks direct tenant_id column
    await adminDb.executeSafe({
      text: `
        INSERT INTO channel_events (channel_id, event_type, payload, correlation_id)
        VALUES ($1, '360dialog_webhook_received', $2::jsonb, $3)
      `,
      values: [channelRow.channel_id, JSON.stringify(body), traceId]
    });

    const { WebhookDedupeService } = await import("@/lib/services/webhook-dedupe.service");
    const dedupeService = new WebhookDedupeService(tenantDb);
    const queue = new QueueService();

    // 5. Inbound Message Processing
    if (body.messages?.[0]) {
      const msg = body.messages[0];
      const senderPhone = body.contacts?.[0]?.wa_id || msg.from;

      log.info(`[360DIALOG] [INBOUND] Processing message: ${msg.id} from ${senderPhone}`, {
        tenantSlug,
        traceId
      });

      // Idempotency check with locking
      const { isDuplicate } = await dedupeService.checkAndLock({
        provider: 'whatsapp',
        providerMessageId: msg.id,
        senderId: senderPhone,
        timestamp: msg.timestamp ? parseInt(msg.timestamp) : Date.now()
      });

      if (isDuplicate) {
        log.warn(`[360DIALOG] [DUPLICATE] Suppressing duplicate message: ${msg.id}`);
        return new NextResponse("EVENT_RECEIVED_DUPLICATE", { status: 200 });
      }

      // Map 360dialog flat incoming payload to core-compatible nested MetaWebhookPayload structure
      const normalizedPayload = {
        object: "whatsapp_business_account",
        entry: [
          {
            id: body.contacts?.[0]?.profile?.name || "360dialog_coexistence", // WABA identifier
            changes: [
              {
                field: "messages",
                value: {
                  messaging_product: "whatsapp",
                  metadata: {
                    display_phone_number: channelRow.identifier,
                    phone_number_id: channelRow.identifier // Channel Phone Number ID
                  },
                  contacts: body.contacts || [
                    {
                      profile: { name: body.contacts?.[0]?.profile?.name || "Customer" },
                      wa_id: msg.from
                    }
                  ],
                  messages: [
                    {
                      from: msg.from,
                      id: msg.id,
                      timestamp: msg.timestamp,
                      type: msg.type,
                      text: msg.text ? { body: msg.text.body } : undefined,
                      image: msg.image ? { id: msg.image.id, caption: msg.image.caption, mime_type: msg.image.mime_type } : undefined,
                      document: msg.document ? { id: msg.document.id, filename: msg.document.filename, mime_type: msg.document.mime_type } : undefined,
                      audio: msg.audio ? { id: msg.audio.id, mime_type: msg.audio.mime_type } : undefined,
                      video: msg.video ? { id: msg.video.id, caption: msg.video.caption, mime_type: msg.video.mime_type } : undefined,
                      location: msg.location ? { latitude: msg.location.latitude, longitude: msg.location.longitude, name: msg.location.name } : undefined,
                      sticker: msg.sticker ? { id: msg.sticker.id, mime_type: msg.sticker.mime_type } : undefined,
                      button: msg.button ? { text: msg.button.text, payload: msg.button.payload } : undefined,
                      interactive: msg.interactive ? { button_reply: msg.interactive.button_reply, list_reply: msg.interactive.list_reply } : undefined
                    }
                  ]
                }
              }
            ]
          }
        ]
      };

      // Publish to the queue
      waitUntil(queue.publish(tenantId, 'whatsapp.message.received', normalizedPayload, {
        channelId: channelRow.channel_id,
        groupId: channelRow.group_id
      }));

      return new NextResponse("EVENT_RECEIVED", { status: 200 });
    }

    // 6. Inbound Status (Receipts) Processing
    if (body.statuses?.[0]) {
      const statusObj = body.statuses[0];
      const statusId = statusObj.id;

      log.info(`[360DIALOG] [STATUS] Ingesting status receipt: ${statusObj.status} for msg_id: ${statusId}`, {
        tenantSlug,
        traceId
      });

      // Idempotency check with locking
      const { isDuplicate } = await dedupeService.checkAndLock({
        provider: 'whatsapp',
        providerMessageId: `${statusId}_${statusObj.status}`,
        senderId: statusObj.recipient_id,
        timestamp: statusObj.timestamp ? parseInt(statusObj.timestamp) : Date.now()
      });

      if (isDuplicate) {
        log.warn(`[360DIALOG] [DUPLICATE] Suppressing duplicate status: ${statusObj.status} for msg_id: ${statusId}`);
        return new NextResponse("EVENT_RECEIVED_DUPLICATE", { status: 200 });
      }

      // Map 360dialog flat status payload to nested MetaWebhookPayload structure
      const normalizedPayload = {
        object: "whatsapp_business_account",
        entry: [
          {
            id: "360dialog_coexistence",
            changes: [
              {
                field: "messages",
                value: {
                  messaging_product: "whatsapp",
                  metadata: {
                    display_phone_number: channelRow.identifier,
                    phone_number_id: channelRow.identifier
                  },
                  statuses: [
                    {
                      id: statusObj.id,
                      status: statusObj.status,
                      recipient_id: statusObj.recipient_id,
                      timestamp: statusObj.timestamp
                    }
                  ]
                }
              }
            ]
          }
        ]
      };

      // Publish status event to the queue
      waitUntil(queue.publish(tenantId, 'whatsapp.status.received', normalizedPayload, {
        channelId: channelRow.channel_id,
        groupId: channelRow.group_id
      }));

      return new NextResponse("EVENT_RECEIVED", { status: 200 });
    }

    return new NextResponse("EVENT_RECEIVED", { status: 200 });

  } catch (error: any) {
    log.error("360dialog Webhook Crash", error, {
      durationMs: Date.now() - startTime
    });
    return new NextResponse("SERVER_ERROR", { status: 500 });
  }
}
