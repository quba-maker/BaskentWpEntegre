import { toolRegistry, ToolContext } from "./tool-registry";
import { logger } from "@/lib/core/logger";
import { sql } from "@/lib/db";
import { AIEventEmitter } from "./event-emitter";

/**
 * ⚡️ Tool Executor — Phase 6 Enhanced
 * Enforces strict validation, timeouts, permission checks, and auditing.
 * AI Intention -> Permission Gate -> Validation Layer -> Execution -> Event Emit
 */
export class ToolExecutor {
  private log = logger.withContext({ module: 'ToolExecutor' });

  public async executeTool(
    toolName: string, 
    args: any, 
    context: ToolContext
  ): Promise<any> {
    const tool = toolRegistry.get(toolName);
    
    if (!tool) {
      this.log.warn(`AI attempted to call an unknown tool: ${toolName}`);
      throw new Error(`Tool [${toolName}] not found.`);
    }

    // 1. Permission Check — DB-backed tenant-level toggle
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
      throw new Error(`Permission denied for tool: ${toolName}`);
    }

    // 2. Schema Validation (Crucial to prevent Hallucination side-effects)
    let validatedArgs: any;
    try {
      validatedArgs = tool.schema.parse(args);
    } catch (err: any) {
      this.log.warn(`AI hallucinated invalid arguments for tool: ${toolName}`, { args, err: err.errors });
      throw new Error(`Invalid arguments provided for tool [${toolName}]. Validation failed.`);
    }

    // 3. Execution with Timeout & Audit
    this.log.info(`Executing tool: ${toolName}`, { tenantId: context.tenantId, args: validatedArgs });
    
    const timeoutMs = tool.timeoutMs || 10000; // Default 10s
    const startTime = Date.now();
    
    try {
      const result = await this.withTimeout(
        tool.execute(validatedArgs, context),
        timeoutMs
      );
      
      const durationMs = Date.now() - startTime;
      this.log.info(`Tool executed successfully: ${toolName}`, { durationMs });
      
      // Phase 6: Emit tool success event
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
      this.log.error(`Tool execution failed: ${toolName}`, error);
      
      // Phase 6: Emit tool failure event
      AIEventEmitter.emit({
        tenantId: context.tenantId,
        conversationId: context.conversationId,
        type: 'tool_failed',
        category: 'tool',
        severity: 'error',
        payload: { toolName, durationMs, error: error.message }
      });
      AIEventEmitter.logHealth(context.tenantId, 'tool_failure', { toolName, error: error.message });
      
      throw error;
    }
  }

  /**
   * DB-backed permission check.
   * If no record exists in tool_permissions, default to ALLOWED (opt-out model).
   */
  private async checkPermissions(toolName: string, requiredPermissions: string[], context: ToolContext): Promise<boolean> {
    try {
      const rows = await sql`
        SELECT is_enabled FROM tool_permissions
        WHERE tenant_id = ${context.tenantId} AND tool_name = ${toolName}
        LIMIT 1
      `;
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
