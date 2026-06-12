import { logger } from "@/lib/core/logger";
import { getTraceContext } from "@/lib/core/trace-context";
import { CircuitBreaker } from "./circuit-breaker";
import { CostLimiter } from "./cost-limiter";
import { toolRegistry } from "./core/tool-registry";
import { toolExecutor } from "./core/tool-executor";
import { auditEngine } from "./core/audit-engine";

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

    try {
      if (tenantId !== 'unknown') {
        await this.costLimiter.consume(tenantId);
      }

      let currentMessages = [...initialMessages];
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
          this.log.info(`LLM Execution Completed [${config.provider}/${config.modelId}]`, { latencyMs, loopCount });
          
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
          this.log.info(`LLM Decision: Tool Call Requested`, { tool: name, args, tenantId, isSandbox });

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

      this.log.error(`[LLM_EXECUTION_FAILED] provider=${config.provider} model=${config.modelId} error=${e.message}`, e, { errorName: e.name, errorStack: e.stack?.substring(0, 500) });
      
      let fallbackText = "Mesajınızı aldım. Sizi doğru yönlendirebilmem için şikâyetinizi biraz daha açık yazar mısınız? 🙏";
      if (e.message?.startsWith('COST_LIMIT_EXCEEDED')) {
        fallbackText = "Mesajınız alındı. Şu an yoğunluk nedeniyle kısa bir gecikme yaşanıyor. Lütfen biraz sonra tekrar yazınız. 🙏";
      } else if (e.message?.startsWith('CIRCUIT_OPEN')) {
        fallbackText = "Mesajınız alındı. Kısa süreli bir teknik bakım yapılıyor, en kısa sürede tekrar hizmetinizdeyiz. 🙏";
      }

      return {
        text: fallbackText,
        providerUsed: 'fallback',
        modelUsed: 'fallback',
        latencyMs: Date.now() - startTime,
        finishReason: 'error'
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

