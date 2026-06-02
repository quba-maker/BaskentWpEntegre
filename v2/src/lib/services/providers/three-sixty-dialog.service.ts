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
}
