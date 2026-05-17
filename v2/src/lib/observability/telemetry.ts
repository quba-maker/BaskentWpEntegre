import { getTraceContext } from "../core/trace-context";

// ==========================================
// EVENT TAXONOMY STANDARD (ADR-0002)
// Arbitrary string events are forbidden.
// ==========================================
export type TelemetryEvent =
  // Queue Lifecycle
  | "QUEUE_RECEIVED"
  | "QUEUE_RETRY"
  | "QUEUE_DLQ"
  
  // Tenant Resolution
  | "TENANT_RESOLVED"
  | "TENANT_REJECTED"
  
  // Security & Isolation
  | "SECURITY_ASSERTION_FAILED"
  | "SECURITY_CROSS_TENANT_BLOCKED"
  | "SECURITY_PANIC"
  | "SECURITY_NAMESPACE_APPLIED"
  | "SECURITY_QUERY_REJECTED"
  | "TENANT_FIREWALL_PASS"
  
  // LLM Lifecycle
  | "LLM_STARTED"
  | "LLM_COMPLETED"
  | "LLM_TIMEOUT"
  | "LLM_POLICY_REJECTED"
  
  // External Communication
  | "WHATSAPP_SENT"
  | "WHATSAPP_FAILED"
  
  // Anomaly & Performance
  | "LATENCY_ANOMALY"
  | "CIRCUIT_BREAKER_OPEN"
  | "CIRCUIT_BREAKER_CLOSED";

// ==========================================
// HIGH CARDINALITY PROTECTION
// Separate indexed structured fields from arbitrary metadata
// ==========================================
export interface TelemetryPayload {
  // 1. Indexed Fields (Low Cardinality, highly queryable)
  eventId: string;           // UUID for the event
  timestamp: string;         // ISO String
  event: TelemetryEvent;     // Strict Taxonomy
  tenantId: string;          // Extracted from context
  traceId: string;           // Execution trace
  conversationId: string;    // Session trace
  workerId: string;          // Vercel Region / AWS Region
  status: "success" | "failure" | "info" | "warn";
  
  // 2. Metadata (High Cardinality, stored as a JSON blob, NOT indexed by default)
  metadata?: Record<string, any>;
  
  // 3. Error specifics (if status === 'failure')
  error?: {
    name: string;
    message: string;
    stack?: string;
  };
}

class TelemetryGateway {
  private generateEventId(): string {
    return crypto.randomUUID();
  }

  private sanitizeMetadata(metadata?: Record<string, any>): Record<string, any> | undefined {
    if (!metadata) return undefined;
    
    const sanitized = { ...metadata };
    
    // PII Masking & Truncation logic goes here
    // Example: mask phone numbers
    for (const key of Object.keys(sanitized)) {
      if (typeof sanitized[key] === 'string' && sanitized[key].match(/(?:\+|00|0)?[1-9][0-9 \-\(\)\.]{9,15}/)) {
        sanitized[key] = "[MASKED_PHONE]";
      }
    }
    return sanitized;
  }

  public track(
    event: TelemetryEvent,
    status: "success" | "failure" | "info" | "warn",
    metadata?: Record<string, any>,
    error?: Error
  ) {
    try {
      const traceCtx = getTraceContext();
      
      const payload: TelemetryPayload = {
        eventId: this.generateEventId(),
        timestamp: new Date().toISOString(),
        event,
        status,
        tenantId: traceCtx?.tenantId || "MISSING_TENANT_ID",
        traceId: traceCtx?.traceId || "MISSING_TRACE_ID",
        conversationId: traceCtx?.conversationId || "MISSING_CONVERSATION_ID",
        workerId: process.env.VERCEL_REGION || "local_worker",
        metadata: this.sanitizeMetadata(metadata),
        ...(error && {
          error: {
            name: error.name,
            message: error.message,
            stack: process.env.NODE_ENV === "development" ? error.stack : undefined
          }
        })
      };

      // TRANSPORT LAYER
      // Later, we will inject Axiom / OpenTelemetry transport here.
      // For now, structured JSON to stdout/stderr.
      
      if (status === "failure") {
        console.error(JSON.stringify(payload));
      } else if (status === "warn") {
        console.warn(JSON.stringify(payload));
      } else {
        console.log(JSON.stringify(payload));
      }
      
    } catch (e) {
      // Gateway crash should not kill the runtime
      console.error("CRITICAL: TelemetryGateway crashed", e);
    }
  }
}

export const telemetry = new TelemetryGateway();
