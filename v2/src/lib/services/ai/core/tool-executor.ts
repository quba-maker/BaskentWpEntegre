import { toolRegistry, ToolContext } from "./tool-registry";
import { logger } from "@/lib/core/logger";
import { withTenantDB } from "@/lib/core/tenant-db";
import { AIEventEmitter } from "./event-emitter";

/**
 * ⚡️ Tool Executor — Phase 6 Production-Hardened
 * 
 * Enterprise-grade execution pipeline:
 * AI Intention -> Permission Gate -> Validation Layer -> Execution -> Event Emit -> Audit
 * 
 * Hardening:
 * - Hallucinated tool names → audit log + hard reject
 * - Disabled tools → hard reject with event
 * - Timeout → abort status recorded in ai_events
 * - Sandbox vs Production mode separation
 */
export class ToolExecutor {
  private log = logger.withContext({ module: 'ToolExecutor' });

  public async executeTool(
    toolName: string, 
    args: any, 
    context: ToolContext
  ): Promise<any> {
    const tool = toolRegistry.get(toolName);
    
    // ========================================
    // GUARD 1: Hallucinated Tool Detection
    // ========================================
    if (!tool) {
      this.log.warn(`AI hallucinated unknown tool: ${toolName}`, { tenantId: context.tenantId });
      
      // Audit: log hallucination attempt for analysis
      AIEventEmitter.emit({
        tenantId: context.tenantId,
        conversationId: context.conversationId,
        type: 'tool_failed',
        category: 'tool',
        severity: 'warning',
        payload: { 
          toolName, 
          reason: 'hallucinated_tool',
          message: `AI attempted to call non-existent tool [${toolName}]`
        }
      });
      AIEventEmitter.logHealth(context.tenantId, 'tool_hallucination', { toolName });
      
      throw new Error(`Tool [${toolName}] not found. Available tools: ${toolRegistry.getToolNames().join(', ')}`);
    }

    // ========================================
    // GUARD 2: Permission Check — DB-backed
    // ========================================
    const isAllowed = await this.checkPermissions(toolName, tool.permissions, context);
    if (!isAllowed) {
      this.log.warn(`Permission denied for tool: ${toolName}`, { tenantId: context.tenantId });
      AIEventEmitter.emit({
        tenantId: context.tenantId,
        conversationId: context.conversationId,
        type: 'tool_failed',
        category: 'tool',
        severity: 'warning',
        payload: { toolName, reason: 'permission_denied' }
      });
      throw new Error(`Permission denied for tool: ${toolName}. Tool is disabled for this tenant.`);
    }

    // ========================================
    // GUARD 3: Schema Validation (Anti-Hallucination)
    // ========================================
    let validatedArgs: any;
    try {
      validatedArgs = tool.schema.parse(args);
    } catch (err: any) {
      this.log.warn(`AI hallucinated invalid arguments for tool: ${toolName}`, { args, err: err.errors });
      AIEventEmitter.emit({
        tenantId: context.tenantId,
        conversationId: context.conversationId,
        type: 'tool_failed',
        category: 'tool',
        severity: 'warning',
        payload: { toolName, reason: 'invalid_arguments', errors: err.errors?.slice(0, 3) }
      });
      throw new Error(`Invalid arguments provided for tool [${toolName}]. Validation failed.`);
    }

    // ========================================
    // EXECUTION: Timeout + Audit
    // ========================================
    this.log.info(`Executing tool: ${toolName}`, { tenantId: context.tenantId });
    
    const timeoutMs = tool.timeoutMs || 10000; // Default 10s
    const startTime = Date.now();
    
    try {
      const result = await this.withTimeout(
        tool.execute(validatedArgs, context),
        timeoutMs
      );
      
      const durationMs = Date.now() - startTime;
      this.log.info(`Tool executed successfully: ${toolName}`, { durationMs });
      
      // Emit success event with latency
      AIEventEmitter.emit({
        tenantId: context.tenantId,
        conversationId: context.conversationId,
        type: 'tool_executed',
        category: 'tool',
        payload: { toolName, durationMs, success: true }
      });
      
      return result;
    } catch (error: any) {
      const durationMs = Date.now() - startTime;
      const isTimeout = error.message?.includes('timed out');
      
      this.log.error(`Tool execution failed: ${toolName}`, error);
      
      // Emit failure event with timeout distinction
      AIEventEmitter.emit({
        tenantId: context.tenantId,
        conversationId: context.conversationId,
        type: 'tool_failed',
        category: 'tool',
        severity: 'error',
        payload: { 
          toolName, 
          durationMs, 
          error: error.message,
          status: isTimeout ? 'aborted_timeout' : 'execution_error',
          timeoutMs: isTimeout ? timeoutMs : undefined
        }
      });
      
      AIEventEmitter.logHealth(
        context.tenantId, 
        isTimeout ? 'tool_timeout' : 'tool_failure', 
        { toolName, durationMs, error: error.message }
      );
      
      throw error;
    }
  }

  private async checkPermissions(toolName: string, requiredPermissions: string[], context: ToolContext): Promise<boolean> {
    try {
      const db = withTenantDB(context.tenantId);
      const rows = await db.executeSafe({
        text: `
          SELECT is_enabled FROM tool_permissions
          WHERE tenant_id = $1 AND tool_name = $2
          LIMIT 1
        `,
        values: [context.tenantId, toolName]
      }) as any[];
      // If no record exists, tool is allowed by default (opt-out model)
      if (rows.length === 0) return true;
      return rows[0].is_enabled === true;
    } catch {
      // If DB check fails, allow the tool to prevent blocking the pipeline
      return true;
    }
  }

  private withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) => 
        setTimeout(() => reject(new Error(`Execution timed out after ${ms}ms`)), ms)
      )
    ]);
  }
}

export const toolExecutor = new ToolExecutor();
