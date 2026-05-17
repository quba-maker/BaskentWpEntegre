# ADR 0003: System Hardening & Platform Governance

## Status
Accepted

## Context
Following the implementation of the asynchronous event-driven architecture, distributed trace propagation, and AI resilience patterns (Circuit Breaker & Cost Limiter), the Quba AI SaaS platform has transitioned into an enterprise-grade structure. At this scale, the primary risks shift from functional bugs to operational regression, security bypasses, and unmonitored anomalies.

To prevent the architecture from degrading over time and to ensure high reliability without manual oversight, we need a formalized "System Hardening Mode."

## Decision

We are implementing a 10-point Platform Governance & System Hardening protocol, effectively enforcing a "Production Lock."

### 1. Production Lock (CI/CD Gates)
- **Rule**: Direct pushes to `main` are disabled.
- **Enforcement**: Required CI checks for Type Safety, ESLint (No Raw SQL), and Unit Tests before merging. Preview deployments are mandatory for QA.

### 2. Environment Governance
- **Rule**: `.env` files must adhere to strict standardization and categorization.
- **Enforcement**: See `.env.example`. Variables are classified by infrastructure layers (Database, Queue, Telemetry, AI, Meta, Security). Legacy keys are systematically purged.

### 3. Database Cleanup
- **Rule**: The schema must only contain actively used fields. Deprecated fields are documented and removed in planned migration cycles.

### 4. Prompt Governance
- **Rule**: All AI prompts are version-controlled. Changes to system prompts require peer review. "Prompt History" logs are maintained for debugging AI degradation.

### 5. Human Support Mode (Handoff)
- **Rule**: The AI Orchestrator must support an explicit `PAUSE_AI` state to allow human operators to take over a conversation upon detecting a `LLM_POLICY_REJECTED` or excessive `QUEUE_RETRY` scenario.

### 6. Observability Dashboard
- **Rule**: Axiom acts as the single pane of glass.
- **Metrics Tracked**: Queue Latency, Retry Rate, AI Token Usage, DLQ Count, Tenant Firewall Rejections, and Cost Anomalies.

### 7. Cost Control Monitoring
- **Rule**: `CostLimiter` limits are actively monitored. Tenant-level hourly/daily token usage must trigger warnings to Slack before hard limits are hit.

### 8. Disaster Recovery (Backup Testing)
- **Rule**: Bi-weekly automated verification of Point-in-Time Recovery (PITR) to ensure a theoretical 30-minute RTO (Recovery Time Objective).

### 9. Performance Pass
- **Rule**: Establish linting rules to prevent unoptimized queries and enforce caching mechanisms for frequently accessed tenant configurations.

### 10. Documentation Freeze
- **Rule**: All major architectural decisions and deployment strategies must be formally documented as ADRs.

## Consequences

### Positive
- Prevents architectural decay as the engineering team scales.
- Drastically reduces the "Blast Radius" of human error.
- Ensures observability and financial predictability.
- Shifts the engineering focus from constant firefighting to product optimization and feature delivery.

### Negative
- Increases friction for rapid, hot-fix deployments.
- Requires strict adherence to policy-as-code from all developers.
