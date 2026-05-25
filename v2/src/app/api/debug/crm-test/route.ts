import { NextResponse } from 'next/server';
import { crmExtractorService } from '@/lib/services/ai/crm-extractor';
import { ChatMessage } from '@/lib/services/ai/orchestrator';
import { TenantDB } from '@/lib/core/tenant-db';
import { ConversationService } from '@/lib/services/conversation.service';
import { PromptBuilder } from '@/lib/services/ai/prompt-builder';

/**
 * DEBUG ONLY — Simulates the EXACT worker CRM extraction pipeline
 * Uses real getHistory, real system prompt, real CRM extractor
 * DELETE THIS FILE AFTER DEBUGGING
 */
export async function GET(req: Request) {
  const tenantId = 'caab9ea1-9591-45e4-bbc5-9c9b498982c8';
  const phoneNumber = '905546833306';
  
  try {
    const db = new TenantDB(tenantId);
    const convService = new ConversationService(db);
    
    // Step 1: Get history exactly as worker does
    const history = await convService.getHistory(phoneNumber, 10);
    
    // Step 2: Build aiMessages exactly as worker does (simplified system prompt)
    const aiMessages: ChatMessage[] = [
      { role: 'system' as const, content: 'Sen bir sağlık turizmi asistanısın.' },
      ...history,
    ];
    
    // Step 3: Call CRM extractor exactly as worker does
    const tenantConfig = { raw: { gemini_api_key: process.env.GEMINI_API_KEY } };
    const crmData = await crmExtractorService.extract(aiMessages, tenantConfig, `debug-pipeline-${Date.now()}`);
    
    return NextResponse.json({
      status: 'ok',
      historyLength: history.length,
      historyRoles: history.map(m => m.role),
      aiMessagesLength: aiMessages.length,
      crmData: crmData,
      debug: {
        country: crmData?.country || '(EMPTY)',
        department: crmData?.department || '(EMPTY)',
        travel_date: crmData?.travel_date || '(EMPTY)',
        should_create_opportunity: crmData?.should_create_opportunity,
      },
      // Show last 3 messages for context
      lastMessages: history.slice(-3).map(m => ({
        role: m.role,
        content: typeof m.content === 'string' ? m.content.substring(0, 100) : '(non-string)',
      }))
    });
  } catch (e: any) {
    return NextResponse.json({ 
      status: 'error', 
      message: e.message,
      stack: e.stack?.split('\n').slice(0, 5),
    }, { status: 500 });
  }
}
