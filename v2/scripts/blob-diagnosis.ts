import { list } from "@vercel/blob";
import { neon } from "@neondatabase/serverless";
import * as dotenv from "dotenv";
import * as path from "path";
import * as fs from "fs";

// Load local environment variables
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

async function run() {
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

  console.log("Connecting to database using process.env.DATABASE_URL...");
  const sql = neon(connectionString);

  // 1. Fetch all tenant IDs to verify tenant scope
  console.log("Fetching tenant list for isolation check...");
  let tenantIds: Set<string>;
  try {
    const dbTenants = await sql`SELECT id FROM tenants`;
    tenantIds = new Set(dbTenants.map((t: any) => t.id.toLowerCase()));
    console.log(`Found ${tenantIds.size} tenants in the database.`);
  } catch (err: any) {
    console.error("Failed to query tenants table:", err.message);
    return;
  }

  // 2. Fetch blobs from Vercel Blob store
  console.log("Fetching blobs from Vercel Blob store...");
  let allBlobs: any[] = [];
  let hasMore = true;
  let cursor: string | undefined = undefined;

  try {
    while (hasMore) {
      const res: any = await list({
        token,
        cursor,
        limit: 1000
      });
      allBlobs = allBlobs.concat(res.blobs);
      hasMore = res.hasMore;
      cursor = res.cursor;
    }
  } catch (err: any) {
    console.error("Failed to fetch blobs from Vercel Blob store:", err.message);
    return;
  }

  const totalBytes = allBlobs.reduce((sum, b) => sum + b.size, 0);
  const totalMB = (totalBytes / (1024 * 1024)).toFixed(2);
  console.log(`\nTotal Blobs: ${allBlobs.length}`);
  console.log(`Total Size: ${totalMB} MB (${(totalBytes / (1024 * 1024 * 1024)).toFixed(3)} GB)`);

  // 3. Scan DB for references in all potential media/metadata columns
  console.log("\nScanning database tables for media and metadata references...");
  const referencedUrls = new Set<string>();

  const extractBlobUrls = (val: any) => {
    if (!val) return;
    if (typeof val === 'string') {
      const matches = val.match(/https:\/\/[a-z0-9]+\.public\.blob\.vercel-storage\.com\/[^\s"\']+/gi);
      if (matches) {
        matches.forEach(m => referencedUrls.add(m.trim()));
      }
    } else if (typeof val === 'object') {
      try {
        const str = JSON.stringify(val);
        const matches = str.match(/https:\/\/[a-z0-9]+\.public\.blob\.vercel-storage\.com\/[^\s"\']+/gi);
        if (matches) {
          matches.forEach(m => referencedUrls.add(m.trim()));
        }
      } catch (e) {
        // ignore serialization errors
      }
    }
  };

  // Run queries in parallel/sequence to collect references
  try {
    // messages (content, media_url, media_metadata)
    const messagesData = await sql`SELECT content, media_url, media_metadata FROM messages`;
    messagesData.forEach((row: any) => {
      extractBlobUrls(row.content);
      extractBlobUrls(row.media_url);
      extractBlobUrls(row.media_metadata);
    });

    // leads (message, raw_data, form_summary)
    const leadsData = await sql`SELECT message, raw_data, form_summary FROM leads`;
    leadsData.forEach((row: any) => {
      extractBlobUrls(row.message);
      extractBlobUrls(row.raw_data);
      extractBlobUrls(row.form_summary);
    });

    // conversations (metadata, notes)
    const convData = await sql`SELECT metadata, notes FROM conversations`;
    convData.forEach((row: any) => {
      extractBlobUrls(row.metadata);
      extractBlobUrls(row.notes);
    });

    // customer_profiles (metadata)
    const customerData = await sql`SELECT metadata FROM customer_profiles`;
    customerData.forEach((row: any) => {
      extractBlobUrls(row.metadata);
    });

    // channel_prompts (prompt_text, metadata)
    const promptData = await sql`SELECT prompt_text, metadata FROM channel_prompts`;
    promptData.forEach((row: any) => {
      extractBlobUrls(row.prompt_text);
      extractBlobUrls(row.metadata);
    });

    // workflow_runs (error_details)
    const wfRunsData = await sql`SELECT error_details FROM workflow_runs`;
    wfRunsData.forEach((row: any) => {
      extractBlobUrls(row.error_details);
    });

    // workflow_steps (payload, error_log)
    const wfStepsData = await sql`SELECT payload, error_log FROM workflow_steps`;
    wfStepsData.forEach((row: any) => {
      extractBlobUrls(row.payload);
      extractBlobUrls(row.error_log);
    });

    // channel_events (payload)
    const channelEventsData = await sql`SELECT payload FROM channel_events`;
    channelEventsData.forEach((row: any) => {
      extractBlobUrls(row.payload);
    });

    // pipeline_events (payload)
    const pipelineEventsData = await sql`SELECT payload FROM pipeline_events`;
    pipelineEventsData.forEach((row: any) => {
      extractBlobUrls(row.payload);
    });

    // dead_letter_jobs (payload)
    const dlqData = await sql`SELECT payload FROM dead_letter_jobs`;
    dlqData.forEach((row: any) => {
      extractBlobUrls(row.payload);
    });

    console.log(`Scan complete. Unique referenced URLs found in DB: ${referencedUrls.size}`);
  } catch (err: any) {
    console.error("Error scanning database tables:", err.message);
    return;
  }

  // 4. Identify orphans and apply safety filters (date and tenant isolation)
  const uuidRegex = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - 14); // 14 days ago (7-14 days safety threshold)

  const orphanCandidates: any[] = [];
  const activeBlobs: any[] = [];
  const otherTenantBlobs: any[] = [];
  const newBlobs: any[] = [];

  allBlobs.forEach(blob => {
    // Check if it's referenced in DB
    const isReferenced = referencedUrls.has(blob.url);

    // Parse tenant ID from path to prevent cross-tenant violations in shared storage
    const pathMatch = blob.pathname.match(uuidRegex);
    let isOtherTenant = false;
    if (pathMatch) {
      const blobTenantId = pathMatch[0].toLowerCase();
      if (!tenantIds.has(blobTenantId)) {
        isOtherTenant = true;
      }
    }

    // Check upload age
    const uploadTime = new Date(blob.uploadedAt);
    const isNew = uploadTime > cutoffDate;

    if (isReferenced) {
      activeBlobs.push(blob);
    } else if (isOtherTenant) {
      otherTenantBlobs.push(blob);
    } else if (isNew) {
      newBlobs.push(blob);
    } else {
      orphanCandidates.push(blob);
    }
  });

  const orphanBytes = orphanCandidates.reduce((sum, b) => sum + b.size, 0);
  const orphanMB = (orphanBytes / (1024 * 1024)).toFixed(2);

  const newBlobsBytes = newBlobs.reduce((sum, b) => sum + b.size, 0);
  const newBlobsMB = (newBlobsBytes / (1024 * 1024)).toFixed(2);

  const otherTenantBytes = otherTenantBlobs.reduce((sum, b) => sum + b.size, 0);
  const otherTenantMB = (otherTenantBytes / (1024 * 1024)).toFixed(2);

  console.log(`\n=== DRY-RUN DIAGNOSTIC SUMMARY ===`);
  console.log(`Orphan Candidates (Older than 14 days, same tenant, unreferenced): ${orphanCandidates.length} files (${orphanMB} MB)`);
  console.log(`New Unreferenced Blobs (Less than 14 days old, safety excluded): ${newBlobs.length} files (${newBlobsMB} MB)`);
  console.log(`Other Tenant Blobs (UUID mismatch, isolation excluded): ${otherTenantBlobs.length} files (${otherTenantMB} MB)`);
  console.log(`Active Blobs (Referenced in DB): ${activeBlobs.length} files`);

  // Sort by size desc
  const sortedBlobs = [...allBlobs].sort((a, b) => b.size - a.size);
  const sortedOrphans = [...orphanCandidates].sort((a, b) => b.size - a.size);

  // 5. Generate markdown report
  const appDataDir = process.env.GEMINI_APP_DATA_DIR || path.join(__dirname, "../..");
  const reportPath = path.join(appDataDir, "blob_diagnosis_report.md");
  
  let reportContent = `# Vercel Blob Storage Diagnosis Report (Dry-Run)\n\n`;
  reportContent += `**Date of Diagnosis**: ${new Date().toISOString()}\n`;
  reportContent += `**Total Blobs**: ${allBlobs.length}\n`;
  reportContent += `**Total Size**: ${totalMB} MB (${(totalBytes / (1024 * 1024 * 1024)).toFixed(3)} GB)\n\n`;
  
  reportContent += `### Categories Breakdown\n`;
  reportContent += `* **Active Blobs (Referenced in DB)**: ${activeBlobs.length} files\n`;
  reportContent += `* **Orphan Candidates (Older than 14 days, safe to delete)**: ${orphanCandidates.length} files (${orphanMB} MB)\n`;
  reportContent += `* **New Blobs (Safety Excluded, < 14 days old)**: ${newBlobs.length} files (${newBlobsMB} MB)\n`;
  reportContent += `* **Other Tenant Blobs (Tenant Isolation Excluded)**: ${otherTenantBlobs.length} files (${otherTenantMB} MB)\n\n`;

  reportContent += `## Top 20 Largest Blobs\n\n`;
  reportContent += `| # | Pathname | Size (MB) | Uploaded At |\n`;
  reportContent += `|---|----------|-----------|-------------|\n`;
  sortedBlobs.slice(0, 20).forEach((b, i) => {
    reportContent += `| ${i + 1} | \`${b.pathname}\` | ${(b.size / (1024 * 1024)).toFixed(2)} | ${b.uploadedAt} |\n`;
  });

  reportContent += `\n## Orphan Candidates for Deletion (Dry-Run)\n\n`;
  reportContent += `| # | Pathname | Size (MB) | Uploaded At |\n`;
  reportContent += `|---|----------|-----------|-------------|\n`;
  sortedOrphans.slice(0, 50).forEach((b, i) => {
    reportContent += `| ${i + 1} | \`${b.pathname}\` | ${(b.size / (1024 * 1024)).toFixed(2)} | ${b.uploadedAt} |\n`;
  });

  try {
    fs.writeFileSync(reportPath, reportContent);
    console.log(`\nReport successfully written to: ${reportPath}`);
  } catch (err: any) {
    console.error("Failed to write diagnostic report:", err.message);
  }
}

run();
