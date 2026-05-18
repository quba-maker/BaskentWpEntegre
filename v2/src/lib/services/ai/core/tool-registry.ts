import { z } from "zod";

/**
 * 🛠️ Tool Registry
 * This is the central registry for all agentic tools.
 * It strictly defines inputs, outputs, and validation schemas.
 */

export interface ToolDefinition<T = any> {
  name: string;
  description: string;
  schema: z.ZodSchema<T>;
  execute: (args: T, context: ToolContext) => Promise<any>;
  permissions: string[]; // required roles or tenant-features to use this tool
  timeoutMs?: number;    // Custom timeout for the tool
}

export interface ToolContext {
  tenantId: string;
  conversationId: string;
  phoneNumber: string;
  // Extra context like CRM API keys, integration tokens can be passed here
}

export class ToolRegistry {
  private tools: Map<string, ToolDefinition> = new Map();

  /**
   * Register a new tool into the runtime.
   */
  public register(tool: ToolDefinition) {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool [${tool.name}] is already registered.`);
    }
    this.tools.set(tool.name, tool);
  }

  /**
   * Retrieve a tool by name.
   */
  public get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  /**
   * Get all registered tools in a format suitable for LLMs (e.g., Gemini / OpenAI).
   */
  public getDefinitionsForLLM() {
    return Array.from(this.tools.values()).map(tool => {
      // Very basic zod-to-json-schema conversion for the LLM
      // In production, use a library like zod-to-json-schema
      const parameters = this.zodToJsonSchema(tool.schema);
      return {
        name: tool.name,
        description: tool.description,
        parameters,
      };
    });
  }

  /**
   * List all registered tool names (used for error messages / debug).
   */
  public getToolNames(): string[] {
    return Array.from(this.tools.keys());
  }

  // Simple Zod to JSON Schema converter for standard LLM Tool definitions
  private zodToJsonSchema(schema: z.ZodTypeAny): any {
    // A simplified conversion for demonstration. 
    // In a full enterprise app, use `zodToJsonSchema` package.
    const def = schema._def as any;
    if (def.typeName === 'ZodObject') {
      const properties: any = {};
      const required: string[] = [];
      const shape = (schema as z.ZodObject<any>).shape;
      
      for (const [key, propSchema] of Object.entries(shape)) {
        properties[key] = this.zodToJsonSchema(propSchema as z.ZodTypeAny);
        if (!(propSchema as any).isOptional()) {
          required.push(key);
        }
      }
      return {
        type: "object",
        properties,
        required,
      };
    }
    
    if (def.typeName === 'ZodString') return { type: "string" };
    if (def.typeName === 'ZodNumber') return { type: "number" };
    if (def.typeName === 'ZodBoolean') return { type: "boolean" };
    
    return { type: "object" }; // fallback
  }
}

// Global Singleton Registry
export const toolRegistry = new ToolRegistry();
