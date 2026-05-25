import { NextResponse } from 'next/server';
import { ChatMessage } from '@/lib/services/ai/orchestrator';
import { AIOrchestrator } from '@/lib/services/ai/orchestrator';
import { CrmExtractionSchema } from '@/lib/services/ai/crm-extractor';

/**
 * DEBUG ONLY — Tests CRM extraction with recent messages
 * DELETE THIS FILE AFTER DEBUGGING
 */
export async function GET(req: Request) {
  const orchestrator = new AIOrchestrator();
  
  const nowIstanbul = new Date().toLocaleString('tr-TR', { 
    timeZone: 'Europe/Istanbul', 
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', weekday: 'long'
  });
  const nowISO = new Date().toISOString();

  const systemPrompt: ChatMessage = {
    role: 'system',
    content: `Sen bir Enterprise CRM Intelligence Engine'sin.
Görevin, aşağıdaki hasta-temsilci (veya bot) görüşmesini analiz ederek yapılandırılmış JSON çıktısı üretmektir.
KESİNLİKLE markdown veya extra metin KULLANMA. SADECE GEÇERLİ JSON DÖNDÜR.

📅 ŞU ANKİ TARİH VE SAAT: ${nowIstanbul} (${nowISO})

Format:
{
  "patient_name": "string",
  "language": "string",
  "country": "string (Türkçe)",
  "department": "string",
  "pipeline_stage": "string",
  "should_create_opportunity": boolean,
  "opportunity_priority": "cold | warm | hot",
  "intent_type": "string",
  "travel_date": "string ISO date",
  "requires_human_confirmation": boolean
}`
  };

  const testMessages: ChatMessage[] = [
    systemPrompt,
    { role: 'user', content: 'Annem için kardiyoloji randevusu istiyorum, Portekizdeyim' },
    { role: 'assistant', content: 'Anneniz için kardiyoloji randevusu talebinizi ve Portekiz\'den geleceğinizi notlarımıza ekledik.' },
    { role: 'user', content: 'Bir düzeltme daha yapalım, ülke Portekiz, bölüm Kardiyoloji olacak. 20 Haziran\'da geleceğiz.' },
  ];

  const apiKey = process.env.GEMINI_API_KEY || '';
  
  try {
    const aiResponse = await orchestrator.generateResponse(testMessages, {
      provider: 'gemini',
      modelId: 'gemini-2.5-flash',
      apiKey,
      temperature: 0.1,
      maxTokens: 600,
      responseFormat: 'json' as const
    });

    let jsonText = aiResponse.text;
    // Clean markdown
    if (jsonText.startsWith('\`\`\`json')) {
      jsonText = jsonText.replace(/\`\`\`json/g, '').replace(/\`\`\`/g, '').trim();
    } else if (jsonText.startsWith('\`\`\`')) {
      jsonText = jsonText.replace(/\`\`\`/g, '').trim();
    }

    const parsed = JSON.parse(jsonText);
    const validated = CrmExtractionSchema.parse(parsed);

    return NextResponse.json({
      status: 'ok',
      raw_text: aiResponse.text,
      parsed: parsed,
      validated: validated,
      debug: {
        country: validated.country || '(EMPTY)',
        department: validated.department || '(EMPTY)',
        travel_date: validated.travel_date || '(EMPTY)',
        should_create_opportunity: validated.should_create_opportunity,
        intent_type: validated.intent_type || '(EMPTY)',
      }
    });
  } catch (e: any) {
    return NextResponse.json({ 
      status: 'error', 
      message: e.message,
      stack: e.stack?.split('\n').slice(0, 5),
      name: e.name,
      apiKeyExists: !!apiKey,
      apiKeyLength: apiKey.length
    }, { status: 500 });
  }
}
