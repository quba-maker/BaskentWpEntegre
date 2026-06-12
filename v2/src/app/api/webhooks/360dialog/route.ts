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
  let resolvedTenantId: string | undefined = undefined;

  // 1. Webhook Secret Validation (Header-first, Query fallback)
  const headerSecret = req.headers.get("x-360dialog-secret");
  const querySecret = req.nextUrl.searchParams.get("secret");
  const expectedSecret = process.env.THREE_SIXTY_DIALOG_WEBHOOK_SECRET;

  if (expectedSecret) {
    const isHeaderMatch = headerSecret && headerSecret.trim() === expectedSecret.trim();
    const isQueryMatch = querySecret && querySecret.trim() === expectedSecret.trim();

    if (!isHeaderMatch && !isQueryMatch) {
      log.warn("[SECURITY_DENIED] Webhook secret mismatch or missing. Access denied.", { traceId });
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
    log.error("Malformed JSON payload in 360dialog webhook", e, { tenantId: 'system_scheduler', conversationId: 'conversation_pending_resolution', traceId });
    return new NextResponse("BAD_REQUEST", { status: 400 });
  }

  // 3. Resolve Channel DB Ownership (Strict isolation)
  // Retrieve channelId from query parameters
  const channelId = req.nextUrl.searchParams.get("channel_id");
  if (!channelId) {
    log.warn("[ROUTING_FAILED] Webhook missing channel_id query parameter.", { tenantId: 'system_scheduler', conversationId: 'conversation_pending_resolution', traceId });
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
      log.warn("[ROUTING_FAILED] Active channel or tenant not found for channelId.", { tenantId: 'system_scheduler', conversationId: 'conversation_pending_resolution', channelId, traceId });
      return new NextResponse("EVENT_RECEIVED_UNROUTABLE", { status: 200 });
    }

    const channelRow = channelResults[0];
    const tenantId = channelRow.tenant_id;
    resolvedTenantId = tenantId;
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

    // 5. Ingestion Extraction Layer (Handles both 360dialog flat format and Meta nested format)
    let messagesList: any[] = [];
    let statusesList: any[] = [];
    let contactsList: any[] = [];
    let wabaId = "360dialog_coexistence";
    let activeIdentifier = channelRow.identifier;

    if (body.messages?.[0]) {
      messagesList = body.messages;
      contactsList = body.contacts || [];
    } else if (body.statuses?.[0]) {
      statusesList = body.statuses;
    } else if (body.entry?.[0]?.changes?.[0]?.value) {
      const value = body.entry[0].changes[0].value;
      wabaId = body.entry[0].id || wabaId;
      contactsList = value.contacts || [];
      if (value.metadata?.display_phone_number) {
        activeIdentifier = value.metadata.display_phone_number;
      }

      if (value.messages?.[0]) {
        messagesList = value.messages;
      } else if (value.message_echoes?.[0]) {
        messagesList = value.message_echoes;
      } else if (value.statuses?.[0]) {
        statusesList = value.statuses;
      }

      // Explicit check for history or smb_message_echoes field root
      const fieldName = body.entry[0].changes[0].field;
      if (fieldName === 'history' && value.messages) {
        messagesList = value.messages;
        value.is_history_import = true;
      } else if (fieldName === 'smb_message_echoes' && value.message_echoes) {
        messagesList = value.message_echoes;
        value.is_smb_echo = true;
      }
    }

    // 6. Inbound Message Processing — Multi-Message Loop (Includes App Echoes)
    // HOTFIX: Process ALL messages in the payload, not just messagesList[0].
    // WhatsApp/360dialog can batch multiple messages in a single webhook delivery
    // (especially during history imports and high-traffic windows).
    if (messagesList.length > 0) {
      const valueObj = body.entry?.[0]?.changes?.[0]?.value;
      const isHistoryField = body.entry?.[0]?.changes?.[0]?.field === 'history';
      const isSmbEchoField = body.entry?.[0]?.changes?.[0]?.field === 'smb_message_echoes';

      let processedCount = 0;
      let duplicateCount = 0;
      let errorCount = 0;

      for (const msg of messagesList) {
        try {
          // Per-message echo detection: sent from display_phone_number, phone_number_id, or channel identifier
          const isEcho = msg.from === channelRow.identifier || 
                         msg.from === valueObj?.metadata?.phone_number_id || 
                         msg.from === valueObj?.metadata?.display_phone_number;

          // For outbound app echoes, the consumer expects the customer number (msg.to) as sender
          const senderPhone = isEcho 
            ? (msg.to || contactsList?.[0]?.wa_id || msg.from)
            : (contactsList?.[0]?.wa_id || msg.from);

          log.info(`[360DIALOG] [${isEcho ? 'OUTBOUND_ECHO' : 'INBOUND'}] Processing message: ${msg.id} from ${senderPhone} [${processedCount + duplicateCount + errorCount + 1}/${messagesList.length}]`, {
            tenantId,
            tenantSlug,
            traceId,
            conversationId: isEcho ? 'echo_pending_match' : 'conversation_pending_resolution'
          });

          // Per-message idempotency check with locking
          const { isDuplicate } = await dedupeService.checkAndLock({
            provider: 'whatsapp',
            providerMessageId: msg.id,
            senderId: senderPhone,
            timestamp: msg.timestamp ? parseInt(msg.timestamp) : Date.now()
          });

          if (isDuplicate) {
            log.warn(`[360DIALOG] [DUPLICATE] Suppressing duplicate message: ${msg.id} [${duplicateCount + 1} dupes so far]`, {
              tenantId,
              tenantSlug,
              traceId,
              conversationId: 'conversation_pending_resolution'
            });
            duplicateCount++;
            continue; // Skip this message, process the rest
          }

          // Build per-message normalized payload (each message gets its own queue job)
          const normalizedPayload = {
            object: "whatsapp_business_account",
            tenantId: tenantId,
            channelId: channelRow.channel_id,
            provider: "whatsapp",
            routingSource: "360dialog_channel_id",
            resolvedChannelIdentifier: channelRow.identifier,
            entry: [
              {
                id: wabaId,
                changes: [
                  {
                    field: "messages",
                    value: {
                      messaging_product: "whatsapp",
                      metadata: {
                        display_phone_number: activeIdentifier,
                        phone_number_id: activeIdentifier
                      },
                      contacts: contactsList.length > 0 ? contactsList : [
                        {
                          profile: { name: contactsList[0]?.profile?.name || (isEcho ? "Quba Business App" : "Customer") },
                          wa_id: senderPhone
                        }
                      ],
                      messages: [
                        {
                          from: msg.from,
                          to: msg.to,
                          id: msg.id,
                          timestamp: msg.timestamp,
                          type: msg.type,
                          text: msg.text ? { body: msg.text.body } : undefined,
                          image: msg.image ? { id: msg.image.id, caption: msg.image.caption, mime_type: msg.image.mime_type, url: msg.image.url } : undefined,
                          document: msg.document ? { id: msg.document.id, filename: msg.document.filename, mime_type: msg.document.mime_type, url: msg.document.url } : undefined,
                          audio: msg.audio ? { id: msg.audio.id, mime_type: msg.audio.mime_type, url: msg.audio.url } : undefined,
                          video: msg.video ? { id: msg.video.id, caption: msg.video.caption, mime_type: msg.video.mime_type, url: msg.video.url } : undefined,
                          location: msg.location ? { latitude: msg.location.latitude, longitude: msg.location.longitude, name: msg.location.name } : undefined,
                          sticker: msg.sticker ? { id: msg.sticker.id, mime_type: msg.sticker.mime_type } : undefined,
                          button: msg.button ? { text: msg.button.text, payload: msg.button.payload } : undefined,
                          interactive: msg.interactive ? msg.interactive : undefined,
                          context: msg.context ? { id: msg.context.id, from: msg.context.from } : undefined,
                          reaction: msg.reaction ? { message_id: msg.reaction.message_id, emoji: msg.reaction.emoji } : undefined,
                          is_history_import: isHistoryField || valueObj?.is_history_import,
                          is_smb_echo: isSmbEchoField || valueObj?.is_smb_echo
                        }
                      ]
                    }
                  }
                ]
              }
            ]
          };

          // Publish each message as an independent queue job
          waitUntil(queue.publish(tenantId, 'whatsapp.message.received', normalizedPayload, {
            channelId: channelRow.channel_id,
            groupId: channelRow.group_id
          }));

          processedCount++;
        } catch (msgError: any) {
          // Error isolation: log and continue with remaining messages
          errorCount++;
          log.error(`[360DIALOG] [MSG_LOOP_ERROR] Failed to process message ${msg?.id || 'unknown'}, continuing with remaining messages`, msgError, {
            tenantId,
            tenantSlug,
            traceId,
            conversationId: 'conversation_pending_resolution',
            messageIndex: processedCount + duplicateCount + errorCount,
            totalMessages: messagesList.length
          });
        }
      }

      log.info(`[360DIALOG] [BATCH_COMPLETE] Processed ${processedCount} messages, ${duplicateCount} duplicates skipped, ${errorCount} errors`, {
        tenantId,
        tenantSlug,
        traceId,
        conversationId: 'conversation_pending_resolution',
        totalInPayload: messagesList.length
      });

      return new NextResponse("EVENT_RECEIVED", { status: 200 });
    }

    // 7. Status Receipts Processing
    if (statusesList.length > 0) {
      const statusObj = statusesList[0];
      const statusId = statusObj.id;

      log.info(`[360DIALOG] [STATUS] Ingesting status receipt: ${statusObj.status} for msg_id: ${statusId}`, {
        tenantId,
        tenantSlug,
        traceId,
        conversationId: 'status_receipt_no_conversation'
      });

      // Idempotency check with locking
      const { isDuplicate } = await dedupeService.checkAndLock({
        provider: 'whatsapp',
        providerMessageId: `${statusId}_${statusObj.status}`,
        senderId: statusObj.recipient_id,
        timestamp: statusObj.timestamp ? parseInt(statusObj.timestamp) : Date.now()
      });

      if (isDuplicate) {
        log.warn(`[360DIALOG] [DUPLICATE] Suppressing duplicate status: ${statusObj.status} for msg_id: ${statusId}`, {
          tenantId,
          tenantSlug,
          traceId,
          conversationId: 'status_receipt_no_conversation'
        });
        return new NextResponse("EVENT_RECEIVED_DUPLICATE", { status: 200 });
      }

      // Map status payload to standard MetaWebhookPayload structure
      const normalizedPayload = {
        object: "whatsapp_business_account",
        tenantId: tenantId,
        channelId: channelRow.channel_id,
        provider: "whatsapp",
        routingSource: "360dialog_channel_id",
        resolvedChannelIdentifier: channelRow.identifier,
        entry: [
          {
            id: wabaId,
            changes: [
              {
                field: "messages",
                value: {
                  messaging_product: "whatsapp",
                  metadata: {
                    display_phone_number: activeIdentifier,
                    phone_number_id: activeIdentifier
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
      tenantId: resolvedTenantId || 'system_scheduler',
      conversationId: 'conversation_pending_resolution',
      durationMs: Date.now() - startTime
    });
    return new NextResponse("SERVER_ERROR", { status: 500 });
  }
}
