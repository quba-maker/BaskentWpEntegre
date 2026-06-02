import dotenv from "dotenv";
dotenv.config({ path: "./.env.local" });

import { withTenantDB } from "../src/lib/core/tenant-db";
import { decryptPayload } from "../src/lib/core/encryption";
import { getProviderAliases } from "../src/lib/core/provider-aliases";

// Secure mask helper
function maskMediaId(id: string): string {
  if (!id) return "N/A";
  if (id.length < 8) return "***";
  return `${id.substring(0, 4)}***${id.substring(id.length - 4)}`;
}

async function main() {
  const tenantId = "caab9ea1-9591-45e4-bbc5-9c9b498982c8";
  const adminDb = withTenantDB(tenantId, true);
  
  console.log("🛠️  DIAGNOSING 360DIALOG MEDIA RETRIEVAL...");

  // 1. Resolve V2 credentials
  const providerAliases = getProviderAliases("whatsapp");
  const v2Results = await adminDb.executeSafe({
    text: `
      SELECT ci.credentials_encrypted, c.identifier, c.id as channel_id, c.provider
      FROM channels c
      JOIN channel_groups cg ON c.group_id = cg.id
      LEFT JOIN channel_integrations ci ON ci.channel_id = c.id
      WHERE cg.tenant_id = $1 
        AND c.provider = ANY($2::text[])
        AND c.status = 'active'
      LIMIT 1
    `,
    values: [tenantId, providerAliases]
  }) as any[];

  if (!v2Results || v2Results.length === 0) {
    console.error("❌ No V2 active channel credentials found!");
    return;
  }

  const row = v2Results[0];
  let accessToken = null;

  if (row.credentials_encrypted) {
    try {
      const parsed = JSON.parse(row.credentials_encrypted);
      if (parsed.encrypted_payload && parsed.version) {
        const decrypted = decryptPayload(parsed);
        accessToken = decrypted.access_token || decrypted.accessToken || decrypted.page_token || null;
      } else if (parsed.accessToken) {
        accessToken = parsed.accessToken;
      }
    } catch (e) {
      accessToken = row.credentials_encrypted;
    }
  }

  // Override via fallback if coexistence is active
  const coexistenceActive = process.env.ENABLE_360DIALOG_COEXISTENCE === "true" || true; // Force local diagnostics
  const fallbackKey = process.env.THREE_SIXTY_DIALOG_API_KEY_FALLBACK;
  const tokenToUse = (coexistenceActive && fallbackKey) ? fallbackKey : accessToken;

  console.log(`\n🔑 Key Resolution Info:`);
  console.log(`  - DB Encrypted Token Found: ${!!accessToken}`);
  console.log(`  - Coexistence Fallback Key Env Found: ${!!fallbackKey}`);
  console.log(`  - Active Token Length: ${tokenToUse ? tokenToUse.length : 0}`);
  
  const testMedias = [
    { type: "image", id: "1530552228450484" },
    { type: "document", id: "1936910473677078" },
    { type: "audio", id: "1617440589356402" }
  ];

  for (const m of testMedias) {
    const masked = maskMediaId(m.id);
    console.log(`\n------------------------------------------------`);
    console.log(`🔍 DIAGNOSING MEDIA ID: ${masked} [${m.type.toUpperCase()}]`);
    console.log(`------------------------------------------------`);

    // Step 1: Metadata Resolve
    const metadataUrl = `https://waba-v2.360dialog.io/${m.id}`;
    console.log(`[STAGE 1] Resolving metadata via: ${metadataUrl}`);
    
    let resolvedUrl = "";
    try {
      const res = await fetch(metadataUrl, {
        headers: { "D360-API-KEY": tokenToUse.trim() }
      });
      console.log(`  - Response Status: ${res.status} ${res.statusText}`);
      const bodyText = await res.text();
      console.log(`  - Response Body: ${bodyText}`);
      
      if (res.ok) {
        const parsed = JSON.parse(bodyText);
        resolvedUrl = parsed.url;
      }
    } catch (err: any) {
      console.error(`  - Stage 1 Fetch Failed:`, err.message);
    }

    if (!resolvedUrl) {
      console.log(`❌ Stage 1 Metadata Resolve failed for ID: ${masked}`);
      continue;
    }

    // Step 2: Binary Download
    console.log(`\n[STAGE 2] Downloading binary from CDN...`);
    const headers: Record<string, string> = {};
    if (resolvedUrl.includes("360dialog.io")) {
      headers["D360-API-KEY"] = tokenToUse;
      console.log(`  - Header: Scoped D360-API-KEY`);
    } else if (resolvedUrl.includes("facebook.com") || resolvedUrl.includes("fbsbx.com")) {
      const metaToken = process.env.META_ACCESS_TOKEN || tokenToUse;
      headers["Authorization"] = `Bearer ${metaToken}`;
      console.log(`  - Header: Authorization Bearer (Meta Token Fallback)`);
    }

    try {
      const fileRes = await fetch(resolvedUrl, { headers });
      console.log(`  - CDN Response Status: ${fileRes.status} ${fileRes.statusText}`);
      console.log(`  - CDN Content-Length: ${fileRes.headers.get("content-length")}`);
      console.log(`  - CDN Content-Type: ${fileRes.headers.get("content-type")}`);
      
      if (fileRes.ok) {
        const buffer = await fileRes.arrayBuffer();
        console.log(`  ✅ SUCCESS! Binary downloaded successfully. Byte length: ${buffer.byteLength}`);
      } else {
        const errText = await fileRes.text();
        console.error(`  ❌ FAILED to download binary:`, errText.substring(0, 300));
      }
    } catch (err: any) {
      console.error(`  - Stage 2 Fetch Failed:`, err.message);
    }
  }
}

main().catch(console.error);
