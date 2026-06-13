import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

// Mirror production configuration
process.env.USE_V2_BRAIN_RESOLUTION = 'true';
process.env.ENABLE_SELECTED_AUTOPILOT = 'true';

import { neon } from '@neondatabase/serverless';

const TENANT_ID = 'caab9ea1-9591-45e4-bbc5-9c9b498982c8'; // baskent
const PHONE_NUMBER = '905546833306';

async function run() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('DATABASE_URL is not set');
    process.exit(1);
  }

  // Dynamically import codebase modules after env variables are loaded
  const { BrainResolver } = await import('../src/lib/brain/brain-resolver');
  const { PromptBuilder } = await import('../src/lib/services/ai/prompt-builder');
  const { TurkishReplyQualityGate } = await import('../src/lib/services/ai/turkish-quality-gate');
  const { ResponsePolicy } = await import('../src/lib/services/ai/response-policy');

  const sql = neon(databaseUrl);

  console.log('=== STEP 1: Fetching Conversation details ===');
  const convRes = await sql.query(
    'SELECT * FROM conversations WHERE phone_number = $1 AND tenant_id = $2 LIMIT 1',
    [PHONE_NUMBER, TENANT_ID]
  );
  const conv = convRes.rows?.[0] || convRes[0];
  if (!conv) {
    console.error(`Conversation not found for phone: ${PHONE_NUMBER}`);
    return;
  }

  console.log('\n=== STEP 2: Fetching Last 5 Messages (Filtered to in/out) ===');
  const msgRes = await sql.query(
    `SELECT id, direction, content, provider_message_id, created_at 
     FROM messages 
     WHERE conversation_id = $1 AND direction IN ('in', 'out') 
     ORDER BY created_at DESC LIMIT 5`,
    [conv.id]
  );
  const messages = msgRes.rows || msgRes;
  console.table(messages);

  console.log('\n=== STEP 3: Resolving Tenant Brain ===');
  // Mock payload for BrainResolver
  const mockPayload = {
    entry: [{
      changes: [{
        value: {
          messages: [{ from: PHONE_NUMBER }]
        }
      }]
    }]
  };
  
  const brain = await BrainResolver.resolveTenantBrain(mockPayload, 'whatsapp', 'dry-run-trace-id', conv.channel_id);
  console.log('Brain Model:', brain.context.settings.aiModel);
  console.log('Max Response Tokens:', brain.context.settings.maxResponseTokens);
  console.log('Has API Key:', !!brain.context.config?.raw?.gemini_api_key);
  console.log('Prompt Source:', brain.context.brainSource);

  console.log('\n=== STEP 4: Simulating History & Prompt Construction ===');
  const history = messages.slice().reverse().map((m: any) => ({
    role: (m.direction === 'in' ? 'user' : 'assistant') as 'user' | 'assistant',
    content: String(m.content)
  }));

  const systemPromptText = PromptBuilder.buildSystemPrompt(brain, conv.lead_stage, false, {
    history,
    currentMessageText: history[history.length - 1]?.content || '',
    patientProvidedAvailability: false,
    approvedLearningHints: []
  });

  console.log('Built System Prompt Length:', systemPromptText.length);

  const contents = history.map(h => ({
    role: h.role === 'user' ? 'user' : 'model',
    parts: [{ text: h.content }]
  }));

  console.log('\n=== STEP 5: Testing Gemini Generation directly with filtered history ===');
  const llmModel = brain.context.settings.aiModel || 'gemini-2.5-flash';
  const apiKey = brain.context.config?.raw?.gemini_api_key || process.env.GEMINI_API_KEY || '';

  const payload = {
    systemInstruction: { parts: [{ text: systemPromptText }] },
    contents,
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: brain.context.settings.maxResponseTokens || 1000
    }
  };

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${llmModel}:generateContent?key=${apiKey}`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    console.log('Response Status:', response.status);
    console.log('Response OK:', response.ok);

    const text = await response.text();
    const parsed = JSON.parse(text);
    console.log(JSON.stringify(parsed, null, 2));

  } catch (err) {
    console.error('Fetch error:', err);
  }
}

run().catch(console.error);
