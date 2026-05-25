import { NextResponse } from 'next/server';
import { crmExtractorService } from '@/lib/services/ai/crm-extractor';
import { ChatMessage } from '@/lib/services/ai/orchestrator';

/**
 * DEBUG ONLY — Tests CRM extraction with recent messages
 * DELETE THIS FILE AFTER DEBUGGING
 * 
 * Usage: GET /api/debug/crm-test?phone=905546833306
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const phone = searchParams.get('phone') || '905546833306';
  const tenantId = 'caab9ea1-9591-45e4-bbc5-9c9b498982c8';
  
  // Simulate the exact messages the CRM extractor would see
  const testMessages: ChatMessage[] = [
    { role: 'user', content: 'Annem için kardiyoloji randevusu istiyorum, Portekizdeyim' },
    { role: 'assistant', content: 'Mustafa Ercan Bey, anneniz için kardiyoloji randevusu talebinizi ve Portekiz\'den geleceğinizi notlarımıza ekledik.' },
    { role: 'user', content: 'önce telefon görüşmesi istiyorum.' },
    { role: 'assistant', content: 'Telefon görüşmesi talebiniz notlarımızda. Yarın saat 14:00\'te koordinatörümüz sizi arayacak.' },
    { role: 'user', content: 'Bir düzeltme daha yapalım, ülke Portekiz, bölüm Kardiyoloji olacak. 20 Haziran\'da geleceğiz.' },
  ];

  try {
    const result = await crmExtractorService.extract(
      testMessages,
      { raw: { gemini_api_key: process.env.GEMINI_API_KEY } },
      `debug-${Date.now()}`
    );

    return NextResponse.json({
      status: 'ok',
      extraction: result,
      debug: {
        country: result?.country || '(EMPTY)',
        department: result?.department || '(EMPTY)',
        travel_date: result?.travel_date || '(EMPTY)',
        should_create_opportunity: result?.should_create_opportunity,
        intent_type: result?.intent_type || '(EMPTY)',
        requires_human_confirmation: result?.requires_human_confirmation,
      }
    });
  } catch (e: any) {
    return NextResponse.json({ status: 'error', message: e.message }, { status: 500 });
  }
}
