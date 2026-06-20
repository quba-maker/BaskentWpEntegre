import { list, del } from "@vercel/blob";
import { neon } from "@neondatabase/serverless";
import * as dotenv from "dotenv";
import * as path from "path";
import * as fs from "fs";

// Load local environment variables
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

async function run() {
  const isConfirmed = process.env.CONFIRM_DELETE === "true";
  if (!isConfirmed) {
    console.error("CONFIRM_DELETE=true is not set! Run in dry-run mode or set CONFIRM_DELETE=true.");
    return;
  }

  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) {
    console.error("BLOB_READ_WRITE_TOKEN is missing in env!");
    return;
  }

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("DATABASE_URL is missing in env!");
    return;
  }

  console.log("Connecting to database for MP4 cleanup execution...");
  const sql = neon(connectionString);

  // 1. Fetch tenants for isolation check
  let tenantIds: Set<string>;
  try {
    const dbTenants = await sql`SELECT id FROM tenants`;
    tenantIds = new Set(dbTenants.map((t: any) => t.id.toLowerCase()));
  } catch (err: any) {
    console.error("Failed to query tenants:", err.message);
    return;
  }

  // 2. Fetch blobs from Vercel Blob store
  console.log("Fetching blobs from Vercel Blob store...");
  let allBlobs: any[] = [];
  let hasMore = true;
  let cursor: string | undefined = undefined;

  try {
    while (hasMore) {
      const response = await list({
        token,
        cursor,
        limit: 1000
      });
      allBlobs = allBlobs.concat(response.blobs);
      hasMore = response.hasMore;
      cursor = response.cursor;
    }
  } catch (err: any) {
    console.error("Failed to list blobs:", err.message);
    return;
  }

  // Filter for MP4 files still in storage
  const mp4Blobs = allBlobs.filter(b => 
    b.pathname.toLowerCase().endsWith(".mp4") || 
    (b.contentType && b.contentType.toLowerCase() === "video/mp4")
  );

  console.log(`Found ${mp4Blobs.length} MP4 files in storage.`);

  // 3. Scan messages table to find which column exists (media_metadata or metadata)
  let metadataColumn = "media_metadata";
  try {
    const cols = await sql`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'messages' AND column_name = 'media_metadata'
    `;
    if (cols.length === 0) {
      metadataColumn = "metadata";
    }
    console.log(`Using messages table metadata column: ${metadataColumn}`);
  } catch (err: any) {
    console.error("Failed to describe messages table:", err.message);
    return;
  }

  // 4. Identify deletable candidates under safety rules (matching tenants & ending in .mp4)
  const uuidRegex = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
  let deletedCount = 0;
  let freedBytes = 0;

  for (const blob of mp4Blobs) {
    // Tenant isolation check
    const parts = blob.pathname.split('/');
    let isOtherTenant = false;
    if (parts[0] === 'media' && parts[1]) {
      const potentialId = parts[1].toLowerCase();
      if (uuidRegex.test(potentialId) && !tenantIds.has(potentialId)) {
        isOtherTenant = true;
      }
    }

    if (!isOtherTenant) {
      try {
        console.log(`[CLEANUP] Deleting remaining blob: ${blob.pathname} (${(blob.size / (1024 * 1024)).toFixed(2)} MB)`);
        await del(blob.url, { token });
        deletedCount++;
        freedBytes += blob.size;
      } catch (err: any) {
        console.error(`Failed to delete blob ${blob.pathname}:`, err.message);
      }
    } else {
      console.log(`[ISOLATION EXCLUDED] Excluded file from other tenant: ${blob.pathname}`);
    }
  }

  // 5. Update DB references for ALL MP4s that are referenced in database (with tenant isolation check)
  console.log("\nUpdating database references for all MP4 files...");
  
  let dbUpdatesCount = 0;
  try {
    let referencedMessages: any[] = [];
    if (metadataColumn === "media_metadata") {
      referencedMessages = await sql`
        SELECT id, media_url, media_metadata, tenant_id 
        FROM messages 
        WHERE media_url LIKE '%.mp4%' OR media_url LIKE '%video/mp4%'
      `;
    } else {
      referencedMessages = await sql`
        SELECT id, media_url, metadata, tenant_id 
        FROM messages 
        WHERE media_url LIKE '%.mp4%' OR media_url LIKE '%video/mp4%'
      `;
    }

    console.log(`Found ${referencedMessages.length} messages referencing MP4 files in database.`);

    for (const msg of referencedMessages) {
      const url = msg.media_url;
      const tenantId = msg.tenant_id ? msg.tenant_id.toLowerCase() : "";

      // Tenant isolation check
      if (tenantId && !tenantIds.has(tenantId)) {
        console.log(`[ISOLATION] Skipping DB update for message ID ${msg.id} belonging to other tenant ${tenantId}`);
        continue;
      }

      const filename = url.split('/').pop() || '';
      const existingMetadata = msg[metadataColumn] || {};
      const updatedMetadata = {
        ...existingMetadata,
        media_archived: true,
        archive_reason: "blob_mp4_cleanup",
        original_filename: filename,
        archived_at: new Date().toISOString()
      };

      if (metadataColumn === "media_metadata") {
        await sql`
          UPDATE messages
          SET media_url = NULL,
              media_metadata = ${JSON.stringify(updatedMetadata)}::jsonb
          WHERE id = ${msg.id}
        `;
      } else {
        await sql`
          UPDATE messages
          SET media_url = NULL,
              metadata = ${JSON.stringify(updatedMetadata)}::jsonb
          WHERE id = ${msg.id}
        `;
      }

      console.log(`   Updated message ID ${msg.id} references. Set media_url to NULL.`);
      dbUpdatesCount++;
    }
  } catch (err: any) {
    console.error("Database update failed:", err.message);
    return;
  }

  // 6. Re-check final storage
  console.log("\nRefreshing blob list to calculate final storage status...");
  let finalBlobs: any[] = [];
  let hasMoreCheck = true;
  let cursorCheck: string | undefined = undefined;

  try {
    while (hasMoreCheck) {
      const response = await list({
        token,
        cursor: cursorCheck,
        limit: 1000
      });
      finalBlobs = finalBlobs.concat(response.blobs);
      hasMoreCheck = response.hasMore;
      cursorCheck = response.cursor;
    }
  } catch (err: any) {
    console.error("Failed to list blobs during final check:", err.message);
  }

  const finalTotalBytes = finalBlobs.reduce((sum, b) => sum + b.size, 0);
  const finalTotalMB = (finalTotalBytes / (1024 * 1024)).toFixed(2);
  const finalTotalGB = (finalTotalBytes / (1024 * 1024 * 1024)).toFixed(3);

  const finalMp4Count = finalBlobs.filter(b => 
    b.pathname.toLowerCase().endsWith(".mp4") || 
    (b.contentType && b.contentType.toLowerCase() === "video/mp4")
  ).length;

  // Check if any broken media_url remains in the messages table
  let brokenUrlsCount = 0;
  try {
    const activeMessages = await sql`SELECT media_url FROM messages WHERE media_url IS NOT NULL`;
    const activeUrls = new Set(activeMessages.map((m: any) => m.media_url));
    const storageUrls = new Set(finalBlobs.map(b => b.url));
    
    activeUrls.forEach(url => {
      if (!storageUrls.has(url)) {
        brokenUrlsCount++;
      }
    });
  } catch (err: any) {
    console.error("Failed to check for broken media URLs in DB:", err.message);
  }

  console.log(`\n=== CLEANUP RUN SUMMARY ===`);
  console.log(`Successfully Deleted from storage: ${deletedCount} MP4 files`);
  console.log(`Successfully Updated in DB: ${dbUpdatesCount} messages`);
  console.log(`Remaining Blob Storage: ${finalTotalMB} MB (${finalTotalGB} GB)`);
  console.log(`Remaining MP4 Files in storage: ${finalMp4Count}`);
  console.log(`Broken media_url Links in DB: ${brokenUrlsCount}`);

  // Write execution report
  const appDataDir = process.env.GEMINI_APP_DATA_DIR || path.join(__dirname, "../..");
  const reportPath = path.join(appDataDir, "mp4_cleanup_execution_report.md");

  let report = `# Vercel Blob MP4 Cleanup Execution Report\n\n`;
  report += `**Execution Date**: ${new Date().toISOString()}\n`;
  report += `**MP4 Files Deleted**: ${deletedCount}\n`;
  report += `**DB Records Updated**: ${dbUpdatesCount}\n`;
  report += `**Remaining Blob Storage**: ${finalTotalMB} MB (${finalTotalGB} GB)\n`;
  report += `**Remaining MP4 Files**: ${finalMp4Count}\n`;
  report += `**Broken DB media_url Count**: ${brokenUrlsCount}\n\n`;

  report += `### DB Update Verification\n`;
  report += `All deleted MP4 message records had their \`media_url\` column set to \`NULL\` to prevent broken links.\n`;
  report += `Message metadata was updated in column \`${metadataColumn}\` with:\n`;
  report += `* \`media_archived: true\`\n`;
  report += `* \`archive_reason: "blob_mp4_cleanup"\`\n`;
  report += `* \`original_filename\`\n`;
  report += `* \`archived_at\`\n`;

  fs.writeFileSync(reportPath, report);
  console.log(`\nExecution report successfully written to: ${reportPath}`);
}

run();
