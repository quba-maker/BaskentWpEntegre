import { getTraceContext } from "../core/trace-context";
import { TelemetryEvent, TelemetryPayload } from "./taxonomy";
import { PiiSanitizer } from "./processors/pii-sanitizer";
import { TelemetryTransport } from "./transport/types";
import { ConsoleTransport } from "./transport/console.transport";
import { AxiomTransport } from "./transport/axiom.transport";

class TelemetryGateway {
  private transports: TelemetryTransport[] = [];

  constructor() {
    // Configure default transports
    this.transports.push(new ConsoleTransport());
    this.transports.push(new AxiomTransport());
  }

  private generateEventId(): string {
    return crypto.randomUUID();
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
        metadata: PiiSanitizer.sanitize(metadata),
        ...(error && {
          error: {
            name: error.name,
            message: error.message,
            stack: process.env.NODE_ENV === "development" ? error.stack : undefined
          }
        })
      };

      // Non-blocking dispatch to all registered transports
      this.transports.forEach(transport => {
        try {
          transport.dispatch(payload);
        } catch (transportErr) {
          // A failing transport must never bring down the application
          console.error(`[TelemetryGateway] Transport failed to dispatch:`, transportErr);
        }
      });
      
    } catch (e) {
      // Gateway crash should not kill the runtime
      console.error("CRITICAL: TelemetryGateway crashed", e);
    }
  }
}

export const telemetry = new TelemetryGateway();
