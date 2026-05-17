# ADR 0002: Event Taxonomy and Telemetry Gateway

## Status
Accepted

## Date
2026-05-17

## Context
As the Quba AI OS evolves into a distributed, multi-tenant AI infrastructure, traditional logging (`console.log`, `logger.info`) is no longer sufficient. We need full execution telemetry to trace the asynchronous lifecycle of requests across webhooks, queues, edge workers, databases, and third-party APIs (LLM, Meta). 
Unstructured logs lead to untraceable systems, and high-cardinality indexing (e.g., indexing raw message IDs or phone numbers) causes exponential costs in observability platforms like Axiom and Datadog.

## Decision
We are deprecating the traditional `logger` module in favor of a **Telemetry Gateway** (`telemetry.track(event)`). 
This Gateway is transport-agnostic, meaning it can route metrics, traces, and events to Axiom, Sentry, or OpenTelemetry without coupling the business logic to a specific vendor.

### Event Taxonomy Standard
All events MUST use one of the predefined taxonomy constants. Arbitrary string events are forbidden.
- `QUEUE_RECEIVED`, `QUEUE_RETRY`, `QUEUE_DLQ`
- `TENANT_RESOLVED`, `TENANT_REJECTED`
- `SECURITY_ASSERTION_FAILED`, `SECURITY_CROSS_TENANT_BLOCKED`
- `LLM_STARTED`, `LLM_COMPLETED`, `LLM_TIMEOUT`, `LLM_POLICY_REJECTED`
- `WHATSAPP_SENT`, `WHATSAPP_FAILED`

### High Cardinality Protection
We separate telemetry data into two layers:
1. **Indexed Fields (Low Cardinality):** `tenantId`, `workerId`, `eventType`, `status`, `channel`
2. **Metadata (High Cardinality - Not Indexed):** `phone_number`, `raw_message_id`, `prompt_hash`, `error_stack`

### Execution Flow Tracing
Every event must include:
- `traceId`: Binds the entire execution lifecycle.
- `conversationId`: Binds the user session.
- `tenantId`: Identifies the environment.
- `workerId`: Identifies the execution node.

## Consequences
- **Positive:** Enables robust Anomaly Detection, Tenant Health Scoring, and deterministic debugging without exploding observability costs.
- **Negative:** Developers must conform strictly to the Event Taxonomy. Custom strings are not allowed for primary event names.
- **Mitigation:** The ESLint AST rules will be updated to enforce the `telemetry.track()` standard. TypeScript interfaces will strictly type the allowed event names.
