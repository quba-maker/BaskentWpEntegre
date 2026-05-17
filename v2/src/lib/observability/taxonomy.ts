export type TelemetryEvent =
  // Queue Lifecycle
  | "QUEUE_RECEIVED"
  | "QUEUE_RETRY"
  | "QUEUE_DLQ"
  | "QUEUE_STARVATION"
  
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
  | "RLS_ASSERTION_FAILED"
  | "VECTOR_NAMESPACE_MISMATCH"
  | "PROMPT_HASH_MISMATCH"
  
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
  | "CIRCUIT_BREAKER_CLOSED"
  | "AI_CIRCUIT_OPEN"
  | "AI_COST_THRESHOLD"
  | "WORKER_MEMORY_PRESSURE";

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
