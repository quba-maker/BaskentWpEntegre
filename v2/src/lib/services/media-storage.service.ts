import { put, del, list } from "@vercel/blob";
import { logger } from "@/lib/core/logger";

const log = logger.withContext({ module: "MediaStorageService" });

/**
 * Securely masks a media ID for safe logging (e.g. 1323******1413)
 */
function maskMediaId(id: string): string {
  if (!id) return "N/A";
  if (id.length < 8) return "***";
  return `${id.substring(0, 4)}***${id.substring(id.length - 4)}`;
}

/**
 * SaaS Media Storage Service
 *
 * Tenant-isolated blob storage for WhatsApp/Instagram/Messenger media.
 * Path format: media/{tenant_id}/{year-month}/{message_id}_{original_filename}
 *
 * Security: Each blob path is scoped to tenant_id — cross-tenant access impossible.
 */
export class MediaStorageService {
  /**
   * Downloads media from Meta CDN and uploads to Vercel Blob (tenant-isolated).
   *
   * @param tenantId - Tenant UUID for isolation
   * @param mediaId - Meta media ID (from webhook payload)
   * @param accessToken - Meta API access token
   * @param messageId - Internal message ID for naming
   * @param metadata - { mime_type, filename, media_type }
   * @returns { blobUrl, fileSize } or null on failure
   */
  static async downloadAndStore(
    tenantId: string,
    mediaId: string,
    accessToken: string,
    messageId: string,
    metadata: {
      mimeType?: string;
      filename?: string;
      mediaType: string;
      provider?: string;
      directUrl?: string;
    }
  ): Promise<{ blobUrl: string; fileSize: number } | null> {
    const maskedId = maskMediaId(mediaId);
    const is360dialog =
      metadata.provider === "360dialog" ||
      metadata.provider === "360dialog_whatsapp" ||
      process.env.ENABLE_360DIALOG_COEXISTENCE === "true";
    
    const endpointVariant = is360dialog ? "360dialog" : "meta_graph";

    try {
      // Pre-check: BLOB_READ_WRITE_TOKEN must exist
      if (!process.env.BLOB_READ_WRITE_TOKEN) {
        log.error(`[MEDIA_NO_BLOB_TOKEN] BLOB_READ_WRITE_TOKEN env variable is missing. Create a Blob Store in Vercel Dashboard → Storage.`, undefined, {
          tenantId,
          mediaId: maskedId,
          stage: "metadata_resolve",
          endpointVariant,
        });
        return null;
      }

      let downloadUrl = metadata.directUrl || "";

      if (!downloadUrl) {
        if (is360dialog) {
          // Step 1: Get the download URL from 360dialog API
          const targetUrl = `https://waba-v2.360dialog.io/${mediaId}`;
          const d360Res = await fetch(targetUrl, {
            headers: { "D360-API-KEY": accessToken },
          });

          if (!d360Res.ok) {
            const errText = await d360Res.text();
            log.error(`[MEDIA_RESOLVE_FAILED] 360dialog media URL resolve failed`, new Error(errText), {
              mediaId: maskedId,
              tenantId,
              status: d360Res.status,
              stage: "metadata_resolve",
              endpointVariant,
              provider: metadata.provider,
              mediaType: metadata.mediaType,
            });
            return null;
          }

          const d360Data = await d360Res.json();
          downloadUrl = d360Data.url;
        } else {
          // Step 1: Get the download URL from Meta Graph API
          const targetUrl = `https://graph.facebook.com/v25.0/${mediaId}`;
          const metaRes = await fetch(targetUrl, {
            headers: { Authorization: `Bearer ${accessToken}` },
          });

          if (!metaRes.ok) {
            const errText = await metaRes.text();
            log.error(`[MEDIA_RESOLVE_FAILED] Meta media URL resolve failed`, new Error(errText), {
              mediaId: maskedId,
              tenantId,
              status: metaRes.status,
              stage: "metadata_resolve",
              endpointVariant,
              provider: metadata.provider,
              mediaType: metadata.mediaType,
            });
            return null;
          }

          const metaData = await metaRes.json();
          downloadUrl = metaData.url;
        }
      }

      if (!downloadUrl) {
        log.error(`[MEDIA_NO_URL] Media returned no download URL`, undefined, {
          mediaId: maskedId,
          tenantId,
          provider: metadata.provider,
          stage: "metadata_resolve",
          endpointVariant,
        });
        return null;
      }

      let originalHost = "";
      let rewrittenHost = "";
      let isHostRewritten = false;

      if (is360dialog && (downloadUrl.includes("facebook.com") || downloadUrl.includes("fbsbx.com"))) {
        try {
          const parsedUrl = new URL(downloadUrl);
          originalHost = parsedUrl.host;
          parsedUrl.host = "waba-v2.360dialog.io";
          downloadUrl = parsedUrl.toString();
          rewrittenHost = parsedUrl.host;
          isHostRewritten = true;

          log.info(`[MEDIA_HOST_REWRITE] Rewriting Meta lookaside URL to 360dialog media proxy`, {
            mediaId: maskedId,
            tenantId,
            stage: "host_rewrite_binary_download",
            originalHost,
            rewrittenHost,
            endpointVariant,
          });
        } catch (e) {
          log.warn("[MEDIA_REWRITE_FAILED] Failed to parse and rewrite download URL", { downloadUrl });
        }
      }

      const directUrlUsed = !!metadata.directUrl;
      const resolveStage = isHostRewritten 
        ? "host_rewrite_binary_download" 
        : (directUrlUsed ? "direct_binary_download" : "metadata_resolve");

      log.info(`[MEDIA_METADATA_RESOLVED] Media metadata successfully resolved`, {
        mediaId: maskedId,
        tenantId,
        stage: resolveStage,
        endpointVariant,
        provider: metadata.provider,
        mediaType: metadata.mediaType,
        hasDownloadUrl: !!downloadUrl,
        directUrlUsed,
        source: directUrlUsed ? "webhook_presigned_url" : "api_metadata_fetch",
        originalHost: originalHost || undefined,
        rewrittenHost: rewrittenHost || undefined,
      });

      // Step 2: Download the actual file with scoped credentials
      const headers: Record<string, string> = {};
      if (is360dialog) {
        if (downloadUrl.includes("360dialog.io")) {
          headers["D360-API-KEY"] = accessToken;
        } else if (downloadUrl.includes("facebook.com") || downloadUrl.includes("fbsbx.com")) {
          // Robust fallback: if URL is from Meta/Facebook CDN, authorize via the Meta page token
          const metaToken = process.env.META_ACCESS_TOKEN || accessToken;
          headers["Authorization"] = `Bearer ${metaToken}`;
        }
      } else {
        if (downloadUrl.includes("facebook.com") || downloadUrl.includes("fbsbx.com")) {
          headers["Authorization"] = `Bearer ${accessToken}`;
        }
      }

      const fileRes = await fetch(downloadUrl, { headers });

      if (!fileRes.ok) {
        log.error(`[MEDIA_BINARY_DOWNLOAD_FAILED] Failed to download media from CDN`, new Error(`HTTP ${fileRes.status}`), {
          mediaId: maskedId,
          tenantId,
          status: fileRes.status,
          stage: isHostRewritten ? "host_rewrite_binary_download" : "binary_download",
          endpointVariant,
          provider: metadata.provider,
          mediaType: metadata.mediaType,
          downloadHost: new URL(downloadUrl).host,
          originalHost: originalHost || undefined,
          rewrittenHost: rewrittenHost || undefined,
        });
        return null;
      }

      const fileBuffer = await fileRes.arrayBuffer();
      const fileSize = fileBuffer.byteLength;

      // Step 3: Generate tenant-isolated blob path
      const now = new Date();
      const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
      const ext = this.getExtension(metadata.mimeType || "", metadata.filename || "");
      const safeName = metadata.filename
        ? metadata.filename.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 100)
        : `${metadata.mediaType}_${messageId.slice(0, 8)}${ext}`;

      const blobPath = `media/${tenantId}/${yearMonth}/${messageId}_${safeName}`;

      // Step 4: Upload to Vercel Blob
      const blob = await put(blobPath, Buffer.from(fileBuffer), {
        access: "public",
        contentType: metadata.mimeType || "application/octet-stream",
        addRandomSuffix: false,
      });

      log.info(`[MEDIA_STORED] Blob uploaded`, {
        tenantId,
        mediaId: maskedId,
        blobPath,
        fileSize,
        mediaType: metadata.mediaType,
        provider: metadata.provider,
        stage: isHostRewritten ? "host_rewrite_binary_download" : "binary_download",
        endpointVariant,
        status: 200,
        originalHost: originalHost || undefined,
        rewrittenHost: rewrittenHost || undefined,
      });

      return { blobUrl: blob.url, fileSize };
    } catch (err) {
      log.error(
        `[MEDIA_STORE_FAILED] Unexpected error in downloadAndStore`,
        err instanceof Error ? err : new Error(String(err)),
        { tenantId, mediaId: maskedId, provider: metadata.provider, stage: "binary_download", endpointVariant }
      );
      return null;
    }
  }

  /**
   * Delete a blob by URL (for 30-day cleanup cron).
   */
  static async deleteBlob(blobUrl: string): Promise<boolean> {
    try {
      await del(blobUrl);
      return true;
    } catch (err) {
      log.error(`[MEDIA_DELETE_FAILED]`, err instanceof Error ? err : new Error(String(err)), { blobUrl });
      return false;
    }
  }

  /**
   * List all blobs for a tenant (for admin/quota views).
   */
  static async listTenantBlobs(tenantId: string, cursor?: string) {
    return list({ prefix: `media/${tenantId}/`, cursor, limit: 100 });
  }

  /**
   * Update tenant storage usage tracking (SaaS quota).
   */
  static async trackUsage(
    db: any,
    tenantId: string,
    mediaType: string,
    fileSize: number
  ): Promise<void> {
    const now = new Date();
    const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

    const mediaColumn =
      mediaType === "image" ? "image_count"
      : mediaType === "document" ? "document_count"
      : mediaType === "audio" ? "audio_count"
      : mediaType === "video" ? "video_count"
      : "image_count"; // fallback

    try {
      await db.executeSafe({
        text: `
          INSERT INTO tenant_storage_usage (tenant_id, month, total_files, total_bytes, ${mediaColumn})
          VALUES ($1, $2, 1, $3, 1)
          ON CONFLICT (tenant_id, month) DO UPDATE SET
            total_files = tenant_storage_usage.total_files + 1,
            total_bytes = tenant_storage_usage.total_bytes + $3,
            ${mediaColumn} = tenant_storage_usage.${mediaColumn} + 1,
            updated_at = NOW()
        `,
        values: [tenantId, month, fileSize],
      });
    } catch (err) {
      // Non-fatal — don't block message processing for quota tracking
      log.warn(`[STORAGE_TRACKING_FAILED] Non-fatal`, { tenantId, error: (err as Error).message });
    }
  }

  /**
   * Derive file extension from MIME type or filename.
   */
  private static getExtension(mimeType: string, filename: string): string {
    // Try from filename first
    const fnMatch = filename.match(/\.[a-zA-Z0-9]+$/);
    if (fnMatch) return fnMatch[0];

    // Fallback to MIME type
    const mimeMap: Record<string, string> = {
      "image/jpeg": ".jpg",
      "image/png": ".png",
      "image/webp": ".webp",
      "image/gif": ".gif",
      "video/mp4": ".mp4",
      "video/3gpp": ".3gp",
      "audio/ogg": ".ogg",
      "audio/mpeg": ".mp3",
      "audio/aac": ".aac",
      "audio/amr": ".amr",
      "application/pdf": ".pdf",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
      "application/msword": ".doc",
      "application/vnd.ms-excel": ".xls",
    };

    return mimeMap[mimeType] || "";
  }

  /**
   * Generate human-readable content text for media messages.
   * Used in conversations list (last_message preview) and AI context.
   */
  static getMediaContentText(
    mediaType: string,
    metadata?: { caption?: string; filename?: string }
  ): string {
    const prefix: Record<string, string> = {
      image: "📷 Fotoğraf",
      document: "📎 Belge",
      audio: "🎵 Ses kaydı",
      video: "🎬 Video",
      location: "📍 Konum",
      sticker: "🏷️ Sticker",
    };

    const label = prefix[mediaType] || `📦 ${mediaType}`;

    if (metadata?.caption) return `${label}: ${metadata.caption}`;
    if (metadata?.filename) return `${label} — ${metadata.filename}`;
    return label;
  }
}
