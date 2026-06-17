import { logger } from "@/lib/core/logger";
import { getTraceContext } from "@/lib/core/trace-context";
import { CircuitBreaker } from "./circuit-breaker";
import { CostLimiter } from "./cost-limiter";
import { toolRegistry } from "./core/tool-registry";
import { toolExecutor } from "./core/tool-executor";
import { auditEngine } from "./core/audit-engine";
import { ConversationIntentRouter } from "./conversation-intent-router";
import { PendingQuestionResolver } from "./pending-question-resolver";


export interface AIProviderConfig {
  provider: 'gemini' | 'openai' | 'anthropic';
  modelId: string;
  apiKey: string;
  temperature: number;
  maxTokens: number;
  responseFormat?: 'json' | 'text';
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'function';
  content?: string;
  direction?: string;
  
  // When assistant wants to call a function
  functionCall?: {
    name: string;
    args: any;
  };

  // When we return the result of a function to the assistant
  functionResponse?: {
    name: string;
    response: any;
  };
}

export class IncompleteResponseError extends Error {
  public finishReason?: string;
  constructor(message: string, finishReason?: string) {
    super(message);
    this.name = 'IncompleteResponseError';
    this.finishReason = finishReason;
  }
}

export class AIBillingExhaustedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AIBillingExhaustedError';
  }
}

export class AIQuotaExhaustedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AIQuotaExhaustedError';
  }
}

export class AICircuitOpenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AICircuitOpenError';
  }
}

export class AIUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AIUnavailableError';
  }
}

export interface AIResponse {
  text: string;
  providerUsed: string;
  modelUsed: string;
  latencyMs: number;
  inputTokens?: number;
  outputTokens?: number;
  finishReason?: string;
}

/**
 * 🎼 AI Orchestrator (Phase 5B/5C - Decision Engine, Runtime & Audit)
 * Abstract provider wrapper + Tool Execution loop + Observability.
 */
export class AIOrchestrator {
  private log = logger.withContext({ module: 'AIOrchestrator' });
  private geminiCircuit = new CircuitBreaker('gemini', { failureThreshold: 5, resetTimeoutMs: 180000 });
  private costLimiter = new CostLimiter({ maxRequests: 200, windowSeconds: 3600 }); // Saatte 200 İstek

  public async generateResponse(
    initialMessages: ChatMessage[],
    config: AIProviderConfig,
    tenantId: string = 'unknown',
    conversationId: string = 'unknown',
    options?: { sandbox?: boolean }
  ): Promise<{ text?: string, providerUsed?: string, modelUsed?: string, inputTokens?: number, outputTokens?: number, latencyMs?: number, providerMessageId?: string, finishReason?: string }> {
    const startTime = Date.now();
    const traceCtx = getTraceContext();
    const _tenantId = tenantId !== 'unknown' ? tenantId : (traceCtx?.tenantId || 'unknown');
    const _conversationId = conversationId !== 'unknown' ? conversationId : (traceCtx?.conversationId || 'unknown');
    const phoneNumber = traceCtx?.metadata?.phone || 'unknown';
    
    // Sandbox mode layer (Prevents real execution if true)
    const isSandbox = options?.sandbox === true || process.env.AI_TOOL_EXECUTION_MODE === 'sandbox';

    let currentMessages = [...initialMessages];
    let contextCompactionApplied = false;

    // 1. Calculate initial prompt stats
    const initialCharCount = currentMessages.reduce((acc, m) => acc + (m.content || '').length, 0);
    const initialTokenCount = Math.ceil(initialCharCount / 4);

    // 2. Perform system note isolation: filter out leaked system notes and direction='system' messages from history
    const systemMsg = currentMessages.find(m => m.role === 'system');
    const userMsg = currentMessages[currentMessages.length - 1];
    
    let midMessages = currentMessages.filter(m => m.role !== 'system' && m !== userMsg);
    const originalMidCount = midMessages.length;
    midMessages = midMessages.filter(m => {
      if (m.direction === 'system') {
        return false;
      }
      const contentLower = (m.content || '').toLowerCase();
      if (
        contentLower.includes('quality gate blocked') || 
        contentLower.includes('yapay zeka yanıtı tamamlanmadı') ||
        contentLower.includes('kalite kontrolünü geçemedi')
      ) {
        return false;
      }
      return true;
    });
    if (midMessages.length < originalMidCount) {
      contextCompactionApplied = true;
    }

    // 3. Check if there's an active pending slot or specific intent to minimize/suppress CRM context
    const lastUserMsg = userMsg?.content || '';
    const historyForSlot = midMessages.map(m => ({
      role: m.role as 'user' | 'assistant',
      content: m.content || ''
    }));
    
    const pendingSlot = PendingQuestionResolver.resolve(historyForSlot);
    const lastUserIntent = ConversationIntentRouter.route(lastUserMsg);
    const isSpecificIntent = ['transfer_request', 'call_scheduling_request', 'time_availability', 'timezone_clarification', 'confirmation_yes_no'].includes(lastUserIntent);
    const pendingActive = pendingSlot && pendingSlot !== 'generic_none';
    const hasActiveFlow = pendingActive || isSpecificIntent;

    let systemPromptText = systemMsg?.content || '';
    if (systemPromptText && (hasActiveFlow || initialCharCount > 8000)) {
      const oppRegex = /--- AKTİF FIRSAT BİLGİLERİ \(CRM OPPORTUNITY\) ---[\s\S]*?(?=(?:---|\n\n|$))/i;
      const memRegex = /--- ÖNCEKİ GÖRÜŞME ÖZETİ[\s\S]*?(?=(?:---|\n\n|$))/i;
      const rawFormRegex = /Ham Form Verileri[\s\S]*?(?=(?:---|\n\n|$))/i;

      let newSystemPromptText = systemPromptText;
      if (oppRegex.test(newSystemPromptText)) {
        newSystemPromptText = newSystemPromptText.replace(oppRegex, '--- AKTİF FIRSAT BİLGİLERİ (CRM OPPORTUNITY) ---\n- Özet: Kayıtlı fırsat bilgileri (aktif akış/bütçe koruması nedeniyle kısaltılmıştır).\n');
        contextCompactionApplied = true;
      }
      if (memRegex.test(newSystemPromptText)) {
        newSystemPromptText = newSystemPromptText.replace(memRegex, '--- ÖNCEKİ GÖRÜŞME ÖZETİ ---\n- Özet: Geçmiş konuşma özeti (aktif akış/bütçe koruması nedeniyle kısaltılmıştır).\n');
        contextCompactionApplied = true;
      }
      if (rawFormRegex.test(newSystemPromptText)) {
        newSystemPromptText = newSystemPromptText.replace(rawFormRegex, 'Ham Form Verileri: Form verisi mevcut.\n');
        contextCompactionApplied = true;
      }
      systemPromptText = newSystemPromptText;
    }

    // 4. Compact history if there is an active pending slot or scheduling/transfer intent
    if (hasActiveFlow && midMessages.length > 3) {
      midMessages = midMessages.slice(-3);
      contextCompactionApplied = true;
    } else {
      // Gentle history trimming only if prompt is still extremely large to avoid losing context aggressively
      const currentEstimate = systemPromptText.length + midMessages.reduce((acc, m) => acc + (m.content || '').length, 0) + (userMsg?.content || '').length;
      if (currentEstimate > 14000 && midMessages.length > 8) {
        midMessages = midMessages.slice(-6);
        contextCompactionApplied = true;
      } else if (currentEstimate > 11000 && midMessages.length > 5) {
        midMessages = midMessages.slice(-4);
        contextCompactionApplied = true;
      }
    }

    // Reconstruct currentMessages with compacted content
    currentMessages = [];
    if (systemMsg) {
      currentMessages.push({
        ...systemMsg,
        content: systemPromptText
      });
    }
    currentMessages.push(...midMessages);
    if (userMsg) {
      currentMessages.push(userMsg);
    }

    const finalPromptCharCount = currentMessages.reduce((acc, m) => acc + (m.content || '').length, 0);
    const estimatedTokenCount = Math.ceil(finalPromptCharCount / 4);

    this.log.info(`[PROMPT_BUDGET_GUARD] Prompt Metrics`, {
      initialCharCount,
      initialTokenCount,
      finalPromptCharCount,
      estimatedTokenCount,
      contextCompactionApplied,
      modelMaxOutputTokens: config.maxTokens
    });

    try {
      if (tenantId !== 'unknown') {
        await this.costLimiter.consume(tenantId);
      }

      let loopCount = 0;
      const MAX_LOOPS = 5; // Guard against infinite tool loops
      let totalInputTokens = 0;
      let totalOutputTokens = 0;

      while (loopCount < MAX_LOOPS) {
        loopCount++;

        // Call LLM
        let rawResponse: any;
        if (config.provider === 'gemini') {
          const tenantCircuit = new CircuitBreaker(`gemini:${_tenantId}`, { failureThreshold: 5, resetTimeoutMs: 180000 });
          rawResponse = await tenantCircuit.execute(() => this.callGemini(currentMessages, config));
        } else {
          throw new Error(`Unsupported provider: ${config.provider}`);
        }

        if (rawResponse.usageMetadata) {
          totalInputTokens += rawResponse.usageMetadata.promptTokenCount || 0;
          totalOutputTokens += rawResponse.usageMetadata.candidatesTokenCount || 0;
        }

        // 1. Did LLM return standard text? (Respond Intent)
        if (rawResponse.text) {
          const latencyMs = Date.now() - startTime;
          this.log.info(`LLM Execution Completed [${config.provider}/${config.modelId}]`, {
            latencyMs,
            loopCount,
            finishReason: rawResponse.finishReason,
            finalPromptCharCount,
            estimatedTokenCount,
            contextCompactionApplied,
            modelMaxOutputTokens: config.maxTokens
          });
          
          if (tenantId !== 'unknown') {
            await auditEngine.logRuntimeMetrics({
              tenantId,
              modelName: config.modelId,
              responseTimeMs: latencyMs,
              toolCallsCount: loopCount - 1
            });
          }

          if (rawResponse.finishReason && rawResponse.finishReason !== 'STOP') {
            throw new IncompleteResponseError(`Incomplete AI response blocked by Orchestrator. finishReason=${rawResponse.finishReason}`, rawResponse.finishReason);
          }

          return {
            text: rawResponse.text,
            providerUsed: config.provider,
            modelUsed: config.modelId,
            latencyMs,
            inputTokens: totalInputTokens,
            outputTokens: totalOutputTokens,
            finishReason: rawResponse.finishReason
          };
        }

        // 2. Did LLM return a function call? (Tool Intent)
        if (rawResponse.functionCall) {
          const { name, args } = rawResponse.functionCall;
          this.log.info(`LLM Decision: Tool Call Requested`, { 
            tool: name, 
            args, 
            tenantId, 
            isSandbox,
            finalPromptCharCount,
            estimatedTokenCount,
            contextCompactionApplied,
            modelMaxOutputTokens: config.maxTokens
          });

          // Add the assistant's function call intent to the history
          currentMessages.push({
            role: 'assistant',
            functionCall: { name, args }
          });

          let toolResult: any;
          const toolStartTime = Date.now();
          let validationPassed = true;
          let errorMessage: string | undefined;

          if (isSandbox) {
            this.log.info(`[SANDBOX] Simulating execution of ${name}`);
            toolResult = { status: 'sandbox_simulation_ok', note: 'Execution skipped in sandbox mode.' };
          } else {
            // EXECUTE TOOL via ToolExecutor (Phase 5B Validation Layer)
            try {
              toolResult = await toolExecutor.executeTool(
                name, 
                args, 
                { tenantId, conversationId, phoneNumber }
              );
            } catch (err: any) {
              this.log.error(`Tool execution failed: ${name}`, err);
              toolResult = { error: err.message };
              validationPassed = !err.message?.includes("Validation failed");
              errorMessage = err.message;
            }
          }

          const executionDurationMs = Date.now() - toolStartTime;

          if (tenantId !== 'unknown') {
            await auditEngine.logToolExecution({
              tenantId,
              conversationId: conversationId !== 'unknown' ? conversationId : undefined,
              toolName: name,
              toolArguments: args,
              validationPassed,
              executionMode: isSandbox ? 'sandbox' : 'production',
              executionDurationMs,
              errorMessage,
              resultSummary: toolResult
            });
          }

          // Push the tool result back to the LLM to get the final answer
          currentMessages.push({
            role: 'function',
            functionResponse: { name, response: toolResult }
          });

          // Loop will continue and call Gemini again with the new history
          continue;
        }

        // Edge case: Empty response
        throw new Error("Empty response from LLM");
      }

      throw new Error("Max tool execution loops reached without a final text response.");

    } catch (e: any) {
      if (
        e instanceof AIBillingExhaustedError ||
        e instanceof AIQuotaExhaustedError ||
        e instanceof AICircuitOpenError ||
        e instanceof AIUnavailableError
      ) {
        throw e;
      }
      if (e.message?.startsWith('CIRCUIT_OPEN')) {
        throw new AICircuitOpenError(e.message);
      }

      const finishReason = e instanceof IncompleteResponseError ? e.finishReason : 'error';
      this.log.error(`[LLM_EXECUTION_FAILED] provider=${config.provider} model=${config.modelId} error=${e.message}`, e, {
        errorName: e.name,
        errorStack: e.stack?.substring(0, 500),
        finishReason,
        finalPromptCharCount,
        estimatedTokenCount,
        contextCompactionApplied,
        modelMaxOutputTokens: config.maxTokens
      });
      
      let fallbackText = "Mesajınızı aldım. Size daha iyi yardımcı olabilmem için talebinizi biraz daha detaylandırabilir misiniz? 🙏";
      
      const cleanLower = (lastUserMsg || '').toLowerCase();
      const locations = [
        { key: 'Almanya', keywords: ['almanya', 'almanyada', 'almanyadayım', 'almanyadayim', 'germany'] },
        { key: 'Kaliforniya', keywords: ['amerika', 'usa', 'us', 'california', 'kaliforniya'] },
        { key: 'Libya', keywords: ['libya'] },
        { key: 'Irak', keywords: ['irak', 'iraq'] },
        { key: 'İngiltere', keywords: ['ingiltere', 'london', 'londra', 'uk', 'england'] },
        { key: 'Hollanda', keywords: ['hollanda', 'netherlands'] },
        { key: 'Fransa', keywords: ['fransa', 'france'] },
        { key: 'Avrupa', keywords: ['avrupa', 'europe'] },
        { key: 'Yurt dışı', keywords: ['yurt dışı', 'yurt disi', 'yurt dışından', 'yurt disindan', 'yurtdısı', 'yurtdisi', 'international'] },
        { key: 'Şehir dışı', keywords: ['şehir dışı', 'sehir disi', 'sehir dışı', 'şehir disi', 'sehir dışından', 'sehirlerarasi', 'şehirlerarası'] },
        { key: 'Uzak', keywords: ['uzak', 'mesafe', 'konya uzak'] }
      ];

      const departmentsList = [
        { key: 'Kardiyoloji', keywords: ['kardiyoloji', 'kalp', 'damar', 'cardio', 'heart'] },
        { key: 'Ortopedi ve Travmatoloji', keywords: ['ortopedi', 'kemik', 'eklem', 'diz', 'kalça', 'kalca'] },
        { key: 'Tüp Bebek', keywords: ['tüp bebek', 'tup bebek', 'tüpbebek', 'ivf'] },
        { key: 'Plastik, Rekonstrüktif ve Estetik Cerrahi', keywords: ['estetik', 'burun estetiği', 'burun estetigi', 'rinoplasti', 'plastik cerrahi'] },
        { key: 'Diş Hekimliği', keywords: ['diş', 'dental', 'implant', 'dis', 'diş hekimliği', 'dis hekimligi'] },
        { key: 'Organ Nakli', keywords: ['organ nakli', 'organ', 'nakil', 'nakli'] },
        { key: 'Beyin ve Sinir Cerrahisi (Bel Fıtığı)', keywords: ['bel fıtığı', 'bel fitigi', 'bel fitigi', 'bel fıtıgı'] }
      ];

      const matchedLocation = locations.find(l => l.keywords.some(kw => cleanLower.includes(kw)));
      const matchedDept = departmentsList.find(d => d.keywords.some(kw => cleanLower.includes(kw)));
      
      const hasLogistics = ['ulasım', 'ulasim', 'ulaşım', 'surec', 'süreç', 'transfer', 'konaklama', 'otel', 'yol', 'bilet', 'gelem', 'konaklamak', 'logistics'].some(kw => cleanLower.includes(kw));
      const hasPrice = ['fiyat', 'ucret', 'ücret', 'maliyet', 'ne kadar', 'tutar', 'para', 'fiyatlar', 'fiyati', 'ucreti', 'pricing'].some(kw => cleanLower.includes(kw));

      if (matchedLocation && hasLogistics && hasPrice) {
        const location = matchedLocation.key;
        const dept = matchedDept?.key || 'Tedavi';
        fallbackText = `${location}'dan bizimle iletişime geçtiğiniz için teşekkür ederiz. ${dept} süreci, ulaşım ve fiyatlandırma ile ilgili bilgiler aşağıdadır:\n\n` +
          `• **Ulaşım ve Konaklama**: Şehir dışı ve yurt dışından gelen hastalarımız için havalimanı transferi, konaklama ve süreç planlama koordinasyonu ekibimiz tarafından organize edilmektedir.\n` +
          `• **${dept} Süreci**: İlgili branşımız bünyesinde tanı ve tedavi süreçleri uzman hekimlerimiz kontrolünde planlanmaktadır.\n` +
          `• **Fiyatlandırma**: Tedavi fiyatları, hekimimizin yapacağı değerlendirme ve oluşturulacak kişiye özel tedavi planına göre belirlenmektedir.\n` +
          `• **Sonraki Adım**: Detayları görüşmek ve planlama yapmak üzere hasta danışmanımızla telefon görüşmesi planlayabiliriz. Hangi gün ve saat aralığında görüşmek istersiniz? 🙏`;
      } else if (e.message?.startsWith('COST_LIMIT_EXCEEDED')) {
        fallbackText = "Mesajınız alındı. Şu an yoğunluk nedeniyle kısa bir gecikme yaşanıyor. Lütfen biraz sonra tekrar yazınız. 🙏";
      } else if (e.message?.startsWith('CIRCUIT_OPEN')) {
        fallbackText = "Mesajınız alındı. Kısa süreli bir teknik bakım yapılıyor, en kısa sürede tekrar hizmetinizdeyiz. 🙏";
      }

      return {
        text: fallbackText,
        providerUsed: 'fallback',
        modelUsed: 'fallback',
        latencyMs: Date.now() - startTime,
        finishReason
      };
    }
  }

  private async callGemini(messages: ChatMessage[], config: AIProviderConfig): Promise<{text?: string, functionCall?: {name: string, args: any}, usageMetadata?: any, finishReason?: string}> {
    const systemMsg = messages.find(m => m.role === 'system');
    
    // Map standard messages to Gemini format
    const contents: any[] = [];
    
    for (const m of messages) {
      if (m.role === 'system') continue;
      
      if (m.role === 'user') {
        contents.push({ role: 'user', parts: [{ text: m.content || '' }] });
      } else if (m.role === 'assistant') {
        if (m.content) {
          contents.push({ role: 'model', parts: [{ text: m.content }] });
        } else if (m.functionCall) {
          contents.push({
            role: 'model',
            parts: [{ functionCall: { name: m.functionCall.name, args: m.functionCall.args } }]
          });
        }
      } else if (m.role === 'function') {
        contents.push({
          role: 'user', // Gemini expects tool responses to come from user/tool role
          parts: [{
            functionResponse: {
              name: m.functionResponse?.name,
              response: { name: m.functionResponse?.name, content: m.functionResponse?.response }
            }
          }]
        });
      }
    }

    // Attach registered tools to the LLM (Tool Registry Phase 5A)
    const registeredTools = toolRegistry.getDefinitionsForLLM();
    let toolsParam: any = undefined;
    
    if (registeredTools && registeredTools.length > 0) {
      toolsParam = [{
        functionDeclarations: registeredTools
      }];
    }

    const payload = {
      systemInstruction: systemMsg ? { parts: [{ text: systemMsg.content }] } : undefined,
      contents,
      tools: toolsParam,
      generationConfig: {
        temperature: config.temperature,
        maxOutputTokens: config.maxTokens,
        responseMimeType: config.responseFormat === 'json' ? 'application/json' : undefined
      }
    };

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${config.modelId}:generateContent?key=${config.apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }
    );

    if (!response.ok) {
      const err = await response.text();
      let errMsg = err;
      try {
        const parsed = JSON.parse(err);
        errMsg = parsed.error?.message || err;
      } catch (_) {}

      const isBilling = errMsg.includes('monthly spending cap') || errMsg.includes('spending cap') || errMsg.includes('billing exhausted') || errMsg.includes('billing limit');
      const isQuota = errMsg.includes('quota exceeded') || errMsg.includes('RESOURCE_EXHAUSTED') || errMsg.includes('limit exceeded') || response.status === 429;

      if (isBilling) {
        throw new AIBillingExhaustedError(`Gemini billing exhausted: ${errMsg}`);
      }
      if (isQuota) {
        throw new AIQuotaExhaustedError(`Gemini quota exceeded: ${errMsg}`);
      }
      throw new Error(`Gemini API Error: ${errMsg}`);
    }

    const data = await response.json();
    const candidate = data.candidates?.[0];
    const part = candidate?.content?.parts?.[0];
    const usageMetadata = data.usageMetadata;

    if (!part) {
      if (candidate?.finishReason) {
         throw new IncompleteResponseError(`Gemini stopped with finishReason=${candidate.finishReason} but no part`, candidate.finishReason);
      }
      throw new Error("No response parts received from Gemini");
    }

    if (part.functionCall) {
      return {
        functionCall: {
          name: part.functionCall.name,
          args: part.functionCall.args
        },
        usageMetadata,
        finishReason: candidate.finishReason
      };
    }

    return { text: part.text || '', usageMetadata, finishReason: candidate.finishReason };
  }
}

