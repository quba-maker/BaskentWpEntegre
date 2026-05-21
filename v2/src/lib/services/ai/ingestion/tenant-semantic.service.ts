import { withTenantDB } from '@/lib/core/tenant-db';

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
  /**
   * When an operator corrects an AI mapping, save it so the AI learns for this tenant.
   */
  static async learnFromOperatorFeedback(payload: SemanticRulePayload) {
    const db = withTenantDB(payload.tenantId);
    const result = await db.executeSafe({
      text: `
        INSERT INTO tenant_semantic_rules (
          tenant_id,
          source_field,
          resolved_entity,
          confidence_threshold,
          is_operator_enforced,
          updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, NOW()
        )
        ON CONFLICT (tenant_id, source_field) 
        DO UPDATE SET 
          resolved_entity = EXCLUDED.resolved_entity,
          is_operator_enforced = EXCLUDED.is_operator_enforced,
          confidence_threshold = EXCLUDED.confidence_threshold,
          updated_at = NOW()
        RETURNING *
      `,
      values: [
        payload.tenantId,
        payload.sourceField,
        payload.resolvedEntity,
        payload.confidenceThreshold || 0.85,
        payload.isOperatorEnforced !== undefined ? payload.isOperatorEnforced : true
      ]
    }) as any[];
    return result[0];
  }

  /**
   * Fetch custom rules to inject into the LLM prompt so it respects past operator decisions.
   */
  static async getRulesForTenant(tenantId: string) {
    const db = withTenantDB(tenantId);
    return await db.executeSafe({
      text: `
        SELECT source_field, resolved_entity, is_operator_enforced 
        FROM tenant_semantic_rules
        WHERE tenant_id = $1
      `,
      values: [tenantId]
    }) as any[];
  }
}
