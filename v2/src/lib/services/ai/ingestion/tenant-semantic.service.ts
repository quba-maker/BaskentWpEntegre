import { neon } from '@neondatabase/serverless';

export interface SemanticRulePayload {
  tenantId: string;
  sourceField: string;
  resolvedEntity: string;
  confidenceThreshold?: number;
  isOperatorEnforced?: boolean;
}

/**
 * Tenant Semantic Rules Service (Learning Loop)
 * Handles multi-tenant AI isolation where the system learns the unique semantic mapping
 * and jargon for each individual tenant over time based on operator feedback.
 */
export class TenantSemanticService {
  private static getSql() {
    return neon(process.env.DATABASE_URL!);
  }

  /**
   * When an operator corrects an AI mapping, save it so the AI learns for this tenant.
   */
  static async learnFromOperatorFeedback(payload: SemanticRulePayload) {
    const sql = this.getSql();
    const result = await sql`
      INSERT INTO tenant_semantic_rules (
        tenant_id,
        source_field,
        resolved_entity,
        confidence_threshold,
        is_operator_enforced,
        updated_at
      ) VALUES (
        ${payload.tenantId},
        ${payload.sourceField},
        ${payload.resolvedEntity},
        ${payload.confidenceThreshold || 0.85},
        ${payload.isOperatorEnforced !== undefined ? payload.isOperatorEnforced : true},
        NOW()
      )
      ON CONFLICT (tenant_id, source_field) 
      DO UPDATE SET 
        resolved_entity = EXCLUDED.resolved_entity,
        is_operator_enforced = EXCLUDED.is_operator_enforced,
        confidence_threshold = EXCLUDED.confidence_threshold,
        updated_at = NOW()
      RETURNING *
    `;
    return result[0];
  }

  /**
   * Fetch custom rules to inject into the LLM prompt so it respects past operator decisions.
   */
  static async getRulesForTenant(tenantId: string) {
    const sql = this.getSql();
    return await sql`
      SELECT source_field, resolved_entity, is_operator_enforced 
      FROM tenant_semantic_rules
      WHERE tenant_id = ${tenantId}
    `;
  }
}
