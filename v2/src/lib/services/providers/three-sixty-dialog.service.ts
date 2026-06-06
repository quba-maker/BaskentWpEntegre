import { logger } from "@/lib/core/logger";

export class ThreeSixtyDialogService {
  private static log = logger.withContext({ module: 'ThreeSixtyDialog' });

  /**
   * Sends an outgoing text message to a customer via the 360dialog WhatsApp Business API.
   * 
   * SECURITY: The apiKey parameter is never logged, printed in error stacks, or exposed
   * to the console/telemetry under any circumstance.
   */
  static async sendMessage(
    apiKey: string,
    to: string,
    content: string,
    media?: {
      type: "image" | "document" | "audio" | "video";
      url: string;
      filename?: string;
    },
    context?: {
      message_id: string;
    }
  ): Promise<{ success: boolean; providerMessageId?: string }> {
    const url = "https://waba-v2.360dialog.io/messages";
    
    if (!apiKey) {
      throw new Error("360dialog API error: D360-API-KEY is missing.");
    }

    try {
      let bodyData: any;

      if (media) {
        const mediaPayload: any = { link: media.url.trim() };
        if (media.filename && media.type === "document") {
          mediaPayload.filename = media.filename;
        }
        if (content && (media.type === "image" || media.type === "document")) {
          mediaPayload.caption = content;
        }

        bodyData = {
          messaging_product: "whatsapp",
          to: to,
          recipient_type: "individual",
          type: media.type,
          [media.type]: mediaPayload
        };
      } else {
        bodyData = {
          messaging_product: "whatsapp",
          to: to,
          recipient_type: "individual",
          type: "text",
          text: { body: content }
        };
      }

      if (context) {
        bodyData.context = context;
      }

      const response = await fetch(url, {
        method: "POST",
        headers: {
          "D360-API-KEY": apiKey.trim(),
          "Content-Type": "application/json"
        },
        body: JSON.stringify(bodyData)
      });

      if (!response.ok) {
        const err = await response.text();
        // Mask API key in any returned errors if they somehow contain it
        throw new Error(`360dialog API HTTP ${response.status} Error: ${err}`);
      }

      const data = await response.json();
      const providerMessageId = data.messages?.[0]?.id || null;
      
      this.log.info("Message sent successfully via 360dialog", { 
        to, 
        hasMessageId: !!providerMessageId 
      });

      return { success: true, providerMessageId };
    } catch (e: any) {
      // Catch and scrub any trace of apiKey in the stack trace or error object
      const safeErrorMsg = e instanceof Error ? e.message : String(e);
      this.log.error("360dialog API request failed", new Error(safeErrorMsg.replace(apiKey, "[SCRUBBED_API_KEY]")), {
        to
      });
      throw new Error(`360dialog sending failed: ${safeErrorMsg.replace(apiKey, "[SCRUBBED_API_KEY]")}`);
    }
  }

  /**
   * Sends an outgoing template message to a customer via the 360dialog WhatsApp Business API.
   * 
   * SECURITY: The apiKey parameter is never logged, printed in error stacks, or exposed
   * to the console/telemetry under any circumstance.
   */
  static async sendTemplate(
    apiKey: string,
    to: string,
    templateName: string,
    languageCode: string = "tr",
    components: any[] = []
  ): Promise<{ success: boolean; providerMessageId?: string }> {
    const url = "https://waba-v2.360dialog.io/messages";
    
    if (!apiKey) {
      throw new Error("360dialog API error: D360-API-KEY is missing.");
    }

    try {
      const bodyData = {
        messaging_product: "whatsapp",
        to: to,
        recipient_type: "individual",
        type: "template",
        template: {
          name: templateName,
          language: {
            code: languageCode
          },
          ...(components.length > 0 ? { components } : {})
        }
      };

      const response = await fetch(url, {
        method: "POST",
        headers: {
          "D360-API-KEY": apiKey.trim(),
          "Content-Type": "application/json"
        },
        body: JSON.stringify(bodyData)
      });

      if (!response.ok) {
        const err = await response.text();
        throw new Error(`360dialog API HTTP ${response.status} Error: ${err}`);
      }

      const data = await response.json();
      const providerMessageId = data.messages?.[0]?.id || null;
      
      this.log.info("Template sent successfully via 360dialog", { 
        to, 
        templateName,
        hasMessageId: !!providerMessageId 
      });

      return { success: true, providerMessageId };
    } catch (e: any) {
      const safeErrorMsg = e instanceof Error ? e.message : String(e);
      this.log.error("360dialog API template request failed", new Error(safeErrorMsg.replace(apiKey, "[SCRUBBED_API_KEY]")), {
        to,
        templateName
      });
      throw new Error(`360dialog template sending failed: ${safeErrorMsg.replace(apiKey, "[SCRUBBED_API_KEY]")}`);
    }
  }

  /**
   * Sends a reaction to a message via the 360dialog WhatsApp Business API.
   */
  static async sendReaction(
    apiKey: string,
    to: string,
    targetProviderMessageId: string,
    emoji: string
  ): Promise<{ success: boolean; providerMessageId?: string }> {
    const url = "https://waba-v2.360dialog.io/messages";
    
    if (!apiKey) {
      throw new Error("360dialog API error: D360-API-KEY is missing.");
    }

    try {
      const bodyData = {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: to,
        type: "reaction",
        reaction: {
          message_id: targetProviderMessageId,
          emoji: emoji
        }
      };

      const response = await fetch(url, {
        method: "POST",
        headers: {
          "D360-API-KEY": apiKey.trim(),
          "Content-Type": "application/json"
        },
        body: JSON.stringify(bodyData)
      });

      if (!response.ok) {
        const err = await response.text();
        throw new Error(`360dialog API HTTP ${response.status} Error: ${err}`);
      }

      const data = await response.json();
      const providerMessageId = data.messages?.[0]?.id || null;
      
      this.log.info("Reaction sent successfully via 360dialog", { 
        to, 
        targetProviderMessageId,
        hasMessageId: !!providerMessageId 
      });

      return { success: true, providerMessageId };
    } catch (e: any) {
      const safeErrorMsg = e instanceof Error ? e.message : String(e);
      this.log.error("360dialog API reaction failed", new Error(safeErrorMsg.replace(apiKey, "[SCRUBBED_API_KEY]")), {
        to,
        targetProviderMessageId
      });
      throw new Error(`360dialog reaction failed: ${safeErrorMsg.replace(apiKey, "[SCRUBBED_API_KEY]")}`);
    }
  }
}
