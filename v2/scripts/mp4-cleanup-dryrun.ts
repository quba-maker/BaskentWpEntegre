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

  console.log("Connecting to database for MP4 dry-run analysis...");
  const sql = neon(connectionString);

  // 1. Fetch tenants
  let tenantIds: Set<string>;
  try {
    const dbTenants = await sql`SELECT id FROM tenants`;
    tenantIds = new Set(dbTenants.map((t: any) => t.id.toLowerCase()));
  } catch (err: any) {
    console.error("Failed to query tenants:", err.message);
    return;
  }

  // 2. Fetch all blobs
  console.log("Fetching blobs from Vercel Blob store...");
  let allBlobs: any[] = [];
  let hasMore = true;
  let cursor: string | undefined = undefined;

  try {
    while (hasMore) {
      const response: any = await list({
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

  // Filter for MP4 files
  const mp4Blobs = allBlobs.filter(b => 
    b.pathname.toLowerCase().endsWith(".mp4") || 
    (b.contentType && b.contentType.toLowerCase() === "video/mp4")
  );

  console.log(`Found ${mp4Blobs.length} MP4 files out of ${allBlobs.length} total blobs.`);

  // 3. Scan database for MP4 URL references
  console.log("Scanning database for MP4 references...");
  
  // Maps URL to an array of reference objects
  const urlReferences = new Map<string, Array<{ table: string; id: string; field: string; tenantId?: string; details?: any }>>();

  const addReference = (url: string, table: string, id: string, field: string, tenantId?: string, details?: any) => {
    const cleanUrl = url.trim();
    if (!urlReferences.has(cleanUrl)) {
      urlReferences.set(cleanUrl, []);
    }
    urlReferences.get(cleanUrl)!.push({ table, id, field, tenantId, details });
  };

  const scanField = (val: any, table: string, rowId: string, fieldName: string, tenantId?: string) => {
    if (!val) return;
    if (typeof val === 'string') {
      const matches = val.match(/https:\/\/[a-z0-9]+\.public\.blob\.vercel-storage\.com\/[^\s"\']+/gi);
      if (matches) {
        matches.forEach(m => {
          if (m.toLowerCase().includes(".mp4")) {
            addReference(m, table, rowId, fieldName, tenantId);
          }
        });
      }
    } else if (typeof val === 'object') {
      try {
        const str = JSON.stringify(val);
        const matches = str.match(/https:\/\/[a-z0-9]+\.public\.blob\.vercel-storage\.com\/[^\s"\']+/gi);
        if (matches) {
          matches.forEach(m => {
            if (m.toLowerCase().includes(".mp4")) {
              addReference(m, table, rowId, fieldName, tenantId, val);
            }
          });
        }
      } catch (e) {}
    }
  };

  try {
    // A. Scan messages
    const messages = await sql`SELECT id, tenant_id, conversation_id, content, media_url, media_metadata FROM messages`;
    messages.forEach((row: any) => {
      scanField(row.content, "messages", row.id, "content", row.tenant_id);
      scanField(row.media_url, "messages", row.id, "media_url", row.tenant_id);
      scanField(row.media_metadata, "messages", row.id, "media_metadata", row.tenant_id);
    });

    // B. Scan leads
    const leads = await sql`SELECT id, tenant_id, message, raw_data, form_summary FROM leads`;
    leads.forEach((row: any) => {
      scanField(row.message, "leads", row.id, "message", row.tenant_id);
      scanField(row.raw_data, "leads", row.id, "raw_data", row.tenant_id);
      scanField(row.form_summary, "leads", row.id, "form_summary", row.tenant_id);
    });

    // C. Scan conversations
    const conversations = await sql`SELECT id, tenant_id, metadata, notes FROM conversations`;
    conversations.forEach((row: any) => {
      scanField(row.metadata, "conversations", row.id, "metadata", row.tenant_id);
      scanField(row.notes, "conversations", row.id, "notes", row.tenant_id);
    });

    // D. Scan customer profiles
    const customerProfiles = await sql`SELECT id, tenant_id, metadata FROM customer_profiles`;
    customerProfiles.forEach((row: any) => {
      scanField(row.metadata, "customer_profiles", row.id, "metadata", row.tenant_id);
    });

    // E. Scan workflow steps
    const wfSteps = await sql`SELECT id, payload, error_log FROM workflow_steps`;
    wfSteps.forEach((row: any) => {
      scanField(row.payload, "workflow_steps", row.id, "payload");
      scanField(row.error_log, "workflow_steps", row.id, "error_log");
    });

    // F. Scan dead letter jobs
    const dlq = await sql`SELECT id, tenant_id, payload FROM dead_letter_jobs`;
    dlq.forEach((row: any) => {
      scanField(row.payload, "dead_letter_jobs", row.id, "payload", row.tenant_id);
    });

  } catch (err: any) {
    console.error("Database scan failed:", err.message);
    return;
  }

  // 4. Categorize MP4 blobs
  const uuidRegex = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
  
  const deletableCandidates: any[] = [];
  const otherTenantMP4s: any[] = [];
  const referencedCandidates: any[] = [];

  mp4Blobs.forEach(blob => {
    const refs = urlReferences.get(blob.url) || [];
    const isReferenced = refs.length > 0;

    // Tenant isolation check based on path structure: media/${tenantId}/...
    const parts = blob.pathname.split('/');
    let isOtherTenant = false;
    let blobTenantId = "";

    if (parts[0] === 'media' && parts[1]) {
      const potentialId = parts[1].toLowerCase();
      if (uuidRegex.test(potentialId)) {
        blobTenantId = potentialId;
        if (!tenantIds.has(potentialId)) {
          isOtherTenant = true;
        }
      }
    }

    const item = {
      pathname: blob.pathname,
      url: blob.url,
      size: blob.size,
      uploadedAt: blob.uploadedAt,
      isOtherTenant,
      blobTenantId,
      references: refs
    };

    if (isOtherTenant) {
      otherTenantMP4s.push(item);
    } else if (isReferenced) {
      referencedCandidates.push(item);
    } else {
      deletableCandidates.push(item);
    }
  });

  const totalBytes = allBlobs.reduce((sum, b) => sum + b.size, 0);
  const totalMB = (totalBytes / (1024 * 1024)).toFixed(2);

  const mp4Bytes = mp4Blobs.reduce((sum, b) => sum + b.size, 0);
  const mp4MB = (mp4Bytes / (1024 * 1024)).toFixed(2);

  const deletableBytes = deletableCandidates.reduce((sum, b) => sum + b.size, 0);
  const deletableMB = (deletableBytes / (1024 * 1024)).toFixed(2);

  const referencedBytes = referencedCandidates.reduce((sum, b) => sum + b.size, 0);
  const referencedMB = (referencedBytes / (1024 * 1024)).toFixed(2);

  const otherTenantBytes = otherTenantMP4s.reduce((sum, b) => sum + b.size, 0);
  const otherTenantMB = (otherTenantBytes / (1024 * 1024)).toFixed(2);

  console.log(`\n=== MP4 DRY-RUN ANALYSIS ===`);
  console.log(`Total Blob Storage: ${totalMB} MB`);
  console.log(`Total MP4 Storage: ${mp4MB} MB`);
  console.log(`- Orphan MP4 Candidates (Same Tenant, Unreferenced): ${deletableCandidates.length} files (${deletableMB} MB)`);
  console.log(`- Referenced MP4 Candidates (Same Tenant, Referenced in DB): ${referencedCandidates.length} files (${referencedMB} MB)`);
  console.log(`- Other Tenant MP4s (Tenant Isolation Excluded): ${otherTenantMP4s.length} files (${otherTenantMB} MB)`);

  // Write markdown report
  const appDataDir = process.env.GEMINI_APP_DATA_DIR || path.join(__dirname, "../..");
  const reportPath = path.join(appDataDir, "mp4_cleanup_dryrun_report.md");

  let report = `# Vercel Blob MP4 Cleanup Dry-Run Report\n\n`;
  report += `**Date**: ${new Date().toISOString()}\n`;
  report += `**Total Blob Storage**: ${totalMB} MB\n`;
  report += `**Total MP4 Storage**: ${mp4MB} MB (${mp4Blobs.length} files)\n\n`;

  report += `### Summary\n`;
  report += `* **Orphan MP4 Candidates (Safe to delete)**: ${deletableCandidates.length} files (${deletableMB} MB)\n`;
  report += `* **Referenced MP4 Candidates (Needs DB updates before deleting)**: ${referencedCandidates.length} files (${referencedMB} MB)\n`;
  report += `* **Other Tenant MP4s (Excluded for isolation)**: ${otherTenantMP4s.length} files (${otherTenantMB} MB)\n\n`;

  report += `### 1. Orphan MP4 Candidates (Safe to Delete)\n\n`;
  if (deletableCandidates.length === 0) {
    report += `No orphan MP4 candidates found.\n`;
  } else {
    report += `| # | Pathname | Size (MB) | Uploaded At |\n`;
    report += `|---|----------|-----------|-------------|\n`;
    deletableCandidates.forEach((b, i) => {
      report += `| ${i + 1} | \`${b.pathname}\` | ${(b.size / (1024 * 1024)).toFixed(2)} | ${b.uploadedAt} |\n`;
    });
  }

  report += `\n### 2. Referenced MP4 Candidates (Requires DB updates)\n\n`;
  if (referencedCandidates.length === 0) {
    report += `No referenced MP4 candidates found.\n`;
  } else {
    report += `| # | Pathname | Size (MB) | DB References |\n`;
    report += `|---|----------|-----------|---------------|\n`;
    referencedCandidates.forEach((b, i) => {
      const refStr = b.references.map((r: any) => `${r.table}.${r.field} (ID: ${r.id})`).join(", ");
      report += `| ${i + 1} | \`${b.pathname}\` | ${(b.size / (1024 * 1024)).toFixed(2)} | ${refStr} |\n`;
    });
  }

  report += `\n### 3. Other Tenant MP4s (Safety Excluded)\n\n`;
  if (otherTenantMP4s.length === 0) {
    report += `No other tenant MP4s found.\n`;
  } else {
    report += `| # | Pathname | Size (MB) | Tenant ID |\n`;
    report += `|---|----------|-----------|-----------|\n`;
    otherTenantMP4s.forEach((b, i) => {
      report += `| ${i + 1} | \`${b.pathname}\` | ${(b.size / (1024 * 1024)).toFixed(2)} | \`${b.blobTenantId}\` |\n`;
    });
  }

  fs.writeFileSync(reportPath, report);
  console.log(`\nDry-run report successfully written to: ${reportPath}`);
}

run();
