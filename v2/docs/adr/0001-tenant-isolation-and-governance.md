# ADR 0001: Strict Tenant Isolation and Platform Governance

## Status
Accepted

## Date
2026-05-17

## Context
The Quba AI OS is transitioning from a feature-driven SaaS MVP to a distributed multi-tenant AI infrastructure. As the platform scales, the risk profile shifts from standard feature bugs to distributed failures, cross-tenant data leakage, and uncontrolled billing costs. Relying on developer discipline and coding conventions ("soft-convention") is no longer sufficient and poses an unacceptable regression risk as the engineering team grows.

## Decision
We are adopting a **Platform Governance and Zero-Trust Isolation** model. All security, isolation, and infrastructure rules must be enforced via automated, hard-fail mechanisms.

The following architectural principles are mandatory:
1. **Immutable Tenant Context:** The `TenantBrain` and all resolved contexts must be deep-frozen at runtime to prevent accidental or malicious memory contamination.
2. **Hard Fail-Closed Enforcement:** Missing or malformed tenant context must instantly throw a `SecurityIsolationError` and block execution. Fallbacks are strictly prohibited.
3. **Automated Code Governance:** Direct execution of raw SQL via `sql(...)` is banned. All database interactions must route through `tenantDb.executeSafe()` which enforces the injection of `tenant_id`. This will be enforced by custom ESLint rules and a CI Security Gate.
4. **Billing & Anomaly Firewalls:** AI operations must pass through a Circuit Breaker that evaluates token usage, retry depth, and rate limits to prevent runaway loops and spam.
5. **Observability First:** All logs must contain structured, mandatory fields (`tenantId`, `traceId`, `conversationId`, `workerId`). System observability (Axiom/Datadog) is a prerequisite for scaling, not an afterthought.

## Consequences
- **Positive:** Mathematical guarantee against cross-tenant data leaks. Regression risks are mitigated by CI pipelines and ESLint rules. Scalability is protected from runaway costs.
- **Negative:** Increased initial development overhead. Developers must adhere strictly to the `tenantDb` and `TenantBrain` APIs.
- **Mitigation:** Comprehensive documentation, custom ESLint auto-fixers (where applicable), and clear error messages in the CI pipeline to guide developers.
