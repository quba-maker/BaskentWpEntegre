import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { put } from "@vercel/blob";
import { logger } from "@/lib/core/logger";

const log = logger.withContext({ module: "PanelUpload" });

// MIME whitelist for outbound media
const ALLOWED_MIMES = new Set([
  // Images
  "image/jpeg",
  "image/png",
  "image/webp",
  // Documents
  "application/pdf",
  // Audio
  "audio/mpeg",     // mp3
  "audio/ogg",
  "audio/aac",
  "audio/amr",
]);

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

export async function POST(req: NextRequest) {
  try {
    // 1. Auth
    const session = await getSession();
    if (!session?.userId || !session?.tenantId) {
      return NextResponse.json({ error: "Yetkisiz." }, { status: 401 });
    }

    const tenantId = session.tenantId;

    // 2. Parse multipart form data
    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "Dosya bulunamadı." }, { status: 400 });
    }

    // 3. MIME validation
    if (!ALLOWED_MIMES.has(file.type)) {
      return NextResponse.json(
        { error: `Desteklenmeyen dosya türü: ${file.type}. Desteklenen: JPG, PNG, WEBP, PDF, MP3, OGG, AAC, AMR` },
        { status: 400 }
      );
    }

    // 4. Size validation
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: `Dosya boyutu çok büyük (${(file.size / 1024 / 1024).toFixed(1)}MB). Maksimum: 10MB` },
        { status: 400 }
      );
    }

    // 5. BLOB_READ_WRITE_TOKEN check
    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      log.error("[UPLOAD_NO_BLOB_TOKEN] BLOB_READ_WRITE_TOKEN missing", undefined, { tenantId });
      return NextResponse.json({ error: "Depolama yapılandırması eksik." }, { status: 500 });
    }

    // 6. Generate tenant-isolated path
    const uuid = crypto.randomUUID().slice(0, 12);
    const timestamp = Date.now();
    const ext = file.name.match(/\.[a-zA-Z0-9]+$/)?.[0] || getMimeExt(file.type);
    const safeName = `${uuid}_${timestamp}${ext}`;
    const blobPath = `media/${tenantId}/outbound/${safeName}`;

    // 7. Upload to Vercel Blob
    const buffer = Buffer.from(await file.arrayBuffer());
    const blob = await put(blobPath, buffer, {
      access: "public",
      contentType: file.type,
      addRandomSuffix: false,
    });

    log.info("[UPLOAD_SUCCESS]", {
      tenantId,
      userId: session.userId,
      blobPath,
      fileSize: file.size,
      mimeType: file.type,
    });

    return NextResponse.json({
      url: blob.url,
      filename: file.name,
      mimeType: file.type,
      size: file.size,
    });
  } catch (err) {
    log.error(
      "[UPLOAD_FAILED]",
      err instanceof Error ? err : new Error(String(err))
    );
    return NextResponse.json({ error: "Yükleme başarısız." }, { status: 500 });
  }
}

function getMimeExt(mime: string): string {
  const map: Record<string, string> = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "application/pdf": ".pdf",
    "audio/mpeg": ".mp3",
    "audio/ogg": ".ogg",
    "audio/aac": ".aac",
    "audio/amr": ".amr",
  };
  return map[mime] || "";
}
