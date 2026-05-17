import { createTenantBrain } from "../../src/lib/brain/tenant-brain";
import { TenantFirewall, SecurityIsolationError } from "../../src/lib/security/tenant-firewall";
import { CacheBoundary } from "../../src/lib/security/cache-boundary";
import { VectorNamespace } from "../../src/lib/security/vector-namespace";
import { TenantQueryGuard } from "../../src/lib/security/tenant-query-guard";
import { PromptBuilder } from "../../src/lib/services/ai/prompt-builder";

describe("Enterprise Security & Tenant Isolation Enforcement", () => {
  const tenantA = "tenant_a_123";
  const tenantB = "tenant_b_456";

  it("should enforce deep immutability on TenantBrain", () => {
    const brain = createTenantBrain(tenantA, "whatsapp", "webhook_1", "I am tenant A");
    
    expect(() => {
      // @ts-ignore
      brain.context.tenantId = tenantB;
    }).toThrow();

    expect(() => {
      // @ts-ignore
      brain.prompts.systemPrompt = "Hacked";
    }).toThrow();

    expect(brain.context.tenantId).toBe(tenantA);
  });

  it("should fail closed on Cross-Tenant Firewall mismatch", () => {
    const brain = createTenantBrain(tenantA, "whatsapp", "webhook_1", "I am tenant A");
    
    expect(() => {
      TenantFirewall.assertTenantIsolation(brain, {
        resourceType: "conversation",
        resourceTenantId: tenantB // Attack: accessing B's conversation from A's brain
      });
    }).toThrow(SecurityIsolationError);
  });

  it("should block cache collisions", () => {
    expect(() => {
      CacheBoundary.assertTenantScopedCacheKey(tenantA, `tenant:${tenantB}:conversation:123`, "conversation");
    }).toThrow(SecurityIsolationError);
  });

  it("should block invalid KB namespace format (Future RAG standard)", () => {
    expect(() => {
      CacheBoundary.assertTenantScopedCacheKey(tenantA, `tenant:${tenantA}:kb:legacy_wrong_format`, "kb");
    }).not.toThrow();

    expect(() => {
      CacheBoundary.assertTenantScopedCacheKey(tenantA, `tenant:${tenantA}:documents:wrong_namespace`, "kb");
    }).toThrow(SecurityIsolationError);
  });

  it("should enforce vector metadata requirements", () => {
    expect(() => {
      VectorNamespace.assertTenantSafeEmbedding({
        tenant_id: tenantA,
        // missing namespace, source, visibility
      });
    }).toThrow(SecurityIsolationError);
  });

  it("should enforce vector retrieval filters", () => {
    expect(() => {
      VectorNamespace.assertTenantSafeRetrieval(tenantA, { tenant_id: tenantB });
    }).toThrow(SecurityIsolationError);

    // Should inject tenant_id if missing
    const safeFilter = VectorNamespace.assertTenantSafeRetrieval(tenantA, { status: "active" });
    expect(safeFilter.tenant_id).toBe(tenantA);
  });

  it("should enforce TenantQueryGuard parameters", () => {
    expect(() => {
      TenantQueryGuard.assertTenantBoundQuery(tenantA, "SELECT * FROM users WHERE tenant_id = $1", [tenantB]);
    }).toThrow(SecurityIsolationError);

    expect(() => {
      TenantQueryGuard.assertTenantBoundQuery(tenantA, "SELECT * FROM users", []);
    }).toThrow(SecurityIsolationError);
    
    expect(() => {
      TenantQueryGuard.assertTenantBoundQuery(tenantA, "SELECT * FROM users WHERE tenant_id = $1", [tenantA]);
    }).not.toThrow();
  });

  it("should reject prompt injection", () => {
    const brain = createTenantBrain(tenantA, "whatsapp", "webhook_1", "Legit prompt");
    
    // Simulate attack bypassing brain by overriding object if it wasn't frozen
    // But since we use PromptBuilder
    expect(() => {
       // @ts-ignore - Simulating an internal call where prompt doesn't match brain
       PromptBuilder.validatePromptOwnership(brain, "Hacked string");
    }).toThrow(SecurityIsolationError);
  });
});
