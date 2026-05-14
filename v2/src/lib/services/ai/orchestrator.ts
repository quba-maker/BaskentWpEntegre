import { logger } from "@/lib/core/logger";

export interface AIProviderConfig {
  provider: 'gemini' | 'openai' | 'anthropic';
  modelId: string;
  apiKey: string;
  temperature: number;
  maxTokens: number;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface AIResponse {
  text: string;
  providerUsed: string;
  modelUsed: string;
  latencyMs: number;
  inputTokens?: number;
  outputTokens?: number;
}

/**
 * 🎼 AI Orchestrator
 * Model sağlayıcılarını (Gemini, OpenAI) soyutlar.
 * Tenant'ın seçimine göre isteği doğru API'ye yönlendirir.
 */
export class AIOrchestrator {
  private log = logger.withContext({ module: 'AIOrchestrator' });

  public async generateResponse(
    messages: ChatMessage[],
    config: AIProviderConfig
  ): Promise<AIResponse> {
    const startTime = Date.now();
    
    try {
      let responseText = '';
      let usageInfo = {};

      if (config.provider === 'gemini') {
        responseText = await this.callGemini(messages, config);
      } else if (config.provider === 'openai') {
        // responseText = await this.callOpenAI(messages, config);
        throw new Error("OpenAI not implemented yet");
      } else {
        throw new Error(`Unsupported provider: ${config.provider}`);
      }

      const latencyMs = Date.now() - startTime;
      
      this.log.info(`LLM Execution Success [${config.provider}/${config.modelId}]`, {
        latencyMs,
        ...usageInfo
      });

      return {
        text: responseText,
        providerUsed: config.provider,
        modelUsed: config.modelId,
        latencyMs
      };
    } catch (e: any) {
      this.log.error(`LLM Execution Failed [${config.provider}]`, e);
      // Fallback response
      return {
        text: "Şu an yoğunluk nedeniyle yanıt veremiyorum. Lütfen daha sonra tekrar deneyiniz.",
        providerUsed: 'fallback',
        modelUsed: 'fallback',
        latencyMs: Date.now() - startTime
      };
    }
  }

  private async callGemini(messages: ChatMessage[], config: AIProviderConfig): Promise<string> {
    // Sadece system instruction'ı ayıkla
    const systemMsg = messages.find(m => m.role === 'system');
    const conversation = messages.filter(m => m.role !== 'system').map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }]
    }));

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${config.modelId}:generateContent?key=${config.apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: systemMsg ? { parts: [{ text: systemMsg.content }] } : undefined,
          contents: conversation,
          generationConfig: {
            temperature: config.temperature,
            maxOutputTokens: config.maxTokens
          }
        })
      }
    );

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Gemini API Error: ${err}`);
    }

    const data = await response.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  }
}
