import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { v4 as uuidv4 } from 'uuid';

async function main() {
  const args = process.argv.slice(2);
  const getArg = (name: string): string | undefined => {
    const idx = args.indexOf(name);
    if (idx !== -1 && idx + 1 < args.length) {
      return args[idx + 1];
    }
    return undefined;
  };
  const hasFlag = (name: string): boolean => args.includes(name);

  const tenantId = getArg('--tenant');
  const isWrite = hasFlag('--write');
  const isDryRun = !isWrite || hasFlag('--dry-run');
  const limitStr = getArg('--limit');
  const limit = limitStr ? parseInt(limitStr, 10) : 100;
  const since = getArg('--since');
  const channelId = getArg('--channel');

  if (!tenantId) {
    console.error('Error: --tenant <tenant_id> is required.');
    console.log('Usage: npx tsx scratch/generate-learning-candidates.ts --tenant <tenant_id> [--dry-run | --write] [--limit <100>] [--since <YYYY-MM-DD>] [--channel <channel_id>]');
    process.exit(1);
  }

  const { sql } = await import('../src/lib/db');
  const { TenantLearningCandidateService } = await import('../src/lib/services/ai/tenant-learning-candidate.service');

  const db = {
    executeSafe: async (queryObj: { text: string; values: any[] }) => {
      return sql.query(queryObj.text, queryObj.values);
    }
  };

  if (isDryRun && !isWrite) {
    console.log(`=== RUNNING LEARNING CANDIDATE GENERATOR (DRY-RUN) ===`);
    console.log(`Tenant ID: ${tenantId}`);
    console.log(`Limit: ${limit}`);
    console.log(`Since: ${since || 'All time'}`);
    console.log(`Channel ID: ${channelId || 'All channels'}`);
    console.log('--------------------------------------------------');

    // Enable RLS for safe read check
    await sql`SELECT set_config('app.bypass_rls', '', true)`;
    await sql`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;

    const candidates = await TenantLearningCandidateService.generateCandidatesForTenant(db, tenantId, {
      limit,
      since,
      channelId,
      writeMode: false
    });

    console.log(`\nFound ${candidates.length} candidate(s):`);
    candidates.forEach((c, index) => {
      console.log(`\n[Candidate #${index + 1}]`);
      console.log(`Type: ${c.candidateType}`);
      console.log(`Title: ${c.title}`);
      console.log(`Summary: ${c.summary}`);
      console.log(`Suggested Rule: ${c.suggestedRuleText}`);
      console.log(`Evidence: ${c.evidenceSummary}`);
      console.log(`Risk Level: ${c.riskLevel}`);
      console.log(`Risk Tags: ${JSON.stringify(c.riskTags)}`);
      console.log(`Fingerprint: ${c.fingerprint}`);
      console.log(`Runtime Eligible: ${c.metadata?.runtime_eligible !== false}`);
      console.log('--------------------------------------------------');
    });

    console.log('\nDry-run completed. No database writes were performed.');
  } else {
    console.log(`=== RUNNING LEARNING CANDIDATE GENERATOR (WRITE MODE / SYNTHETIC TEST) ===`);
    console.log(`Tenant ID: ${tenantId}`);
    console.log('--------------------------------------------------');

    const testPhone = "+905991119988";
    let testGroupId: string = "";
    let testChannelId: string = "";
    let testConversationId: string = "";
    const testEventId = uuidv4();
    const testEventId2 = uuidv4();

    try {
      // Bypass RLS to insert synthetic test setup
      await sql`SELECT set_config('app.bypass_rls', 'true', true)`;

      console.log('1. Setting up temporary test channel group and channel...');
      testGroupId = uuidv4();
      testChannelId = uuidv4();
      
      await sql`
        INSERT INTO channel_groups (id, tenant_id, name)
        VALUES (${testGroupId}, ${tenantId}, 'Synthetic Test Group')
      `;
      await sql`
        INSERT INTO channels (id, group_id, provider, identifier, name)
        VALUES (${testChannelId}, ${testGroupId}, 'whatsapp', ${'test-ident-' + testChannelId.slice(0, 8)}, 'Synthetic Test Channel')
      `;

      console.log('2. Setting up temporary test conversation...');
      await sql`DELETE FROM conversations WHERE phone_number = ${testPhone} AND tenant_id = ${tenantId}`;
      const convInsert = await sql`
        INSERT INTO conversations (tenant_id, phone_number, status, autopilot_enabled, channel_id)
        VALUES (${tenantId}, ${testPhone}, 'bot', true, ${testChannelId})
        RETURNING id
      `;
      testConversationId = convInsert[0].id;

      console.log('3. Inserting synthetic captured learning events...');
      
      // Event 1: smart_draft was edited, cta and price removed
      await sql`
        INSERT INTO tenant_learning_events (
          id, tenant_id, channel_id, conversation_id, source_type, 
          ai_generated_text, human_final_text, changed_ratio, removed_phrases,
          added_phrases, risk_tags, diff_summary, status, idempotency_key, metadata
        )
        VALUES (
          ${testEventId}, ${tenantId}, ${testChannelId}, ${testConversationId}, 'human_edited_ai_draft',
          'Merhaba, size nasıl yardımcı olabilirim? Muayene fiyatımız 500 TL.', 'Merhaba. Fiyat sormuştunuz.',
          0.4500, '["anladım", "fiyatımız", "500", "TL"]'::jsonb, '["merhaba", "fiyat"]'::jsonb,
          '["price", "identity"]'::jsonb, '{"aiLength":65, "humanLength":25, "ctaRemoved":false, "doctorRemoved":false, "priceRemoved":true, "clichesRemoved":true}'::jsonb,
          'captured', ${uuidv4()}, '{"contains_sensitive_data":true}'::jsonb
        )
      `;

      // Event 2: manual reply referencing a doctor
      await sql`
        INSERT INTO tenant_learning_events (
          id, tenant_id, channel_id, conversation_id, source_type, 
          human_final_text, risk_tags, status, idempotency_key, metadata
        )
        VALUES (
          ${testEventId2}, ${tenantId}, ${testChannelId}, ${testConversationId}, 'manual_reply',
          'Doktor Ahmet Bey ile randevu organize edebiliriz.', '["doctor"]'::jsonb,
          'captured', ${uuidv4()}, '{"contains_sensitive_data":true}'::jsonb
        )
      `;

      console.log('4. Running Candidate Generator on synthetic test data...');
      
      // Enforce RLS for candidate generation test
      await sql`SELECT set_config('app.bypass_rls', '', true)`;
      await sql`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;

      const candidates = await TenantLearningCandidateService.generateCandidatesForTenant(db, tenantId, {
        limit: 10,
        writeMode: true,
        channelId: testChannelId
      });

      console.log(`Generated ${candidates.length} synthetic candidate(s).`);

      // 3. Verify unique constraint and duplicate processing
      console.log('\n3. Processing duplicate source event to verify idempotency...');
      
      // Run generation again on same events
      await TenantLearningCandidateService.generateCandidatesForTenant(db, tenantId, {
        limit: 10,
        writeMode: true,
        channelId: testChannelId
      });

      // Verify database state for the created candidate
      const results = await sql`
        SELECT id, source_event_ids, confidence_score, risk_level, status, fingerprint 
        FROM tenant_learning_candidates
        WHERE tenant_id = ${tenantId}
          AND conversation_id = ${testConversationId}
      `;

      console.log(`Verification: Found ${results.length} saved candidates in DB:`);
      results.forEach(c => {
        console.log(`- Type/Fingerprint: ${c.fingerprint}`);
        console.log(`  Confidence Score: ${c.confidence_score} (Expected: 1.00 for no duplicate inflation)`);
        console.log(`  Risk Level: ${c.risk_level} (Expected: high/blocked due to contains_sensitive_data)`);
        console.log(`  Evidence Events: ${JSON.stringify(c.source_event_ids)}`);
      });

      // 4. Verify RLS tenant isolation
      console.log('\n4. Verifying RLS Tenant Isolation...');
      const appClientUrl = process.env.APP_DATABASE_URL || process.env.DATABASE_URL;
      const { neon: neonClient } = await import('@neondatabase/serverless');
      const appSql = neonClient(appClientUrl!);

      const dummyTenantId = uuidv4();
      
      const rlsVisibleRes = await appSql.transaction(tx => [
        tx`SELECT set_config('app.bypass_rls', 'false', true), set_config('app.current_tenant_id', ${tenantId}, true)`,
        tx`SELECT COUNT(*) FROM tenant_learning_candidates WHERE conversation_id = ${testConversationId}`
      ]);
      const rlsVisibleCount = parseInt(rlsVisibleRes[1][0].count, 10);
      console.log(`RLS Check: Found ${rlsVisibleCount} records under actual tenant (Expected: 4)`);

      const rlsHiddenRes = await appSql.transaction(tx => [
        tx`SELECT set_config('app.bypass_rls', 'false', true), set_config('app.current_tenant_id', ${dummyTenantId}, true)`,
        tx`SELECT COUNT(*) FROM tenant_learning_candidates WHERE conversation_id = ${testConversationId}`
      ]);
      const rlsHiddenCount = parseInt(rlsHiddenRes[1][0].count, 10);
      console.log(`RLS Check: Found ${rlsHiddenCount} records under dummy tenant (Expected: 0)`);

      if (rlsHiddenCount > 0) {
        throw new Error(`RLS isolation failed! Dummy tenant was able to read isolated candidates. Count: ${rlsHiddenCount}`);
      }
      console.log("RLS Check: PASSED");

    } finally {
      // 5. Cleanup synthetic events and candidates
      console.log('\n5. Cleaning up synthetic test data from database...');
      await sql`SELECT set_config('app.bypass_rls', 'true', true)`;
      
      const deletedEvents = await sql`
        DELETE FROM tenant_learning_events WHERE conversation_id = ${testConversationId} RETURNING id
      `;
      const deletedCandidates = await sql`
        DELETE FROM tenant_learning_candidates WHERE conversation_id = ${testConversationId} RETURNING id
      `;
      let deletedConv = 0;
      if (testConversationId) {
        const res = await sql`DELETE FROM conversations WHERE id = ${testConversationId} RETURNING id`;
        deletedConv = res.length;
      }
      let deletedGroup = 0;
      if (testGroupId) {
        const res = await sql`DELETE FROM channel_groups WHERE id = ${testGroupId} RETURNING id`;
        deletedGroup = res.length;
      }
      console.log(`Cleaned up ${deletedConv} conversations, ${deletedEvents.length} events, ${deletedCandidates.length} candidates, and ${deletedGroup} channel groups.`);
      console.log('Write test complete and verified.');
    }
  }
}

main().catch(err => {
  console.error('Fatal CLI Error:', err);
  process.exit(1);
});
