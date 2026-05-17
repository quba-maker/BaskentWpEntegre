export const SecurityTelemetry = {
  log: (
    event: 
      | "SECURITY_CONTEXT_CREATED"
      | "TENANT_FIREWALL_PASS"
      | "TENANT_FIREWALL_BLOCK"
      | "CROSS_TENANT_ATTEMPT"
      | "CACHE_NAMESPACE_APPLIED"
      | "VECTOR_NAMESPACE_APPLIED"
      | "QUERY_REJECTED"
      | "SECURITY_PANIC",
    tenantId: string,
    traceId: string,
    conversationId: string | null,
    details?: Record<string, any>
  ) => {
    const payload = {
      timestamp: new Date().toISOString(),
      event,
      tenantId,
      traceId,
      conversationId,
      ...details,
    };

    // In a production scenario, this would write to Datadog, Axiom, etc.
    // We enforce structure here.
    if (event === "SECURITY_PANIC" || event === "TENANT_FIREWALL_BLOCK" || event === "CROSS_TENANT_ATTEMPT" || event === "QUERY_REJECTED") {
      console.error(`[SECURITY_ALERT] ${event}:`, JSON.stringify(payload));
    } else {
      console.info(`[SECURITY_TRACE] ${event}:`, JSON.stringify(payload));
    }
  }
};
