import { TenantDB } from "@/lib/core/tenant-db";
import { resolveFormAutopilotEligibility } from "./form-autopilot-eligibility-resolver";
import { logger } from "@/lib/core/logger";

const log = logger.withContext({ module: 'FormAutopilotOrchestrator' });

// CRITICAL SAFETY LOCK: Configurable Outbound Blocker.
// Defaults to true (safe/blocked). Can only be unlocked when set to 'false'.
export const PHASE_LOCK_OUTBOUND_BLOCKED = process.env.FORM_AUTOPILOT_PHASE_LOCK_OUTBOUND_BLOCKED !== 'false';

export interface AutopilotOrchestratorResult {
  processed: boolean;
  eligible: boolean;
  reason: string;
  simulatedResponse?: string;
}

/**
 * Orchestrates the Form Autopilot Greeting flow.
 * Implements the guarded live outbound send path.
 */
export class FormAutopilotOrchestrator {
  
  public static async execute(
    tenantId: string,
    leadId: string,
    conversationId: string,
    db: TenantDB
  ): Promise<AutopilotOrchestratorResult> {
    try {
      const phaseLockBlocked = process.env.FORM_AUTOPILOT_PHASE_LOCK_OUTBOUND_BLOCKED !== 'false';

      // 1. Evaluate Eligibility (Status, Mismatch, Allowlist, Meta Window, Idempotency)
      const eligibility = await resolveFormAutopilotEligibility(tenantId, leadId, conversationId, db);

      if (!eligibility.eligible) {
        // Log blocked status to ai_audit_logs
        await db.executeSafe({
          text: `
            INSERT INTO ai_audit_logs (tenant_id, conversation_id, action, reasoning_summary, result_summary)
            VALUES ($1, $2, $3, $4, $5::jsonb)
          `,
          values: [
            tenantId,
            conversationId,
            'FORM_AUTOPILOT_BLOCKED',
            `Autopilot blocked: ${eligibility.reason}`,
            JSON.stringify({
              leadId,
              channelId: eligibility.channelId || 'whatsapp',
              conversationId,
              tenantId,
              eligible: false,
              baseEligible: eligibility.baseEligible,
              gateOpen: eligibility.gateOpen,
              reason: eligibility.reason,
              baseReason: eligibility.baseReason,
              gateReason: eligibility.gateReason,
              dryRun: eligibility.dryRun,
              globalDisabled: eligibility.globalDisabled,
              featureFlagEnabled: eligibility.featureFlagEnabled,
              phaseLockOutboundBlocked: phaseLockBlocked,
              timestamp: new Date().toISOString()
            })
          ]
        });

        log.info('Form Autopilot Blocked', { leadId, conversationId, reason: eligibility.reason });
        return {
          processed: false,
          eligible: false,
          reason: eligibility.reason
        };
      }

      // 2. Perform Mock Simulation (Dry Run response generation)
      // Strictly do not call external Gemini/OpenAI API or execute live sending.
      const simulatedText = "Merhaba, form doldurduğunuz için teşekkürler. Size nasıl yardımcı olabiliriz?";

      // Save success log to ai_audit_logs
      // CRITICAL: NO raw simulated text or patient messages will be stored in audit logs.
      await db.executeSafe({
        text: `
          INSERT INTO ai_audit_logs (tenant_id, conversation_id, action, reasoning_summary, result_summary)
          VALUES ($1, $2, $3, $4, $5::jsonb)
        `,
        values: [
          tenantId,
          conversationId,
          'FORM_AUTOPILOT_DRY_RUN',
          'Autopilot eligibility passed. Dry-run simulation completed successfully.',
          JSON.stringify({
            leadId,
            channelId: eligibility.channelId || 'whatsapp',
            conversationId,
            tenantId,
            eligible: true,
            baseEligible: eligibility.baseEligible,
            gateOpen: eligibility.gateOpen,
            dryRun: eligibility.dryRun,
            globalDisabled: eligibility.globalDisabled,
            featureFlagEnabled: eligibility.featureFlagEnabled,
            phaseLockOutboundBlocked: phaseLockBlocked,
            hasSimulatedResponse: true,
            timestamp: new Date().toISOString()
          })
        ]
      });

      // 3. Live Send Check (Gatekeeper Check)
      // When PHASE_LOCK_OUTBOUND_BLOCKED = true, or if dryRun = true:
      // We absolutely prevent live sending.
      if (phaseLockBlocked || eligibility.dryRun) {
        log.info('Form Autopilot Dry Run (Phase Lock / Dry Run enabled). Outbound blocked.', {
          leadId,
          conversationId,
          phaseLockBlocked,
          dryRun: eligibility.dryRun
        });

        return {
          processed: true,
          eligible: true,
          reason: 'dry_run_simulation',
          simulatedResponse: simulatedText
        };
      }

      // ═══════════════════════════════════════════════════════════
      // LIVE OUTBOUND SEND PATH (UNLOCKED STATE ONLY)
      // ═══════════════════════════════════════════════════════════
      log.info('Executing Form Autopilot Live Outbound Send', { leadId, conversationId });

      // 1. Resolve Credentials
      const { CredentialsService } = await import("@/lib/services/credentials.service");
      const credentials = await CredentialsService.resolveCredentials(tenantId, 'whatsapp');

      if (!credentials || !credentials.whatsappPhoneNumberId || !credentials.accessToken) {
        log.error("Form Autopilot Live Send: WhatsApp credentials missing", undefined, { tenantId });
        return {
          processed: false,
          eligible: true,
          reason: 'credentials_missing'
        };
      }

      // 2. Fetch Phone Number from Conversation
      const convRows = await db.executeSafe({
        text: `SELECT phone_number FROM conversations WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
        values: [conversationId, tenantId]
      }) as any[];

      if (convRows.length === 0) {
        log.error("Form Autopilot Live Send: Conversation not found", undefined, { conversationId });
        return {
          processed: false,
          eligible: true,
          reason: 'conversation_not_found'
        };
      }

      const phoneNumber = convRows[0].phone_number;

      // 3. Final Outbound Guard Checks
      const { FinalOutboundGuard } = await import("@/lib/services/ai/final-outbound-guard");
      const guardContext = {
        tenantId,
        conversationId,
        source: 'form_autopilot',
        intent: 'greeting',
        isHealthcare: true
      };

      const processedText = FinalOutboundGuard.process(simulatedText, guardContext);

      // If FinalOutboundGuard triggers fallback/failure (or returns Kusura bakmayın)
      if (processedText.includes("Kusura bakmayın") || processedText !== simulatedText) {
        log.warn("Form Autopilot Live Send: Blocked by FinalOutboundGuard", { leadId, conversationId });
        
        await db.executeSafe({
          text: `
            INSERT INTO ai_audit_logs (tenant_id, conversation_id, action, reasoning_summary, result_summary)
            VALUES ($1, $2, $3, $4, $5::jsonb)
          `,
          values: [
            tenantId,
            conversationId,
            'FORM_AUTOPILOT_BLOCKED',
            'FinalOutboundGuard rejected autopilot greeting.',
            JSON.stringify({
              leadId,
              channelId: 'whatsapp',
              conversationId,
              tenantId,
              eligible: false,
              reason: 'final_outbound_guard_failed',
              timestamp: new Date().toISOString()
            })
          ]
        });

        return {
          processed: false,
          eligible: true,
          reason: 'final_outbound_guard_failed'
        };
      }

      // 4. Send Message via MessageService
      const { MessageService } = await import("@/lib/services/message.service");
      const msgService = new MessageService(db);

      const sendResult = await msgService.sendWhatsAppMessage(
        credentials.whatsappPhoneNumberId,
        credentials.accessToken,
        phoneNumber,
        processedText,
        credentials.provider
      );

      if (!sendResult.success) {
        log.error("Form Autopilot Live Send: Message sending failed", undefined, { leadId, conversationId });
        return {
          processed: false,
          eligible: true,
          reason: 'message_send_failed'
        };
      }

      const providerMessageId = sendResult.providerMessageId || null;

      // 5. Write message record to DB messages table
      const dbMetadata = {
        source: "form_autopilot",
        initiated_from: "form_activation",
        lead_id: leadId,
        conversation_id: conversationId,
        provider: credentials.provider || 'meta_graph'
      };

      const msgInsert = await db.executeSafe({
        text: `
          INSERT INTO messages (tenant_id, conversation_id, phone_number, direction, content, channel, status, provider_message_id, media_metadata)
          VALUES ($1, $2, $3, 'out', $4, 'whatsapp', 'sent', $5, $6::jsonb)
          RETURNING id
        `,
        values: [
          tenantId,
          conversationId,
          phoneNumber,
          processedText,
          providerMessageId,
          JSON.stringify(dbMetadata)
        ]
      }) as any[];

      const messageId = msgInsert[0]?.id;

      // 6. Publish to Ably / Realtime
      if (messageId) {
        try {
          const { RealtimePublisher } = await import("@/lib/realtime/publisher");
          await RealtimePublisher.publishMessageCreated(tenantId, {
            id: messageId,
            conversation_id: conversationId,
            phone_number: phoneNumber,
            content: processedText,
            direction: 'out',
            status: 'sent',
            created_at: new Date().toISOString()
          });
        } catch (realtimeErr) {
          log.warn("Form Autopilot Live Send: Realtime publish failed non-fatally", { realtimeErr });
        }
      }

      // 7. Log to ai_audit_logs as FORM_AUTOPILOT_SENT
      await db.executeSafe({
        text: `
          INSERT INTO ai_audit_logs (tenant_id, conversation_id, action, reasoning_summary, result_summary)
          VALUES ($1, $2, $3, $4, $5::jsonb)
        `,
        values: [
          tenantId,
          conversationId,
          'FORM_AUTOPILOT_SENT',
          'Autopilot greeting successfully sent to patient.',
          JSON.stringify({
            leadId,
            channelId: 'whatsapp',
            conversationId,
            tenantId,
            eligible: true,
            dryRun: false,
            messageId,
            timestamp: new Date().toISOString()
          })
        ]
      });

      return {
        processed: true,
        eligible: true,
        reason: 'sent',
        simulatedResponse: processedText
      };

    } catch (err) {
      log.error('Orchestrator error during live send path execution', err instanceof Error ? err : new Error(String(err)));
      return {
        processed: false,
        eligible: false,
        reason: 'orchestrator_error'
      };
    }
  }
}
