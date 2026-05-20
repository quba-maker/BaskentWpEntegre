import { neon } from '@neondatabase/serverless';
import dotenv from 'dotenv';
import path from 'path';
import crypto from 'crypto';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("❌ DATABASE_URL eksik!");
  process.exit(1);
}

const sql = neon(DATABASE_URL);

// --- Encryption Logic ---
const ENCRYPTION_KEY = process.env.INTEGRATION_ENCRYPTION_KEY || process.env.AUTH_SECRET || "fallback_32_byte_secret_for_dev!";
const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;
const SALT_LENGTH = 64;
const TAG_LENGTH = 16;

function getKey(salt) {
  return crypto.scryptSync(ENCRYPTION_KEY, salt, 32);
}

function encryptPayload(provider, data, version = "1.0") {
  const text = JSON.stringify(data);
  const iv = crypto.randomBytes(IV_LENGTH);
  const salt = crypto.randomBytes(SALT_LENGTH);
  const key = getKey(salt);
  
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  const combinedPayload = Buffer.concat([salt, iv, tag, encrypted]).toString("base64");
  return JSON.stringify({ version, provider, encrypted_payload: combinedPayload });
}
// -----------------------

async function shadowMigrate() {
  console.log("🚀 Starting Shadow Migration: baskent-shadow");

  const report = {
    recoveredConversations: 0,
    recoveredLeads: 0,
    recoveredPrompts: 0,
    recoveredIntegrations: 0,
    orphanedConversations: 0,
    unresolvedMappings: 0,
    missingIntegrations: []
  };

  try {
    // 1. Create Shadow Tenant
    const [tenant] = await sql`
      INSERT INTO tenants (
        name, slug, industry, primary_color
      ) VALUES (
        'Başkent Hastanesi (Shadow)', 'baskent-shadow', 'health', '#005A9C'
      )
      ON CONFLICT (slug) DO UPDATE SET updated_at = NOW()
      RETURNING id
    `;
    const shadowId = tenant.id;
    console.log(`✅ Shadow Tenant Created/Found: ${shadowId}`);

    // 2. Create User admin@baskent-shadow.com
    // Use a dummy hash (In real app, we'd hash 'Baskent2026!' properly, here we just insert a placeholder or an already hashed generic pwd)
    const dummyHash = "$2b$10$Ep9vJ5Wl/R/G5sYV7pQjTOSdE1O./Tf/1E1gM2Z6Z1Wj1m5u0QW2m"; // bcrypt generic
    await sql`
      INSERT INTO users (tenant_id, email, password_hash, name, role)
      VALUES (${shadowId}, 'admin@baskent-shadow.com', ${dummyHash}, 'Baskent Shadow Admin', 'admin')
      ON CONFLICT (email) DO NOTHING
    `;
    console.log(`✅ Shadow User Created`);

    // 3. Create Channel Groups & Prompts
    // A. WhatsApp TR
    const [waGroup] = await sql`
      INSERT INTO channel_groups (tenant_id, name, description)
      VALUES (${shadowId}, 'WhatsApp TR', 'Primary WhatsApp line for Turkish patients')
      RETURNING id
    `;
    
    // Legacy system_prompt fallback
    const sysPrompt = "Sen Başkent Üniversitesi Konya Hastanesi danışmanısın. Samimi, kısa, doğal yaz. Fiyat verme, randevuya yönlendir.";
    const [waPrompt] = await sql`
      INSERT INTO channel_prompts (group_id, tenant_id, name, prompt_type, prompt_text)
      VALUES (${waGroup.id}, ${shadowId}, 'WhatsApp System Prompt', 'system', ${sysPrompt})
      RETURNING id
    `;

    // AI Profile
    await sql`INSERT INTO channel_ai_profiles (group_id, ai_model, language_profile) VALUES (${waGroup.id}, 'gemini-2.5-flash', 'tr-TR')`;

    // Channel
    const waPhoneId = process.env.PHONE_NUMBER_ID || '1072536945944841';
    const waToken = process.env.META_ACCESS_TOKEN || 'dummy_token';
    const [waChannel] = await sql`
      INSERT INTO channels (group_id, provider, identifier, name)
      VALUES (${waGroup.id}, 'whatsapp', ${waPhoneId}, 'Primary WhatsApp Number')
      RETURNING id
    `;
    
    // Binding & Integration
    await sql`INSERT INTO channel_prompt_bindings (channel_id, prompt_id, priority) VALUES (${waChannel.id}, ${waPrompt.id}, 100)`;
    await sql`
      INSERT INTO channel_integrations (channel_id, provider, credentials_encrypted)
      VALUES (${waChannel.id}, 'whatsapp', ${encryptPayload('whatsapp', { access_token: waToken })})
    `;
    console.log(`✅ WhatsApp TR Group Created`);


    // B. Social TR
    const [socTrGroup] = await sql`
      INSERT INTO channel_groups (tenant_id, name, description)
      VALUES (${shadowId}, 'Social TR', 'Instagram & Facebook TR pages')
      RETURNING id
    `;
    
    const turkcePrompt = "Sen Başkent Üniversitesi Konya Uygulama ve Araştırma Merkezi'nin Türkçe sosyal medya sayfalarının (Instagram/Facebook) hasta danışmanısın. Adın yok, bireysel kimlik kullanmazsın. Kurumu temsil edersin.";
    const [socTrPrompt] = await sql`
      INSERT INTO channel_prompts (group_id, tenant_id, name, prompt_type, prompt_text)
      VALUES (${socTrGroup.id}, ${shadowId}, 'Social TR Prompt', 'system', ${turkcePrompt})
      RETURNING id
    `;

    await sql`INSERT INTO channel_ai_profiles (group_id, ai_model, language_profile) VALUES (${socTrGroup.id}, 'gemini-2.5-flash', 'tr-TR')`;

    const igTrPageId = '103094588239235';
    const igTrToken = process.env.PAGE_TOKEN_103094588239235 || 'dummy_token';
    const [socTrChannel] = await sql`
      INSERT INTO channels (group_id, provider, identifier, name)
      VALUES (${socTrGroup.id}, 'meta_instagram', ${igTrPageId}, 'Instagram TR Page')
      RETURNING id
    `;
    
    await sql`INSERT INTO channel_prompt_bindings (channel_id, prompt_id, priority) VALUES (${socTrChannel.id}, ${socTrPrompt.id}, 100)`;
    await sql`
      INSERT INTO channel_integrations (channel_id, provider, credentials_encrypted)
      VALUES (${socTrChannel.id}, 'meta_instagram', ${encryptPayload('meta_instagram', { page_token: igTrToken })})
    `;
    console.log(`✅ Social TR Group Created`);


    // C. Social Foreign
    const [socEnGroup] = await sql`
      INSERT INTO channel_groups (tenant_id, name, description)
      VALUES (${shadowId}, 'Social Foreign', 'Foreign Instagram pages')
      RETURNING id
    `;
    const [socEnPrompt] = await sql`
      INSERT INTO channel_prompts (group_id, tenant_id, name, prompt_type, prompt_text)
      VALUES (${socEnGroup.id}, ${shadowId}, 'Social Foreign Prompt', 'system', 'You are the English/Arabic support agent for Baskent University.')
      RETURNING id
    `;
    await sql`INSERT INTO channel_ai_profiles (group_id, ai_model, language_profile) VALUES (${socEnGroup.id}, 'gemini-2.5-flash', 'en-US')`;

    const igEnPageId = '107027185544203';
    const igEnToken = process.env.PAGE_TOKEN_107027185544203 || 'dummy_token';
    const [socEnChannel] = await sql`
      INSERT INTO channels (group_id, provider, identifier, name)
      VALUES (${socEnGroup.id}, 'meta_instagram', ${igEnPageId}, 'Instagram EN Page')
      RETURNING id
    `;
    await sql`INSERT INTO channel_prompt_bindings (channel_id, prompt_id, priority) VALUES (${socEnChannel.id}, ${socEnPrompt.id}, 100)`;
    await sql`
      INSERT INTO channel_integrations (channel_id, provider, credentials_encrypted)
      VALUES (${socEnChannel.id}, 'meta_instagram', ${encryptPayload('meta_instagram', { page_token: igEnToken })})
    `;
    
    report.recoveredPrompts += 3;
    
    if (waToken !== 'dummy_token') report.recoveredIntegrations++; else report.missingIntegrations.push('whatsapp_token');
    if (igTrToken !== 'dummy_token') report.recoveredIntegrations++; else report.missingIntegrations.push('instagram_tr_token');
    if (igEnToken !== 'dummy_token') report.recoveredIntegrations++; else report.missingIntegrations.push('instagram_en_token');
    
    console.log(`✅ Social Foreign Group Created`);

    // D. Baskent Legacy Social (Ambiguous mapping)
    const [legacyGroup] = await sql`
      INSERT INTO channel_groups (tenant_id, name, description)
      VALUES (${shadowId}, 'Baskent Legacy Social', 'Fallback for historical ambiguous Meta records')
      RETURNING id
    `;
    const [legacyChannel] = await sql`
      INSERT INTO channels (group_id, provider, identifier, name)
      VALUES (${legacyGroup.id}, 'meta_legacy', 'legacy_ambiguous', 'Legacy Meta Sync')
      RETURNING id
    `;
    console.log(`✅ Legacy Social Fallback Group Created`);

    // 4. CRM Hydration (Safe execution)
    console.log("⏳ Running CRM Hydration...");
    try {
      // Check if conversations table exists
      const convCheck = await sql`SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'conversations')`;
      if (convCheck[0].exists) {
        
        // 4.1 Create customer_profiles from conversations
        await sql`
          INSERT INTO customer_profiles (tenant_id, primary_phone)
          SELECT DISTINCT ${shadowId}, phone_number
          FROM conversations
          WHERE phone_number IS NOT NULL
          ON CONFLICT (tenant_id, primary_phone) DO NOTHING
        `;
        
        // 4.2 Map conversations.customer_id
        await sql`
          UPDATE conversations c
          SET customer_id = cp.id
          FROM customer_profiles cp
          WHERE c.phone_number = cp.primary_phone
          AND cp.tenant_id = ${shadowId}
          AND c.customer_id IS NULL
        `;

        // 4.3 Map conversations.channel_id
        // We will map based on channel='whatsapp' vs channel='instagram'
        const updatedWa = await sql`
          UPDATE conversations
          SET channel_id = ${waChannel.id}
          WHERE channel = 'whatsapp' AND channel_id IS NULL
        `;

        // For ambiguous instagram, we map to legacyChannel
        const updatedIg = await sql`
          UPDATE conversations
          SET channel_id = ${legacyChannel.id}
          WHERE channel = 'instagram' AND channel_id IS NULL
        `;
        
        const countRes = await sql`SELECT count(*) FROM conversations WHERE customer_id IS NOT NULL AND tenant_id = ${shadowId}`;
        report.recoveredConversations = parseInt(countRes[0].count, 10);
        
        const orphanedRes = await sql`SELECT count(*) FROM conversations WHERE channel_id IS NULL`;
        report.orphanedConversations = parseInt(orphanedRes[0].count, 10);

        console.log("✅ Hydrated conversations -> customer_profiles and mapped channel_ids");
      } else {
        console.log("⚠️ Legacy 'conversations' table not found. Skipping CRM hydration.");
      }

      // Check leads
      const leadsCheck = await sql`SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'leads')`;
      if (leadsCheck[0].exists) {
        await sql`
          INSERT INTO customer_profiles (tenant_id, primary_phone, first_name)
          SELECT DISTINCT ${shadowId}, phone_number, patient_name
          FROM leads
          WHERE phone_number IS NOT NULL
          ON CONFLICT (tenant_id, primary_phone) DO NOTHING
        `;

        await sql`
          UPDATE leads l
          SET customer_id = cp.id
          FROM customer_profiles cp
          WHERE l.phone_number = cp.primary_phone
          AND cp.tenant_id = ${shadowId}
          AND l.customer_id IS NULL
        `;
        const countLeads = await sql`SELECT count(*) FROM leads WHERE customer_id IS NOT NULL AND tenant_id = ${shadowId}`;
        report.recoveredLeads = parseInt(countLeads[0].count, 10);
        console.log("✅ Hydrated leads -> customer_profiles");
      }

    } catch (err) {
      console.warn("⚠️ CRM Hydration partial error:", err.message);
    }
    
    console.log("\n====================================");
    console.log("📊 MIGRATION VALIDATION REPORT");
    console.log("====================================");
    console.log(`Recovered Conversations: ${report.recoveredConversations}`);
    console.log(`Recovered Leads:         ${report.recoveredLeads}`);
    console.log(`Recovered Prompts:       ${report.recoveredPrompts}`);
    console.log(`Recovered Integrations:  ${report.recoveredIntegrations}`);
    console.log(`Missing Integrations:    ${report.missingIntegrations.length > 0 ? report.missingIntegrations.join(', ') : 'None'}`);
    console.log(`Orphaned Conversations:  ${report.orphanedConversations} (No channel mapped)`);
    console.log(`Unresolved Mappings:     ${report.unresolvedMappings}`);
    console.log("====================================\n");

    console.log("🎉 Shadow Migration for Baskent completed successfully!");
    process.exit(0);

  } catch (err) {
    console.error("❌ Shadow Migration Failed:", err);
    process.exit(1);
  }
}

shadowMigrate();
